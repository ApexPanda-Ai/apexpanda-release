import type { WorkflowChannelContext } from '../workflow/types.js';
export interface MultiAgentOrchestratorInput {
    task: string;
    agentIds: string[];
    channelSessionId: string;
    history: Array<{
        role: string;
        content: string;
    }>;
    memoryScopeHint?: string;
    userId?: string;
    onProgress?: (msg: string) => void | Promise<void>;
    /** 消息内联指定的协同模式，优先级高于全局 config */
    inlineCollabMode?: 'pipeline' | 'parallel' | 'plan';
}
/**
 * 执行多 Agent 协同（主从式 / 流水线 / 并行 / 动态规划，由配置决定）
 */
export declare function runMultiAgentOrchestrator(channel: string, ctx: WorkflowChannelContext, input: MultiAgentOrchestratorInput): Promise<{
    reply: string;
}>;
/**
 * 执行已缓存的待确认计划（用户回复「确认」后调用）
 */
export declare function executePendingPlan(pending: import('./pending-plan-store.js').PendingPlan): Promise<{
    reply: string;
}>;
//# sourceMappingURL=multi-agent-orchestrator.d.ts.map