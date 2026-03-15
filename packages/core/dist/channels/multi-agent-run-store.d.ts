export type MultiAgentRunStatus = 'running' | 'completed' | 'failed' | 'pending_confirm';
/** 阶段三：流水线步骤（含 verify 通过/失败） */
export interface RunStepInfo {
    id: string;
    type: 'agent' | 'verify' | 'loop';
    label?: string;
    status: 'completed' | 'failed' | 'pending';
    pass?: boolean;
}
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
    /** 阶段三：plan 模式下的步骤列表（含 verify 通过/失败），供沙盘展示 */
    steps?: RunStepInfo[];
    /** 阶段一：自动选 Agent 时的选择原因，供沙盘展示「已为你自动选择 Agent：xxx，原因：...」 */
    autoSelectReason?: string;
}
export declare function listMultiAgentRuns(limit?: number): Promise<MultiAgentRunLog[]>;
export declare function appendMultiAgentRun(log: MultiAgentRunLog): Promise<void>;
export declare function updateMultiAgentRun(runId: string, patch: Partial<Pick<MultiAgentRunLog, 'status' | 'completedAt' | 'replySummary' | 'error' | 'steps'>>): Promise<boolean>;
export declare function makeRunId(): string;
//# sourceMappingURL=multi-agent-run-store.d.ts.map