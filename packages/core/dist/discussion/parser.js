/**
 * 创新模式：解析 /debate、/讨论 命令及参数
 */
import { listAgents } from '../agent/store.js';
import { matchAgent } from '../channels/agent-router.js';
const DEBATE_TRIGGER = /^\/(?:debate|讨论)\s*[，,：:]*\s*(.*)$/s;
const AT_MENTION_REG = /@([^\s@，。、,.:;!?：；\n]+)/g;
const ROUNDS_REG = /\b([1-9]|10)\b/;
/**
 * 解析 /debate 或 /讨论 后的内容
 * @returns null 表示未匹配；{ question: '', ... } 且 question 为空表示仅命令无参数（需输出帮助）
 */
export async function parseDiscussionInput(raw, opts = {}) {
    const m = raw.match(DEBATE_TRIGGER);
    if (!m)
        return null;
    const rest = (m[1] ?? '').trim();
    if (rest === '')
        return { question: '', maxRounds: 3, agentIds: [] }; // 仅命令，无参数
    const agents = await listAgents();
    const agentIdSet = new Set();
    // 1. 提取 @提及
    const atMatches = [...rest.matchAll(AT_MENTION_REG)];
    for (const am of atMatches) {
        const name = am[1]?.trim();
        if (!name)
            continue;
        const agent = matchAgent(name, agents);
        if (agent)
            agentIdSet.add(agent.id);
    }
    let remainder = rest.replace(AT_MENTION_REG, ' ').replace(/\s+/g, ' ').trim();
    // 2. 提取轮数（独立数字 1-10）
    const roundsMatch = remainder.match(ROUNDS_REG);
    const capRounds = Math.min(10, opts.maxRounds ?? 10);
    const defaultRounds = Math.min(capRounds, Math.max(1, opts.defaultRounds ?? 3));
    let maxRounds = defaultRounds;
    if (roundsMatch) {
        maxRounds = Math.min(capRounds, Math.max(1, parseInt(roundsMatch[1], 10)));
        remainder = remainder.replace(ROUNDS_REG, ' ').replace(/\s+/g, ' ').trim();
    }
    // 3. 剩余为问题
    const question = remainder.trim();
    // 4. 限制参与 Agent 数量（建议 ≤ 5）
    const maxAgents = Math.min(10, Math.max(1, opts.maxAgents ?? 5));
    const rawAgentIds = agentIdSet.size > 0 ? Array.from(agentIdSet) : agents.map((a) => a.id);
    const agentIds = rawAgentIds.slice(0, maxAgents);
    return {
        question,
        maxRounds,
        agentIds,
    };
}
/** 是否匹配讨论触发命令（含参数或否，支持 ，,：: 作为分隔符） */
export function isDiscussionTrigger(msg) {
    return /^\/(?:debate|讨论)(?:\s*[，,：:]*\s*|$)/.test(msg.trim());
}
//# sourceMappingURL=parser.js.map