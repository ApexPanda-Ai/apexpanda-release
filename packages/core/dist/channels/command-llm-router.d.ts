export type CommandIntent = 'help' | 'create_workflow' | 'create_agent' | 'workflow_run' | 'discussion' | 'nodes' | 'chat';
export interface CommandIntentResult {
    intent: CommandIntent;
    params: Record<string, string>;
}
/**
 * 调用 LLM 解析用户消息的意图
 * @param rawMessage 原始用户消息
 * @returns 解析结果，失败或 intent=chat 时仍返回有效对象
 */
export declare function routeCommandIntent(rawMessage: string): Promise<CommandIntentResult>;
//# sourceMappingURL=command-llm-router.d.ts.map