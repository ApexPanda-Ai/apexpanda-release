import type { WorkflowTemplate } from './templates.js';
import type { WorkflowNode, WorkflowEdge } from './types.js';
/** 校验模板名称：字母数字、中文、-、_、· 等 */
export declare function sanitizeTemplateName(name: string): string;
/** 校验模板 id：用于自定义模板，避免与系统模板冲突 */
export declare function sanitizeTemplateId(name: string): string;
/** 获取所有自定义模板 */
export declare function listCustomTemplates(): Promise<WorkflowTemplate[]>;
/** 保存为自定义模板，返回新模板；若 name 与已有模板重名则失败 */
export declare function saveAsTemplate(input: {
    name: string;
    description: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    suggestedCommand?: string;
    suggestedCron?: string;
}): Promise<{
    success: boolean;
    template?: WorkflowTemplate;
    error?: string;
}>;
/** 是否为自定义模板 id（仅自定义模板可删改） */
export declare function isCustomTemplateId(id: string): boolean;
/** 删除自定义模板 */
export declare function deleteCustomTemplate(id: string): Promise<{
    success: boolean;
    error?: string;
}>;
/** 更新自定义模板 */
export declare function updateCustomTemplate(id: string, patch: {
    name?: string;
    description?: string;
    suggestedCommand?: string;
    suggestedCron?: string;
}): Promise<{
    success: boolean;
    template?: WorkflowTemplate;
    error?: string;
}>;
/** 合并系统 + 自定义模板，供 listWorkflowTemplates 使用 */
export declare function mergeTemplates(system: WorkflowTemplate[], customs: WorkflowTemplate[]): WorkflowTemplate[];
//# sourceMappingURL=custom-templates.d.ts.map