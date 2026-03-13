export interface WorkflowMatchResult {
    workflowId: string;
    workflowName: string;
    /** 作为工作流输入的内容，传入 input.message */
    inputContent: string;
}
/**
 * 从渠道消息中解析是否触发工作流
 * @param channel 渠道 ID
 * @param content 消息内容
 * @returns 匹配的工作流及输入内容，不匹配返回 null
 */
export declare function parseWorkflowTrigger(channel: string, content: string): Promise<WorkflowMatchResult | null>;
//# sourceMappingURL=workflow-router.d.ts.map