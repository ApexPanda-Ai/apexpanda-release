import type { WorkflowDef, RunCheckpoint, WorkflowChannelContext } from './types.js';
export interface RunWorkflowOptions {
    runId?: string;
    /** 渠道上下文：完成后将结果发回 IM */
    channelContext?: {
        channel: string;
        ctx: WorkflowChannelContext;
    };
    /**
     * 跳过自动渠道回复（完成和失败时均不调用 sendReplyToChannel）。
     * 用于 multi-agent plan 模式：channelContext 仅用于推导 memScopeHint，
     * 渠道发送由 orchestrator/server.ts 统一控制，避免重复发送。
     */
    skipChannelReply?: boolean;
}
export declare function runWorkflow(def: WorkflowDef, input: Record<string, unknown>, runIdOrOpts?: string | RunWorkflowOptions): Promise<{
    runId: string;
    status: RunCheckpoint['status'];
    output?: unknown;
    error?: string;
}>;
/**
 * Human-in-the-loop: 用人工输入恢复工作流执行
 */
export declare function resumeWorkflow(def: WorkflowDef, runId: string, humanInput: unknown): Promise<{
    runId: string;
    status: RunCheckpoint['status'];
    output?: unknown;
    error?: string;
}>;
//# sourceMappingURL=engine.d.ts.map