import type { WorkflowDef, RunCheckpoint } from './types.js';
export declare function listWorkflows(): Promise<WorkflowDef[]>;
export declare function getWorkflow(id: string): Promise<WorkflowDef | null>;
export declare function createWorkflow(def: Omit<WorkflowDef, 'id'>): Promise<WorkflowDef>;
export declare function updateWorkflow(id: string, patch: Partial<WorkflowDef>): Promise<WorkflowDef | null>;
export declare function deleteWorkflow(id: string): Promise<boolean>;
export declare function saveRunCheckpoint(cp: RunCheckpoint): void;
export declare function getRunCheckpoint(runId: string): Promise<RunCheckpoint | null>;
/** 列出运行记录，可选按 workflowId 筛选，按时间倒序 */
export declare function listRuns(workflowId?: string, limit?: number): Promise<RunCheckpoint[]>;
//# sourceMappingURL=store.d.ts.map