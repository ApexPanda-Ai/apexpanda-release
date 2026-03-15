/**
 * 工作流 DAG 执行引擎
 * 支持串行/并行、步骤超时、断点续传
 */
import { runAgent } from '../agent/runner.js';
import { getAgent } from '../agent/store.js';
import { recordUsage } from '../usage/store.js';
import { invokeTool } from '../skills/registry.js';
import { invokeMcpTool } from '../mcp/client.js';
import { getKnowledgeStore } from '../knowledge/store-getter.js';
import { saveRunCheckpoint, getRunCheckpoint } from './store.js';
import { executeVerify, VerifyFailedError } from './verify-node.js';
import { sendReplyToChannel } from './channel-reply.js';
const STEP_TIMEOUT_MS = Number(process.env.APEXPANDA_WORKFLOW_STEP_TIMEOUT_MS) || 300_000;
/** 拓扑排序，返回层级（同一层级可并行） */
function topologicalLevels(def) {
    const inDegree = new Map();
    const outEdges = new Map();
    for (const n of def.nodes) {
        inDegree.set(n.id, 0);
        outEdges.set(n.id, []);
    }
    for (const e of def.edges) {
        inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
        const arr = outEdges.get(e.from) ?? [];
        arr.push(e.to);
        outEdges.set(e.from, arr);
    }
    const levels = [];
    let remaining = new Set(def.nodes.map((n) => n.id));
    while (remaining.size > 0) {
        const ready = [];
        for (const id of remaining) {
            if (inDegree.get(id) === 0)
                ready.push(id);
        }
        if (ready.length === 0) {
            throw new Error('Workflow has cycles');
        }
        levels.push(ready);
        for (const id of ready) {
            remaining.delete(id);
            for (const to of outEdges.get(id) ?? []) {
                inDegree.set(to, (inDegree.get(to) ?? 1) - 1);
            }
        }
    }
    return levels;
}
async function executeNode(node, inputs, channelCtx) {
    const cfg = node.config ?? {};
    const nodeTimeoutMs = typeof cfg.timeout === 'number' && cfg.timeout > 0
        ? Math.min(cfg.timeout, 600_000)
        : cfg.skillName === 'remote-exec' && typeof cfg.params?.timeout === 'number'
            ? Math.min(cfg.params.timeout, 600_000)
            : STEP_TIMEOUT_MS;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`Step ${node.id} timeout after ${nodeTimeoutMs}ms`)), nodeTimeoutMs));
    if (node.type === 'agent') {
        const agentId = cfg.agentId;
        let message = cfg.message ?? '请根据上下文完成任务';
        if (typeof message === 'string') {
            const prev = inputs['__prev'] ?? inputs[node.id] ?? inputs.message;
            if (message.includes('{{prev}}'))
                message = message.replace(/\{\{prev\}\}/g, String(prev ?? ''));
            if (message.includes('{{workflowName}}'))
                message = message.replace(/\{\{workflowName\}\}/g, String(inputs.workflowName ?? ''));
        }
        const store = getKnowledgeStore();
        const agent = agentId ? await getAgent(agentId) : null;
        /** 节点可单独配置 mcpServerIds，覆盖或补充 Agent 的；未配置时用 Agent 的 */
        const nodeMcpIds = Array.isArray(cfg.mcpServerIds) ? cfg.mcpServerIds.filter(Boolean) : undefined;
        const mcpServerIds = nodeMcpIds ?? agent?.mcpServerIds;
        const memScopeHint = channelCtx?.chatType === 'p2p' && channelCtx?.userId
            ? `user:${channelCtx.userId}`
            : channelCtx?.chatType === 'group' && channelCtx?.chatId
                ? `group:${channelCtx.chatId}`
                : undefined;
        const result = await Promise.race([
            runAgent({
                knowledgeStore: store,
                topK: 5,
                model: agent?.model,
                systemPrompt: agent?.systemPrompt,
                workerIds: agent?.workerIds,
                mcpServerIds,
                skillIds: agent?.skillIds,
                nodeToolsEnabled: agent?.nodeToolsEnabled,
            }, {
                message,
                agentId: agentId ?? undefined,
                agentMemoryVisibility: agent?.memoryVisibility ?? 'shared',
                userId: channelCtx?.userId,
                memoryScopeHint: memScopeHint,
                deleteSource: channelCtx ? 'channel' : 'agent',
            }),
            timeout,
        ]);
        if (result.usage) {
            recordUsage(result.usage.promptTokens, result.usage.completionTokens, result.model);
        }
        return result.reply;
    }
    if (node.type === 'skill') {
        const { skillName, toolId, params: rawParams } = node.config;
        if (!skillName || !toolId)
            throw new Error('skillName and toolId required');
        const prev = inputs['__prev'];
        const params = {};
        for (const [k, v] of Object.entries(rawParams ?? {})) {
            if (typeof v === 'string' && v.includes('{{prev}}')) {
                params[k] = v.replace(/\{\{prev\}\}/g, String(prev ?? ''));
            }
            else {
                params[k] = v;
            }
        }
        return Promise.race([
            invokeTool(skillName, toolId, params, { deleteSource: channelCtx ? 'channel' : 'agent' }),
            timeout,
        ]);
    }
    if (node.type === 'mcp') {
        const { serverId, toolName, params: rawParams } = node.config;
        if (!serverId || !toolName)
            throw new Error('serverId and toolName required for MCP node');
        const prev = inputs['__prev'];
        const params = {};
        for (const [k, v] of Object.entries(rawParams ?? {})) {
            if (typeof v === 'string' && v.includes('{{prev}}')) {
                params[k] = v.replace(/\{\{prev\}\}/g, String(prev ?? ''));
            }
            else {
                params[k] = v;
            }
        }
        const mcpName = `mcp_${serverId}_${toolName}`;
        return Promise.race([invokeMcpTool(mcpName, params), timeout]);
    }
    if (node.type === 'human') {
        throw new Error('HUMAN_NODE_PENDING');
    }
    if (node.type === 'loop') {
        const cfg2 = node.config;
        const loopStepIds = Array.isArray(cfg2.steps) ? cfg2.steps : [];
        const exitKeyword = (cfg2.exitCondition ?? '').trim();
        const maxIter = typeof cfg2.maxIterations === 'number' && cfg2.maxIterations > 0 ? Math.min(cfg2.maxIterations, 20) : 5;
        let lastLoopOutput = '';
        for (let iter = 0; iter < maxIter; iter++) {
            for (const sid of loopStepIds) {
                const snode = inputs['__nodeById'] instanceof Map ? inputs['__nodeById'].get(sid) : undefined;
                if (!snode)
                    throw new Error(`Loop step node not found: ${sid}`);
                const sout = await executeNode(snode, { ...inputs, __prev: lastLoopOutput }, channelCtx);
                lastLoopOutput = typeof sout === 'string' ? sout : JSON.stringify(sout);
            }
            if (exitKeyword && lastLoopOutput.includes(exitKeyword)) {
                break;
            }
        }
        return lastLoopOutput;
    }
    if (node.type === 'verify') {
        const prev = inputs['__prev'];
        const vcfg = node.config;
        const checkpoint = (vcfg.checkpoint ?? '').trim() || '产出需完整、无逻辑矛盾';
        const validator = vcfg.validator === 'rule' || vcfg.validator === 'skill' ? vcfg.validator : 'llm';
        return Promise.race([
            executeVerify(prev, { checkpoint, validator, skillName: vcfg.skillName, toolId: vcfg.toolId, params: vcfg.params, keywords: vcfg.keywords, regex: vcfg.regex }),
            timeout,
        ]);
    }
    throw new Error(`Unknown node type: ${node.type}`);
}
export async function runWorkflow(def, input, runIdOrOpts) {
    const opts = typeof runIdOrOpts === 'string' ? { runId: runIdOrOpts } : (runIdOrOpts ?? {});
    const rid = opts.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let checkpoint = await getRunCheckpoint(rid);
    const stepOutputs = checkpoint?.stepOutputs ?? {};
    const channelContext = opts.channelContext ?? checkpoint?.channelContext;
    const levels = topologicalLevels(def);
    const nodeById = new Map(def.nodes.map((n) => [n.id, n]));
    saveRunCheckpoint({
        runId: rid,
        workflowId: def.id,
        status: 'running',
        stepOutputs,
        startedAt: checkpoint?.startedAt ?? Date.now(),
        channelContext,
    });
    try {
        for (const level of levels) {
            const toRun = level.filter((nid) => stepOutputs[nid] == null);
            if (toRun.length === 0)
                continue;
            const humanNodes = toRun.filter((nid) => nodeById.get(nid).type === 'human');
            const nonHumanNodes = toRun.filter((nid) => nodeById.get(nid).type !== 'human');
            // 同一 level 内互不依赖的节点并行执行
            if (nonHumanNodes.length > 0) {
                const results = await Promise.all(nonHumanNodes.map(async (nid) => {
                    const node = nodeById.get(nid);
                    const nodeInputs = { ...input, __nodeById: nodeById };
                    const prevIds = def.edges.filter((e) => e.to === nid).map((e) => e.from);
                    if (prevIds.length === 1) {
                        nodeInputs['__prev'] = stepOutputs[prevIds[0]];
                    }
                    else if (prevIds.length > 1) {
                        nodeInputs['__prev'] = prevIds.map((p) => stepOutputs[p]);
                    }
                    const out = await executeNode(node, nodeInputs, channelContext?.ctx);
                    return { nid, out };
                }));
                for (const { nid, out } of results) {
                    stepOutputs[nid] = out;
                }
            }
            // 人工节点逐个处理，遇 human 即暂停等待 resume
            for (const nid of humanNodes) {
                const node = nodeById.get(nid);
                const prompt = node.config?.prompt ?? '请提供输入';
                saveRunCheckpoint({
                    runId: rid,
                    workflowId: def.id,
                    status: 'pending_human',
                    stepOutputs,
                    currentStep: nid,
                    pendingHumanNode: nid,
                    pendingHumanPrompt: prompt,
                    startedAt: checkpoint?.startedAt ?? Date.now(),
                    channelContext,
                });
                return { runId: rid, status: 'pending_human', output: { nodeId: nid, prompt } };
            }
        }
        const lastLevel = levels[levels.length - 1];
        const output = lastLevel.length === 1 ? stepOutputs[lastLevel[0]] : lastLevel.map((id) => stepOutputs[id]);
        saveRunCheckpoint({
            runId: rid,
            workflowId: def.id,
            status: 'completed',
            stepOutputs,
            completedAt: Date.now(),
            startedAt: checkpoint?.startedAt ?? Date.now(),
            channelContext,
        });
        const outputText = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
        if (channelContext && !opts.skipChannelReply) {
            sendReplyToChannel(channelContext.channel, channelContext.ctx, outputText).catch((e) => console.error('[Workflow] Channel reply failed:', e));
        }
        return { runId: rid, status: 'completed', output };
    }
    catch (e) {
        const err = e instanceof VerifyFailedError
            ? e.issues?.length
                ? `${e.message}：${e.issues.join('；')}`
                : e.message
            : e instanceof Error
                ? e.message
                : String(e);
        saveRunCheckpoint({
            runId: rid,
            workflowId: def.id,
            status: 'failed',
            stepOutputs,
            error: err,
            completedAt: Date.now(),
            startedAt: checkpoint?.startedAt ?? Date.now(),
            channelContext,
        });
        if (channelContext && !opts.skipChannelReply) {
            sendReplyToChannel(channelContext.channel, channelContext.ctx, `工作流执行失败：${err}`).catch((e) => console.error('[Workflow] Channel reply failed:', e));
        }
        return { runId: rid, status: 'failed', error: err };
    }
}
/**
 * Human-in-the-loop: 用人工输入恢复工作流执行
 */
export async function resumeWorkflow(def, runId, humanInput) {
    const checkpoint = await getRunCheckpoint(runId);
    if (!checkpoint || checkpoint.workflowId !== def.id) {
        throw new Error('Run not found');
    }
    if (checkpoint.status !== 'pending_human' || !checkpoint.pendingHumanNode) {
        throw new Error('Run is not waiting for human input');
    }
    const stepOutputs = { ...checkpoint.stepOutputs };
    stepOutputs[checkpoint.pendingHumanNode] = humanInput;
    saveRunCheckpoint({
        ...checkpoint,
        status: 'running',
        stepOutputs,
        currentStep: undefined,
        pendingHumanNode: undefined,
        pendingHumanPrompt: undefined,
    });
    return runWorkflow(def, {}, { runId, channelContext: checkpoint.channelContext });
}
//# sourceMappingURL=engine.js.map