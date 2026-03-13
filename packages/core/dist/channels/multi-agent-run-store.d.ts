export type MultiAgentRunStatus = 'running' | 'completed' | 'failed' | 'pending_confirm';
export interface MultiAgentRunLog {
    runId: string;
    /** 协同模式 */
    mode: 'supervisor' | 'pipeline' | 'parallel' | 'plan' | string;
    /** 用户原始任务 */
    task: string;
    /** 参与 Agent 名称列表 */
    agentNames: string[];
    /** 参与 Agent ID 列表（用于沙盘展示，可选） */
    agentIds?: string[];
    /** 运行状态 */
    status: MultiAgentRunStatus;
    /** 最终回复摘要（截取前 200 字） */
    replySummary?: string;
    /** 错误信息 */
    error?: string;
    /** 渠道 */
    channel?: string;
    startedAt: number;
    completedAt?: number;
}
export declare function listMultiAgentRuns(limit?: number): Promise<MultiAgentRunLog[]>;
export declare function appendMultiAgentRun(log: MultiAgentRunLog): Promise<void>;
export declare function makeRunId(): string;
//# sourceMappingURL=multi-agent-run-store.d.ts.map