import { createServer as createHttpServer } from 'node:http';
import { attachWebSocket } from './ws.js';
import { addAudit } from './audit/store.js';
import { getKnowledgeStore } from './knowledge/store-getter.js';
import { logMem } from './debug-mem.js';
let knowledgeImportLock = Promise.resolve();
/** 安装接口限速（每 IP 每分钟最多 10 次写操作） */
const _installRateMap = new Map();
function parseRequestUrl(req) {
    return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}
/** 渠道会话键：用于 memory 隔离与会话历史，同群/同会话共享 */
function getChannelSessionId(channel, ctx) {
    if (channel === 'chat' && ctx.chatId)
        return ctx.chatId;
    const peer = ctx.chatId ?? ctx.sessionWebhook ?? ctx.messageId ?? 'default';
    return `ch:${channel}:${peer}`;
}
/** 渠道命令处理：help */
async function handleHelp(channel, ctx, topic) {
    const { sendHelpToChannel, sendReplyToChannel } = await import('./workflow/channel-reply.js');
    try {
        const { formatChannelHelp } = await import('./channels/help.js');
        const helpText = await formatChannelHelp(channel, topic);
        await sendHelpToChannel(channel, ctx, helpText);
    }
    catch (e) {
        console.error('[help] formatChannelHelp error:', e);
        await sendReplyToChannel(channel, ctx, '帮助信息加载失败，请稍后重试。');
    }
}
/** 渠道命令处理：nodes */
async function handleNodes(channel, ctx) {
    const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
    try {
        const { listOnlineNodes } = await import('./node/store.js');
        const nodes = listOnlineNodes();
        const text = nodes.length === 0
            ? '【在线节点】\n暂无在线节点。请在 Headless 或桌面端运行 apexpanda-node run 连接 Gateway 后在此审批。'
            : `【在线节点】共 ${nodes.length} 个\n\n${nodes
                .map((n) => {
                const conn = n;
                const env = conn.envTools?.length ? ` 环境: ${conn.envTools.join(', ')}` : '';
                return `• ${n.displayName} (${n.platform})${env}\n  能力: ${n.capabilities.join(', ') || '-'}\n  连接: ${new Date(n.connectedAt).toLocaleString('zh-CN')}`;
            })
                .join('\n\n')}`;
        await sendReplyToChannel(channel, ctx, text);
    }
    catch (e) {
        console.error('[nodes] listOnlineNodes error:', e);
        await sendReplyToChannel(channel, ctx, '查询节点失败，请稍后重试。');
    }
}
/** 渠道命令处理：创建工作流（含 confirmMode、audit、错误回复） */
async function handleCreateWorkflow(channel, ctx, description) {
    const { parseCreateWorkflowIntent, createWorkflowFromIntent, formatCreateResult, formatPendingCreatePreview, setPendingCreate, isCreateWorkflowConfirmMode, } = await import('./workflow/workflow-create-intent.js');
    const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
    let msg;
    try {
        const intent = await parseCreateWorkflowIntent(description);
        if (isCreateWorkflowConfirmMode() && intent.templateId?.trim()) {
            setPendingCreate(channel, ctx, intent);
            msg = await formatPendingCreatePreview(intent);
        }
        else {
            const result = await createWorkflowFromIntent(intent, { channel, ctx });
            if (result.success && result.workflow) {
                const { addAudit } = await import('./audit/store.js');
                addAudit({ type: 'workflow', action: 'create', detail: { id: result.workflow.id, name: result.workflow.name, source: 'channel' } });
            }
            msg = await formatCreateResult(result, intent);
        }
    }
    catch (e) {
        msg = `❌ 创建工作流失败：${e instanceof Error ? e.message : String(e)}`;
    }
    try {
        await sendReplyToChannel(channel, ctx, msg);
    }
    catch (sendErr) {
        console.error('[渠道] 创建工作流回复发送失败（工作流可能已创建）:', sendErr);
    }
}
/** 渠道命令处理：创建 Agent（含 confirmMode、audit、错误回复） */
async function handleCreateAgent(channel, ctx, description) {
    const { parseCreateAgentIntent, createAgentFromIntent, formatAgentCreateResult, isCreateAgentConfirmMode, setPendingAgentCreate, formatPendingAgentCreatePreview, } = await import('./agent/agent-create-intent.js');
    const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
    let msg;
    try {
        const intent = await parseCreateAgentIntent(description);
        if (isCreateAgentConfirmMode() && (intent.name?.trim() || intent.templateId?.trim())) {
            setPendingAgentCreate(channel, ctx, intent);
            msg = formatPendingAgentCreatePreview(intent);
        }
        else {
            const result = await createAgentFromIntent(intent);
            if (result.success && result.agent) {
                const { addAudit } = await import('./audit/store.js');
                addAudit({ type: 'agent', action: 'create', detail: { id: result.agent.id, name: result.agent.name, source: 'channel' } });
            }
            msg = formatAgentCreateResult(result);
        }
    }
    catch (e) {
        msg = `❌ 创建 Agent 失败：${e instanceof Error ? e.message : String(e)}`;
    }
    try {
        await sendReplyToChannel(channel, ctx, msg);
    }
    catch (sendErr) {
        console.error('[渠道] 创建 Agent 回复发送失败（Agent 可能已创建）:', sendErr);
    }
}
/** 渠道命令处理：运行工作流（通过 match 结果执行） */
async function handleWorkflowRunFromMatch(channel, ctx, match) {
    const { getWorkflow } = await import('./workflow/store.js');
    const { runWorkflow } = await import('./workflow/engine.js');
    const def = await getWorkflow(match.workflowId);
    if (def) {
        await runWorkflow(def, { message: match.inputContent, workflowName: def.name }, { channelContext: { channel, ctx } });
    }
}
/** 渠道命令处理：运行工作流（通过 name+content 走 parseWorkflowTrigger 模糊匹配，用于 LLM 兜底） */
async function handleWorkflowRun(channel, ctx, name, content) {
    const { parseWorkflowTrigger } = await import('./workflow/workflow-router.js');
    const synthetic = `/workflow ${name} ${content}`.trim();
    const match = await parseWorkflowTrigger(channel, synthetic);
    if (!match)
        return false;
    await handleWorkflowRunFromMatch(channel, ctx, match);
    return true;
}
/** 渠道命令处理：多 Agent 讨论（接受 parseDiscussionInput 的 ParsedDiscussion 或 LLM 兜底构建的 { question, maxRounds?, agentIds? }） */
async function handleDiscussion(channel, ctx, parsed) {
    const { getSessionKey, hasActiveDiscussion } = await import('./discussion/store.js');
    const { getDiscussionConfig } = await import('./config/loader.js');
    const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
    const agentStore = await import('./agent/store.js');
    const sessionKey = getSessionKey(channel, ctx);
    const discussionCfg = getDiscussionConfig();
    const agents = await agentStore.listAgents();
    const maxAgents = Math.min(10, Math.max(1, discussionCfg.maxAgents ?? 5));
    const agentIds = parsed.agentIds?.length
        ? parsed.agentIds
        : agents.slice(0, maxAgents).map((a) => a.id);
    const resolved = {
        question: (parsed.question ?? '').trim(),
        maxRounds: Math.min(10, Math.max(1, parsed.maxRounds ?? discussionCfg.defaultRounds ?? 3)),
        agentIds,
    };
    if (!resolved.question) {
        if ((channel === 'feishu' || channel === 'lark') && ctx.messageId) {
            const { sendFeishuDiscussionHelpCard } = await import('./channels/feishu-client.js');
            await sendFeishuDiscussionHelpCard(ctx.messageId);
        }
        else {
            await sendReplyToChannel(channel, ctx, `【多 Agent 讨论 - 使用说明】
触发：/debate 或 /讨论
格式：/讨论 [问题] [轮数] [@Agent1 @Agent2...]
示例：/讨论 定价策略 5 @产品`);
        }
        return;
    }
    if (hasActiveDiscussion(sessionKey)) {
        await sendReplyToChannel(channel, ctx, '当前有讨论进行中，请先输入「结束讨论」结束。');
        return;
    }
    const { runDiscussion } = await import('./discussion/runner.js');
    const names = resolved.agentIds.map((id) => agents.find((a) => a.id === id)?.name ?? id).filter(Boolean).join('、');
    runDiscussion(channel, ctx, resolved).catch((e) => console.error('[discussion] runDiscussion error:', e));
    await sendReplyToChannel(channel, ctx, `讨论开始，共 ${resolved.maxRounds} 轮，参与：${names || '全员'}。输入「结束讨论」可提前结束。`);
}
export async function processChannelEvent(channel, message, ctx) {
    const msgContent = message.content?.trim() ?? '';
    const channelSessionId = getChannelSessionId(channel, ctx);
    console.log('[ApexPanda] 收到消息', { channel, msgLen: msgContent.length, first50: msgContent.slice(0, 50) });
    const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
    // 删除二次确认：用户回复「确认」或「取消」处理待删除项
    const { getDeleteConfirmRequired } = await import('./config/loader.js');
    if (getDeleteConfirmRequired()) {
        const { getAndClearPendingDelete, executePendingDelete, executePendingShellDelete, isConfirmIntent, isCancelIntent, } = await import('./delete-confirm/store.js');
        const pending = getAndClearPendingDelete(channelSessionId);
        if (pending && (isConfirmIntent(msgContent) || isCancelIntent(msgContent))) {
            if (isCancelIntent(msgContent)) {
                await sendReplyToChannel(channel, ctx, '已取消删除');
            }
            else if (pending.type === 'shell') {
                const result = await executePendingShellDelete({ command: pending.command, cwd: pending.cwd, env: pending.env });
                await sendReplyToChannel(channel, ctx, result.ok ? '已执行删除' : `删除失败：${result.error}`);
            }
            else {
                const result = await executePendingDelete(pending.path, pending.workspaceDir);
                await sendReplyToChannel(channel, ctx, result.ok ? `已删除 ${pending.path}` : `删除失败：${result.error}`);
            }
            return;
        }
    }
    // /help、/帮助：统一帮助入口（支持 ，,：: 作为分隔符，如 /help，讨论）
    const helpMatch = /^\/(?:help|帮助)(?:\s*[，,：:]*\s*(.*))?$/i.exec(msgContent);
    if (helpMatch) {
        const topic = (helpMatch[1] ?? '').trim() || undefined;
        await handleHelp(channel, ctx, topic);
        return;
    }
    // /nodes、/节点：查看在线节点列表（支持 ，,：: 作为分隔符）
    const nodesMatch = /^\/(?:nodes|节点)(?:\s*[，,：:]*\s*)?$/i.exec(msgContent.trim());
    if (nodesMatch) {
        await handleNodes(channel, ctx);
        return;
    }
    // /自动执行、自动执行模式：该会话后续节点命令免审批
    const autoExecMatch = /^\/(?:自动执行|auto-exec)(?:\s*[，,：:]*\s*)?$/i.exec(msgContent.trim())
        || /^(?:自动执行模式|auto[- ]?exec)$/i.exec(msgContent.trim());
    if (autoExecMatch) {
        const { setSessionAutoApprove } = await import('./session/store.js');
        await setSessionAutoApprove(channelSessionId, true);
        await sendReplyToChannel(channel, ctx, '已开启自动执行模式，该会话后续节点命令将自动批准。');
        return;
    }
    // /取消自动执行、取消自动执行模式
    const cancelAutoMatch = /^\/(?:取消自动执行|cancel[- ]?auto)(?:\s*[，,：:]*\s*)?$/i.exec(msgContent.trim())
        || /^(?:取消自动执行模式|cancel[- ]?auto[- ]?exec)$/i.exec(msgContent.trim());
    if (cancelAutoMatch) {
        const { setSessionAutoApprove } = await import('./session/store.js');
        await setSessionAutoApprove(channelSessionId, false);
        await sendReplyToChannel(channel, ctx, '已关闭自动执行模式，节点命令将恢复为需审批。');
        return;
    }
    const { getAndClearPendingCreate, isConfirmMessage, } = await import('./workflow/workflow-create-intent.js');
    const { getAndClearPendingAgentCreate } = await import('./agent/agent-create-intent.js');
    if (isConfirmMessage(msgContent)) {
        const workflowIntent = getAndClearPendingCreate(channel, ctx);
        if (workflowIntent) {
            const { createWorkflowFromIntent, formatCreateResult } = await import('./workflow/workflow-create-intent.js');
            const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
            let msg;
            try {
                const result = await createWorkflowFromIntent(workflowIntent, { channel, ctx });
                if (result.success && result.workflow) {
                    const { addAudit } = await import('./audit/store.js');
                    addAudit({ type: 'workflow', action: 'create', detail: { id: result.workflow.id, name: result.workflow.name, source: 'channel_confirm' } });
                }
                msg = await formatCreateResult(result, workflowIntent);
            }
            catch (e) {
                msg = `❌ 创建工作流失败：${e instanceof Error ? e.message : String(e)}`;
            }
            try {
                await sendReplyToChannel(channel, ctx, msg);
            }
            catch (sendErr) {
                console.error('[渠道] 创建工作流回复发送失败（工作流可能已创建）:', sendErr);
            }
            return;
        }
        const agentIntent = getAndClearPendingAgentCreate(channel, ctx);
        if (agentIntent) {
            const { createAgentFromIntent, formatAgentCreateResult } = await import('./agent/agent-create-intent.js');
            const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
            let msg;
            try {
                const result = await createAgentFromIntent(agentIntent);
                if (result.success && result.agent) {
                    const { addAudit } = await import('./audit/store.js');
                    addAudit({ type: 'agent', action: 'create', detail: { id: result.agent.id, name: result.agent.name, source: 'channel_confirm' } });
                }
                msg = formatAgentCreateResult(result);
            }
            catch (e) {
                msg = `❌ 创建 Agent 失败：${e instanceof Error ? e.message : String(e)}`;
            }
            try {
                await sendReplyToChannel(channel, ctx, msg);
            }
            catch (sendErr) {
                console.error('[渠道] 创建 Agent 回复发送失败（Agent 可能已创建）:', sendErr);
            }
            return;
        }
    }
    const createWorkflowMatch = msgContent.match(/^\/(?:创建工作流|create-workflow)\s*[，,：:]*\s*(.*)$/s);
    if (createWorkflowMatch) {
        const description = (createWorkflowMatch[1] ?? '').trim();
        if (!description || /^[，,：:\s]+$/.test(description)) {
            const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
            await sendReplyToChannel(channel, ctx, '请提供工作流描述，如：/创建工作流 每日发送销售报表');
            return;
        }
        await handleCreateWorkflow(channel, ctx, description);
        return;
    }
    // 渠道自动创建 Agent：/创建agent 描述 或 关键词「创建 agent」
    const { isCreateAgentTrigger, extractAgentDescription, } = await import('./agent/agent-create-intent.js');
    const { isChannelAgentCreateEnabled } = await import('./config/loader.js');
    if (isCreateAgentTrigger(msgContent)) {
        if (!isChannelAgentCreateEnabled(channel)) {
            const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
            await sendReplyToChannel(channel, ctx, '当前渠道不支持创建 Agent，请在 Dashboard 中创建。');
            return;
        }
        const description = extractAgentDescription(msgContent);
        if (!description || /^[，,：:\s]+$/.test(description)) {
            const { sendReplyToChannel } = await import('./workflow/channel-reply.js');
            await sendReplyToChannel(channel, ctx, '请提供 Agent 描述，如：/创建agent 数据分析助手');
            return;
        }
        await handleCreateAgent(channel, ctx, description);
        return;
    }
    const { parseWorkflowTrigger } = await import('./workflow/workflow-router.js');
    console.log('[ApexPanda] 即将 parseWorkflowTrigger');
    const workflowMatch = await parseWorkflowTrigger(channel, msgContent);
    console.log('[ApexPanda] parseWorkflowTrigger 完成', workflowMatch ? '命中' : '未命中');
    if (workflowMatch) {
        await handleWorkflowRunFromMatch(channel, ctx, workflowMatch);
        return;
    }
    // 创新模式：/debate、/讨论 多 Agent 讨论
    const { parseDiscussionInput, isDiscussionTrigger, } = await import('./discussion/parser.js');
    const { getSessionKey, hasActiveDiscussion, setEndRequested, } = await import('./discussion/store.js');
    const { isEndPhrase } = await import('./discussion/end-phrases.js');
    const { getDiscussionConfig } = await import('./config/loader.js');
    const sessionKey = getSessionKey(channel, ctx);
    if (isDiscussionTrigger(msgContent)) {
        console.log('[ApexPanda] 进入讨论分支 parseDiscussionInput');
        const discussionCfg = getDiscussionConfig();
        const parsed = await parseDiscussionInput(msgContent, {
            defaultRounds: discussionCfg.defaultRounds,
            maxRounds: discussionCfg.maxRounds,
            maxAgents: discussionCfg.maxAgents,
        });
        console.log('[ApexPanda] parseDiscussionInput 完成', parsed ? '命中' : '未命中');
        if (parsed) {
            await handleDiscussion(channel, ctx, parsed);
            return;
        }
    }
    if (isEndPhrase(msgContent, getDiscussionConfig().endPhrases) && hasActiveDiscussion(sessionKey)) {
        setEndRequested(sessionKey);
        await sendReplyToChannel(channel, ctx, '收到，正在生成总结…');
        return;
    }
    if (hasActiveDiscussion(sessionKey)) {
        await sendReplyToChannel(channel, ctx, '讨论进行中，输入「结束讨论」可提前结束。');
        return;
    }
    // /agent 单独发送：列出可用 Agent 及用法（支持 ，,：: 分隔符）
    const slashAgentAlone = /^\/agent\s*[，,：:]*\s*$/i.test(msgContent);
    if (slashAgentAlone) {
        const { listAgents } = await import('./agent/store.js');
        const agents = await listAgents();
        if (channel === 'feishu' && ctx.messageId && agents.length > 0) {
            const { sendFeishuAgentSelectionCard } = await import('./channels/feishu-client.js');
            await sendFeishuAgentSelectionCard(ctx.messageId, agents.map((a) => ({ id: a.id, name: a.name })));
        }
        else {
            const names = agents.map((a) => a.name).join('、');
            const hint = names
                ? `可用助手：${names}\n\n指定方式：\n• \`/agent 助手名 问题\` 如 /agent 产品经理 写个PRD\n• \`@助手名 问题\` 如 @产品经理 需求分析`
                : '暂无可用的助手，请先在 Agent 管理中创建。';
            await sendReplyToChannel(channel, ctx, hint);
        }
        return;
    }
    // LLM 兜底：以 / 开头且所有命令正则均未命中时，由 LLM 识别意图并分发
    if (msgContent.startsWith('/')) {
        console.log('[ApexPanda] 消息以/开头，调用 routeCommandIntent(LLM)...');
        const { routeCommandIntent } = await import('./channels/command-llm-router.js');
        const { isChannelAgentCreateEnabled } = await import('./config/loader.js');
        const { intent, params } = await routeCommandIntent(msgContent);
        console.log('[ApexPanda] routeCommandIntent 完成', { intent });
        if (intent !== 'chat') {
            if (intent === 'help') {
                await handleHelp(channel, ctx, params.topic);
                return;
            }
            if (intent === 'nodes') {
                await handleNodes(channel, ctx);
                return;
            }
            if (intent === 'create_workflow') {
                const desc = params.description?.trim();
                if (!desc || /^[，,：:\s]+$/.test(desc)) {
                    await sendReplyToChannel(channel, ctx, '请提供工作流描述，如：/创建工作流 每日发送销售报表');
                }
                else {
                    await handleCreateWorkflow(channel, ctx, desc);
                }
                return;
            }
            if (intent === 'create_agent') {
                if (!isChannelAgentCreateEnabled(channel)) {
                    await sendReplyToChannel(channel, ctx, '当前渠道不支持创建 Agent，请在 Dashboard 中创建。');
                    return;
                }
                const desc = params.description?.trim();
                if (!desc || /^[，,：:\s]+$/.test(desc)) {
                    await sendReplyToChannel(channel, ctx, '请提供 Agent 描述，如：/创建agent 数据分析助手');
                }
                else {
                    await handleCreateAgent(channel, ctx, desc);
                }
                return;
            }
            if (intent === 'workflow_run') {
                const name = params.name?.trim();
                if (!name) {
                    await sendReplyToChannel(channel, ctx, '请指定工作流名称，如：/workflow 日报 今日进展');
                }
                else {
                    const ran = await handleWorkflowRun(channel, ctx, name, params.content?.trim() ?? '');
                    if (!ran) {
                        await sendReplyToChannel(channel, ctx, `未找到工作流「${name}」，请检查名称或使用 /help 查看。`);
                    }
                }
                return;
            }
            if (intent === 'discussion') {
                const question = params.question?.trim();
                const rounds = params.rounds ? parseInt(params.rounds, 10) : undefined;
                await handleDiscussion(channel, ctx, { question: question ?? '', maxRounds: rounds });
                return;
            }
        }
        // intent=chat 或解析失败：fallback 到下方 Agent 对话
    }
    console.log('[ApexPanda] 进入 Agent 分支，准备 parseAgentMention');
    const { parseAgentMention } = await import('./channels/agent-router.js');
    const { runAgent } = await import('./agent/runner.js');
    const { getAgent } = await import('./agent/store.js');
    const { getChannelDefaultAgentId, getChannelMentionEnabled, getChannelChatRoutingAgentId } = await import('./config/loader.js');
    const defaultAgentId = channel === 'chat' && ctx.preferredAgentId?.trim()
        ? ctx.preferredAgentId.trim()
        : getChannelDefaultAgentId(channel);
    let mentionAgentId;
    let content;
    let unmappedMention;
    let mentionAgentIds = [];
    if (getChannelMentionEnabled(channel)) {
        const result = await parseAgentMention(message.content);
        mentionAgentId = result.agentId;
        mentionAgentIds = result.agentIds ?? (result.agentId ? [result.agentId] : []);
        content = result.content;
        unmappedMention = result.unmappedMention;
    }
    else {
        mentionAgentId = undefined;
        mentionAgentIds = [];
        content = message.content.trim();
        unmappedMention = undefined;
    }
    // /单聊：强制走单 Agent 模式，跳过 agent-selector（逃生出口）
    const SINGLE_CHAT_REG = /^\/单聊\s*/;
    if (mentionAgentIds.length === 0 && SINGLE_CHAT_REG.test(content)) {
        content = content.replace(SINGLE_CHAT_REG, '').trim() || '你好';
    }
    // 阶段一：无 @ 时自动选 Agent（MANUS_FUSION_PLAN 单任务入口）
    let autoSelectReason = '';
    const forceSingleChat = mentionAgentIds.length === 0 && SINGLE_CHAT_REG.test(message.content.trim());
    if (mentionAgentIds.length === 0 && getChannelMentionEnabled(channel) && !forceSingleChat) {
        const { getAgentSelectorConfig } = await import('./config/loader.js');
        const { selectAgentsForTask, isSimpleGreeting } = await import('./channels/agent-selector.js');
        const { listAgents } = await import('./agent/store.js');
        const cfg = getAgentSelectorConfig();
        const agents = await listAgents();
        if (cfg.enabled && agents.length >= 2 && !isSimpleGreeting(content)) {
            const sel = await selectAgentsForTask(content);
            if (sel.agentIds.length >= 1) {
                mentionAgentIds = sel.agentIds;
                mentionAgentId = sel.agentIds[0];
                autoSelectReason = sel.reason;
            }
            // 未匹配时静默使用 defaultAgentId，不再提示「未找到合适 Agent，将使用默认模式」
        }
    }
    // 三级优先级：1.@/# 触发 2.chatId 映射 3.defaultAgentId
    const chatRoutingAgentId = ctx.chatId ? getChannelChatRoutingAgentId(channel, ctx.chatId) : undefined;
    const agentId = mentionAgentId ?? chatRoutingAgentId ?? defaultAgentId;
    const agentSrc = mentionAgentId ? '@提及' : chatRoutingAgentId ? 'chatRouting' : defaultAgentId ? 'defaultAgentId' : 'none';
    if (agentId) {
        console.log('[ApexPanda] parseAgentMention 完成', { agentId, 来源: agentSrc, contentLen: content.length, autoSelectReason: autoSelectReason || undefined });
    }
    else {
        console.log('[ApexPanda] parseAgentMention 完成', { 来源: agentSrc, 说明: '未指定 Agent，将使用系统默认配置回复', contentLen: content.length });
    }
    console.log('[ApexPanda] 准备 getAgent');
    let agent = agentId ? await getAgent(agentId) : null;
    if (!agent && !mentionAgentId && defaultAgentId) {
        agent = await getAgent(defaultAgentId);
    }
    // 不指定 defaultAgentId 时不再 fallback 到 agents[0]，与 Chat 页面一致使用系统默认
    const store = getKnowledgeStore();
    const effectiveContent = content.trim() || message.content.trim() || '在';
    if (effectiveContent.includes('[语音识别失败，Agent 兜底')) {
        console.log('[Feishu] processChannelEvent 收到语音兜底消息，即将调用 runAgent');
    }
    const memoryScopeHint = ctx.chatType === 'p2p' && ctx.userId
        ? `user:${ctx.userId}`
        : ctx.chatType === 'group' && ctx.chatId
            ? `group:${ctx.chatId}`
            : undefined;
    console.log('[ApexPanda] getAgent 完成，准备 getSessionHistory');
    const { getSessionHistory, appendToSession, SESSION_MAX_HISTORY } = await import('./session/store.js');
    const { getMemoryConfig } = await import('./config/loader.js');
    const { extractAndWriteMemories } = await import('./memory/extraction.js');
    const hist = channel === 'chat' && message.explicitHistory && Array.isArray(message.explicitHistory)
        ? message.explicitHistory.map((m) => ({ role: m.role, content: m.content }))
        : await getSessionHistory(channelSessionId, channel === 'chat' ? ctx.tenantId : undefined);
    console.log('[ApexPanda] getSessionHistory 完成', { historyLen: hist.length, source: channel === 'chat' && message.explicitHistory ? 'explicit' : 'store' });
    const history = hist.map((m) => ({ role: m.role, content: m.content }));
    const chatTenantId = channel === 'chat' ? ctx.tenantId : undefined;
    // Phase 7: 传入 agentId + visibility + userId，memory 工具按 visibility 推导正确 scope
    const agentMemoryVisibility = agent?.memoryVisibility ?? 'shared';
    // 多 Agent 动态规划待确认：检查是否有 pending plan，「确认」则执行，「取消」则清除
    {
        const { hasPendingPlan, getAndClearPendingPlan, isPlanConfirmMessage, isPlanCancelMessage } = await import('./channels/pending-plan-store.js');
        if (await hasPendingPlan(channelSessionId)) {
            const rawMsg = message.content.trim();
            if (isPlanCancelMessage(rawMsg)) {
                await getAndClearPendingPlan(channelSessionId);
                await sendReplyToChannel(channel, ctx, '已取消执行计划。');
                return;
            }
            if (isPlanConfirmMessage(rawMsg)) {
                const pending = await getAndClearPendingPlan(channelSessionId);
                if (pending) {
                    try {
                        await sendReplyToChannel(channel, ctx, '收到确认，开始执行计划…');
                        const { executePendingPlan } = await import('./channels/multi-agent-orchestrator.js');
                        const { reply } = await executePendingPlan(pending);
                        await appendToSession(channelSessionId, 'user', rawMsg, undefined, { channel, userId: ctx.userId, peer: ctx.chatId ?? ctx.messageId ?? ctx.sessionWebhook });
                        await appendToSession(channelSessionId, 'assistant', reply);
                        await sendReplyToChannel(channel, ctx, reply);
                    }
                    catch (e) {
                        const errMsg = e instanceof Error ? e.message : String(e);
                        await sendReplyToChannel(channel, ctx, `执行计划失败：${errMsg}`).catch(() => { });
                    }
                    return;
                }
            }
        }
    }
    // 多 Agent 协同：@ 2+ 个 Agent 时走 Orchestrator（含 agent-selector 自动选中的）
    if (mentionAgentIds.length >= 2) {
        const effectiveContent = content.trim() || message.content.trim() || '在';
        // 阶段一透明度：自动选 Agent 时向用户说明召集原因
        if (autoSelectReason) {
            const agentsForNames = await Promise.all(mentionAgentIds.map((id) => getAgent(id)));
            const names = agentsForNames.filter((a) => a != null).map((a) => a.name);
            const nameList = names.length > 0 ? names.join('、') : mentionAgentIds.join(', ');
            await sendReplyToChannel(channel, ctx, `为完成此任务，我为你召集了 [${nameList}]，原因：${autoSelectReason}`).catch(() => { });
        }
        // 消息内联模式识别：英文 /pipeline /parallel /plan 及中文 /流水线 /并行 /规划（优先级高于 config 全局设置）
        const INLINE_MODE_REG = /^\/(?:pipeline|parallel|plan|流水线|并行|规划)\s*/i;
        const MODE_MAP = {
            pipeline: 'pipeline', parallel: 'parallel', plan: 'plan',
            流水线: 'pipeline', 并行: 'parallel', 规划: 'plan',
        };
        const MODE_LABEL_MAP = {
            pipeline: '流水线', parallel: '并行', plan: '动态规划',
        };
        let inlineMode;
        let taskContent = effectiveContent;
        const modeMatch = effectiveContent.match(/^\/([a-zA-Z\u4e00-\u9fa5]+)\s*/);
        if (modeMatch) {
            const modeWord = modeMatch[1].toLowerCase();
            if (MODE_MAP[modeWord]) {
                inlineMode = MODE_MAP[modeWord];
                taskContent = effectiveContent.replace(INLINE_MODE_REG, '').trim() || effectiveContent;
            }
        }
        try {
            const modeLabel = inlineMode ? `（${MODE_LABEL_MAP[inlineMode]} 模式）` : '';
            await sendReplyToChannel(channel, ctx, `收到，多 Agent 协同执行中${modeLabel}…`);
            const { runMultiAgentOrchestrator } = await import('./channels/multi-agent-orchestrator.js');
            const { reply } = await runMultiAgentOrchestrator(channel, ctx, {
                task: taskContent,
                agentIds: mentionAgentIds,
                channelSessionId,
                history,
                memoryScopeHint,
                userId: ctx.userId,
                inlineCollabMode: inlineMode,
                onProgress: (msg) => sendReplyToChannel(channel, ctx, msg),
                autoSelectReason: autoSelectReason || undefined,
            });
            await appendToSession(channelSessionId, 'user', effectiveContent, undefined, {
                channel, agentId: mentionAgentIds[0], userId: ctx.userId,
                peer: ctx.chatId ?? ctx.messageId ?? ctx.sessionWebhook,
            });
            await appendToSession(channelSessionId, 'assistant', reply);
            await sendReplyToChannel(channel, ctx, reply);
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[渠道] 多 Agent 协同异常:', e);
            await sendReplyToChannel(channel, ctx, `多 Agent 协同出错：${errMsg}。请稍后重试。`).catch((sendErr) => console.error('[渠道] 错误回复发送失败:', sendErr));
        }
        return;
    }
    // 单 Agent 流程
    // P0: 执行前发进度提示，长时间任务用户有反馈；runAgent 异常时回复用户
    console.log('[ApexPanda] 即将发送进度提示 收到BOSS');
    try {
        await sendReplyToChannel(channel, ctx, '收到BOSS，正在执行您的任务，请稍候…');
        console.log('[ApexPanda] 已发送进度提示 收到BOSS');
    }
    catch (e) {
        console.warn('[渠道] 进度提示发送失败，继续执行', e);
    }
    // 沙盘记录：单 Agent 运行开始
    const { appendMultiAgentRun, updateMultiAgentRun, makeRunId } = await import('./channels/multi-agent-run-store.js');
    const { broadcast } = await import('./ws.js');
    const saRunId = makeRunId();
    const saAgentName = agent?.name ?? agentId ?? '默认助手';
    const saAgentIds = agentId ? [agentId] : [];
    const saStartedAt = Date.now();
    appendMultiAgentRun({
        runId: saRunId,
        mode: 'single',
        task: effectiveContent.slice(0, 200),
        agentNames: [saAgentName],
        agentIds: saAgentIds,
        status: 'running',
        channel,
        startedAt: saStartedAt,
    }).catch(() => { });
    broadcast({ type: 'multi_agent_run', payload: { action: 'started', runId: saRunId, mode: 'single', task: effectiveContent.slice(0, 200), agentIds: saAgentIds, agentNames: [saAgentName], startedAt: saStartedAt } });
    let agentResult;
    try {
        agentResult = await runAgent({
            knowledgeStore: store,
            topK: 5,
            model: agent?.model,
            systemPrompt: agent?.systemPrompt,
            workerIds: agent?.workerIds,
            mcpServerIds: agent?.mcpServerIds,
            skillIds: agent?.skillIds,
            nodeToolsEnabled: agent?.nodeToolsEnabled,
        }, {
            message: effectiveContent,
            sessionId: channelSessionId,
            history,
            memoryScopeHint,
            agentId: agentId ?? undefined,
            agentMemoryVisibility,
            userId: ctx.userId,
            onProgress: (msg) => sendReplyToChannel(channel, ctx, msg),
            deleteSource: 'channel',
        });
    }
    catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('[渠道] runAgent 异常:', e);
        // 沙盘记录：单 Agent 运行失败
        const saFailedAt = Date.now();
        updateMultiAgentRun(saRunId, { status: 'failed', completedAt: saFailedAt, error: errMsg }).catch(() => { });
        broadcast({ type: 'multi_agent_run', payload: { action: 'completed', runId: saRunId, status: 'failed', completedAt: saFailedAt, error: errMsg } });
        await sendReplyToChannel(channel, ctx, `任务执行出错：${errMsg}。请稍后重试或简化需求。`).catch((sendErr) => console.error('[渠道] 错误回复发送失败:', sendErr));
        return;
    }
    const { reply: rawReply, fileReply, fileReplies, usage: agentUsage, model: agentModel } = agentResult;
    if (agentUsage) {
        const { recordUsage } = await import('./usage/store.js');
        recordUsage(agentUsage.promptTokens, agentUsage.completionTokens, agentModel);
    }
    // 文件直通：工具返回文件类结果时，跳过 LLM，直接发给渠道（支持多文件）
    const files = fileReply ? [fileReply] : (fileReplies ?? []);
    if (files.length > 0) {
        await appendToSession(channelSessionId, 'user', effectiveContent, chatTenantId, {
            channel, agentId: agentId ?? undefined, userId: ctx.userId,
            peer: ctx.chatId ?? ctx.messageId ?? ctx.sessionWebhook,
        });
        await appendToSession(channelSessionId, 'assistant', rawReply, chatTenantId);
        if (channel === 'chat' && ctx.replyCapturer) {
            ctx.replyCapturer(rawReply);
            return;
        }
        const { sendFileToChannel } = await import('./workflow/channel-reply.js');
        for (const fr of files) {
            await sendFileToChannel(channel, ctx, fr);
        }
        return;
    }
    // Phase 7: memoryScopeForFlush 需根据 visibility 计算，与 memory#write 保持一致
    const memoryScopeForFlush = (() => {
        if (agentId && agentMemoryVisibility === 'agent-only') {
            if (memoryScopeHint?.startsWith('group:') && ctx.userId) {
                return `agent:${agentId}:${memoryScopeHint}:user:${ctx.userId}`;
            }
            if (memoryScopeHint?.startsWith('group:'))
                return `agent:${agentId}:${memoryScopeHint}`;
            if (memoryScopeHint?.startsWith('user:'))
                return `agent:${agentId}:${memoryScopeHint}`;
            return `agent:${agentId}:${channelSessionId}`;
        }
        return memoryScopeHint ?? channelSessionId;
    })();
    const memCfg = getMemoryConfig();
    if (memCfg.preCompactionFlush && hist.length + 2 > SESSION_MAX_HISTORY) {
        const toDrop = hist.slice(0, hist.length + 2 - SESSION_MAX_HISTORY);
        if (toDrop.length > 0)
            extractAndWriteMemories(toDrop, memoryScopeForFlush).catch(() => { });
    }
    if (memCfg.postDialogueFlushRounds > 0) {
        const assistantCount = hist.filter((m) => m.role === 'assistant').length;
        if ((assistantCount + 1) % memCfg.postDialogueFlushRounds === 0) {
            const fullDialogue = [
                ...hist.map((m) => ({ role: m.role, content: m.content })),
                { role: 'user', content: effectiveContent },
                { role: 'assistant', content: rawReply },
            ];
            extractAndWriteMemories(fullDialogue, memoryScopeForFlush).catch(() => { });
        }
    }
    const sessionMeta = {
        channel,
        agentId: agentId ?? undefined,
        userId: ctx.userId,
        peer: ctx.chatId ?? ctx.messageId ?? ctx.sessionWebhook,
    };
    await appendToSession(channelSessionId, 'user', effectiveContent, chatTenantId, sessionMeta);
    await appendToSession(channelSessionId, 'assistant', rawReply, chatTenantId);
    // 沙盘记录：单 Agent 运行完成
    const saCompletedAt = Date.now();
    updateMultiAgentRun(saRunId, {
        status: 'completed',
        completedAt: saCompletedAt,
        replySummary: rawReply.slice(0, 200),
    }).catch(() => { });
    broadcast({ type: 'multi_agent_run', payload: { action: 'completed', runId: saRunId, status: 'completed', completedAt: saCompletedAt, replySummary: rawReply.slice(0, 200) } });
    // 匹配到 Agent 时在回复前附加 [agent名称]，便于渠道用户识别由谁作答
    const reply = agent?.name
        ? `[${agent.name}] ${rawReply}`
        : rawReply;
    if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
        console.log(`[渠道调试] 准备发送回复 channel=${channel} rawReplyLen=${rawReply?.length ?? 0} finalReplyLen=${reply?.length ?? 0} last50="${(reply ?? '').slice(-50).replace(/\n/g, '\\n')}"`);
    }
    if (channel === 'chat' && ctx.replyCapturer) {
        ctx.replyCapturer(reply);
        return;
    }
    // 方案 B：channel 可为实例 ID（inst_feishu_0），需同时匹配类型与实例格式
    const isFeishu = channel === 'feishu' || channel === 'lark' || (typeof channel === 'string' && (channel.startsWith('inst_feishu') || channel.startsWith('inst_lark')));
    const isDingtalk = channel === 'dingtalk' || (typeof channel === 'string' && channel.startsWith('inst_dingtalk'));
    const isTelegram = channel === 'telegram' || (typeof channel === 'string' && channel.startsWith('inst_telegram'));
    const isSlack = channel === 'slack' || (typeof channel === 'string' && channel.startsWith('inst_slack'));
    const isWhatsapp = channel === 'whatsapp' || (typeof channel === 'string' && channel.startsWith('inst_whatsapp'));
    const isWecom = channel === 'wecom' || (typeof channel === 'string' && channel.startsWith('inst_wecom'));
    const isDiscord = channel === 'discord' || (typeof channel === 'string' && channel.startsWith('inst_discord'));
    const instanceId = typeof channel === 'string' && channel.startsWith('inst_') ? channel : undefined;
    if (isFeishu && ctx.messageId) {
        const { sendFeishuReply } = await import('./channels/feishu-client.js');
        await sendFeishuReply(ctx.messageId, reply, instanceId ?? (channel === 'lark' ? 'lark' : undefined));
    }
    else if (isDingtalk && ctx.sessionWebhook) {
        const { sendDingTalkReply } = await import('./channels/dingtalk.js');
        await sendDingTalkReply(ctx.sessionWebhook, reply);
    }
    else if (isTelegram && ctx.chatId) {
        const { getTelegramBotToken } = await import('./config/loader.js');
        const { sendTelegramMessage } = await import('./channels/telegram.js');
        const token = getTelegramBotToken(instanceId ?? channel);
        if (token)
            await sendTelegramMessage(ctx.chatId, reply, token);
        else
            console.log('[telegram] Reply (no token):', reply.slice(0, 80));
    }
    else if (isSlack && ctx.chatId) {
        const { getSlackBotToken } = await import('./config/loader.js');
        const { sendSlackMessage } = await import('./channels/slack.js');
        const token = getSlackBotToken(instanceId ?? channel);
        if (token)
            await sendSlackMessage(ctx.chatId, reply, token);
        else
            console.log('[slack] Reply (no token):', reply.slice(0, 80));
    }
    else if (isWhatsapp && ctx.chatId && ctx.phoneNumberId) {
        const { getWhatsAppAccessToken } = await import('./config/loader.js');
        const { sendWhatsAppMessage } = await import('./channels/whatsapp.js');
        const token = getWhatsAppAccessToken();
        if (token)
            await sendWhatsAppMessage(ctx.chatId, reply, ctx.phoneNumberId, token);
        else
            console.log('[whatsapp] Reply (no token):', reply.slice(0, 80));
    }
    else if (isWecom && (ctx.wecomFrame || ctx.chatId)) {
        const { replyWecomBotText, sendWecomBotText } = await import('./channels/wecom-bot-ws.js');
        const credId = instanceId ?? channel;
        if (ctx.wecomFrame) {
            const frame = ctx.wecomFrame;
            const ok = await replyWecomBotText(credId, frame, reply);
            if (!ok)
                console.log('[wecom-bot] Reply (no client):', reply.slice(0, 80));
        }
        else if (ctx.chatId) {
            const ok = await sendWecomBotText(credId, ctx.chatId, reply);
            if (!ok)
                console.log('[wecom-bot] Reply (no client/chatId):', reply.slice(0, 80));
        }
    }
    else if (isDiscord && ctx.chatId) {
        const { getDiscordBotToken } = await import('./config/loader.js');
        const { sendDiscordMessage } = await import('./channels/discord.js');
        const token = getDiscordBotToken(instanceId ?? channel);
        if (token)
            await sendDiscordMessage(ctx.chatId, reply, token);
        else
            console.log('[discord] Reply (no token):', reply.slice(0, 80));
    }
    else {
        console.log(`[${channel}] Reply (no sender, not sent):`, reply.slice(0, 80));
    }
}
async function processFeishuEvent(result) {
    const { isDuplicateFeishuMessage } = await import('./channels/feishu-ws.js');
    if (result.messageId && isDuplicateFeishuMessage(result.messageId)) {
        console.log(`[Feishu] 跳过重复消息(webhook) ${result.messageId}`);
        return;
    }
    const channelOrInstance = result.instanceId ?? 'feishu';
    if (result.messageId && result.message.content?.includes('[语音识别失败，Agent 兜底')) {
        try {
            const { sendFeishuReply, getVoiceFallbackUserPrompt } = await import('./channels/feishu-client.js');
            const reason = result.message.meta?.voiceFallbackReason;
            await sendFeishuReply(result.messageId, getVoiceFallbackUserPrompt(reason), result.instanceId);
        }
        catch (e) {
            console.warn('[Feishu] 发送兜底提示失败', e);
        }
    }
    await processChannelEvent(channelOrInstance, result.message, {
        messageId: result.messageId,
        chatId: result.chatId,
        chatType: result.chatType,
        userId: result.userId,
    });
}
/** 处理 deferred 事件（audio/image/file）：完整 parse 后复用 processFeishuEvent，供 Redis Worker 调用 */
export async function processFeishuEventDeferred(rawResult) {
    // 注意：此处不调用 isDuplicateFeishuMessage，由 processFeishuEvent 作为唯一去重记录点。
    // 若在此处也记录 messageId，processFeishuEvent 会误判为重复消息而跳过，导致 deferred 消息永远不被处理。
    const { parseFeishuEvent } = await import('./channels/feishu.js');
    const msg = await parseFeishuEvent(rawResult.rawBody, 'default', rawResult.instanceId);
    if (!msg)
        return;
    await processFeishuEvent({
        type: 'event',
        message: msg,
        messageId: rawResult.messageId,
        chatId: rawResult.chatId,
        chatType: rawResult.chatType,
        userId: rawResult.userId,
        instanceId: rawResult.instanceId,
    });
}
function applyCors(res) {
    const origin = process.env.APEXPANDA_CORS_ORIGIN ?? '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
}
export async function createServer() {
    const server = createHttpServer(async (req, res) => {
        applyCors(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const reqUrl = parseRequestUrl(req);
        const pathname = reqUrl.pathname;
        // MCP (Model Context Protocol) - Cursor / Claude Code 等客户端接入
        if (pathname === '/mcp/sse' && req.method === 'GET') {
            const enabled = process.env.APEXPANDA_MCP_ENABLED !== 'false';
            if (enabled) {
                const { handleMcpSse } = await import('./mcp/index.js');
                if (handleMcpSse(req, res))
                    return;
            }
        }
        if (pathname === '/mcp/message' && req.method === 'POST') {
            const enabled = process.env.APEXPANDA_MCP_ENABLED !== 'false';
            if (enabled) {
                const { handleMcpMessage } = await import('./mcp/index.js');
                const sessionId = String(reqUrl.searchParams.get('session') ?? '');
                if (sessionId && handleMcpMessage(req, res, sessionId))
                    return;
            }
        }
        // Shortlink redirect: GET /s/:code
        const sMatch = pathname?.match(/^\/s\/([a-zA-Z0-9_-]+)$/);
        if (sMatch && req.method === 'GET') {
            const { shortlinkStore } = await import('./shortlink/store.js');
            const code = sMatch[1];
            const entry = shortlinkStore.get(code);
            if (entry) {
                res.writeHead(302, { Location: entry.url });
                res.end();
            }
            else {
                res.writeHead(404);
                res.end('Short link not found');
            }
            return;
        }
        // Health check
        if (pathname === '/health') {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({
                status: 'ok',
                timestamp: Date.now(),
                uptime: Math.round(process.uptime()),
            }));
            return;
        }
        // Webhooks (渠道回调)
        // 钉钉已改用 Stream 长连接，无 webhook 路由
        if (pathname?.startsWith('/webhooks/workflow/') && req.method === 'POST') {
            const workflowId = pathname.slice('/webhooks/workflow/'.length);
            if (workflowId) {
                const secret = process.env.APEXPANDA_WEBHOOK_SECRET;
                if (secret) {
                    const provided = req.headers['x-webhook-secret'] ?? req.headers['x-apexpanda-webhook-secret'];
                    if (String(provided ?? '') !== secret) {
                        res.writeHead(401);
                        res.end(JSON.stringify({ error: 'Invalid webhook secret' }));
                        return;
                    }
                }
                let body = '';
                for await (const chunk of req)
                    body += chunk;
                try {
                    const { getWorkflow } = await import('./workflow/store.js');
                    const { runWorkflow } = await import('./workflow/engine.js');
                    const def = await getWorkflow(workflowId);
                    if (!def) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Workflow not found' }));
                        return;
                    }
                    const input = (body ? JSON.parse(body) : {});
                    const result = await runWorkflow(def, input);
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end(JSON.stringify(result));
                }
                catch (e) {
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Run failed' }));
                }
            }
            else {
                res.writeHead(404);
                res.end();
            }
            return;
        }
        // 方案 B：/webhooks/feishu/:instanceId 支持多实例
        const feishuWebhookMatch = pathname?.match(/^\/webhooks\/(feishu|lark)(?:\/([a-z0-9_-]+))?$/);
        if (feishuWebhookMatch && req.method === 'POST') {
            const instanceIdFromPath = feishuWebhookMatch[2];
            let body = '';
            for await (const chunk of req)
                body += chunk;
            try {
                const data = JSON.parse(body);
                const { handleFeishuWebhook } = await import('./channels/feishu.js');
                const { isChannelConfigured, getChannelInstances, getInstanceConfig } = await import('./config/loader.js');
                const result = await handleFeishuWebhook(data);
                res.setHeader('Content-Type', 'application/json');
                if (result?.type === 'challenge') {
                    res.writeHead(200);
                    res.end(JSON.stringify({ challenge: result.challenge }));
                }
                else if (result?.type === 'event') {
                    res.writeHead(200);
                    res.end('{}');
                    let instanceId = instanceIdFromPath;
                    if (!instanceId) {
                        const instances = getChannelInstances();
                        const first = instances.find((i) => (i.type === 'feishu' || i.type === 'lark') && isChannelConfigured(i.id));
                        instanceId = first?.id;
                    }
                    const skip = instanceId ? !isChannelConfigured(instanceId) : !isChannelConfigured('feishu');
                    if (!skip && instanceId && getInstanceConfig(instanceId)) {
                        if ('deferred' in result && result.deferred === true) {
                            processFeishuEventDeferred({ ...result, instanceId }).catch((e) => console.error('[Feishu] deferred', e));
                        }
                        else {
                            processFeishuEvent({ ...result, instanceId }).catch((e) => console.error('[Feishu]', e));
                        }
                    }
                    else if (!skip && !instanceId) {
                        if ('deferred' in result && result.deferred === true) {
                            processFeishuEventDeferred(result).catch((e) => console.error('[Feishu] deferred', e));
                        }
                        else {
                            processFeishuEvent(result).catch((e) => console.error('[Feishu]', e));
                        }
                    }
                }
                else {
                    res.writeHead(200);
                    res.end('{}');
                }
            }
            catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid body' }));
            }
            return;
        }
        // 方案 B：telegram 多实例 /webhooks/telegram 或 /webhooks/telegram/:instanceId
        const telegramWebhookMatch = pathname?.match(/^\/webhooks\/telegram(?:\/([a-z0-9_-]+))?$/);
        if (telegramWebhookMatch && req.method === 'POST') {
            const instanceIdFromPath = telegramWebhookMatch[1];
            let body = '';
            for await (const chunk of req)
                body += chunk;
            try {
                const { getChannelInstances, isChannelConfigured } = await import('./config/loader.js');
                const data = JSON.parse(body);
                const { handleTelegramWebhook } = await import('./channels/telegram.js');
                const { getTelegramBotToken } = await import('./config/loader.js');
                let instanceId = instanceIdFromPath;
                if (!instanceId) {
                    const instances = getChannelInstances();
                    instanceId = instances.find((i) => i.type === 'telegram' && isChannelConfigured(i.id))?.id ?? 'telegram';
                }
                const token = getTelegramBotToken(instanceId);
                const result = token ? await handleTelegramWebhook(data, token) : null;
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end('{}');
                if (result?.type === 'event') {
                    processChannelEvent(instanceId, result.message, {
                        chatId: result.chatId,
                    }).catch((e) => console.error('[Telegram]', e));
                }
            }
            catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid body' }));
            }
            return;
        }
        // 方案 B：slack 多实例 /webhooks/slack 或 /webhooks/slack/:instanceId
        const slackWebhookMatch = pathname?.match(/^\/webhooks\/slack(?:\/([a-z0-9_-]+))?$/);
        if (slackWebhookMatch && req.method === 'POST') {
            const instanceIdFromPath = slackWebhookMatch[1];
            let body = '';
            for await (const chunk of req)
                body += chunk;
            try {
                const { getSlackSigningSecret, getChannelInstances, isChannelConfigured } = await import('./config/loader.js');
                const { handleSlackWebhook } = await import('./channels/slack.js');
                let instanceId = instanceIdFromPath;
                if (!instanceId) {
                    const instances = getChannelInstances();
                    instanceId = instances.find((i) => i.type === 'slack' && isChannelConfigured(i.id))?.id ?? 'slack';
                }
                const secret = getSlackSigningSecret(instanceId);
                const sig = req.headers['x-slack-signature'];
                const ts = req.headers['x-slack-request-timestamp'];
                const result = handleSlackWebhook(JSON.parse(body), body, secret, sig, ts);
                res.setHeader('Content-Type', 'application/json');
                if (result?.type === 'challenge') {
                    res.writeHead(200);
                    res.end(JSON.stringify({ challenge: result.challenge }));
                }
                else if (result?.type === 'event') {
                    res.writeHead(200);
                    res.end('{}');
                    processChannelEvent(instanceId, result.message, {
                        chatId: result.channelId,
                    }).catch((e) => console.error('[Slack]', e));
                }
                else {
                    res.writeHead(200);
                    res.end('{}');
                }
            }
            catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid body' }));
            }
            return;
        }
        // 方案 B：whatsapp 多实例 /webhooks/whatsapp 或 /webhooks/whatsapp/:instanceId
        const whatsappWebhookMatch = pathname?.match(/^\/webhooks\/whatsapp(?:\/([a-z0-9_-]+))?$/);
        if (whatsappWebhookMatch) {
            const instanceIdFromPath = whatsappWebhookMatch[1];
            const { getWhatsAppVerifyToken, getWhatsAppPhoneNumberId, getChannelInstances, isChannelConfigured } = await import('./config/loader.js');
            const { handleWhatsAppVerify, handleWhatsAppWebhook } = await import('./channels/whatsapp.js');
            let instanceId = instanceIdFromPath;
            if (!instanceId) {
                const instances = getChannelInstances();
                instanceId = instances.find((i) => i.type === 'whatsapp' && isChannelConfigured(i.id))?.id ?? 'whatsapp';
            }
            const verifyToken = getWhatsAppVerifyToken(instanceId);
            if (req.method === 'GET') {
                const u = parseRequestUrl(req);
                const mode = u.searchParams.get('hub.mode') ?? '';
                const token = u.searchParams.get('hub.verify_token') ?? '';
                const challenge = u.searchParams.get('hub.challenge') ?? '';
                const result = handleWhatsAppVerify(String(mode ?? ''), String(token ?? ''), String(challenge ?? ''), verifyToken);
                if (result) {
                    res.setHeader('Content-Type', 'text/plain');
                    res.writeHead(200);
                    res.end(result.challenge);
                }
                else {
                    res.writeHead(403);
                    res.end('Verification failed');
                }
                return;
            }
            if (req.method === 'POST') {
                let body = '';
                for await (const chunk of req)
                    body += chunk;
                try {
                    const data = JSON.parse(body || '{}');
                    const result = handleWhatsAppWebhook(data);
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end('{}');
                    if (result?.type === 'event') {
                        processChannelEvent(instanceId, result.message, {
                            chatId: result.message.channelPeerId,
                            phoneNumberId: result.phoneNumberId ?? getWhatsAppPhoneNumberId(instanceId),
                        }).catch((e) => console.error('[WhatsApp]', e));
                    }
                }
                catch {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid body' }));
                }
                return;
            }
        }
        // API v1
        if (pathname?.startsWith('/api/v1/')) {
            await handleApi(req, res, pathname);
            return;
        }
        // API 文档 (Swagger UI)
        if (pathname === '/api-docs' && req.method === 'GET') {
            const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ApexPanda API 文档</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/v1/openapi.json',
      dom_id: '#swagger-ui',
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>`;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.writeHead(200);
            res.end(html);
            return;
        }
        // Root (API info when no dashboard)
        if (pathname === '/' || pathname === '') {
            const dashboardDir = process.env.APEXPANDA_DASHBOARD_DIR;
            if (dashboardDir) {
                const { serveStatic } = await import('./static.js');
                const ok = await serveStatic(res, '/', dashboardDir);
                if (ok)
                    return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({
                name: 'ApexPanda',
                version: '0.1.0',
                status: 'running',
                endpoints: { health: '/health', api: '/api/v1' },
            }));
            return;
        }
        // 静态资源（生产环境 dashboard）
        const dashboardDir = process.env.APEXPANDA_DASHBOARD_DIR;
        if (dashboardDir && pathname && !pathname.startsWith('/api/') && !pathname.startsWith('/webhooks/') && pathname !== '/ws') {
            const { serveStatic } = await import('./static.js');
            const ok = await serveStatic(res, pathname ?? '/', dashboardDir);
            if (ok)
                return;
        }
        res.writeHead(404);
        res.end();
    }).on('error', (err) => {
        console.error('[Gateway]', err);
    });
    attachWebSocket(server);
    return server;
}
/** 路由 → 所需权限，无则跳过 RBAC */
function getRoutePermission(pathname, method) {
    const get = (r, a) => ({ resource: r, action: a });
    if (pathname === '/api/v1/channels' && method === 'GET')
        return get('channel', 'read');
    if (pathname?.match(/^\/api\/v1\/channels\/[a-z0-9_-]+$/) && (method === 'PATCH' || method === 'DELETE'))
        return get('channel', 'update');
    if (pathname === '/api/v1/llm/test' && method === 'POST')
        return get('config', 'read');
    if (pathname === '/api/v1/config') {
        if (method === 'GET')
            return get('config', 'read');
        if (method === 'PATCH')
            return get('config', 'update');
    }
    if (pathname === '/api/v1/voicewake') {
        if (method === 'GET')
            return get('config', 'read');
        if (method === 'POST')
            return get('config', 'update');
    }
    if (pathname === '/api/v1/voicewake/recognize' && method === 'POST')
        return get('config', 'read');
    if (pathname === '/api/v1/voicewake/tts' && method === 'POST')
        return get('config', 'read');
    if (pathname === '/api/v1/status' && method === 'GET')
        return get('config', 'read');
    if (pathname === '/api/v1/sessions' && method === 'GET')
        return get('session', 'read');
    if (pathname?.startsWith('/api/v1/sessions/')) {
        if (method === 'GET')
            return get('session', 'read');
        if (method === 'DELETE')
            return get('session', 'delete');
    }
    if (pathname === '/api/v1/memory/counts' && method === 'GET')
        return get('session', 'read');
    if (pathname === '/api/v1/openapi.json' && method === 'GET')
        return null;
    if (pathname === '/api/v1/usage' && method === 'GET')
        return get('usage', 'view');
    if (pathname === '/api/v1/audit' && method === 'GET')
        return get('audit', 'view');
    if (pathname === '/api/v1/agents' && method === 'GET')
        return get('agent', 'read');
    if (pathname === '/api/v1/agents' && method === 'POST')
        return get('agent', 'create');
    if (pathname === '/api/v1/agents/select' && method === 'POST')
        return get('agent', 'read');
    if (pathname?.startsWith('/api/v1/agents/')) {
        if (method === 'GET')
            return get('agent', 'read');
        if (method === 'PATCH')
            return get('agent', 'update');
        if (method === 'DELETE')
            return get('agent', 'delete');
    }
    if (pathname === '/api/v1/skills' && method === 'GET')
        return get('skill', 'read');
    if (pathname === '/api/v1/skills/templates' && method === 'GET')
        return get('skill', 'read');
    if (pathname === '/api/v1/skills/template-zip' && method === 'GET')
        return get('skill', 'read');
    if (pathname === '/api/v1/skills/install-history' && method === 'GET')
        return get('skill', 'read');
    if (pathname === '/api/v1/skills/import' && method === 'POST')
        return get('skill', 'configure');
    if (pathname === '/api/v1/skills/repo-scan' && method === 'POST')
        return get('skill', 'read');
    if (pathname === '/api/v1/skills/install' && method === 'POST')
        return get('skill', 'configure');
    if (pathname === '/api/v1/skills/upload' && method === 'POST')
        return get('skill', 'configure');
    if (pathname === '/api/v1/skills/reload' && method === 'POST')
        return get('skill', 'configure');
    if (pathname === '/api/v1/skills/invoke' && method === 'POST')
        return get('skill', 'configure');
    if (pathname === '/api/v1/skills/verify' && method === 'POST')
        return get('skill', 'configure');
    if (pathname === '/api/v1/mcp/registry' && method === 'GET')
        return get('config', 'read');
    if (pathname === '/api/v1/mcp/install' && method === 'POST')
        return get('config', 'update');
    if (pathname === '/api/v1/mcp/tools' && method === 'GET')
        return get('config', 'read');
    if (pathname?.match(/^\/api\/v1\/skills\/[^/]+$/) && method === 'DELETE')
        return get('skill', 'configure');
    if (pathname?.match(/^\/api\/v1\/skills\/[^/]+\/diagnose$/) && method === 'GET')
        return get('skill', 'read');
    if (pathname?.match(/^\/api\/v1\/skills\/[^/]+\/repair$/) && method === 'POST')
        return get('skill', 'configure');
    if (pathname?.match(/^\/api\/v1\/skills\/[^/]+\/files\/.+$/) && method === 'PATCH')
        return get('skill', 'configure');
    if (pathname === '/api/v1/procedural-skills' && method === 'GET')
        return get('skill', 'read');
    if (pathname?.match(/^\/api\/v1\/procedural-skills\/[^/]+$/) && method === 'DELETE')
        return get('skill', 'configure');
    if (pathname?.match(/^\/api\/v1\/procedural-skills\/[^/]+$/) && method === 'PATCH')
        return get('skill', 'configure');
    if (pathname?.match(/^\/api\/v1\/procedural-skills\/[^/]+\/reset$/) && method === 'POST')
        return get('skill', 'configure');
    if (pathname === '/api/v1/chat' && method === 'POST')
        return get('agent', 'invoke');
    if (pathname === '/api/v1/knowledge' && method === 'GET')
        return get('knowledge', 'read');
    if (pathname === '/api/v1/knowledge' && method === 'POST')
        return get('knowledge', 'upload');
    if (pathname === '/api/v1/knowledge' && method === 'DELETE')
        return get('knowledge', 'delete');
    if (pathname === '/api/v1/knowledge/search' && method === 'POST')
        return get('knowledge', 'read');
    if (pathname === '/api/v1/compliance/user-data' && method === 'DELETE')
        return get('session', 'delete');
    if (pathname === '/api/v1/workflow-templates' && method === 'GET')
        return get('workflow', 'read');
    if (pathname === '/api/v1/workflow-templates' && method === 'POST')
        return get('workflow', 'create');
    if (pathname?.match(/^\/api\/v1\/workflow-templates\/[^/]+$/) && (method === 'PATCH' || method === 'DELETE'))
        return get('workflow', 'update');
    if (pathname === '/api/v1/workflows' && method === 'GET')
        return get('workflow', 'read');
    if (pathname === '/api/v1/workflows' && method === 'POST')
        return get('workflow', 'create');
    if (pathname === '/api/v1/workflows/from-template' && method === 'POST')
        return get('workflow', 'create');
    if (pathname === '/api/v1/workflow-runs' && method === 'GET')
        return get('workflow', 'read');
    if (pathname?.startsWith('/api/v1/workflows/')) {
        const sub = pathname.slice('/api/v1/workflows/'.length);
        if (sub && !sub.includes('/')) {
            if (method === 'PATCH')
                return get('workflow', 'update');
            if (method === 'DELETE')
                return get('workflow', 'delete');
            return get('workflow', 'read');
        }
        if (sub.includes('/run') && method === 'POST')
            return get('workflow', 'run');
        if (sub.includes('/runs/')) {
            if (method === 'GET')
                return get('workflow', 'read');
            if (method === 'POST' && sub.endsWith('/resume'))
                return get('workflow', 'run');
        }
    }
    if (pathname === '/api/v1/nodes' && method === 'GET')
        return get('node', 'read');
    if (pathname === '/api/v1/nodes/capability-reference' && method === 'GET')
        return get('node', 'read');
    if (pathname === '/api/v1/nodes/pending' && method === 'GET')
        return get('node', 'approve');
    if (pathname?.match(/^\/api\/v1\/nodes\/pending\/[^/]+\/approve$/) && method === 'POST')
        return get('node', 'approve');
    if (pathname?.match(/^\/api\/v1\/nodes\/pending\/[^/]+\/reject$/) && method === 'POST')
        return get('node', 'approve');
    if (pathname?.match(/^\/api\/v1\/nodes\/[^/]+$/) && method === 'DELETE')
        return get('node', 'delete');
    if (pathname?.match(/^\/api\/v1\/nodes\/[^/]+\/invoke$/) && method === 'POST')
        return get('node', 'invoke');
    if (pathname === '/api/v1/nodes/invoke-batch' && method === 'POST')
        return get('node', 'invoke');
    if (pathname?.match(/^\/api\/v1\/nodes\/[^/]+\/approvals$/) && method === 'GET')
        return get('node', 'read');
    if (pathname?.match(/^\/api\/v1\/nodes\/[^/]+\/approvals$/) && method === 'PUT')
        return get('node', 'approve');
    if (pathname?.match(/^\/api\/v1\/nodes\/[^/]+\/tags$/) && (method === 'GET' || method === 'PUT'))
        return get('node', method === 'PUT' ? 'approve' : 'read');
    if (pathname === '/api/v1/nodes/exec-approval/pending' && method === 'GET')
        return get('node', 'read');
    if (pathname === '/api/v1/nodes/exec-approval/approve-all' && method === 'POST')
        return get('node', 'approve');
    if (pathname?.match(/^\/api\/v1\/nodes\/exec-approval\/[^/]+\/(?:approve|reject)$/) && method === 'POST')
        return get('node', 'approve');
    if (pathname === '/api/v1/nodes/exec-history' && method === 'GET')
        return get('node', 'read');
    if (pathname === '/api/v1/sandbox/summary' && method === 'GET')
        return get('agent', 'read');
    return null;
}
async function handleApi(req, res, pathname) {
    const method = req.method ?? 'GET';
    const reqUrl = parseRequestUrl(req);
    // ——— 安装向导检查（优先于认证） ———
    const { isInstalled } = await import('./install/wizard.js');
    const installExemptPaths = ['/api/v1/install/status', '/api/v1/install', '/api/v1/install/test-llm', '/api/v1/install/reset', '/api/v1/auth/required'];
    if (!isInstalled() && !installExemptPaths.includes(pathname)) {
        // 非安装接口：若为 API 请求返回 503，否则交由静态服务渲染安装页
        if (pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'not_installed', message: 'Please complete setup wizard first at /' }));
            return;
        }
        // 前端页面 SPA 路由，直接 fall-through 到静态服务（index.html 会渲染安装向导）
    }
    // API Key 认证（可选，APEXPANDA_API_KEY 设置时启用）
    // 豁免：openapi.json、auth 相关接口、安装接口
    const authExemptPaths = ['/api/v1/openapi.json', '/api/v1/auth/verify-key', '/api/v1/auth/required', ...installExemptPaths];
    const { validateRequest, getConfiguredApiKey, isAuthRequired } = await import('./auth/api-key.js');
    if (!authExemptPaths.includes(pathname) && !validateRequest(req)) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('WWW-Authenticate', 'Bearer');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing API key' }));
        return;
    }
    // RBAC 权限检查（APEXPANDA_RBAC_ENABLED=true 时生效）
    const { checkPermission } = await import('./auth/rbac.js');
    const routePerm = getRoutePermission(pathname, method);
    if (routePerm && !checkPermission(req, routePerm.resource, routePerm.action)) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Forbidden', message: `Missing permission: ${routePerm.resource}:${routePerm.action}` }));
        return;
    }
    // Auth 接口：供 Dashboard 登录页使用
    if (pathname === '/api/v1/auth/required' && method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        // 未安装时不调用 isAuthRequired()（会触发生成 api-key），直接返回 false
        const { isInstalled: chkInstalled } = await import('./install/wizard.js');
        res.end(JSON.stringify({ required: chkInstalled() ? isAuthRequired() : false }));
        return;
    }
    if (pathname === '/api/v1/auth/verify-key' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { apiKey } = JSON.parse(body || '{}');
            const key = typeof apiKey === 'string' ? apiKey.trim() : '';
            const configured = getConfiguredApiKey();
            if (!configured) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            if (key && key === configured) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: false, error: 'Invalid API key' }));
        }
        catch {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
        }
        return;
    }
    if (pathname === '/api/v1/channels' && method === 'GET') {
        const { getChannelInstances, hasChannelCredentialsForUi, isChannelConfigured, CHANNEL_TYPE_TEMPLATES, isSecretsFromEnvOnly } = await import('./config/loader.js');
        const baseUrl = process.env.APEXPANDA_BASE_URL ?? process.env.APEXPANDA_PUBLIC_URL ?? '';
        const secretsEditable = !isSecretsFromEnvOnly();
        const instances = getChannelInstances();
        const list = instances.map((inst) => {
            const tpl = CHANNEL_TYPE_TEMPLATES[inst.type];
            const hasCredentials = hasChannelCredentialsForUi(inst.id);
            const enabled = isChannelConfigured(inst.id);
            const config = {};
            const configFields = tpl?.configFields ?? [];
            for (const f of configFields) {
                const v = inst[f];
                const isSecret = ['appSecret', 'botToken', 'signingSecret', 'verifyToken', 'accessToken', 'secret', 'appToken'].includes(f);
                if (f === 'mentionEnabled') {
                    config[f] = { set: v === true || v === false, masked: v === false ? '关闭' : v === true ? '开启' : undefined };
                }
                else {
                    config[f] = {
                        set: !!v,
                        masked: f === 'defaultAgentId' ? (typeof v === 'string' ? v : undefined) : isSecret && typeof v === 'string' && v.length > 4 ? `****${v.slice(-4)}` : undefined,
                    };
                }
            }
            const chatRouting = inst.chatRouting && typeof inst.chatRouting === 'object' ? inst.chatRouting : {};
            return {
                id: inst.id,
                type: inst.type,
                name: inst.name ?? tpl?.name ?? inst.type,
                connectionMode: tpl?.connectionMode ?? 'webhook',
                webhookPath: `/webhooks/${inst.type}/${inst.id}`,
                configFields: [...configFields],
                enabled,
                hasCredentials,
                config,
                chatRouting,
            };
        });
        const channelTemplates = Object.entries(CHANNEL_TYPE_TEMPLATES).map(([id, tpl]) => ({
            id,
            name: tpl.name,
            connectionMode: tpl.connectionMode,
            webhookPath: tpl.webhookPath,
            configFields: [...tpl.configFields],
        }));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ channels: list, channelTemplates, baseUrl: baseUrl || undefined, secretsEditable }));
        return;
    }
    if (pathname === '/api/v1/channels' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { addChannelInstance, CHANNEL_TYPE_TEMPLATES } = await import('./config/loader.js');
            const { isSecretsFromEnvOnly } = await import('./config/loader.js');
            const patch = JSON.parse(body || '{}');
            const typeVal = patch.type;
            if (!typeVal || !(typeVal in CHANNEL_TYPE_TEMPLATES)) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid type', validTypes: Object.keys(CHANNEL_TYPE_TEMPLATES) }));
                return;
            }
            const instanceInput = {
                type: typeVal,
                name: typeof patch.name === 'string' ? patch.name.trim() || undefined : undefined,
                defaultAgentId: typeof patch.defaultAgentId === 'string' ? patch.defaultAgentId.trim() || undefined : undefined,
                mentionEnabled: patch.mentionEnabled === true,
                enabled: patch.enabled !== false,
            };
            if (!isSecretsFromEnvOnly()) {
                if (typeVal === 'feishu' || typeVal === 'lark') {
                    if (typeof patch.appId === 'string')
                        instanceInput.appId = patch.appId;
                    if (typeof patch.appSecret === 'string')
                        instanceInput.appSecret = patch.appSecret;
                }
                else if (typeVal === 'telegram') {
                    if (typeof patch.botToken === 'string')
                        instanceInput.botToken = patch.botToken;
                }
                else if (typeVal === 'slack') {
                    if (typeof patch.botToken === 'string')
                        instanceInput.botToken = patch.botToken;
                    if (typeof patch.appToken === 'string')
                        instanceInput.appToken = patch.appToken;
                    if (typeof patch.signingSecret === 'string')
                        instanceInput.signingSecret = patch.signingSecret;
                }
                else if (typeVal === 'whatsapp') {
                    if (typeof patch.verifyToken === 'string')
                        instanceInput.verifyToken = patch.verifyToken;
                    if (typeof patch.accessToken === 'string')
                        instanceInput.accessToken = patch.accessToken;
                    if (typeof patch.phoneNumberId === 'string')
                        instanceInput.phoneNumberId = patch.phoneNumberId;
                }
                else if (typeVal === 'dingtalk') {
                    if (typeof patch.clientId === 'string')
                        instanceInput.clientId = patch.clientId;
                    if (typeof patch.clientSecret === 'string')
                        instanceInput.clientSecret = patch.clientSecret;
                }
                else if (typeVal === 'wecom') {
                    if (typeof patch.botId === 'string')
                        instanceInput.botId = patch.botId;
                    if (typeof patch.secret === 'string')
                        instanceInput.secret = patch.secret;
                }
                else if (typeVal === 'discord') {
                    if (typeof patch.botToken === 'string')
                        instanceInput.botToken = patch.botToken;
                }
            }
            if (patch.chatRouting && typeof patch.chatRouting === 'object' && !Array.isArray(patch.chatRouting)) {
                const cleaned = {};
                for (const [k, v] of Object.entries(patch.chatRouting)) {
                    if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) {
                        cleaned[k.trim()] = v.trim();
                    }
                }
                instanceInput.chatRouting = cleaned;
            }
            const instance = await addChannelInstance(instanceInput);
            addAudit({ type: 'channel', action: 'create', detail: { instanceId: instance.id, type: instance.type } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, instance: { id: instance.id, type: instance.type, name: instance.name } }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Add failed' }));
        }
        return;
    }
    const channelsPatchMatch = pathname?.match(/^\/api\/v1\/channels\/([a-z0-9_-]+)$/);
    if (channelsPatchMatch && method === 'PATCH') {
        const instanceId = channelsPatchMatch[1];
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { getInstanceConfig, updateChannelInstance, isSecretsFromEnvOnly, CHANNEL_TYPE_TEMPLATES } = await import('./config/loader.js');
            const inst = getInstanceConfig(instanceId);
            if (!inst) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Channel instance not found' }));
                return;
            }
            const patch = JSON.parse(body || '{}');
            const p = {};
            if (patch.defaultAgentId !== undefined)
                p.defaultAgentId = typeof patch.defaultAgentId === 'string' ? patch.defaultAgentId.trim() || undefined : undefined;
            if (patch.mentionEnabled !== undefined)
                p.mentionEnabled = patch.mentionEnabled === true;
            if (patch.enabled !== undefined)
                p.enabled = patch.enabled === true;
            if (patch.name !== undefined)
                p.name = typeof patch.name === 'string' ? patch.name.trim() || undefined : undefined;
            if (patch.chatRouting !== undefined) {
                const r = patch.chatRouting;
                if (r && typeof r === 'object' && !Array.isArray(r)) {
                    const cleaned = {};
                    for (const [k, v] of Object.entries(r)) {
                        if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim())
                            cleaned[k.trim()] = v.trim();
                    }
                    p.chatRouting = cleaned;
                }
                else {
                    p.chatRouting = {};
                }
            }
            const typeVal = inst.type;
            if (!isSecretsFromEnvOnly()) {
                if (typeVal === 'feishu' || typeVal === 'lark') {
                    if (typeof patch.appId === 'string')
                        p.appId = patch.appId;
                    if (typeof patch.appSecret === 'string')
                        p.appSecret = patch.appSecret;
                }
                else if (typeVal === 'telegram') {
                    if (typeof patch.botToken === 'string')
                        p.botToken = patch.botToken;
                }
                else if (typeVal === 'slack') {
                    if (typeof patch.botToken === 'string')
                        p.botToken = patch.botToken;
                    if (typeof patch.appToken === 'string')
                        p.appToken = patch.appToken;
                    if (typeof patch.signingSecret === 'string')
                        p.signingSecret = patch.signingSecret;
                }
                else if (typeVal === 'whatsapp') {
                    if (typeof patch.verifyToken === 'string')
                        p.verifyToken = patch.verifyToken;
                    if (typeof patch.accessToken === 'string')
                        p.accessToken = patch.accessToken;
                    if (typeof patch.phoneNumberId === 'string')
                        p.phoneNumberId = patch.phoneNumberId;
                }
                else if (typeVal === 'dingtalk') {
                    if (typeof patch.clientId === 'string')
                        p.clientId = patch.clientId;
                    if (typeof patch.clientSecret === 'string')
                        p.clientSecret = patch.clientSecret;
                }
                else if (typeVal === 'wecom') {
                    if (typeof patch.botId === 'string')
                        p.botId = patch.botId;
                    if (typeof patch.secret === 'string')
                        p.secret = patch.secret;
                }
                else if (typeVal === 'discord') {
                    if (typeof patch.botToken === 'string')
                        p.botToken = patch.botToken;
                }
            }
            const updated = await updateChannelInstance(instanceId, p);
            if (updated) {
                addAudit({ type: 'channel', action: 'update', detail: { instanceId } });
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true }));
            }
            else {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Update failed' }));
            }
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Update failed' }));
        }
        return;
    }
    const channelsDeleteMatch = pathname?.match(/^\/api\/v1\/channels\/([a-z0-9_-]+)$/);
    if (channelsDeleteMatch && method === 'DELETE') {
        const instanceId = channelsDeleteMatch[1];
        try {
            const { getInstanceConfig, deleteChannelInstance } = await import('./config/loader.js');
            const inst = getInstanceConfig(instanceId);
            if (!inst) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Channel instance not found' }));
                return;
            }
            const ok = await deleteChannelInstance(instanceId);
            if (ok) {
                addAudit({ type: 'channel', action: 'delete', detail: { instanceId } });
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true }));
            }
            else {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Delete failed' }));
            }
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Delete failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/nodes' && method === 'GET') {
        const { listOnlineNodes } = await import('./node/store.js');
        const { getNodeTags } = await import('./node/tags-store.js');
        const nodes = await Promise.all(listOnlineNodes().map(async (c) => {
            const connTags = c.tags ?? [];
            const storedTags = await getNodeTags(c.nodeId);
            const tags = [...new Set([...connTags, ...storedTags])];
            return {
                nodeId: c.nodeId,
                deviceId: c.deviceId,
                displayName: c.displayName,
                platform: c.platform,
                capabilities: c.capabilities,
                envTools: c.envTools ?? [],
                tags,
                connectedAt: c.connectedAt,
                lastPongAt: c.lastPongAt,
                status: 'online',
            };
        }));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ nodes }));
        return;
    }
    if (pathname === '/api/v1/nodes/capability-reference' && method === 'GET') {
        const { NODE_INVOKE_TOOLS } = await import('./skills/node-tools.js');
        const byPlatform = {};
        for (const t of NODE_INVOKE_TOOLS) {
            for (const p of t.platforms) {
                if (!byPlatform[p])
                    byPlatform[p] = [];
                if (!byPlatform[p].includes(t.capability))
                    byPlatform[p].push(t.capability);
            }
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ byPlatform }));
        return;
    }
    if (pathname === '/api/v1/nodes/exec-history' && method === 'GET') {
        const { getExecHistory } = await import('./node/exec-history.js');
        const nodeId = reqUrl.searchParams.get('nodeId') ?? undefined;
        const limit = Math.min(500, Math.max(1, parseInt(reqUrl.searchParams.get('limit') ?? '100', 10)));
        const since = reqUrl.searchParams.get('since');
        const entries = await getExecHistory({
            nodeId,
            limit,
            since: since ? parseInt(since, 10) : undefined,
        });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ entries }));
        return;
    }
    if (pathname === '/api/v1/nodes/pending' && method === 'GET') {
        const { listPendingPairings } = await import('./node/store.js');
        const pending = listPendingPairings().map((p) => ({
            requestId: p.requestId,
            deviceId: p.deviceId,
            displayName: p.displayName,
            platform: p.platform,
            requestedAt: p.requestedAt,
        }));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ pending }));
        return;
    }
    const nodesPendingApproveMatch = pathname?.match(/^\/api\/v1\/nodes\/pending\/([^/]+)\/approve$/);
    if (nodesPendingApproveMatch && method === 'POST') {
        const requestId = nodesPendingApproveMatch[1];
        const { approvePairing } = await import('./node/store.js');
        const result = await approvePairing(requestId);
        if ('error' in result) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(404);
            res.end(JSON.stringify({ error: result.error }));
            return;
        }
        addAudit({ type: 'node', action: 'approve', detail: { requestId, nodeId: result.nodeId } });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, nodeId: result.nodeId, token: result.token }));
        return;
    }
    const nodesPendingRejectMatch = pathname?.match(/^\/api\/v1\/nodes\/pending\/([^/]+)\/reject$/);
    if (nodesPendingRejectMatch && method === 'POST') {
        const requestId = nodesPendingRejectMatch[1];
        const { rejectPairing } = await import('./node/store.js');
        const ok = rejectPairing(requestId);
        addAudit({ type: 'node', action: 'reject', detail: { requestId } });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok }));
        return;
    }
    const nodesDeleteMatch = pathname?.match(/^\/api\/v1\/nodes\/([^/]+)$/);
    if (nodesDeleteMatch && method === 'DELETE') {
        const nodeId = nodesDeleteMatch[1];
        const { getNodeConnection, revokePairing, findPairingByNodeId } = await import('./node/store.js');
        const { rejectAllPending } = await import('./node/invoke.js');
        const conn = getNodeConnection(nodeId);
        if (conn) {
            await revokePairing(conn.deviceId);
            rejectAllPending(nodeId);
            try {
                if (conn.ws.readyState === 1)
                    conn.ws.close();
            }
            catch {
                /* ignore */
            }
        }
        else {
            const p = await findPairingByNodeId(nodeId);
            if (p)
                await revokePairing(p.deviceId);
        }
        addAudit({ type: 'node', action: 'revoke', detail: { nodeId } });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    if (pathname === '/api/v1/nodes/invoke-batch' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        const startAt = Date.now();
        try {
            const data = JSON.parse(body || '{}');
            const baseParams = data.params ?? {};
            const cmdParams = { ...baseParams, command: baseParams.command ?? data.command ?? '' };
            if (!String(cmdParams.command ?? '').trim()) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'params.command required' }));
                return;
            }
            const { invokeNodeBatch, sensitiveRedact } = await import('./node/invoke.js');
            const { results } = await invokeNodeBatch('system.run', cmdParams, {
                nodeIds: data.nodeIds,
                nodeTags: data.nodeTags,
                timeoutMs: 60_000,
            });
            const durationMs = Date.now() - startAt;
            addAudit({ type: 'node', action: 'invoke', detail: { source: 'api', toolId: 'batchSysRun', durationMs, nodeCount: results.length, params: sensitiveRedact(cmdParams) } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, payload: { results, summary: `在 ${results.length} 个节点执行：成功 ${results.filter((r) => r.ok).length}，失败 ${results.filter((r) => !r.ok).length}` } }));
        }
        catch (e) {
            const durationMs = Date.now() - startAt;
            addAudit({ type: 'node', action: 'invoke', detail: { source: 'api', toolId: 'batchSysRun', ok: false, durationMs, error: e instanceof Error ? e.message : String(e) } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
    }
    const nodesInvokeMatch = pathname?.match(/^\/api\/v1\/nodes\/([^/]+)\/invoke$/);
    if (nodesInvokeMatch && method === 'POST') {
        const nodeId = nodesInvokeMatch[1];
        let body = '';
        for await (const chunk of req)
            body += chunk;
        let command = '';
        let cmdParams = {};
        const startAt = Date.now();
        try {
            const params = JSON.parse(body || '{}');
            command = params.command ?? '';
            cmdParams = params.params ?? {};
            if (!command || typeof command !== 'string') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'command required' }));
                return;
            }
            const { invokeNodeWithMediaHandling, sensitiveRedact } = await import('./node/invoke.js');
            const result = await invokeNodeWithMediaHandling(nodeId, command, cmdParams);
            const durationMs = Date.now() - startAt;
            addAudit({ type: 'node', action: 'invoke', detail: { nodeId, command, source: 'api', params: sensitiveRedact(cmdParams) } });
            if (command === 'system.run') {
                const r = result;
                const { addExecHistory } = await import('./node/exec-history.js');
                addExecHistory({
                    nodeId,
                    command: String(cmdParams.command ?? ''),
                    ok: true,
                    exitCode: r?.exitCode ?? 0,
                    durationMs,
                    timestamp: Date.now(),
                    source: 'api',
                }).catch(() => { });
            }
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, payload: result }));
        }
        catch (e) {
            const durationMs = Date.now() - startAt;
            if (command === 'system.run') {
                const { addExecHistory } = await import('./node/exec-history.js');
                addExecHistory({
                    nodeId,
                    command: String(cmdParams.command ?? ''),
                    ok: false,
                    durationMs,
                    timestamp: Date.now(),
                    source: 'api',
                    error: e instanceof Error ? e.message : String(e),
                }).catch(() => { });
            }
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
    }
    const nodesTagsMatch = pathname?.match(/^\/api\/v1\/nodes\/([^/]+)\/tags$/);
    if (nodesTagsMatch && (method === 'GET' || method === 'PUT')) {
        const nodeId = nodesTagsMatch[1];
        const { getNodeTags, setNodeTags } = await import('./node/tags-store.js');
        if (method === 'GET') {
            const tags = await getNodeTags(nodeId);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ tags }));
            return;
        }
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const data = JSON.parse(body || '{}');
            const tags = Array.isArray(data.tags) ? data.tags : [];
            await setNodeTags(nodeId, tags);
            addAudit({ type: 'node', action: 'tags_update', detail: { nodeId, tags } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, tags }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid JSON' }));
        }
        return;
    }
    const nodesApprovalsMatch = pathname?.match(/^\/api\/v1\/nodes\/([^/]+)\/approvals$/);
    if (nodesApprovalsMatch) {
        const nodeId = nodesApprovalsMatch[1];
        const { getNodeApprovals, saveNodeApprovals, pushNodeApprovals } = await import('./node/approvals-store.js');
        if (method === 'GET') {
            const data = await getNodeApprovals(nodeId);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ approvals: data ?? { mode: 'full', rules: [] } }));
            return;
        }
        if (method === 'PUT') {
            let body = '';
            for await (const chunk of req)
                body += chunk;
            try {
                const data = JSON.parse(body || '{}');
                const toSave = {
                    mode: data.mode ?? 'full',
                    rules: data.rules ?? [],
                    trustPaths: Array.isArray(data.trustPaths) ? data.trustPaths : undefined,
                    trustPatterns: Array.isArray(data.trustPatterns) ? data.trustPatterns : undefined,
                    approvalTimeoutMs: typeof data.approvalTimeoutMs === 'number' ? data.approvalTimeoutMs : undefined,
                };
                await saveNodeApprovals(nodeId, toSave);
                const pushed = pushNodeApprovals(nodeId, toSave);
                addAudit({ type: 'node', action: 'approvals_update', detail: { nodeId, pushed } });
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, pushed }));
            }
            catch (e) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid JSON' }));
            }
            return;
        }
    }
    if (pathname === '/api/v1/nodes/exec-approval/pending' && method === 'GET') {
        const { getPendingExecApprovals } = await import('./node/exec-approval.js');
        const list = getPendingExecApprovals().map((p) => ({
            reqId: p.reqId,
            nodeId: p.nodeId,
            displayName: p.displayName,
            command: p.command,
            params: p.params,
            requestedAt: p.requestedAt,
        }));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ pending: list }));
        return;
    }
    if (pathname === '/api/v1/nodes/exec-approval/approve-all' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const data = JSON.parse(body || '{}');
            const targetNodeId = data.nodeId?.trim();
            if (!targetNodeId) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'nodeId required' }));
                return;
            }
            const { resolveAllByNodeId } = await import('./node/exec-approval.js');
            const count = resolveAllByNodeId(targetNodeId, true);
            addAudit({ type: 'node', action: 'exec_approval_batch', detail: { nodeId: targetNodeId, approved: true, count } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, count }));
            return;
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' }));
            return;
        }
    }
    const execApprovalMatch = pathname?.match(/^\/api\/v1\/nodes\/exec-approval\/([^/]+)\/(approve|reject)$/);
    if (execApprovalMatch && method === 'POST') {
        const reqId = execApprovalMatch[1];
        const action = execApprovalMatch[2];
        const approved = action === 'approve';
        const { resolveExecApproval } = await import('./node/exec-approval.js');
        const ok = resolveExecApproval(reqId, approved);
        addAudit({ type: 'node', action: 'exec_approval', detail: { reqId, approved } });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok }));
        return;
    }
    if (pathname === '/api/v1/llm/test' && method === 'POST') {
        try {
            const { getLLMProvider } = await import('./agent/config.js');
            const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
            const testModel = url.searchParams.get('model')?.trim() || undefined;
            const llm = getLLMProvider(testModel);
            await llm.complete([{ role: 'user', content: 'hi' }]);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : String(e),
            }));
        }
        return;
    }
    if (pathname === '/api/v1/config' && method === 'GET') {
        const { getConfigSync, getLLMBaseUrl, getLLMModel, getLLMFallbackModel, getWorkspaceDir, isSecretsFromEnvOnly, getConfigPath, loadConfig, getDiscussionConfig, getMemoryConfig, getDeleteConfirmRequired, getHybridSearchEnabled, getAgentSelectorConfig, getVerifyConfig, DEFAULT_INTENT_MAPPINGS, } = await import('./config/loader.js');
        const cfg = getConfigSync();
        const apiKey = process.env.APEXPANDA_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? cfg.llm?.apiKey ?? '';
        const baseUrlFromEnv = !!process.env.APEXPANDA_LLM_BASE_URL;
        const modelFromEnv = !!process.env.APEXPANDA_LLM_MODEL;
        const workspaceFromEnv = !!process.env.APEXPANDA_WORKSPACE;
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        const defaultModel = getLLMModel();
        const modelPresets = cfg.llm?.modelPresets ?? [];
        const endpoints = cfg.llm?.endpoints ?? {};
        const endpointModels = Object.keys(endpoints);
        const seen = new Set();
        const modelOptions = [
            { value: '', label: '使用全局默认' },
            ...(defaultModel ? [{ value: defaultModel, label: `${defaultModel} (全局)` }] : []),
            ...modelPresets
                .filter((p) => {
                if (seen.has(p.model) || p.model === defaultModel)
                    return false;
                seen.add(p.model);
                return true;
            })
                .map((p) => ({ value: p.model, label: p.label ? `${p.label} (${p.model})` : p.model })),
            ...endpointModels
                .filter((m) => !seen.has(m))
                .map((m) => ({ value: m, label: m })),
        ];
        const endpointsMasked = {};
        for (const [k, v] of Object.entries(endpoints)) {
            if (v && typeof v.baseUrl === 'string') {
                const ek = v.apiKey;
                endpointsMasked[k] = {
                    baseUrl: v.baseUrl,
                    apiKeySet: !!ek,
                    apiKeyMasked: ek ? `****${String(ek).slice(-4)}` : undefined,
                };
            }
        }
        res.end(JSON.stringify({
            llm: {
                baseUrl: getLLMBaseUrl(),
                apiKeySet: !!apiKey,
                apiKeyMasked: apiKey ? `****${apiKey.slice(-4)}` : null,
                model: defaultModel,
                fallbackModel: getLLMFallbackModel() ?? undefined,
                apiKeyEditable: !isSecretsFromEnvOnly(),
                baseUrlFromEnv,
                modelFromEnv,
                modelPresets,
                modelOptions,
                endpoints: endpointsMasked,
            },
            workspace: getWorkspaceDir(),
            workspaceFromEnv,
            configPath: getConfigPath(),
            defaultAgentId: cfg.defaultAgentId ?? undefined,
            deleteConfirmRequired: getDeleteConfirmRequired(),
            deleteConfirmRequiredFromEnv: !!process.env.APEXPANDA_DELETE_CONFIRM_REQUIRED,
            intentMappings: (await loadConfig()).intentMappings ?? [],
            defaultIntentMappings: DEFAULT_INTENT_MAPPINGS,
            skills: cfg.skills ?? undefined,
            discussion: getDiscussionConfig(),
            memory: getMemoryConfig(),
            knowledge: {
                ...(cfg.knowledge ?? {}),
                hybridSearchEnabled: getHybridSearchEnabled(),
                hybridSearchFromEnv: process.env.APEXPANDA_HYBRID_SEARCH_ENABLED !== undefined,
                embeddingFromEnv: !!process.env.APEXPANDA_EMBEDDING_ENABLED,
            },
            multiAgent: {
                autoSelectAgent: getAgentSelectorConfig().enabled,
                autoSelectMaxAgents: getAgentSelectorConfig().maxAgents,
                verifyEnabled: getVerifyConfig().enabled,
            },
            mcp: cfg.mcp ?? undefined,
        }));
        return;
    }
    if (pathname === '/api/v1/voicewake' && method === 'GET') {
        const { loadVoiceWakeConfig } = await import('./voicewake/config.js');
        const config = await loadVoiceWakeConfig();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(config));
        return;
    }
    if (pathname === '/api/v1/voicewake/recognize' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const parsed = JSON.parse(body || '{}');
            const audioBase64 = parsed?.audioBase64?.trim?.() ?? '';
            const format = String(parsed?.format ?? 'webm').toLowerCase();
            if (!audioBase64) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'audioBase64 required' }));
                return;
            }
            const { recognizeWithFallback } = await import('./channels/asr-fallback.js');
            const result = await recognizeWithFallback({ audioBase64, format });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ text: result.text ?? '', error: result.error }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
    }
    if (pathname === '/api/v1/voicewake/tts' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const parsed = JSON.parse(body || '{}');
            const text = String(parsed?.text ?? '').trim();
            if (!text) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'text required' }));
                return;
            }
            const { invokeTool } = await import('./skills/registry.js');
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const { getWorkspaceDir } = await import('./config/loader.js');
            const ws = getWorkspaceDir();
            let audioBase64 = '';
            let format = 'mp3';
            const ttsAzure = await invokeTool('tts-azure', 'synthesize', { text }).catch(() => null);
            const parseTtsResult = (r) => r && typeof r === 'object' && r !== null && '_fileReply' in r ? r : null;
            const azure = parseTtsResult(ttsAzure);
            if (azure?.filePath) {
                const abs = azure.filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(azure.filePath)
                    ? azure.filePath
                    : join(ws, azure.filePath.replace(/^\.[/\\]/, ''));
                const buf = await readFile(abs);
                audioBase64 = buf.toString('base64');
            }
            if (!audioBase64) {
                const ttsAliyun = await invokeTool('tts-aliyun', 'synthesize', { text }).catch(() => null);
                const aliyun = parseTtsResult(ttsAliyun);
                if (aliyun?.filePath) {
                    const abs = aliyun.filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(aliyun.filePath)
                        ? aliyun.filePath
                        : join(ws, aliyun.filePath.replace(/^\.[/\\]/, ''));
                    const buf = await readFile(abs);
                    audioBase64 = buf.toString('base64');
                    format = aliyun.mimeType?.includes('wav') ? 'wav' : 'mp3';
                }
            }
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(audioBase64 ? { audioBase64, format } : { error: 'TTS 未配置（需 tts-azure 或 tts-aliyun）' }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
    }
    if (pathname === '/api/v1/voicewake' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { saveVoiceWakeConfig } = await import('./voicewake/config.js');
            const parsed = JSON.parse(body || '{}');
            const patch = (typeof parsed === 'object' && parsed !== null ? parsed : {});
            const config = await saveVoiceWakeConfig(patch);
            const { broadcast, broadcastToNodes } = await import('./ws.js');
            broadcast({ type: 'voicewake.changed', payload: config });
            broadcastToNodes({ type: 'voicewake_config', payload: config });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(config));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
    }
    if (pathname === '/api/v1/config' && method === 'PATCH') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { saveConfig, loadConfig, isSecretsFromEnvOnly } = await import('./config/loader.js');
            const patch = JSON.parse(body || '{}');
            const llmPatch = {};
            if (patch.llm && typeof patch.llm === 'object') {
                const llm = patch.llm;
                if (typeof llm.baseUrl === 'string')
                    llmPatch.baseUrl = llm.baseUrl;
                if (typeof llm.model === 'string') {
                    const m = llm.model.replace(/^["']|["']$/g, '').trim();
                    llmPatch.model = m || llm.model;
                }
                if (llm.fallbackModel !== undefined)
                    llmPatch.fallbackModel = typeof llm.fallbackModel === 'string' ? llm.fallbackModel.trim() || undefined : undefined;
                if (typeof llm.apiKey === 'string' && !isSecretsFromEnvOnly())
                    llmPatch.apiKey = llm.apiKey;
                if (Array.isArray(llm.modelPresets)) {
                    const seen = new Set();
                    llmPatch.modelPresets = llm.modelPresets
                        .filter((p) => typeof p === 'object' && p !== null && typeof p.model === 'string')
                        .map((p) => {
                        const model = String(p.model).replace(/^["']|["']$/g, '').trim();
                        return { label: p.label?.replace(/^["']|["']$/g, '').trim() || model, model };
                    })
                        .filter((p) => {
                        if (!p.model || seen.has(p.model))
                            return false;
                        seen.add(p.model);
                        return true;
                    });
                }
                if (llm.endpoints !== undefined && typeof llm.endpoints === 'object') {
                    const eps = {};
                    for (const [k, v] of Object.entries(llm.endpoints)) {
                        const normKey = String(k).replace(/^["']|["']$/g, '').trim();
                        if (!normKey)
                            continue;
                        if (v && typeof v === 'object' && typeof v.baseUrl === 'string') {
                            const o = v;
                            eps[normKey] = { baseUrl: o.baseUrl };
                            if (typeof o.apiKey === 'string' && o.apiKey.trim())
                                eps[normKey].apiKey = o.apiKey.trim();
                        }
                    }
                    llmPatch.endpoints = eps;
                }
                const toRemove = llm.endpointsToRemove;
                if (Array.isArray(toRemove) && toRemove.length > 0) {
                    llmPatch.endpointsToRemove = toRemove;
                }
            }
            const configPatch = {};
            if (Object.keys(llmPatch).length > 0)
                configPatch.llm = llmPatch;
            if (typeof patch.workspace === 'string')
                configPatch.workspace = patch.workspace;
            if (patch.defaultAgentId !== undefined)
                configPatch.defaultAgentId = typeof patch.defaultAgentId === 'string' ? patch.defaultAgentId.trim() || undefined : undefined;
            if (patch.deleteConfirmRequired !== undefined && typeof patch.deleteConfirmRequired === 'boolean') {
                configPatch.deleteConfirmRequired = patch.deleteConfirmRequired;
            }
            if (patch.skills && typeof patch.skills === 'object') {
                const skillsPatch = patch.skills;
                if (skillsPatch.entries && typeof skillsPatch.entries === 'object') {
                    const currentEntries = (await loadConfig()).skills?.entries ?? {};
                    const merged = {};
                    for (const key of Object.keys(currentEntries)) {
                        merged[key] = { ...currentEntries[key] };
                    }
                    for (const [k, v] of Object.entries(skillsPatch.entries)) {
                        if (v && typeof v === 'object') {
                            const cur = (merged[k] || {});
                            merged[k] = {
                                ...cur,
                                ...(v.enabled !== undefined && { enabled: v.enabled }),
                                ...(typeof v.apiKey === 'string' && v.apiKey.trim() ? { apiKey: v.apiKey.trim() } : {}),
                                ...(v.env && typeof v.env === 'object' && { env: v.env }),
                                ...(v.config !== undefined && { config: v.config }),
                            };
                        }
                    }
                    configPatch.skills = { entries: merged };
                }
            }
            if (Array.isArray(patch.intentMappings)) {
                configPatch.intentMappings = patch.intentMappings.filter((m) => typeof m === 'object' && m !== null &&
                    typeof m.phrase === 'string' &&
                    typeof m.tool === 'string').map((m) => ({
                    phrase: String(m.phrase).trim(),
                    tool: String(m.tool).trim(),
                    params: m.params && typeof m.params === 'object' ? m.params : {},
                }));
            }
            if (patch.discussion !== undefined && typeof patch.discussion === 'object') {
                const d = patch.discussion;
                const discussionPatch = {};
                if (typeof d.defaultRounds === 'number' && d.defaultRounds >= 1 && d.defaultRounds <= 10) {
                    discussionPatch.defaultRounds = d.defaultRounds;
                }
                if (typeof d.maxRounds === 'number' && d.maxRounds >= 1 && d.maxRounds <= 10) {
                    discussionPatch.maxRounds = d.maxRounds;
                }
                if (typeof d.maxAgents === 'number' && d.maxAgents >= 1 && d.maxAgents <= 10) {
                    discussionPatch.maxAgents = d.maxAgents;
                }
                if (typeof d.timeoutMinutes === 'number' && d.timeoutMinutes >= 5 && d.timeoutMinutes <= 120) {
                    discussionPatch.timeoutMinutes = d.timeoutMinutes;
                }
                if (Array.isArray(d.endPhrases) && d.endPhrases.every((p) => typeof p === 'string' && p.trim())) {
                    discussionPatch.endPhrases = d.endPhrases.map((p) => p.trim()).filter(Boolean);
                }
                if (Object.keys(discussionPatch).length > 0) {
                    configPatch.discussion = discussionPatch;
                }
            }
            if (patch.memory !== undefined && typeof patch.memory === 'object') {
                const m = patch.memory;
                const memoryPatch = {};
                if (typeof m.persist === 'boolean')
                    memoryPatch.persist = m.persist;
                if (typeof m.decayHalfLifeDays === 'number' && m.decayHalfLifeDays >= 1 && m.decayHalfLifeDays <= 365) {
                    memoryPatch.decayHalfLifeDays = m.decayHalfLifeDays;
                }
                if (typeof m.logHalfLifeDays === 'number' && m.logHalfLifeDays >= 1 && m.logHalfLifeDays <= 90) {
                    memoryPatch.logHalfLifeDays = m.logHalfLifeDays;
                }
                if (typeof m.postDialogueFlushRounds === 'number' && m.postDialogueFlushRounds >= 0 && m.postDialogueFlushRounds <= 20) {
                    memoryPatch.postDialogueFlushRounds = m.postDialogueFlushRounds;
                }
                if (typeof m.exportMarkdown === 'boolean')
                    memoryPatch.exportMarkdown = m.exportMarkdown;
                if (typeof m.preCompactionFlush === 'boolean')
                    memoryPatch.preCompactionFlush = m.preCompactionFlush;
                if (typeof m.sessionIndexInSearch === 'boolean')
                    memoryPatch.sessionIndexInSearch = m.sessionIndexInSearch;
                if (typeof m.preInjectTopK === 'number' && m.preInjectTopK >= 0 && m.preInjectTopK <= 20)
                    memoryPatch.preInjectTopK = m.preInjectTopK;
                if (typeof m.consolidationEnabled === 'boolean')
                    memoryPatch.consolidationEnabled = m.consolidationEnabled;
                if (m.consolidationCron !== undefined)
                    memoryPatch.consolidationCron = typeof m.consolidationCron === 'string' && m.consolidationCron.trim() ? m.consolidationCron.trim() : '';
                if (Object.keys(memoryPatch).length > 0) {
                    configPatch.memory = memoryPatch;
                }
            }
            if (patch.mcp !== undefined && typeof patch.mcp === 'object') {
                const cfg = await loadConfig();
                const mcpPatch = patch.mcp;
                const mcpOut = { ...cfg.mcp };
                if (mcpPatch.client) {
                    const curClient = (cfg.mcp?.client ?? {});
                    const client = { ...curClient };
                    if (Array.isArray(mcpPatch.client.servers)) {
                        const servers = [];
                        for (const s of mcpPatch.client.servers) {
                            const o = s;
                            if (!o || typeof o.id !== 'string' || !o.id.trim())
                                continue;
                            const id = String(o.id).trim();
                            const transport = o.transport || 'stdio';
                            if (transport === 'sse' && typeof o.url === 'string' && o.url.trim().startsWith('http')) {
                                servers.push({ id, transport: 'sse', url: String(o.url).trim() });
                            }
                            else if (typeof o.command === 'string' && o.command.trim() && Array.isArray(o.args)) {
                                servers.push({
                                    id,
                                    transport: 'stdio',
                                    command: String(o.command).trim(),
                                    args: o.args.map((a) => String(a)),
                                    env: o.env && typeof o.env === 'object' ? o.env : undefined,
                                });
                            }
                        }
                        client.servers = servers;
                    }
                    if (typeof mcpPatch.client.callTimeoutMs === 'number' && mcpPatch.client.callTimeoutMs > 0) {
                        client.callTimeoutMs = mcpPatch.client.callTimeoutMs;
                    }
                    if (Array.isArray(mcpPatch.client.allowedCommands)) {
                        client.allowedCommands = mcpPatch.client.allowedCommands.filter((a) => typeof a === 'string');
                    }
                    mcpOut.client = client;
                }
                if (Array.isArray(mcpPatch.registries)) {
                    const curList = (cfg.mcp?.registries ?? []);
                    const curByUrl = new Map();
                    for (const r of curList) {
                        const u = (typeof r === 'string' ? r : r?.url)?.trim().replace(/\/$/, '');
                        if (u && typeof r === 'object' && r.token) {
                            curByUrl.set(u, r.token);
                        }
                    }
                    mcpOut.registries = mcpPatch.registries
                        .map((r) => {
                        if (typeof r === 'string' && r.trim().startsWith('http')) {
                            const u = r.trim().replace(/\/$/, '');
                            return { url: u, token: curByUrl.get(u) };
                        }
                        if (r && typeof r === 'object' && typeof r.url === 'string') {
                            const o = r;
                            const u = o.url.trim().replace(/\/$/, '');
                            if (!u.startsWith('http'))
                                return null;
                            const token = typeof o.token === 'string' && o.token.trim() ? o.token.trim() : curByUrl.get(u);
                            return { url: u, ...(token ? { token } : {}) };
                        }
                        return null;
                    })
                        .filter((r) => r !== null);
                }
                configPatch.mcp = mcpOut;
            }
            if (patch.knowledge !== undefined && typeof patch.knowledge === 'object') {
                const k = patch.knowledge;
                const cur = await loadConfig();
                let knowledgeOut = { ...(cur.knowledge ?? {}) };
                if (process.env.APEXPANDA_HYBRID_SEARCH_ENABLED === undefined && k.hybridSearch !== undefined && typeof k.hybridSearch === 'object' && typeof k.hybridSearch.enabled === 'boolean') {
                    knowledgeOut = { ...knowledgeOut, hybridSearch: { ...(knowledgeOut.hybridSearch ?? {}), enabled: k.hybridSearch.enabled } };
                }
                if (k.embedding !== undefined && typeof k.embedding === 'object' && typeof k.embedding.enabled === 'boolean') {
                    knowledgeOut = { ...knowledgeOut, embedding: { ...(knowledgeOut.embedding ?? {}), enabled: k.embedding.enabled } };
                }
                if (k.rerank !== undefined && typeof k.rerank === 'object') {
                    const r = k.rerank;
                    const rerankPatch = {};
                    if (typeof r.enabled === 'boolean')
                        rerankPatch.enabled = r.enabled;
                    if (r.provider === 'local' || r.provider === 'cohere' || r.provider === 'jina')
                        rerankPatch.provider = r.provider;
                    if (typeof r.model === 'string')
                        rerankPatch.model = r.model.trim() || undefined;
                    if (typeof r.topK === 'number' && r.topK >= 1)
                        rerankPatch.topK = r.topK;
                    if (typeof r.apiKey === 'string' && r.apiKey.trim() && !isSecretsFromEnvOnly()) {
                        rerankPatch.apiKey = r.apiKey.trim();
                    }
                    if (Object.keys(rerankPatch).length > 0) {
                        knowledgeOut = {
                            ...knowledgeOut,
                            rerank: { ...(knowledgeOut.rerank ?? {}), ...rerankPatch },
                        };
                    }
                }
                if (Object.keys(knowledgeOut).length > 0) {
                    configPatch.knowledge = knowledgeOut;
                }
            }
            if (patch.multiAgent !== undefined && typeof patch.multiAgent === 'object') {
                const cur = (await loadConfig()).multiAgent ?? {};
                const ma = patch.multiAgent;
                const multiAgentPatch = { ...cur };
                if (typeof ma.autoSelectAgent === 'boolean')
                    multiAgentPatch.autoSelectAgent = ma.autoSelectAgent;
                if (typeof ma.autoSelectMaxAgents === 'number' && ma.autoSelectMaxAgents >= 1 && ma.autoSelectMaxAgents <= 5) {
                    multiAgentPatch.autoSelectMaxAgents = ma.autoSelectMaxAgents;
                }
                if (typeof ma.verifyEnabled === 'boolean')
                    multiAgentPatch.verifyEnabled = ma.verifyEnabled;
                configPatch.multiAgent = multiAgentPatch;
            }
            await saveConfig(configPatch);
            addAudit({ type: 'config', action: 'update', detail: {} });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    if (pathname === '/api/v1/mcp/registry' && method === 'GET') {
        try {
            const { fetchRegistryServers } = await import('./mcp/registry-client.js');
            const { loadConfig } = await import('./config/loader.js');
            const search = reqUrl.searchParams.get('search') ?? undefined;
            const limit = Math.min(50, Math.max(1, Number(reqUrl.searchParams.get('limit')) || 20));
            const cursor = reqUrl.searchParams.get('cursor') ?? undefined;
            let registryUrl;
            let token;
            const v = reqUrl.searchParams.get('registryUrl') ?? '';
            if (v && v !== 'default' && v.startsWith('http')) {
                registryUrl = v.trim().replace(/\/$/, '');
                const cfg = await loadConfig();
                const regs = (cfg.mcp?.registries ?? []);
                for (const r of regs) {
                    const u = typeof r === 'string' ? r : r.url;
                    if (u && u.replace(/\/$/, '') === registryUrl && typeof r === 'object' && r.token) {
                        token = r.token;
                        break;
                    }
                }
            }
            const data = await fetchRegistryServers({ search, limit, cursor, registryUrl, token });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(data));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(502);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Registry fetch failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/mcp/tools' && method === 'GET') {
        try {
            const reqUrl = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
            const serverId = reqUrl.searchParams.get('serverId')?.trim();
            if (serverId) {
                const { testMcpServerConnection } = await import('./mcp/client.js');
                const result = await testMcpServerConnection(serverId);
                const servers = 'error' in result
                    ? [{ id: result.serverId, tools: [], error: result.error }]
                    : [{ id: result.serverId, tools: result.tools.map((t) => ({ name: t.name, description: t.description })) }];
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ servers }));
            }
            else {
                const { loadConfig } = await import('./config/loader.js');
                const { getMcpTools } = await import('./mcp/client.js');
                const cfg = await loadConfig();
                const configured = (cfg.mcp?.client?.servers ?? []).map((s) => s.id).filter(Boolean);
                const groups = await getMcpTools();
                const servers = groups.map((g) => ({
                    id: g.serverId,
                    tools: g.tools.map((t) => ({ name: t.name, description: t.description })),
                }));
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ servers, configured }));
            }
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(502);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'MCP tools fetch failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/mcp/install' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { loadConfig, saveConfig } = await import('./config/loader.js');
            const { registryServerToClientEntry } = await import('./mcp/registry-client.js');
            const { server: serverData, packageIndex = 0, userArgs = {} } = JSON.parse(body || '{}');
            if (!serverData?.server) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'server is required' }));
                return;
            }
            const srv = serverData.server;
            const serverId = (srv.name ?? 'mcp-server').replace(/[/:]/g, '-').replace(/\s+/g, '_').toLowerCase().slice(0, 32) || 'mcp-server';
            const entry = registryServerToClientEntry(srv, serverId, userArgs);
            if (!entry) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'No supported package found (npm/pypi/docker/nuget/sse)' }));
                return;
            }
            const entryId = entry.id;
            const cfg = await loadConfig();
            const raw = cfg.mcp?.client?.servers;
            const curServers = [];
            if (Array.isArray(raw)) {
                for (const s of raw) {
                    const o = s;
                    if (!o || typeof o.id !== 'string')
                        continue;
                    if (o.transport === 'sse' && typeof o.url === 'string') {
                        curServers.push({ id: String(o.id), transport: 'sse', url: String(o.url) });
                    }
                    else if (typeof o.command === 'string' && Array.isArray(o.args)) {
                        curServers.push({
                            id: String(o.id),
                            transport: 'stdio',
                            command: String(o.command),
                            args: o.args.map(String),
                            env: o.env && typeof o.env === 'object' ? o.env : undefined,
                        });
                    }
                }
            }
            if (curServers.some((s) => s.id === entryId)) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: `Server "${entryId}" already installed` }));
                return;
            }
            const servers = [...curServers, entry];
            await saveConfig({ mcp: { client: { servers } } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, id: entryId }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Install failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/status' && method === 'GET') {
        const { loadConfig } = await import('./config/loader.js');
        const { listAgents } = await import('./agent/store.js');
        const { listSessionIds } = await import('./session/store.js');
        const { loadAllSkills } = await import('./skills/registry.js');
        const { listWorkflows } = await import('./workflow/store.js');
        const { getMemoryScopes, getMemoryCountsForScopes } = await import('./skills/executor.js');
        const agentList = await listAgents();
        const sessionIds = await listSessionIds();
        const skills = await loadAllSkills();
        const workflows = await listWorkflows();
        const store = getKnowledgeStore();
        const knowledgeCount = 'list' in store && typeof store.list === 'function'
            ? (await store.list()).length
            : 0;
        let memoryEntries = 0;
        try {
            const scopes = await getMemoryScopes();
            const counts = await getMemoryCountsForScopes(scopes);
            memoryEntries = Object.values(counts).reduce((a, b) => a + b, 0);
        }
        catch {
            /* memory might not be loaded */
        }
        const cfg = await loadConfig();
        const mcpServers = (cfg.mcp?.client?.servers ?? []);
        const mcpClients = mcpServers.length;
        let mcpToolsTotal = 0;
        if (mcpClients > 0) {
            try {
                const { getMcpTools } = await import('./mcp/client.js');
                const groups = await getMcpTools();
                mcpToolsTotal = groups.reduce((s, g) => s + (g.tools?.length ?? 0), 0);
            }
            catch {
                /* MCP might not be connected */
            }
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({
            gateway: 'running',
            uptime: process.uptime(),
            agents: agentList.length,
            sessions: sessionIds.length,
            skills: skills.length,
            workflows: workflows.length,
            knowledgeChunks: knowledgeCount,
            memoryEntries,
            mcpEnabled: process.env.APEXPANDA_MCP_ENABLED !== 'false',
            mcpClients,
            mcpToolsTotal,
        }));
        return;
    }
    if (pathname === '/api/v1/sessions/bulk-delete' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { ids, tenantId: bodyTenantId } = JSON.parse(body || '{}');
            const idsArr = Array.isArray(ids) ? ids : [];
            const tenantId = typeof bodyTenantId === 'string' ? bodyTenantId : reqUrl.searchParams.get('tenantId') ?? undefined;
            if (idsArr.length === 0) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'ids array is required' }));
                return;
            }
            const { clearSessionsBulk } = await import('./session/store.js');
            const count = await clearSessionsBulk(idsArr, tenantId);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, deleted: count }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    if (pathname === '/api/v1/sessions' && method === 'GET') {
        const { listSessionsWithMeta } = await import('./session/store.js');
        const tenantId = reqUrl.searchParams.get('tenantId') ?? undefined;
        const channel = reqUrl.searchParams.get('channel') ?? undefined;
        const data = await listSessionsWithMeta(tenantId);
        let filtered = data;
        if (channel) {
            /** 从 sessionId 或 meta.channel 推导渠道类型，支持多实例格式 ch:inst_feishu_0:xxx */
            const inferChannel = (idOrChannel) => {
                const raw = idOrChannel.startsWith('ch:') ? idOrChannel.slice(3).split(':')[0] : idOrChannel;
                if (raw === 'feishu' || raw.startsWith('inst_feishu'))
                    return 'feishu';
                if (raw === 'lark' || raw.startsWith('inst_lark'))
                    return 'lark';
                if (raw === 'dingtalk' || raw.startsWith('inst_dingtalk'))
                    return 'dingtalk';
                if (raw === 'wecom' || raw.startsWith('inst_wecom'))
                    return 'wecom';
                if (raw === 'telegram' || raw.startsWith('inst_telegram'))
                    return 'telegram';
                if (raw === 'slack' || raw.startsWith('inst_slack'))
                    return 'slack';
                if (raw === 'discord' || raw.startsWith('inst_discord'))
                    return 'discord';
                if (raw === 'whatsapp' || raw.startsWith('inst_whatsapp'))
                    return 'whatsapp';
                if (idOrChannel.startsWith('chat-'))
                    return 'chat';
                if (idOrChannel.startsWith('default-'))
                    return 'api';
                return 'other';
            };
            /** inferChannel 已返回标准渠道键，channel 来自下拉框也是标准键，直接比较 */
            filtered = data.filter((s) => inferChannel(s.meta?.channel ?? s.id) === channel);
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ sessions: filtered.map((s) => s.id), sessionsWithMeta: filtered }));
        return;
    }
    if (pathname?.startsWith('/api/v1/sessions/') && pathname !== '/api/v1/sessions') {
        const rawId = pathname.slice('/api/v1/sessions/'.length);
        let id = '';
        if (rawId) {
            try {
                id = decodeURIComponent(rawId).replace(/\/$/, '');
            }
            catch {
                id = rawId.replace(/\/$/, '');
            }
        }
        const t = reqUrl.searchParams.get('tenantId');
        const tenantId = (t === null || t === '') ? undefined : t;
        if (id === 'bulk-delete') {
            // bulk-delete 仅支持 POST，不当作 session id
        }
        else if (id && method === 'DELETE') {
            const { clearSession } = await import('./session/store.js');
            await clearSession(id, tenantId);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (id && method === 'GET') {
            const { getSessionHistory, getSessionMeta } = await import('./session/store.js');
            const history = await getSessionHistory(id, tenantId);
            const meta = getSessionMeta(id, tenantId);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ sessionId: id, history, meta: meta ?? undefined }));
            return;
        }
    }
    if (pathname === '/api/v1/memory/counts' && method === 'GET') {
        const scopesParam = reqUrl.searchParams.get('scopes');
        const scopes = scopesParam ? scopesParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
        const { getMemoryCountsForScopes } = await import('./skills/executor.js');
        const counts = await getMemoryCountsForScopes(scopes);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ counts }));
        return;
    }
    if (pathname === '/api/v1/openapi.json' && method === 'GET') {
        const { getOpenAPISpec } = await import('./openapi.js');
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(getOpenAPISpec(), null, 2));
        return;
    }
    if (pathname === '/api/v1/usage' && method === 'GET') {
        const { getUsage, getUsageByModel } = await import('./usage/store.js');
        const days = Math.min(30, Math.max(1, Number(reqUrl.searchParams.get('days')) || 7));
        const usage = getUsage(days);
        const byModel = getUsageByModel(days);
        // total 为所选周期内的汇总，与 daily/byModel 一致
        const total = {
            promptTokens: usage.reduce((s, d) => s + d.promptTokens, 0),
            completionTokens: usage.reduce((s, d) => s + d.completionTokens, 0),
            totalTokens: usage.reduce((s, d) => s + d.totalTokens, 0),
            requests: usage.reduce((s, d) => s + d.requests, 0),
            estimatedCostUsd: byModel.reduce((s, m) => s + (m.estimatedCostUsd ?? 0), 0) || undefined,
        };
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ daily: usage, total, byModel }));
        return;
    }
    if (pathname === '/api/v1/compliance/user-data' && method === 'DELETE') {
        const tenantId = reqUrl.searchParams.get('tenantId');
        if (!tenantId || typeof tenantId !== 'string') {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'tenantId is required' }));
            return;
        }
        const { deleteAllSessionsForTenant } = await import('./session/store.js');
        const count = await deleteAllSessionsForTenant(tenantId);
        addAudit({ type: 'compliance', action: 'user_data_delete', detail: { tenantId, sessionsDeleted: count } });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, sessionsDeleted: count }));
        return;
    }
    if (pathname === '/api/v1/sandbox/summary' && method === 'GET') {
        const [{ listAgents }, { listOnlineNodes }, { getNodeTags }, { getConfigSync }, { listMultiAgentRuns }, { getExecHistory }, { listAudit },] = await Promise.all([
            import('./agent/store.js'),
            import('./node/store.js'),
            import('./node/tags-store.js'),
            import('./config/loader.js'),
            import('./channels/multi-agent-run-store.js'),
            import('./node/exec-history.js'),
            import('./audit/store.js'),
        ]);
        const [agents, nodesRaw, cfg, runs, execEntries, auditEntries] = await Promise.all([
            listAgents(),
            listOnlineNodes(),
            Promise.resolve(getConfigSync()),
            listMultiAgentRuns(50),
            getExecHistory({ limit: 20 }),
            Promise.resolve(listAudit(30)),
        ]);
        const { getChannelsForAgent, getLLMModel, getChannelInstances } = await import('./config/loader.js');
        const { getUsageByModel } = await import('./usage/store.js');
        const usageByModel = getUsageByModel(7);
        // 沙盘中心 Agent：优先用全局 defaultAgentId，否则用第一个渠道实例的 defaultAgentId
        const effectiveDefaultAgentId = cfg.defaultAgentId?.trim() ||
            getChannelInstances().find((i) => i.defaultAgentId?.trim())?.defaultAgentId?.trim() ||
            undefined;
        const agentsOut = agents.map((a) => {
            const connectedChannels = getChannelsForAgent(a.id);
            const effectiveModel = (a.model?.trim() || getLLMModel()) || 'default';
            const usage = usageByModel.find((u) => u.model === effectiveModel);
            return {
                ...a,
                connectedChannels,
                boundModel: a.model?.trim() || getLLMModel() || undefined,
                tokenUsage: usage ? { totalTokens: usage.totalTokens, model: usage.model } : undefined,
            };
        });
        const nodes = await Promise.all(nodesRaw.map(async (c) => {
            const connTags = c.tags ?? [];
            const stored = await getNodeTags(c.nodeId);
            const tags = [...new Set([...connTags, ...stored])];
            return {
                nodeId: c.nodeId,
                deviceId: c.deviceId,
                displayName: c.displayName,
                platform: c.platform,
                capabilities: c.capabilities,
                envTools: c.envTools ?? [],
                tags,
                connectedAt: c.connectedAt,
                lastPongAt: c.lastPongAt,
                status: 'online',
            };
        }));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({
            agents: agentsOut,
            nodes,
            defaultAgentId: effectiveDefaultAgentId,
            runs,
            execHistory: execEntries,
            audit: auditEntries,
        }));
        return;
    }
    if (pathname === '/api/v1/multi-agent-runs' && method === 'GET') {
        const { listMultiAgentRuns } = await import('./channels/multi-agent-run-store.js');
        const limit = Math.min(200, Number(reqUrl.searchParams.get('limit')) || 50);
        const runs = await listMultiAgentRuns(limit);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(runs));
        return;
    }
    if (pathname === '/api/v1/audit' && method === 'GET') {
        const { listAudit, exportDebaoFormat } = await import('./audit/store.js');
        const limit = Math.min(500, Number(reqUrl.searchParams.get('limit')) || 50);
        const type = reqUrl.searchParams.get('type') ?? undefined;
        const format = reqUrl.searchParams.get('format') ?? 'json';
        if (format === 'debao' || format === 'export') {
            const rows = exportDebaoFormat(limit, type);
            const fmt = reqUrl.searchParams.get('as') ?? 'json';
            if (fmt === 'csv') {
                const header = Object.keys(rows[0] ?? {}).join(',');
                const lines = rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename=audit-debao.csv');
                res.writeHead(200);
                res.end('\uFEFF' + [header, ...lines].join('\n'));
            }
            else {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename=audit-debao.json');
                res.writeHead(200);
                res.end(JSON.stringify(rows, null, 2));
            }
            return;
        }
        const list = listAudit(limit, type);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ entries: list }));
        return;
    }
    if (pathname === '/api/v1/agents' && method === 'GET') {
        const { listAgents } = await import('./agent/store.js');
        const { getChannelsForAgent } = await import('./config/loader.js');
        const { getLLMModel } = await import('./config/loader.js');
        const { getUsageByModel } = await import('./usage/store.js');
        const list = await listAgents();
        const usageByModel = getUsageByModel(7);
        const enriched = list.map((a) => {
            const connectedChannels = getChannelsForAgent(a.id);
            const effectiveModel = (a.model?.trim() || getLLMModel()) || 'default';
            const usage = usageByModel.find((u) => u.model === effectiveModel);
            return {
                ...a,
                connectedChannels,
                tokenUsage: usage ? { totalTokens: usage.totalTokens, model: usage.model } : undefined,
                boundModel: a.model?.trim() || getLLMModel() || undefined,
            };
        });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ agents: enriched }));
        return;
    }
    if (pathname === '/api/v1/agents' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { name, handle, description, category, model, systemPrompt, workerIds, mcpServerIds, skillIds, nodeToolsEnabled, avatar3d } = JSON.parse(body);
            if (!name || typeof name !== 'string') {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'name is required' }));
                return;
            }
            const { createAgent } = await import('./agent/store.js');
            const agent = await createAgent({ name, handle, description, category, model, systemPrompt, workerIds, mcpServerIds, skillIds, nodeToolsEnabled, avatar3d });
            addAudit({ type: 'agent', action: 'create', detail: { id: agent.id, name: agent.name } });
            (await import('./ws.js')).broadcast({ type: 'agent', payload: { action: 'create', id: agent.id } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(201);
            res.end(JSON.stringify(agent));
        }
        catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    if (pathname === '/api/v1/agents/select' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { task } = JSON.parse(body || '{}');
            const taskText = typeof task === 'string' ? task.trim() : '';
            if (!taskText) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'task is required' }));
                return;
            }
            const { selectAgentsForTask, isSimpleGreeting } = await import('./channels/agent-selector.js');
            const { getAgent } = await import('./agent/store.js');
            if (isSimpleGreeting(taskText)) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ agentIds: [], reason: '简单问候，建议使用默认 Agent。' }));
                return;
            }
            const sel = await selectAgentsForTask(taskText);
            const agentNames = sel.agentIds.length > 0
                ? (await Promise.all(sel.agentIds.map((id) => getAgent(id))))
                    .filter((a) => a != null)
                    .map((a) => a.name)
                : [];
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ agentIds: sel.agentIds, agentNames, reason: sel.reason }));
        }
        catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Agent select failed' }));
        }
        return;
    }
    if (pathname?.startsWith('/api/v1/agents/') && pathname !== '/api/v1/agents') {
        const id = pathname.slice('/api/v1/agents/'.length);
        if (!id) {
            res.writeHead(404);
            res.end();
            return;
        }
        const { getAgent, updateAgent, deleteAgent } = await import('./agent/store.js');
        const existing = await getAgent(id);
        if (!existing) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Agent not found' }));
            return;
        }
        if (method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(existing));
            return;
        }
        if (method === 'PATCH') {
            let body = '';
            for await (const chunk of req)
                body += chunk;
            try {
                const patch = JSON.parse(body || '{}');
                const updated = await updateAgent(id, {
                    name: patch.name,
                    handle: patch.handle,
                    description: patch.description,
                    category: patch.category,
                    model: patch.model,
                    systemPrompt: patch.systemPrompt,
                    workerIds: patch.workerIds,
                    memoryVisibility: (patch.memoryVisibility === 'agent-only' || patch.memoryVisibility === 'shared')
                        ? patch.memoryVisibility
                        : undefined,
                    preferredNodeId: typeof patch.preferredNodeId === 'string' ? patch.preferredNodeId : undefined,
                    mcpServerIds: Array.isArray(patch.mcpServerIds) ? patch.mcpServerIds : undefined,
                    skillIds: patch.skillIds !== undefined ? (patch.skillIds === null ? null : Array.isArray(patch.skillIds) ? patch.skillIds : undefined) : undefined,
                    nodeToolsEnabled: typeof patch.nodeToolsEnabled === 'boolean' ? patch.nodeToolsEnabled : undefined,
                    avatar3d: patch.avatar3d && typeof patch.avatar3d === 'object'
                        ? {
                            modelId: patch.avatar3d.modelId,
                            color: patch.avatar3d.color,
                            size: patch.avatar3d.size,
                            position: Array.isArray(patch.avatar3d.position)
                                ? patch.avatar3d.position
                                : undefined,
                        }
                        : undefined,
                });
                res.setHeader('Content-Type', 'application/json');
                addAudit({ type: 'agent', action: 'update', detail: { id, name: updated?.name } });
                res.writeHead(200);
                res.end(JSON.stringify(updated));
            }
            catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
            }
            return;
        }
        if (method === 'DELETE') {
            addAudit({ type: 'agent', action: 'delete', detail: { id, name: existing.name } });
            await deleteAgent(id);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
            return;
        }
    }
    if (pathname === '/api/v1/skills/import' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { path: sourcePath, url: sourceUrl, subpath, token } = JSON.parse(body);
            const { copySkillFromPath, importSkillFromUrl } = await import('./skills/import.js');
            const result = sourceUrl
                ? await importSkillFromUrl(sourceUrl, { subpath, token })
                : sourcePath && typeof sourcePath === 'string'
                    ? await copySkillFromPath(sourcePath)
                    : (() => { throw new Error('path or url is required'); })();
            const { invalidateSkillsCache } = await import('./skills/registry.js');
            invalidateSkillsCache();
            addAudit({ type: 'skill', action: 'import', detail: { path: sourcePath ?? sourceUrl, name: result.name } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(201);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Import failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/skills/repo-scan' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { url: repoUrl, branch, token } = JSON.parse(body);
            const u = (repoUrl ?? '').trim();
            if (!u) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'url is required' }));
                return;
            }
            const { scanRepoForSkills } = await import('./skills/import.js');
            const skills = await scanRepoForSkills(u, { branch, token });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ skills }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Repo scan failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/skills/reload' && method === 'POST') {
        const { invalidateSkillsCache } = await import('./skills/registry.js');
        invalidateSkillsCache();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    if (pathname === '/api/v1/skills/templates' && method === 'GET') {
        const { getSkillTemplates } = await import('./skills/templates.js');
        const templates = await getSkillTemplates();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ templates }));
        return;
    }
    if (pathname === '/api/v1/skills/template-zip' && method === 'GET') {
        const { buildSkillTemplateZip } = await import('./skills/template-zip.js');
        const zip = buildSkillTemplateZip();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="apex-skill-template.zip"');
        res.writeHead(200);
        res.end(zip);
        return;
    }
    if (pathname === '/api/v1/skills/install-history' && method === 'GET') {
        const { listAudit } = await import('./audit/store.js');
        const limit = Math.min(50, Math.max(1, Number(reqUrl.searchParams.get('limit')) || 10));
        const all = listAudit(limit * 3, 'skill');
        const history = all
            .filter((e) => e.action === 'install' || e.action === 'upload' || e.action === 'import')
            .slice(0, limit)
            .map((e) => ({
            ts: e.ts,
            action: e.action,
            skillName: e.detail?.skillName ?? e.detail?.name,
            templateId: e.detail?.templateId,
            source: e.detail?.source,
        }))
            .filter((h) => h.skillName);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ history }));
        return;
    }
    if (pathname === '/api/v1/skills/install' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { templateId, force } = JSON.parse(body);
            if (!templateId || typeof templateId !== 'string') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'templateId is required' }));
                return;
            }
            const { installSkillFromTemplate } = await import('./skills/templates.js');
            const result = await installSkillFromTemplate(templateId, force);
            if (!result.ok) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: result.error ?? 'Install failed' }));
                return;
            }
            addAudit({ type: 'skill', action: 'install', detail: { templateId, skillName: result.skillName, requiresConfig: result.requiresConfig } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    if (pathname === '/api/v1/skills/upload' && method === 'POST') {
        const ct = req.headers['content-type'] ?? '';
        if (!ct.includes('multipart/form-data')) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Content-Type must be multipart/form-data' }));
            return;
        }
        try {
            const { default: createBusboy } = await import('busboy');
            const bb = createBusboy({ headers: { 'content-type': ct }, limits: { fileSize: 10 * 1024 * 1024 } });
            const chunks = [];
            let filename = '';
            let fieldName = '';
            const filePromise = new Promise((resolvePromise, rejectPromise) => {
                bb.on('file', (name, file, info) => {
                    if (name !== 'file') {
                        file.resume();
                        return;
                    }
                    fieldName = name;
                    filename = info.filename || '';
                    file.on('data', (d) => chunks.push(d));
                    file.on('end', () => { });
                    file.on('error', rejectPromise);
                });
                bb.on('close', () => {
                    if (fieldName === 'file' && filename) {
                        resolvePromise({ buffer: Buffer.concat(chunks), filename });
                    }
                    else {
                        rejectPromise(new Error('No file field in request'));
                    }
                });
                bb.on('error', rejectPromise);
            });
            req.pipe(bb);
            const { buffer, filename: fn } = await filePromise;
            const ext = fn.toLowerCase().endsWith('.zip') ? 'zip' : fn.toLowerCase().endsWith('.yaml') || fn.toLowerCase().endsWith('.yml') ? 'yaml' : null;
            if (!ext) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Only .zip or .yaml/.yml files are supported' }));
                return;
            }
            const force = new URL(req.url ?? '/', 'http://localhost').searchParams.get('force') === 'true';
            const { handleZipUpload, handleYamlUpload } = await import('./skills/upload.js');
            const result = ext === 'zip' ? await handleZipUpload(buffer, force) : await handleYamlUpload(buffer, force);
            addAudit({ type: 'skill', action: 'upload', detail: { name: result.name, source: result.source } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(201);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            const err = e instanceof Error ? e : new Error(String(e));
            if (err.message.startsWith('SKILL_EXISTS:')) {
                res.writeHead(409);
                res.end(JSON.stringify({ error: 'skill_already_exists', name: err.message.slice('SKILL_EXISTS:'.length) }));
            }
            else {
                res.writeHead(400);
                res.end(JSON.stringify({ error: err.message || 'Upload failed' }));
            }
        }
        return;
    }
    const skillDeleteMatch = pathname?.match(/^\/api\/v1\/skills\/([^/]+)$/);
    if (skillDeleteMatch && method === 'DELETE') {
        const skillName = decodeURIComponent(skillDeleteMatch[1]);
        try {
            const { loadAllSkills } = await import('./skills/registry.js');
            const { uninstallSkill } = await import('./skills/import.js');
            const { invalidateSkillsCache } = await import('./skills/registry.js');
            const skills = await loadAllSkills();
            const skill = skills.find((s) => s.name === skillName);
            if (!skill || skill.source !== 'managed') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: '仅仓库/上传安装的技能可卸载' }));
                return;
            }
            await uninstallSkill(skillName);
            invalidateSkillsCache();
            addAudit({ type: 'skill', action: 'uninstall', detail: { name: skillName } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Uninstall failed' }));
        }
        return;
    }
    const diagnoseMatch = pathname?.match(/^\/api\/v1\/skills\/([^/]+)\/diagnose$/);
    if (diagnoseMatch && method === 'GET') {
        const skillName = decodeURIComponent(diagnoseMatch[1]);
        try {
            const { diagnoseSkill } = await import('./skills/verify-diagnose.js');
            const result = await diagnoseSkill(skillName);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Diagnose failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/skills/verify' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { skillName } = JSON.parse(body);
            if (!skillName || typeof skillName !== 'string') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'skillName is required' }));
                return;
            }
            const { verifySkill } = await import('./skills/verify-diagnose.js');
            const result = await verifySkill(skillName);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Verify failed' }));
        }
        return;
    }
    const repairMatch = pathname?.match(/^\/api\/v1\/skills\/([^/]+)\/repair$/);
    if (repairMatch && method === 'POST') {
        const skillName = decodeURIComponent(repairMatch[1]);
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const input = JSON.parse(body);
            if (!input.errorMessage || typeof input.errorMessage !== 'string') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'errorMessage is required' }));
                return;
            }
            const { suggestRepair } = await import('./skills/repair.js');
            const result = await suggestRepair(skillName, {
                errorType: input.errorType,
                errorMessage: input.errorMessage,
                filePath: input.filePath,
            });
            if (result.error) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: result.error }));
                return;
            }
            addAudit({ type: 'skill', action: 'repair-suggest', detail: { skillName, filePath: input.filePath } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    const filesPatchMatch = pathname?.match(/^\/api\/v1\/skills\/([^/]+)\/files\/(.+)$/);
    if (filesPatchMatch && method === 'PATCH') {
        const skillName = decodeURIComponent(filesPatchMatch[1]);
        const filePath = decodeURIComponent(filesPatchMatch[2]);
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { applyRepair } = await import('./skills/repair.js');
            const result = await applyRepair(skillName, filePath, body);
            if (!result.ok) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: result.error ?? 'Apply failed' }));
                return;
            }
            addAudit({ type: 'skill', action: 'repair-apply', detail: { skillName, filePath } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Apply failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/skills' && method === 'GET') {
        const { loadAllSkills } = await import('./skills/registry.js');
        const skills = await loadAllSkills();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({
            skills: skills.map((s) => ({
                name: s.name,
                version: s.manifest.version,
                description: s.manifest.description,
                tools: s.manifest.tools?.map((t) => t.id) ?? [],
                legacy: s.manifest.compatibility?.openClaw === true,
                category: s.manifest.category,
                envFields: s.manifest.envFields,
                defaultParams: s.manifest.defaultParams,
                source: s.source,
                registryMeta: s.registryMeta,
            })),
        }));
        return;
    }
    if (pathname === '/api/v1/procedural-skills' && method === 'GET') {
        try {
            const { listAllProceduralSkills, archiveStaleSkills } = await import('./skills/skill-store.js');
            await archiveStaleSkills();
            const skills = await listAllProceduralSkills();
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ skills }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to list procedural skills' }));
        }
        return;
    }
    const procSkillDeleteMatch = pathname?.match(/^\/api\/v1\/procedural-skills\/([^/]+)$/);
    if (procSkillDeleteMatch && method === 'DELETE') {
        const id = decodeURIComponent(procSkillDeleteMatch[1]);
        try {
            const { deleteProceduralSkill } = await import('./skills/skill-store.js');
            const ok = await deleteProceduralSkill(id);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(ok ? 200 : 404);
            res.end(JSON.stringify(ok ? { ok: true } : { error: 'Skill not found' }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Delete failed' }));
        }
        return;
    }
    const procSkillPatchMatch = pathname?.match(/^\/api\/v1\/procedural-skills\/([^/]+)$/);
    if (procSkillPatchMatch && method === 'PATCH') {
        const id = decodeURIComponent(procSkillPatchMatch[1]);
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const patch = JSON.parse(body || '{}');
            const VALID_TRUST_LEVELS = ['unverified', 'testing', 'trusted', 'suspended', 'archived'];
            const patchData = {};
            if (patch.trustLevel != null) {
                if (!VALID_TRUST_LEVELS.includes(String(patch.trustLevel))) {
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: `Invalid trustLevel. Valid values: ${VALID_TRUST_LEVELS.join(', ')}` }));
                    return;
                }
                patchData.trustLevel = String(patch.trustLevel);
            }
            if (Array.isArray(patch.tags))
                patchData.tags = patch.tags.filter((t) => typeof t === 'string');
            if (typeof patch.name === 'string')
                patchData.name = patch.name;
            if (typeof patch.description === 'string')
                patchData.description = patch.description;
            const { updateProceduralSkill } = await import('./skills/skill-store.js');
            const skill = await updateProceduralSkill(id, patchData);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(skill ? 200 : 404);
            res.end(JSON.stringify(skill ? { ok: true, skill } : { error: 'Skill not found' }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Update failed' }));
        }
        return;
    }
    const procSkillResetMatch = pathname?.match(/^\/api\/v1\/procedural-skills\/([^/]+)\/reset$/);
    if (procSkillResetMatch && method === 'POST') {
        const id = decodeURIComponent(procSkillResetMatch[1]);
        try {
            const { resetProceduralSkill } = await import('./skills/skill-store.js');
            const skill = await resetProceduralSkill(id);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(skill ? 200 : 404);
            res.end(JSON.stringify(skill ? { ok: true, skill } : { error: 'Skill not found' }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(500);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Reset failed' }));
        }
        return;
    }
    if (pathname === '/api/v1/chat' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { message, sessionId, history: explicitHistory, agentId, tenantId, memoryScopeHint, userId } = JSON.parse(body);
            const { appendToSession } = await import('./session/store.js');
            const sid = sessionId ?? `default-${Date.now()}`;
            const { getDeleteConfirmRequired } = await import('./config/loader.js');
            if (getDeleteConfirmRequired()) {
                const { getAndClearPendingDelete, executePendingDelete, executePendingShellDelete, isConfirmIntent, isCancelIntent, } = await import('./delete-confirm/store.js');
                const pending = getAndClearPendingDelete(sid);
                if (pending && (isConfirmIntent(message) || isCancelIntent(message))) {
                    let reply;
                    if (isCancelIntent(message)) {
                        reply = "已取消删除";
                    }
                    else if (pending.type === "shell") {
                        const result = await executePendingShellDelete({
                            command: pending.command,
                            cwd: pending.cwd,
                            env: pending.env,
                        });
                        reply = result.ok ? "已执行删除" : `删除失败：${result.error}`;
                    }
                    else {
                        const result = await executePendingDelete(pending.path, pending.workspaceDir);
                        reply = result.ok ? `已删除 ${pending.path}` : `删除失败：${result.error}`;
                    }
                    await appendToSession(sid, "user", message, tenantId);
                    await appendToSession(sid, "assistant", reply, tenantId);
                    res.setHeader("Content-Type", "application/json");
                    res.writeHead(200);
                    res.end(JSON.stringify({ reply }));
                    return;
                }
            }
            const { filterAndAudit } = await import('./compliance/sensitive-filter.js');
            filterAndAudit(message, { type: 'user', sessionId: sid, tenantId });
            let lastReply = '';
            await processChannelEvent('chat', { content: message, explicitHistory }, {
                chatId: sid,
                preferredAgentId: agentId?.trim() || undefined,
                userId: userId?.trim() || undefined,
                tenantId,
                replyCapturer: (r) => { lastReply = r; },
            });
            filterAndAudit(lastReply, { type: 'assistant', sessionId: sid, tenantId });
            addAudit({ type: 'chat', action: 'message', detail: { sessionId: sid, agentId: agentId ?? null } });
            const { broadcast } = await import('./ws.js');
            broadcast({ type: 'chat', payload: { sessionId: sid } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ reply: lastReply, sessionId: sid }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : String(e),
            }));
        }
        return;
    }
    if (pathname === '/api/v1/knowledge' && method === 'GET') {
        logMem('knowledge-GET:start');
        const store = getKnowledgeStore();
        const list = 'list' in store && typeof store.list === 'function' ? await store.list() : [];
        logMem('knowledge-GET:after-list', { count: list.length });
        const persist = process.env.APEXPANDA_KNOWLEDGE_PERSIST !== 'false';
        const embeddingEnabled = process.env.APEXPANDA_EMBEDDING_ENABLED === 'true';
        const { getChunkConfig } = await import('./knowledge/document-ingest.js');
        const chunkConfig = getChunkConfig();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        const chunksForClient = list.map((c) => {
            const { embedding, ...rest } = c;
            return rest;
        });
        res.end(JSON.stringify({ count: list.length, chunks: chunksForClient, persist, embeddingEnabled, chunkConfig }));
        return;
    }
    if (pathname === '/api/v1/knowledge' && method === 'DELETE') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        const store = getKnowledgeStore();
        try {
            if (body.trim()) {
                const parsed = JSON.parse(body);
                if (Array.isArray(parsed.ids) && parsed.ids.length > 0) {
                    if ('delete' in store && typeof store.delete === 'function') {
                        await store.delete(parsed.ids);
                    }
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, deleted: parsed.ids.length }));
                    return;
                }
            }
            if ('clear' in store && typeof store.clear === 'function')
                await store.clear();
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: String(e) }));
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    if (pathname === '/api/v1/knowledge' && method === 'POST') {
        logMem('knowledge-POST:start');
        const prevLock = knowledgeImportLock;
        let resolveLock;
        knowledgeImportLock = new Promise((r) => { resolveLock = r; });
        await prevLock;
        try {
            // 防 OOM：base64 编码会使体积×1.33，50MB 文件→JSON 约 67MB；上限设 100MB
            const KNOWLEDGE_BODY_LIMIT = 100 * 1024 * 1024;
            const rawChunks = [];
            let rawSize = 0;
            let bodyTooLarge = false;
            for await (const chunk of req) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                rawSize += buf.length;
                if (rawSize > KNOWLEDGE_BODY_LIMIT) {
                    bodyTooLarge = true;
                    req.resume(); // 排空剩余数据，关闭连接
                    break;
                }
                rawChunks.push(buf);
            }
            if (bodyTooLarge) {
                resolveLock();
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(413);
                res.end(JSON.stringify({ ok: false, error: '上传内容超过 100MB 限制（含 base64 编码膨胀），请拆分上传' }));
                return;
            }
            try {
                const body = Buffer.concat(rawChunks).toString('utf-8');
                logMem('knowledge-POST:body-received', { bodyKB: Math.round(body.length / 1024) });
                let parsed;
                try {
                    parsed = JSON.parse(body);
                }
                catch (parseErr) {
                    if (parseErr instanceof RangeError) {
                        throw new Error('解析失败：请求数据过大或格式异常，请减小上传文件或拆分');
                    }
                    throw parseErr;
                }
                const chunkOpts = parsed.chunkSize != null || parsed.chunkOverlap != null
                    ? { size: parsed.chunkSize, overlap: parsed.chunkOverlap }
                    : undefined;
                const store = getKnowledgeStore();
                let allChunks = [];
                const sourcesToReplace = new Set();
                if (parsed.url && typeof parsed.url === 'string') {
                    const { ingestFromUrl } = await import('./knowledge/document-ingest.js');
                    const ingested = await ingestFromUrl(parsed.url.trim(), chunkOpts);
                    allChunks = ingested.map((c) => ({ id: c.id, content: c.content, metadata: c.metadata }));
                    const src = ingested[0]?.metadata?.source;
                    if (src)
                        sourcesToReplace.add(src);
                }
                else if (Array.isArray(parsed.files) && parsed.files.length > 0) {
                    const { ingestDocument } = await import('./knowledge/document-ingest.js');
                    for (const f of parsed.files) {
                        const buf = Buffer.from(f.file, 'base64');
                        const ingested = await ingestDocument(buf, f.filename, chunkOpts);
                        allChunks.push(...ingested.map((c) => ({ id: c.id, content: c.content, metadata: c.metadata })));
                        const src = ingested[0]?.metadata?.source;
                        if (src)
                            sourcesToReplace.add(src);
                    }
                }
                else if (parsed.file && parsed.filename) {
                    const buf = Buffer.from(parsed.file, 'base64');
                    logMem('knowledge-POST:before-ingest', { bufKB: Math.round(buf.length / 1024), filename: parsed.filename });
                    const { ingestDocument } = await import('./knowledge/document-ingest.js');
                    const ingested = await ingestDocument(buf, parsed.filename, chunkOpts);
                    logMem('knowledge-POST:after-ingest', { ingested: ingested.length });
                    allChunks = ingested.map((c) => ({ id: c.id, content: c.content, metadata: c.metadata }));
                    const src = ingested[0]?.metadata?.source;
                    if (src)
                        sourcesToReplace.add(src);
                }
                else if (Array.isArray(parsed.chunks)) {
                    allChunks = parsed.chunks.map((c) => ({
                        id: c.id,
                        content: c.content,
                        metadata: c.metadata,
                    }));
                }
                else {
                    throw new Error('Provide chunks, file+filename, files array, or url');
                }
                if (sourcesToReplace.size > 0) {
                    const list = 'list' in store && typeof store.list === 'function' ? await store.list() : [];
                    const toDel = list
                        .filter((c) => c.metadata?.source && sourcesToReplace.has(String(c.metadata.source)))
                        .map((c) => c.id);
                    if (toDel.length > 0) {
                        if ('delete' in store && typeof store.delete === 'function')
                            await store.delete(toDel);
                    }
                }
                if (allChunks.length > 10000) {
                    throw new Error(`本次导入 ${allChunks.length} 条超过上限 10000，请拆分文件或增大分块大小（APEXPANDA_CHUNK_SIZE）`);
                }
                // 按 content 去重，防止分块逻辑或重复导入产生重复条目
                const seen = new Set();
                const deduped = allChunks.filter((c) => {
                    const key = (c.content ?? '').trim();
                    if (!key || seen.has(key))
                        return false;
                    seen.add(key);
                    return true;
                });
                if (deduped.length < allChunks.length) {
                    logMem('knowledge-POST:deduped', { before: allChunks.length, after: deduped.length });
                }
                logMem('knowledge-POST:before-upsert', { chunks: deduped.length });
                await store.upsert(deduped);
                logMem('knowledge-POST:after-upsert');
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, count: deduped.length }));
            }
            catch (e) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                const errMsg = e instanceof RangeError
                    ? '解析失败：请求数据过大或格式异常，请减小上传文件 size 或拆分'
                    : e instanceof Error
                        ? e.message
                        : String(e);
                res.end(JSON.stringify({ ok: false, error: errMsg }));
            }
            finally {
                resolveLock();
            }
            return;
        }
        finally {
            resolveLock();
        }
    }
    if (pathname === '/api/v1/knowledge/search' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { query, topK = 5 } = JSON.parse(body);
            const store = getKnowledgeStore();
            const { retrieve } = await import('./knowledge/rag.js');
            const { createRerank } = await import('./knowledge/rerank.js');
            const { getKnowledgeRerankConfig } = await import('./config/loader.js');
            const rerankCfg = getKnowledgeRerankConfig();
            const rerankFn = rerankCfg ? createRerank(rerankCfg) : null;
            const chunks = await retrieve({ vectorStore: store, topK, rerank: rerankFn ?? undefined }, query);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ chunks }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
        return;
    }
    if (pathname === '/api/v1/skills/invoke' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { skillName, toolId, params = {} } = JSON.parse(body);
            const { invokeTool } = await import('./skills/registry.js');
            const result = await invokeTool(skillName, toolId, params, { deleteSource: 'user' });
            addAudit({ type: 'skill', action: 'invoke', detail: { skillName, toolId } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, result }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : 'Unknown error',
            }));
        }
        return;
    }
    // Workflow templates
    if (pathname === '/api/v1/workflow-templates' && method === 'GET') {
        const { listWorkflowTemplatesMerged } = await import('./workflow/templates.js');
        const templates = await listWorkflowTemplatesMerged();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ templates }));
        return;
    }
    if (pathname === '/api/v1/workflow-templates' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { name, description, nodes, edges, suggestedCommand, suggestedCron } = JSON.parse(body || '{}');
            if (!name?.trim() || !Array.isArray(nodes) || nodes.length === 0) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'name and nodes required' }));
                return;
            }
            const validatedNodes = nodes.map((n) => ({
                ...n,
                type: (n.type === 'agent' || n.type === 'skill' || n.type === 'human' ? n.type : 'agent'),
            }));
            const { saveAsTemplate } = await import('./workflow/custom-templates.js');
            const result = await saveAsTemplate({
                name: name.trim(),
                description: description?.trim() ?? '',
                nodes: validatedNodes,
                edges: edges ?? [],
                suggestedCommand,
                suggestedCron,
            });
            if (!result.success) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: result.error ?? 'Save failed' }));
                return;
            }
            addAudit({ type: 'workflow', action: 'create', detail: { template: result.template?.name } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(201);
            res.end(JSON.stringify({ template: result.template }));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    const workflowTemplateIdMatch = pathname?.match(/^\/api\/v1\/workflow-templates\/([^/]+)$/);
    const workflowTemplateId = workflowTemplateIdMatch?.[1];
    if (workflowTemplateId) {
        if (method === 'DELETE') {
            const { deleteCustomTemplate } = await import('./workflow/custom-templates.js');
            const result = await deleteCustomTemplate(workflowTemplateId);
            if (!result.success) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(result.error === '模板不存在' ? 404 : 400);
                res.end(JSON.stringify({ error: result.error }));
                return;
            }
            addAudit({ type: 'workflow', action: 'delete', detail: { templateId: workflowTemplateId } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(204);
            res.end();
            return;
        }
        if (method === 'PATCH') {
            let body = '';
            for await (const chunk of req)
                body += chunk;
            try {
                const patch = JSON.parse(body || '{}');
                const { updateCustomTemplate } = await import('./workflow/custom-templates.js');
                const result = await updateCustomTemplate(workflowTemplateId, patch);
                if (!result.success) {
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(result.error === '模板不存在' ? 404 : 400);
                    res.end(JSON.stringify({ error: result.error }));
                    return;
                }
                addAudit({ type: 'workflow', action: 'update', detail: { templateId: workflowTemplateId } });
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ template: result.template }));
            }
            catch (e) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
            }
            return;
        }
    }
    // Workflows
    if (pathname === '/api/v1/workflows' && method === 'GET') {
        const { listWorkflows } = await import('./workflow/store.js');
        const list = await listWorkflows();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ workflows: list }));
        return;
    }
    if (pathname === '/api/v1/workflows' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { name, description, nodes, edges, triggers } = JSON.parse(body);
            if (!name || !Array.isArray(nodes) || nodes.length === 0) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'name and nodes required' }));
                return;
            }
            const { createWorkflow } = await import('./workflow/store.js');
            const { refreshWorkflowCronScheduler } = await import('./workflow/scheduler.js');
            const validatedNodes = nodes.map((n) => ({
                ...n,
                type: (n.type === 'agent' || n.type === 'skill' || n.type === 'human' ? n.type : 'agent'),
            }));
            const w = await createWorkflow({
                name,
                description,
                nodes: validatedNodes,
                edges: edges ?? [],
                triggers: Array.isArray(triggers) ? triggers : undefined,
            });
            await refreshWorkflowCronScheduler();
            addAudit({ type: 'workflow', action: 'create', detail: { id: w.id, name } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(201);
            res.end(JSON.stringify(w));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    if (pathname === '/api/v1/workflows/from-template' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { templateId, name } = JSON.parse(body || '{}');
            const { getWorkflowTemplateMerged } = await import('./workflow/templates.js');
            const { createWorkflow } = await import('./workflow/store.js');
            const { refreshWorkflowCronScheduler } = await import('./workflow/scheduler.js');
            const tpl = await getWorkflowTemplateMerged(templateId);
            if (!tpl) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Template not found' }));
                return;
            }
            const triggers = [];
            if (tpl.suggestedCommand) {
                triggers.push({ type: 'message', command: '/workflow', enabled: true });
            }
            if (tpl.suggestedCron) {
                triggers.push({ type: 'cron', expression: tpl.suggestedCron, enabled: false });
            }
            const w = await createWorkflow({
                name: name ?? tpl.name,
                description: tpl.description,
                nodes: tpl.nodes,
                edges: tpl.edges,
                triggers: triggers.length > 0 ? triggers : undefined,
            });
            await refreshWorkflowCronScheduler();
            addAudit({ type: 'workflow', action: 'create', detail: { id: w.id, name: w.name, fromTemplate: templateId } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(201);
            res.end(JSON.stringify(w));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    if (pathname === '/api/v1/workflow-runs' && method === 'GET') {
        const workflowId = reqUrl.searchParams.get('workflowId') ?? undefined;
        const limit = Math.min(100, Math.max(1, parseInt(reqUrl.searchParams.get('limit') ?? '20', 10) || 20));
        const { listRuns } = await import('./workflow/store.js');
        const runs = await listRuns(workflowId, limit);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ runs }));
        return;
    }
    const workflowIdMatch = pathname?.match(/^\/api\/v1\/workflows\/([^/]+)(?:\/|$)/);
    const workflowId = workflowIdMatch?.[1];
    const hasSubPath = pathname && pathname.length > `/api/v1/workflows/${workflowId ?? ''}`.length;
    if (workflowId && !hasSubPath && method === 'GET') {
        const { getWorkflow } = await import('./workflow/store.js');
        const w = await getWorkflow(workflowId);
        if (!w) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Workflow not found' }));
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(w));
        return;
    }
    if (workflowId && !hasSubPath && method === 'PATCH') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const patch = body ? JSON.parse(body) : {};
            const { updateWorkflow } = await import('./workflow/store.js');
            const { refreshWorkflowCronScheduler } = await import('./workflow/scheduler.js');
            const w = await updateWorkflow(workflowId, patch);
            if (!w) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Workflow not found' }));
                return;
            }
            await refreshWorkflowCronScheduler();
            addAudit({ type: 'workflow', action: 'update', detail: { id: workflowId } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(w));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Invalid body' }));
        }
        return;
    }
    if (workflowId && !hasSubPath && method === 'DELETE') {
        const { deleteWorkflow } = await import('./workflow/store.js');
        const { refreshWorkflowCronScheduler } = await import('./workflow/scheduler.js');
        const ok = await deleteWorkflow(workflowId);
        if (!ok) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Workflow not found' }));
            return;
        }
        await refreshWorkflowCronScheduler();
        addAudit({ type: 'workflow', action: 'delete', detail: { id: workflowId } });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    const runMatch = pathname?.match(/^\/api\/v1\/workflows\/([^/]+)\/run$/);
    if (runMatch && method === 'POST') {
        const workflowId = runMatch[1];
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { getWorkflow } = await import('./workflow/store.js');
            const { runWorkflow } = await import('./workflow/engine.js');
            const def = await getWorkflow(workflowId);
            if (!def) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Workflow not found' }));
                return;
            }
            const input = (body ? JSON.parse(body) : {});
            const result = await runWorkflow(def, input);
            addAudit({ type: 'workflow', action: 'run', detail: { workflowId, runId: result.runId } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Run failed' }));
        }
        return;
    }
    const runResumeMatch = pathname?.match(/^\/api\/v1\/workflows\/([^/]+)\/runs\/([^/]+)\/resume$/);
    if (runResumeMatch && method === 'POST') {
        const [, workflowId, runId] = runResumeMatch;
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { getWorkflow } = await import('./workflow/store.js');
            const { resumeWorkflow } = await import('./workflow/engine.js');
            const def = await getWorkflow(workflowId);
            if (!def) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Workflow not found' }));
                return;
            }
            const payload = body ? JSON.parse(body) : {};
            const humanInput = payload.input ?? payload.value ?? payload;
            const result = await resumeWorkflow(def, runId, humanInput);
            addAudit({ type: 'workflow', action: 'resume', detail: { workflowId, runId } });
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }
        catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Resume failed' }));
        }
        return;
    }
    const runStatusMatch = pathname?.match(/^\/api\/v1\/workflows\/([^/]+)\/runs\/([^/]+)$/);
    if (runStatusMatch && method === 'GET') {
        const [, workflowId, runId] = runStatusMatch;
        const { getRunCheckpoint } = await import('./workflow/store.js');
        const cp = await getRunCheckpoint(runId);
        if (!cp || cp.workflowId !== workflowId) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Run not found' }));
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(cp));
        return;
    }
    // ——— 安装向导 API ———
    // 限速：install 写操作（test-llm + POST install）每 IP 每分钟最多 10 次
    if (pathname === '/api/v1/install/test-llm' || (pathname === '/api/v1/install' && method === 'POST')) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const windowMs = 60_000;
        const maxReq = 10;
        const entry = _installRateMap.get(ip);
        if (entry && now - entry.ts < windowMs) {
            entry.count++;
            if (entry.count > maxReq) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(429);
                res.end(JSON.stringify({ ok: false, error: 'Too many requests, please wait a moment.' }));
                return;
            }
        }
        else {
            _installRateMap.set(ip, { ts: now, count: 1 });
        }
    }
    if (pathname === '/api/v1/install/status' && method === 'GET') {
        const { isInstalled: chk, getInstalledMeta } = await import('./install/wizard.js');
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ installed: chk(), meta: getInstalledMeta() }));
        return;
    }
    if (pathname === '/api/v1/install/test-llm' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { baseUrl, apiKey, model } = JSON.parse(body || '{}');
            if (!baseUrl || !apiKey || !model) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'baseUrl, apiKey and model are required' }));
                return;
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);
            try {
                const r = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                if (r.ok || r.status === 400) {
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true }));
                }
                else {
                    const txt = await r.text().catch(() => '');
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: false, error: `HTTP ${r.status}${txt ? ': ' + txt.slice(0, 200) : ''}` }));
                }
            }
            catch (e) {
                clearTimeout(timeout);
                const msg = e instanceof Error ? e.message : String(e);
                const code = e instanceof Error ? e.code : '';
                const isNetworkError = /aborted|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket hang up|network/i.test(msg) ||
                    code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ABORT_ERR';
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: false, error: isNetworkError ? 'NETWORK_ERROR' : msg }));
            }
        }
        catch {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
        }
        return;
    }
    if (pathname === '/api/v1/install' && method === 'POST') {
        const { isInstalled: chk, generateAndWriteApiKey, createInstalledLock, resetInstall } = await import('./install/wizard.js');
        if (chk()) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(403);
            res.end(JSON.stringify({ ok: false, error: 'Already installed' }));
            return;
        }
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const payload = JSON.parse(body || '{}');
            const { baseUrl, apiKey: llmKey, model } = payload.llm ?? {};
            if (!baseUrl || !llmKey || !model) {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'llm.baseUrl, llm.apiKey and llm.model are required' }));
                return;
            }
            try {
                const { loadConfig, saveConfig, invalidateConfigCache, getConfigPath, CHANNEL_TYPE_TEMPLATES } = await import('./config/loader.js');
                const { writeFile, mkdir } = await import('node:fs/promises');
                const { dirname: dn } = await import('node:path');
                // 先清空旧 config 的 LLM 字段，防止旧 endpoints 的 apiKey 覆盖安装时填入的新 key
                const current = await loadConfig();
                const cleanedConfig = {
                    ...current,
                    llm: {
                        baseUrl,
                        apiKey: llmKey,
                        model,
                        // 保留 modelPresets，但清除 endpoints 中同 model 的旧 apiKey，避免合并时被覆盖
                        modelPresets: current.llm?.modelPresets,
                        endpoints: current.llm?.endpoints
                            ? Object.fromEntries(Object.entries(current.llm.endpoints).map(([k, v]) => [
                                k,
                                k === model ? { ...v, apiKey: llmKey } : v,
                            ]))
                            : undefined,
                    },
                };
                const cfgPath = getConfigPath();
                await mkdir(dn(cfgPath), { recursive: true });
                await writeFile(cfgPath, JSON.stringify(cleanedConfig, null, 2), 'utf-8');
                invalidateConfigCache();
                // 方案 B：安装时写入 channels.instances，与渠道页面配置方式一致
                const allowedInstallTypes = ['feishu', 'dingtalk', 'wecom', 'telegram', 'slack'];
                const instances = [];
                for (const [type, fields] of Object.entries(payload.channels ?? {})) {
                    if (!fields || typeof fields !== 'object' || !Object.values(fields).some((v) => String(v ?? '').trim()))
                        continue;
                    if (!allowedInstallTypes.includes(type))
                        continue;
                    const name = CHANNEL_TYPE_TEMPLATES[type]?.name ?? type;
                    instances.push({
                        id: `inst_${type}_0`,
                        type,
                        name,
                        ...fields,
                    });
                }
                if (instances.length) {
                    await saveConfig({ channels: { instances } });
                }
                const generatedKey = generateAndWriteApiKey();
                const { version } = await import('../package.json', { assert: { type: 'json' } }).catch(() => ({ version: '1.0.0' }));
                createInstalledLock(String(version));
                console.log('[ApexPanda] Installation complete. API Key generated.');
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, apiKey: generatedKey }));
            }
            catch (e) {
                resetInstall();
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Install failed' }));
            }
        }
        catch {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
        }
        return;
    }
    if (pathname === '/api/v1/install/reset' && method === 'POST') {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const { confirm } = JSON.parse(body || '{}');
            if (confirm !== '确认重置') {
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'confirm 字段必须为「确认重置」' }));
                return;
            }
            const { resetInstall: doReset } = await import('./install/wizard.js');
            doReset();
            console.log('[ApexPanda] Installation reset.');
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        }
        catch {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
        }
        return;
    }
    res.writeHead(404);
    res.end();
}
//# sourceMappingURL=server.js.map