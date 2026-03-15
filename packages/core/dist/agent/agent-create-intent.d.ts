/** Agent 模板（workerIds 可扩展为预置 Worker Agent ID） */
export declare const AGENT_TEMPLATES: readonly [{
    readonly id: "general";
    readonly name: "通用助手";
    readonly description: "通用对话、任务执行";
}, {
    readonly id: "data-analysis";
    readonly name: "数据分析";
    readonly description: "数据解读、报表、图表";
}, {
    readonly id: "customer-service";
    readonly name: "客服助手";
    readonly description: "客服、售后、FAQ";
}, {
    readonly id: "code-assistant";
    readonly name: "代码助手";
    readonly description: "编程、调试、重构";
}, {
    readonly id: "research";
    readonly name: "研究助手";
    readonly description: "调研、归纳、引用";
}];
export interface CreateAgentIntent {
    templateId?: string;
    name?: string;
    handle?: string;
    description?: string;
    model?: string;
    systemPrompt?: string;
    workerIds?: string[];
    reason?: string;
    error?: string;
}
/** Phase 2：是否启用确认模式（APEXPANDA_AGENT_CREATE_CONFIRM=true） */
export declare function isCreateAgentConfirmMode(): boolean;
export declare function setPendingAgentCreate(channel: string, ctx: {
    chatId?: string;
    sessionWebhook?: string;
    messageId?: string;
}, intent: CreateAgentIntent): void;
export declare function getAndClearPendingAgentCreate(channel: string, ctx: {
    chatId?: string;
    sessionWebhook?: string;
    messageId?: string;
}): CreateAgentIntent | null;
/** 定时清理过期待确认创建 Agent（供 index 定期调用） */
export declare function cleanupExpiredPendingAgentCreates(): void;
/** 生成待确认的回复文案 */
export declare function formatPendingAgentCreatePreview(intent: CreateAgentIntent): string;
/** 检测消息是否为「创建 Agent」意图 */
export declare function isCreateAgentTrigger(text: string): boolean;
/** 提取命令/关键词后的描述部分 */
export declare function extractAgentDescription(text: string): string;
/** 调用 LLM 解析用户描述，匹配模板并提取 name、description、handle、systemPrompt */
export declare function parseCreateAgentIntent(userInput: string): Promise<CreateAgentIntent>;
/** 根据解析结果创建 Agent */
export declare function createAgentFromIntent(intent: CreateAgentIntent): Promise<{
    success: boolean;
    agent?: {
        id: string;
        name: string;
        handle?: string;
    };
    error?: string;
}>;
/** 生成创建成功后的使用说明文案 */
export declare function formatAgentCreateResult(result: {
    success: boolean;
    agent?: {
        id: string;
        name: string;
        handle?: string;
    };
    error?: string;
}): string;
//# sourceMappingURL=agent-create-intent.d.ts.map