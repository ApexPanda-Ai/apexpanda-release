/**
 * 工作流模板市场：预设常见场景
 */
import type { WorkflowNode, WorkflowEdge } from './types.js';
export interface WorkflowTemplate {
    id: string;
    name: string;
    description: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    /** 建议的消息触发命令，用于渠道中快速触发 */
    suggestedCommand?: string;
    /** 建议的定时 cron，如每天 9 点 */
    suggestedCron?: string;
}
export declare const WORKFLOW_TEMPLATES: WorkflowTemplate[];
/** 同步：仅系统预设模板（兼容旧调用） */
export declare function listWorkflowTemplates(): WorkflowTemplate[];
/** 异步：系统 + 用户自定义模板合并 */
export declare function listWorkflowTemplatesMerged(): Promise<WorkflowTemplate[]>;
export declare function getWorkflowTemplate(id: string): WorkflowTemplate | undefined;
/** 异步：从系统 + 自定义模板中查找 */
export declare function getWorkflowTemplateMerged(id: string): Promise<WorkflowTemplate | undefined>;
//# sourceMappingURL=templates.d.ts.map