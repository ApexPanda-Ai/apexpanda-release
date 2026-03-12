import { listAgents } from '../agent/store.js';
/** (?![^\s,，：:]) 防止 /agentx 误匹配，应走 LLM 兜底 */
const SLASH_AGENT_REG = /^\/agent(?![^\s,，：:])\s*[，,：:]*\s*([^\s/,，：:]+)\s*[，,：:]*\s*(.*)$/s;
const HASH_REG = /^#([^\s#]+)\s*(.*)$/s;
// 全文中所有 @xxx 的位置；遇常见标点（中英文逗号、冒号等）即停止，避免 "@产品经理，你好" 被误解析为 "@产品经理，你好"
const AT_SCAN_REG = /@([^\s@，。、,.:;!?：；\n]+)/g;
/**
 * 按优先级匹配 Agent：
 * 1. name 精确匹配（大小写敏感）
 * 2. handle 精确匹配
 * 3. name 大小写不敏感精确匹配
 * 4. name 包含用户输入（agent 名包含用户打的字，而非反过来）
 */
export function matchAgent(name, agents) {
    // 1. 精确匹配 name（区分大小写，最高优先）
    let found = agents.find((a) => a.name === name);
    if (found)
        return found;
    // 2. 精确匹配 handle（大小写不敏感）
    found = agents.find((a) => a.handle && a.handle.toLowerCase() === name.toLowerCase());
    if (found)
        return found;
    // 3. name 大小写不敏感精确匹配
    const lower = name.toLowerCase();
    found = agents.find((a) => a.name.toLowerCase() === lower);
    if (found)
        return found;
    // 4. Agent name 以用户输入开头，或包含用户输入（用户输错也能命中）
    //    不允许反向包含（用户输入包含 Agent name），避免短名 Agent 误匹配所有消息
    found = agents.find((a) => a.name.toLowerCase().startsWith(lower) ||
        a.name.toLowerCase().includes(lower));
    return found;
}
/**
 * 扫描所有 @xxx，收集匹配的 Agent ID（按出现顺序去重），并生成内容（去掉所有 @ 部分）
 */
function scanAllAtMentions(text, agents) {
    const atRegex = new RegExp(AT_SCAN_REG.source, 'g');
    const seen = new Set();
    const agentIds = [];
    let match;
    let unmatchedCount = 0;
    let lastUnmatchedName = '';
    while ((match = atRegex.exec(text)) !== null) {
        const name = match[1];
        const agent = matchAgent(name, agents);
        if (agent) {
            if (!seen.has(agent.id)) {
                seen.add(agent.id);
                agentIds.push(agent.id);
            }
        }
        else {
            unmatchedCount++;
            lastUnmatchedName = name;
        }
    }
    // 去掉 @Agent 以及其前后紧跟的分隔符（中英文逗号、顿号、冒号等），避免 content 残留标点
    const content = text
        .replace(AT_SCAN_REG, ' ')
        .replace(/[，,、；;：:]+/g, ' ') // 清理 @ 间的分隔标点
        .replace(/\s+/g, ' ')
        .trim() || '你好';
    const unmappedMention = unmatchedCount === 1 ? lastUnmatchedName : undefined;
    return { agentIds, content, unmappedMention };
}
/**
 * 从消息中解析 @Agent / /agent / # 格式，返回目标 agentId 与内容
 */
export async function parseAgentMention(text) {
    const trimmed = text.trim();
    const agents = await listAgents();
    // 优先检测 /agent 和 # 显式命令（不受群聊 @机器人 污染影响）
    let cm = trimmed.match(SLASH_AGENT_REG);
    if (cm) {
        const agent = matchAgent(cm[1].trim(), agents);
        if (agent)
            return { agentId: agent.id, agentIds: [agent.id], content: cm[2].trim() || '你好', mentionMatched: true };
        return { agentIds: [], content: cm[2].trim() || trimmed, mentionMatched: false, unmappedMention: cm[1].trim() };
    }
    cm = trimmed.match(HASH_REG);
    if (cm) {
        const agent = matchAgent(cm[1].trim(), agents);
        if (agent)
            return { agentId: agent.id, agentIds: [agent.id], content: cm[2].trim() || '你好', mentionMatched: true };
        return { agentIds: [], content: cm[2].trim() || trimmed, mentionMatched: false, unmappedMention: cm[1].trim() };
    }
    // @ 扫描：收集所有匹配的 Agent，支持多 @ 协同
    if (trimmed.includes('@')) {
        const result = scanAllAtMentions(trimmed, agents);
        if (result.agentIds.length > 0) {
            return {
                agentId: result.agentIds[0],
                agentIds: result.agentIds,
                content: result.content,
                mentionMatched: true,
                unmappedMention: result.unmappedMention,
            };
        }
        if (result.unmappedMention) {
            return { agentIds: [], content: result.content, mentionMatched: false, unmappedMention: result.unmappedMention };
        }
    }
    // 无任何 @，走默认 Agent
    return { agentIds: [], content: trimmed, mentionMatched: false };
}
//# sourceMappingURL=agent-router.js.map