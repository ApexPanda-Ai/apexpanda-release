/**
 * 多 Agent 动态规划 — 待确认计划存储
 * 当 planConfirmRequired=true 时，planWithLLM 生成计划后先缓存，
 * 等用户回复「确认」才执行。
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
}
/** 以 channelSessionId 为 key 存储待确认计划 */
export declare function setPendingPlan(sessionId: string, plan: PendingPlan): void;
/** 取出待确认计划（取出后自动删除） */
export declare function getAndClearPendingPlan(sessionId: string): PendingPlan | undefined;
/** 是否有待确认计划 */
export declare function hasPendingPlan(sessionId: string): boolean;
/** 判断消息是否为「确认」指令 */
export declare function isPlanConfirmMessage(msg: string): boolean;
/** 判断消息是否为「取消」指令 */
export declare function isPlanCancelMessage(msg: string): boolean;
//# sourceMappingURL=pending-plan-store.d.ts.map