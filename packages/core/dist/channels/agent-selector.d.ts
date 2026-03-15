export interface AgentSelectorResult {
    agentIds: string[];
    reason: string;
}
/** 判断是否为简单问候，不触发 agent-selector */
export declare function isSimpleGreeting(text: string): boolean;
/**
 * 根据任务文本自动选择 1～N 个 Agent
 * @param task 用户任务描述
 * @returns 选中的 agentIds 与原因；失败或 0 个时返回空数组，调用方应降级到 defaultAgent
 */
export declare function selectAgentsForTask(task: string): Promise<AgentSelectorResult>;
//# sourceMappingURL=agent-selector.d.ts.map