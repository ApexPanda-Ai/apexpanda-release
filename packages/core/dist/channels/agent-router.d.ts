/**
 * 渠道消息中 @Agent 解析与路由
 * 支持格式：@Agent名称 问题 / /agent Agent名 问题 / #Agent名 问题
 *
 * 核心策略：扫描消息中所有 @xxx，依次尝试匹配 Agent，第一个命中的为目标。
 * 这样可自动跳过群聊中 @机器人 的前缀干扰，无需知道机器人自身的名称。
 */
import type { AgentDef } from '../agent/store.js';
export interface AgentMentionResult {
    /** 解析出的 Agent ID，未匹配时为 undefined（单 Agent 兼容） */
    agentId?: string;
    /** 解析出的所有 Agent ID 列表（多 @ 时按出现顺序去重） */
    agentIds: string[];
    /** 实际要发送给 Agent 的内容（已去掉 @Agent 前缀） */
    content: string;
    /** 是否成功匹配到提及的 Agent */
    mentionMatched: boolean;
    /** @ 了但未匹配到的名称，用于友好提示（仅消息中只有一个 @ 且未匹配时） */
    unmappedMention?: string;
}
/**
 * 按优先级匹配 Agent：
 * 1. name 精确匹配（大小写敏感）
 * 2. handle 精确匹配
 * 3. name 大小写不敏感精确匹配
 * 4. name 包含用户输入（agent 名包含用户打的字，而非反过来）
 */
export declare function matchAgent(name: string, agents: AgentDef[]): AgentDef | undefined;
/**
 * 从消息中解析 @Agent / /agent / # 格式，返回目标 agentId 与内容
 */
export declare function parseAgentMention(text: string): Promise<AgentMentionResult>;
//# sourceMappingURL=agent-router.d.ts.map