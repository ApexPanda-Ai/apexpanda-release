/**
 * 创新模式：讨论执行（轮次循环、Agent 发言、总结生成）
 */
import { runAgent } from '../agent/runner.js';
import { getAgent } from '../agent/store.js';
import { getKnowledgeStore } from '../knowledge/store-getter.js';
import { getLLMProvider } from '../agent/config.js';
import { sendReplyToChannel } from '../workflow/channel-reply.js';
import { getSessionKey, setDiscussionState, appendDiscussionEntry, incrementRound, getEndRequested, getDiscussionState, clearDiscussion, } from './store.js';
const KEEPRECENT_ROUNDS = 6;
function formatHistory(history, agentCount, truncate = true) {
    const n = Math.max(1, agentCount);
    const entries = truncate && history.length > KEEPRECENT_ROUNDS * n
        ? history.slice(-KEEPRECENT_ROUNDS * n)
        : history;
    const prefix = truncate && entries.length < history.length
        ? `[前略，保留最近 ${KEEPRECENT_ROUNDS} 轮]\n\n`
        : '';
    return prefix + entries.map((h) => `【${h.agentName}】\n${h.content}`).join('\n\n');
}
async function generateSummary(question, history, agentCount) {
    const text = formatHistory(history, agentCount, false);
    const system = `你负责对多 Agent 讨论进行总结。根据以下讨论内容，输出简洁的总结，包含：
1. 共识/结论（如有）
2. 主要观点
3. 建议

格式使用纯文本，分点列出即可。`;
    const user = `讨论问题：${question}\n\n讨论记录：\n${text}`;
    const provider = getLLMProvider();
    const result = await provider.complete([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.3, maxTokens: 1024 });
    const summary = result.content?.trim() ?? '（无法生成总结）';
    return `---
【讨论总结】
问题：${question}

${summary}

💡 可根据讨论结论使用 \`/创建工作流 [描述]\` 创建工作流
---`;
}
export async function runDiscussion(channel, ctx, parsed) {
    if (!parsed.agentIds.length) {
        await sendReplyToChannel(channel, ctx, '❌ 暂无可用的 Agent，请先在 Agent 管理中创建。');
        return;
    }
    const sessionKey = getSessionKey(channel, ctx);
    const store = getKnowledgeStore();
    const state = {
        mode: 'discussion',
        question: parsed.question,
        maxRounds: parsed.maxRounds,
        agentIds: parsed.agentIds,
        history: [],
        currentRound: 0,
        startedAt: Date.now(),
    };
    setDiscussionState(sessionKey, state);
    try {
        for (let round = 1; round <= parsed.maxRounds; round++) {
            if (getEndRequested(sessionKey))
                break;
            for (const agentId of parsed.agentIds) {
                const agent = await getAgent(agentId);
                if (!agent)
                    continue;
                const formattedHistory = formatHistory(state.history, parsed.agentIds.length, true);
                const discussionContext = formattedHistory
                    ? `\n\n讨论记录：\n${formattedHistory}\n\n请以你的角色身份发表观点，可认同、补充或反驳。`
                    : '\n\n请发表你的观点。';
                const systemAddition = `【讨论模式】当前讨论问题：${parsed.question}\n你是 ${agent.name}。${discussionContext}`;
                const basePrompt = agent.systemPrompt?.trim()
                    ? `${agent.systemPrompt}\n\n${systemAddition}`
                    : systemAddition;
                const memScopeHint = ctx.chatType === 'p2p' && ctx.userId
                    ? `user:${ctx.userId}`
                    : ctx.chatType === 'group' && ctx.chatId
                        ? `group:${ctx.chatId}`
                        : undefined;
                const result = await runAgent({
                    knowledgeStore: store,
                    topK: 3,
                    model: agent.model,
                    systemPrompt: basePrompt,
                    workerIds: agent.workerIds,
                    mcpServerIds: agent.mcpServerIds,
                    skillIds: agent.skillIds,
                    nodeToolsEnabled: agent.nodeToolsEnabled,
                    enableTools: true,
                }, {
                    message: `请就「${parsed.question}」发表观点。`,
                    agentId: agent.id,
                    agentMemoryVisibility: agent.memoryVisibility ?? 'shared',
                    userId: ctx.userId,
                    memoryScopeHint: memScopeHint,
                    deleteSource: 'channel',
                });
                if (result.usage) {
                    const { recordUsage } = await import('../usage/store.js');
                    recordUsage(result.usage.promptTokens, result.usage.completionTokens, result.model);
                }
                const entry = { agentId: agent.id, agentName: agent.name, content: result.reply };
                appendDiscussionEntry(sessionKey, entry);
                const display = `【${agent.name}】\n${result.reply}`;
                await sendReplyToChannel(channel, ctx, display);
                if (getEndRequested(sessionKey))
                    break;
            }
            incrementRound(sessionKey);
            const updated = getDiscussionState(sessionKey);
            if (updated)
                Object.assign(state, updated);
        }
        const summary = await generateSummary(parsed.question, state.history, parsed.agentIds.length);
        await sendReplyToChannel(channel, ctx, summary);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendReplyToChannel(channel, ctx, `❌ 讨论出错：${msg}`);
    }
    finally {
        clearDiscussion(sessionKey);
    }
}
//# sourceMappingURL=runner.js.map