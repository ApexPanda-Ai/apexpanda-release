/**
 * 多 Agent 动态规划 — 待确认计划存储
 * 当 planConfirmRequired=true 时，planWithLLM 生成计划后先缓存，
 * 等用户回复「确认」才执行。
 *
 * 持久化：计划保存到 .apexpanda/pending-plans.json，重启后仍可恢复。
 * - onProgress（函数）和 wecomFrame（活跃 WS 对象）不可序列化，保存时剥离。
 * - 加载时自动丢弃已超过 TTL 的过期条目。
 */
import type { MultiAgentOrchestratorInput } from './multi-agent-orchestrator.js';
import type { AgentDef } from '../agent/store.js';
export interface PendingPlan {
    input: MultiAgentOrchestratorInput;
    agents: AgentDef[];
    preview: string;
    channel: string;
    ctx: import('../workflow/types.js').WorkflowChannelContext;
    createdAt: number;
    runId?: string;
    mode?: string;
    task?: string;
    agentIds?: string[];
    agentNames?: string[];
}
/** 以 channelSessionId 为 key 存储待确认计划，并持久化到磁盘 */
export declare function setPendingPlan(sessionId: string, plan: PendingPlan): Promise<void>;
/** 取出待确认计划（取出后自动删除并更新磁盘） */
export declare function getAndClearPendingPlan(sessionId: string): Promise<PendingPlan | undefined>;
/** 是否有待确认计划 */
export declare function hasPendingPlan(sessionId: string): Promise<boolean>;
/** 判断消息是否为「确认」指令 */
export declare function isPlanConfirmMessage(msg: string): boolean;
/** 判断消息是否为「取消」指令 */
export declare function isPlanCancelMessage(msg: string): boolean;
//# sourceMappingURL=pending-plan-store.d.ts.map