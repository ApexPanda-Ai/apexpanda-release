import { listAgents } from '../agent/store.js';
import { getLLMProvider } from '../agent/config.js';
import { getAgentSelectorConfig } from '../config/loader.js';
/** 简单问候/无任务意图的短语（不触发 agent-selector，走默认 Agent） */
const SIMPLE_GREETING_PATTERNS = [
    /^(你好|您好|hi|hello|hey|嗨|哈喽)[\s!?。！？]*$/i,
    /^(在吗|在不在|有人吗)[\s!?。！？]*$/i,
    /^(帮帮我|帮帮忙)[\s!?。！？]*$/i,
    /^[\s!?。！？]+$/, // 纯标点
];
/** 判断是否为简单问候，不触发 agent-selector */
export function isSimpleGreeting(text) {
    const t = text.trim();
    if (t.length < 3)
        return true; // 过短视为问候
    return SIMPLE_GREETING_PATTERNS.some((r) => r.test(t));
}
/** 选择超时时间（毫秒），超时即降级 */
const SELECTOR_TIMEOUT_MS = 5000;
/**
 * 根据任务文本自动选择 1～N 个 Agent
 * @param task 用户任务描述
 * @returns 选中的 agentIds 与原因；失败或 0 个时返回空数组，调用方应降级到 defaultAgent
 */
export async function selectAgentsForTask(task) {
    const cfg = getAgentSelectorConfig();
    if (!cfg.enabled) {
        return { agentIds: [], reason: '' };
    }
    const agents = await listAgents();
    if (agents.length < 1)
        return { agentIds: [], reason: '' };
    if (agents.length === 1) {
        return { agentIds: [agents[0].id], reason: '仅有一个 Agent，直接使用。' };
    }
    const agentDesc = agents
        .map((a) => {
        const cat = a.category?.trim() || '';
        const skills = (a.skillIds ?? []).join('、') || '无';
        const desc = a.description?.trim() || '';
        return `- ${a.id}（${a.name}）：${cat ? `分类：${cat}；` : ''}技能：${skills}；${desc ? `简介：${desc}` : ''}`;
    })
        .join('\n');
    const systemPrompt = `你是 Agent 选择助手。用户给出任务描述，你需要从可选 Agent 中选出最合适的 1～N 个。
规则：
1. 仅返回 JSON，格式 {"agentIds":["id1","id2"],"reason":"一句话说明选择原因"}，无其他文字
2. agentIds 必须是下方 Agent 列表中的 id，按优先级排序
3. 简单任务选 1 个；需要多角色协作的复杂任务选 2～${cfg.maxAgents} 个
4. 根据任务的动词、目标，匹配 Agent 的 category、skillIds、description
5. 无法匹配时返回 {"agentIds":[],"reason":"未找到合适 Agent"}`;
    const userMsg = `用户任务：${task}\n\n可选 Agent：\n${agentDesc}\n\n请选择并返回 JSON。`;
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('agent-selector timeout')), SELECTOR_TIMEOUT_MS));
    const runPromise = (async () => {
        const provider = getLLMProvider();
        const result = await provider.complete([{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }], { temperature: 0.1, maxTokens: 256 });
        const content = result.content?.trim() ?? '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            return { agentIds: [], reason: '' };
        const parsed = JSON.parse(jsonMatch[0]);
        const ids = Array.isArray(parsed.agentIds) ? parsed.agentIds : [];
        const validIds = ids.filter((id) => typeof id === 'string');
        const idSet = new Set(agents.map((a) => a.id));
        const agentIds = validIds.filter((id) => idSet.has(id)).slice(0, cfg.maxAgents);
        return { agentIds, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
    })();
    try {
        return await Promise.race([runPromise, timeoutPromise]);
    }
    catch (e) {
        const msg = e instanceof Error && e.message === 'agent-selector timeout'
            ? 'LLM 选择超时（3s），将使用默认 Agent'
            : e instanceof Error ? e.message : String(e);
        console.warn('[agent-selector]', msg);
        return { agentIds: [], reason: '' };
    }
}
//# sourceMappingURL=agent-selector.js.map