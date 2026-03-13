import { getAgent } from '../agent/store.js';
import { runAgent } from '../agent/runner.js';
import { getLLMProvider } from '../agent/config.js';
import { runWorkflow } from '../workflow/engine.js';
import { getKnowledgeStore } from '../knowledge/store-getter.js';
import { getMultiAgentConfig } from '../config/loader.js';
import { createBlackboard, blackboardWrite, blackboardSummary, destroyBlackboard } from './task-blackboard.js';
import { setPendingPlan } from './pending-plan-store.js';
import { appendMultiAgentRun, makeRunId } from './multi-agent-run-store.js';
import { recordUsage } from '../usage/store.js';
/**
 * 意图感知：根据任务文本和 Agent 特征自动推断协同模式（智能默认）
 * 优先级：inline > 意图感知 > 兜底默认 > config 全局设置
 * 规则顺序：supervisor(workerIds) → plan(循环/≥4) → pipeline(顺序词) → parallel(并列词)
 * 返回 undefined 表示无法确定，由 selectCollabMode 使用兜底默认
 */
function detectIntentMode(task, agents, agentIds) {
    const t = task;
    // 1. 纯主控型：某 Agent 的 workerIds 包含其他 @ 的 Agent → supervisor
    for (const a of agents) {
        const workerIds = a.workerIds ?? [];
        const others = agentIds.filter((id) => id !== a.id);
        const hasOthersAsWorkers = others.length > 0 && others.some((id) => workerIds.includes(id));
        if (hasOthersAsWorkers)
            return 'supervisor';
    }
    // 2. 循环/复杂意图 或 Agent ≥ 4 → plan
    const loopKeywords = /直到|持续|循环|不断|反复|测试通过|重试|retry|loop|until|多轮/i;
    if (agents.length >= 4 || loopKeywords.test(t))
        return 'plan';
    // 3. 顺序意图 → pipeline
    const seqKeywords = /先[^后]*后|然后|接着|再[^来]|之后|最后|第一步|第二步|步骤\d|阶段\d|→|=>|first.*then/i;
    if (seqKeywords.test(t))
        return 'pipeline';
    // 4. 并行意图：Agent 2-3 且含并列词 → parallel
    const parallelKeywords = /同时|并行|分别|各自|一起|同步/i;
    if (parallelKeywords.test(t) && agents.length <= 3)
        return 'parallel';
    return undefined;
}
/**
 * 兜底默认：规则均不命中时
 * 2–3 个 Agent → pipeline（顺序执行更常见）；≥ 4 个 → plan（依赖多、需规划）
 */
function getDefaultFallbackMode(agents) {
    return agents.length >= 4 ? 'plan' : 'pipeline';
}
const VALID_MODES = ['supervisor', 'pipeline', 'parallel', 'plan'];
/**
 * LLM 推理兜底：规则不命中时，单次轻量调用推断协同模式
 * 返回 { mode, reason } 或 undefined（失败时）
 */
async function llmSelectCollabMode(task, agents) {
    const agentDesc = agents
        .map((a) => `- ${a.id}（${a.name}）：${a.category ?? ''}，技能：${(a.skillIds ?? []).join('、') || '无'}`)
        .join('\n');
    const systemPrompt = `你是多 Agent 协同模式选择助手。根据用户任务和 Agent 能力，选择最合适的协同模式。

模式说明：
- supervisor：有主控型 Agent（可委托他人）时，适合主从式分工
- pipeline：任务有明确先后顺序（如产品→设计→开发）时，适合流水线
- parallel：任务可拆成多个独立子任务同时执行时，适合并行
- plan：任务复杂、依赖多、或需要循环（测试-修复）时，适合动态规划

仅返回 JSON，无其他文字：{"mode":"supervisor|pipeline|parallel|plan","reason":"一句话说明"}`;
    const userMsg = `用户任务：${task}\n\n可选 Agent：\n${agentDesc}\n\n请选择协同模式并简要说明。`;
    try {
        const provider = getLLMProvider();
        const result = await provider.complete([{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }], { temperature: 0.1, maxTokens: 150 });
        const content = result.content?.trim() ?? '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            return undefined;
        const parsed = JSON.parse(jsonMatch[0]);
        const mode = parsed.mode?.toLowerCase();
        if (mode && VALID_MODES.includes(mode)) {
            return { mode: mode, reason: parsed.reason ?? '' };
        }
        return undefined;
    }
    catch (e) {
        console.warn('[多 Agent] LLM 模式选择失败，使用规则兜底:', e);
        return undefined;
    }
}
/** 从任务文本提取关键词（简单分词：连续字母数字或中文） */
function extractTaskKeywords(task) {
    const words = task
        .replace(/[@\s\u200b-\u200d\ufeff]+/g, ' ')
        .split(/\s+/)
        .map((s) => s.toLowerCase().trim())
        .filter((s) => s.length >= 2);
    return new Set(words);
}
/** 计算 Agent 与任务的能力匹配分数（category/description/skillIds 关键词重叠） */
function scoreAgentCapability(agent, keywords) {
    const text = [
        agent.category ?? '',
        agent.description ?? '',
        (agent.skillIds ?? []).join(' '),
        agent.name ?? '',
    ]
        .join(' ')
        .toLowerCase();
    const textWords = new Set(text.match(/[\u4e00-\u9fa5a-z0-9]+/g) ?? []);
    let score = 0;
    for (const kw of keywords) {
        if (textWords.has(kw) || text.includes(kw))
            score += 1;
    }
    return score;
}
/**
 * 选主控：按配置策略选择
 * - workerIds: 有 workerIds 且包含其他 @ Agent 者优先
 * - first: 第一个 @ 为主控
 * - capability: 按 category/description/skillIds 与任务匹配打分，最高者为主控
 */
function selectLeader(agents, agentIds, task) {
    const cfg = getMultiAgentConfig();
    const idSet = new Set(agentIds);
    if (cfg.leaderSelection === 'first') {
        const leader = agents[0];
        const workers = agentIds.filter((id) => id !== leader.id);
        return { leader, workers };
    }
    if (cfg.leaderSelection === 'capability') {
        const keywords = extractTaskKeywords(task);
        const scored = agents.map((a) => ({ a, score: scoreAgentCapability(a, keywords) }));
        scored.sort((x, y) => y.score - x.score);
        const leader = scored[0].a;
        const workers = agentIds.filter((id) => id !== leader.id);
        return { leader, workers };
    }
    // workerIds（默认）：有 workerIds 且包含其他 @ 者优先
    for (const a of agents) {
        const workerIds = a.workerIds ?? [];
        const others = agentIds.filter((id) => id !== a.id);
        const hasOthersAsWorkers = others.length > 0 && others.every((id) => workerIds.includes(id));
        if (hasOthersAsWorkers) {
            const workers = [...new Set([...workerIds, ...others])].filter((id) => idSet.has(id));
            return { leader: a, workers };
        }
    }
    const leader = agents[0];
    const workers = agentIds.filter((id) => id !== leader.id);
    return { leader, workers };
}
/**
 * 流水线协同：按 agentIds 顺序执行，前一 Agent 产出作为后一 Agent 输入
 */
async function runPipelineOrchestrator(input, agents) {
    const { task, agentIds, channelSessionId, history, memoryScopeHint, userId, onProgress } = input;
    const store = getKnowledgeStore();
    let prevOutput = '';
    const pipelineOrder = agentIds
        .map((id) => agents.find((a) => a.id === id))
        .filter((a) => Boolean(a));
    let accumulatedHistory = [...history];
    const stepReplies = [];
    const bbId = createBlackboard();
    for (let i = 0; i < pipelineOrder.length; i++) {
        const agent = pipelineOrder[i];
        const prevName = i > 0 ? pipelineOrder[i - 1].name : '';
        // 优先使用黑板摘要（含所有前步产出），只有第一步无前序时使用原始 task
        const bbSummary = i > 0 ? blackboardSummary(bbId, []) : '';
        const message = i === 0
            ? task
            : `${task}\n\n【协作上下文（前序 Agent 产出摘要）】\n${bbSummary}\n\n【直接前序（${prevName}）产出】\n${prevOutput}`;
        if (onProgress) {
            await onProgress(`【流水线 ${i + 1}/${pipelineOrder.length}】${agent.name} 正在执行…`);
        }
        // 用 agent 名称包装进度，让用户看出每条 tool 进展属于哪个 Agent
        const agentProgress = onProgress
            ? async (msg) => onProgress(`【${agent.name}】${msg}`)
            : undefined;
        const result = await runAgent({
            knowledgeStore: store,
            topK: 5,
            model: agent.model,
            systemPrompt: agent.systemPrompt,
            workerIds: [],
            mcpServerIds: agent.mcpServerIds,
            skillIds: agent.skillIds,
            nodeToolsEnabled: agent.nodeToolsEnabled,
            enableTools: true,
        }, {
            message,
            sessionId: channelSessionId,
            history: accumulatedHistory,
            memoryScopeHint,
            agentId: agent.id,
            agentMemoryVisibility: agent.memoryVisibility ?? 'shared',
            userId,
            onProgress: agentProgress,
            deleteSource: onProgress ? 'channel' : 'agent',
        });
        if (result.usage) {
            recordUsage(result.usage.promptTokens, result.usage.completionTokens, result.model);
        }
        prevOutput = result.reply;
        stepReplies.push(result.reply);
        // 写入黑板，后续 Agent 可按名称读取
        blackboardWrite(bbId, agent.name, result.reply);
        accumulatedHistory = [...accumulatedHistory, { role: 'user', content: message }, { role: 'assistant', content: result.reply }];
    }
    destroyBlackboard(bbId);
    const lastNames = pipelineOrder.map((a) => a.name).join(' → ');
    if (pipelineOrder.length <= 1) {
        return { reply: prevOutput };
    }
    // 展示每个环节的 Agent 名称和产出，让用户清晰看到流水线各阶段
    const parts = pipelineOrder.map((a, i) => {
        const isLast = i === pipelineOrder.length - 1;
        const label = isLast ? `【${a.name}】（最终产出）` : `【${a.name}】`;
        return `${label}\n${stepReplies[i]}`;
    });
    return { reply: `经流水线（${lastNames}）协作：\n\n${parts.join('\n\n---\n\n')}` };
}
/**
 * 并行分工：各 Agent 同时执行同一任务，按能力分工理解，最后汇总产出
 */
async function runParallelOrchestrator(input, agents) {
    const { task, agentIds, channelSessionId, history, memoryScopeHint, userId, onProgress } = input;
    const store = getKnowledgeStore();
    const orderedAgents = agentIds
        .map((id) => agents.find((a) => a.id === id))
        .filter((a) => Boolean(a));
    if (onProgress) {
        const names = orderedAgents.map((a) => a.name).join('、');
        await onProgress(`【并行分工】${names} 正在同时执行…`);
    }
    const roleHint = (agent) => `\n\n【并行协作】你是 ${agent.name}，请从你的专业角度完成任务的相应部分。其他 Agent 会并行处理各自擅长部分，最终将汇总给用户。`;
    const bbIdParallel = createBlackboard();
    const results = await Promise.all(orderedAgents.map((agent) => {
        // 每个 Agent 的 tool 进展带上自己名称，并行时不会混淆
        const agentProgress = onProgress
            ? async (msg) => onProgress(`【${agent.name}】${msg}`)
            : undefined;
        return runAgent({
            knowledgeStore: store,
            topK: 5,
            model: agent.model,
            systemPrompt: (agent.systemPrompt ?? '') + roleHint(agent),
            workerIds: [],
            mcpServerIds: agent.mcpServerIds,
            skillIds: agent.skillIds,
            nodeToolsEnabled: agent.nodeToolsEnabled,
            enableTools: true,
        }, {
            message: task,
            sessionId: channelSessionId,
            history,
            memoryScopeHint,
            agentId: agent.id,
            agentMemoryVisibility: agent.memoryVisibility ?? 'shared',
            userId,
            onProgress: agentProgress,
            deleteSource: onProgress ? 'channel' : 'agent',
        });
    }));
    for (const r of results) {
        if (r.usage)
            recordUsage(r.usage.promptTokens, r.usage.completionTokens, r.model);
    }
    orderedAgents.forEach((a, i) => blackboardWrite(bbIdParallel, a.name, results[i].reply));
    destroyBlackboard(bbIdParallel);
    const parts = orderedAgents.map((a, i) => `【${a.name}】\n${results[i].reply}`).join('\n\n---\n\n');
    const header = orderedAgents.length > 1 ? `经并行协作（${orderedAgents.map((a) => a.name).join('、')}）汇总：\n\n` : '';
    return { reply: header + parts };
}
/** LLM 规划：生成子任务 DAG（含可选 loop 节点） */
async function planWithLLM(task, agents) {
    const agentDesc = agents
        .map((a) => `- ${a.id}（${a.name}）：${a.category ?? ''}，技能：${(a.skillIds ?? []).join('、') || '无'}`)
        .join('\n');
    const systemPrompt = `你是多 Agent 任务规划助手。根据用户任务和可选 Agent 能力，生成执行计划。
规则：
1. 每个步骤有 id（如 s0、s1）、agentId（必须是下方列表中的 id）、subTask（该 Agent 的子任务描述）、after（依赖的步骤 id 列表，无依赖则 []）
2. after 中的 id 必须出现在 steps 中，且不能形成环
3. 支持串行（A→B→C）、并行（A 和 B 无依赖同时执行）、混合（如 A→B、A→C 表示 A 完成后 B、C 并行）
4. 仅使用提供的 Agent，合理分配子任务
5. 若任务需要「执行-测试-修复」循环，可在 loops 字段声明：id（循环节点唯一 id）、steps（循环内步骤 id 列表）、exitCondition（退出关键词）、maxIterations（最大轮数，默认 5）、after（依赖的前序步骤 id）

必须返回 JSON，且只包含以下结构（无其他文字，loops 可选，无循环时省略）：
{"steps":[{"id":"s0","agentId":"Agent的id","subTask":"子任务描述","after":[]},...],"loops":[{"id":"loop0","steps":["s1","s2"],"exitCondition":"测试通过","maxIterations":5,"after":["s0"]}]}`;
    const userMsg = `用户任务：${task}\n\n可选 Agent：\n${agentDesc}\n\n请生成执行计划。`;
    const provider = getLLMProvider();
    const result = await provider.complete([{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }], { temperature: 0.2, maxTokens: 1200 });
    const content = result.content?.trim() ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
        return null;
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        const steps = parsed.steps;
        if (!Array.isArray(steps) || steps.length === 0)
            return null;
        const validIds = new Set(agents.map((a) => a.id));
        for (const s of steps) {
            if (!s.id || !s.agentId || !s.subTask)
                return null;
            if (!validIds.has(s.agentId))
                return null;
            if (s.after && !s.after.every((a) => steps.some((x) => x.id === a)))
                return null;
        }
        // 校验 loops 字段（可选）
        const allStepIds = new Set(steps.map((s) => s.id));
        const loops = [];
        if (Array.isArray(parsed.loops)) {
            for (const lp of parsed.loops) {
                if (!lp.id || !Array.isArray(lp.steps) || !lp.exitCondition)
                    continue;
                if (!lp.steps.every((sid) => allStepIds.has(sid)))
                    continue;
                loops.push(lp);
                allStepIds.add(lp.id); // loop 节点 id 也加入可引用集合
            }
        }
        return { steps, loops: loops.length > 0 ? loops : undefined };
    }
    catch {
        return null;
    }
}
/** 将计划格式化为人类可读的确认消息 */
function formatPlanPreview(plan, agentById) {
    const lines = ['【执行计划预览】\n'];
    plan.steps.forEach((s, i) => {
        const a = agentById.get(s.agentId);
        const deps = s.after?.length ? `（依赖：${s.after.join('、')}）` : '';
        lines.push(`${i + 1}. ${a?.name ?? s.agentId} — ${s.subTask}${deps}`);
    });
    if (plan.loops?.length) {
        lines.push('');
        plan.loops.forEach((lp) => {
            const stepNames = lp.steps.map((sid) => agentById.get(plan.steps.find((s) => s.id === sid)?.agentId ?? '')?.name ?? sid);
            const deps = lp.after?.length ? `（依赖：${lp.after.join('、')}）` : '';
            lines.push(`🔄 循环（${lp.id}）：${stepNames.join(' → ')}，退出条件：「${lp.exitCondition}」，最多 ${lp.maxIterations ?? 5} 轮${deps}`);
        });
    }
    lines.push('\n回复「确认」开始执行，或「取消」放弃。');
    return lines.join('\n');
}
/** 动态规划：LLM 生成 DAG，工作流引擎执行 */
async function runPlanOrchestrator(input, agents, channel, ctx, prebuiltPlan) {
    const { task, onProgress } = input;
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const plan = prebuiltPlan ?? await (async () => {
        if (onProgress)
            await onProgress(`【动态规划】正在生成执行计划…`);
        return planWithLLM(task, agents);
    })();
    if (!plan) {
        return { reply: '无法生成执行计划，请简化任务或检查 @ 的 Agent 配置。' };
    }
    // 人工确认：若开启则缓存计划，返回预览消息，等用户确认
    const cfg = getMultiAgentConfig();
    if (cfg.planConfirmRequired && !prebuiltPlan) {
        const preview = formatPlanPreview(plan, agentById);
        setPendingPlan(input.channelSessionId, { input, agents, preview, channel, ctx, createdAt: Date.now() });
        return { reply: preview };
    }
    const steps = plan.steps;
    const stepIds = new Set(steps.map((s) => s.id));
    // 普通 agent 节点
    const nodes = steps.map((s) => {
        const agent = agentById.get(s.agentId);
        const hasPrev = s.after && s.after.length > 0;
        const message = hasPrev
            ? `用户任务：${task}\n\n【前一环节产出】\n{{prev}}\n\n你的子任务：${s.subTask}`
            : `用户任务：${task}\n\n你的子任务：${s.subTask}`;
        return {
            id: s.id,
            type: 'agent',
            config: { agentId: s.agentId, message },
        };
    });
    // loop 节点（可选）
    if (plan.loops) {
        for (const lp of plan.loops) {
            nodes.push({
                id: lp.id,
                type: 'loop',
                config: {
                    steps: lp.steps,
                    exitCondition: lp.exitCondition,
                    maxIterations: lp.maxIterations ?? 5,
                },
            });
        }
    }
    const allNodeIds = new Set(nodes.map((n) => n.id));
    const edges = [
        ...steps.flatMap((s) => (s.after ?? []).filter((a) => allNodeIds.has(a)).map((from) => ({ from, to: s.id }))),
        ...(plan.loops ?? []).flatMap((lp) => (lp.after ?? []).filter((a) => allNodeIds.has(a)).map((from) => ({ from, to: lp.id }))),
    ];
    const def = {
        id: `plan-${Date.now()}`,
        name: '动态规划',
        nodes,
        edges,
    };
    if (onProgress) {
        const names = [...new Set(steps.map((s) => agentById.get(s.agentId)?.name ?? s.agentId))].join('、');
        await onProgress(`【动态规划】计划已生成，正在执行（${names}）…`);
    }
    const { status, output, error } = await runWorkflow(def, { message: task }, {
        channelContext: { channel, ctx },
        skipChannelReply: true,
    });
    if (status === 'failed' || error) {
        return { reply: `动态规划执行失败：${error ?? '未知错误'}` };
    }
    const outputText = typeof output === 'string' ? output : Array.isArray(output) ? output.join('\n\n---\n\n') : JSON.stringify(output, null, 2);
    const header = `经动态规划协作，最终产出：\n\n`;
    return { reply: header + outputText };
}
/**
 * 执行多 Agent 协同（主从式 / 流水线 / 并行 / 动态规划，由配置决定）
 */
export async function runMultiAgentOrchestrator(channel, ctx, input) {
    const { task, agentIds, channelSessionId, history, memoryScopeHint, userId, onProgress } = input;
    if (agentIds.length < 2) {
        return { reply: '多 Agent 协同需要 @ 至少 2 个 Agent。' };
    }
    const agents = [];
    for (const id of agentIds) {
        const a = await getAgent(id);
        if (!a)
            continue;
        agents.push(a);
    }
    if (agents.length < 2) {
        return { reply: '未找到足够的 Agent，请检查 @ 的 Agent 是否存在。' };
    }
    const cfg = getMultiAgentConfig();
    // 智能默认：inline > 意图感知规则 > LLM 推理兜底(可选) > 兜底默认(2-3→pipeline, 4+→plan) > config
    const intentMode = detectIntentMode(task, agents, agentIds);
    let llmResult;
    if (!input.inlineCollabMode && !intentMode && cfg.llmModeSelectionFallback) {
        if (onProgress)
            await onProgress(`【智能选择】规则未命中，正在通过 LLM 推断协同模式…`);
        llmResult = await llmSelectCollabMode(task, agents);
    }
    const fallbackMode = getDefaultFallbackMode(agents);
    const effectiveMode = input.inlineCollabMode ??
        intentMode ??
        llmResult?.mode ??
        fallbackMode ??
        cfg.collabMode;
    const wasAutoSelected = !input.inlineCollabMode;
    const MODE_LABEL = {
        supervisor: '主从式',
        pipeline: '流水线',
        parallel: '并行',
        plan: '动态规划',
    };
    if (wasAutoSelected && onProgress) {
        const reasonPart = llmResult?.reason ? `（${llmResult.reason}）` : '';
        await onProgress(`【智能选择】已自动采用「${MODE_LABEL[effectiveMode] ?? effectiveMode}」协同模式${reasonPart}`);
    }
    const runId = makeRunId();
    const agentNames = agents.map((a) => a.name);
    const startedAt = Date.now();
    const withLog = async (fn) => {
        try {
            const result = await fn();
            appendMultiAgentRun({
                runId, mode: effectiveMode, task, agentNames, agentIds, status: 'completed',
                replySummary: result.reply.slice(0, 200), channel, startedAt, completedAt: Date.now(),
            }).catch(() => { });
            return result;
        }
        catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            appendMultiAgentRun({ runId, mode: effectiveMode, task, agentNames, agentIds, status: 'failed', error: err, channel, startedAt, completedAt: Date.now() }).catch(() => { });
            throw e;
        }
    };
    if (effectiveMode === 'pipeline') {
        if (onProgress) {
            const names = agents.map((a) => a.name).join(' → ');
            await onProgress(`【多 Agent 流水线】${names}，按顺序执行…`);
        }
        return withLog(() => runPipelineOrchestrator(input, agents));
    }
    if (effectiveMode === 'parallel') {
        return withLog(() => runParallelOrchestrator(input, agents));
    }
    if (effectiveMode === 'plan') {
        // 待确认时先记录 pending 日志
        appendMultiAgentRun({ runId, mode: effectiveMode, task, agentNames, agentIds, status: 'pending_confirm', channel, startedAt }).catch(() => { });
        return runPlanOrchestrator(input, agents, channel, ctx);
    }
    const { leader, workers } = selectLeader(agents, agentIds, task);
    const workerNames = workers
        .map((id) => agents.find((a) => a.id === id)?.name ?? id)
        .filter(Boolean)
        .join('、');
    if (onProgress) {
        await onProgress(`【多 Agent 协同】主控：${leader.name}，协作：${workerNames}，正在执行…`);
    }
    const store = getKnowledgeStore();
    const agentMemoryVisibility = leader.memoryVisibility ?? 'shared';
    const mergedWorkerIds = [...new Set([...(leader.workerIds ?? []), ...workers])];
    // 构建 Worker 能力描述，帮助主控 LLM 了解该委托给谁
    const workerCapDesc = workers
        .map((wid) => {
        const wa = agents.find((a) => a.id === wid);
        if (!wa)
            return null;
        const caps = [];
        if (wa.category)
            caps.push(wa.category);
        if (wa.skillIds?.length)
            caps.push(`技能：${wa.skillIds.join('、')}`);
        if (wa.nodeToolsEnabled !== false)
            caps.push('可操作设备节点');
        return `  - ${wid}（${wa.name}）：${caps.join('，') || '通用助手'}`;
    })
        .filter(Boolean)
        .join('\n');
    const isLeaderDelegateOnly = leader.nodeToolsEnabled === false && (!leader.skillIds || leader.skillIds.length === 0);
    const delegateConstraint = isLeaderDelegateOnly
        ? '【重要】你是纯委托型主控，没有执行工具，**必须且只能**通过 delegate_to_worker 分配任务，严禁自行执行任何操作。'
        : '你是主控，应优先将专项任务通过 delegate_to_worker 委托给对应 Worker，再汇总结果。';
    const collabHint = workers.length > 0
        ? `\n\n【多 Agent 协同】${delegateConstraint}\n用户同时 @ 了你与以下 Worker，请根据各自能力合理分工，按依赖顺序逐步委托，每步完成后再继续：\n${workerCapDesc}\n\n委托方式：delegate_to_worker(workerId, subTask)，workerId 可选：${mergedWorkerIds.join(', ')}。完成所有委托后汇总结果回复用户。`
        : '';
    // 主控的 tool 进展带上主控名称
    const leaderProgress = onProgress
        ? async (msg) => onProgress(`【${leader.name}】${msg}`)
        : undefined;
    const { reply } = await runAgent({
        knowledgeStore: store,
        topK: 5,
        model: leader.model,
        systemPrompt: (leader.systemPrompt ?? '') + collabHint,
        workerIds: mergedWorkerIds,
        mcpServerIds: leader.mcpServerIds,
        skillIds: leader.skillIds,
        nodeToolsEnabled: leader.nodeToolsEnabled,
        enableTools: true,
    }, {
        message: task,
        sessionId: channelSessionId,
        history,
        memoryScopeHint,
        agentId: leader.id,
        agentMemoryVisibility,
        userId,
        onProgress: leaderProgress,
        deleteSource: onProgress ? 'channel' : 'agent',
    });
    // 最终回复带上主控名称，让用户知道是谁汇总的结果
    return { reply: `【${leader.name}】\n${reply}` };
}
/**
 * 执行已缓存的待确认计划（用户回复「确认」后调用）
 */
export async function executePendingPlan(pending) {
    return runPlanOrchestrator(pending.input, pending.agents, pending.channel, pending.ctx, undefined);
}
//# sourceMappingURL=multi-agent-orchestrator.js.map