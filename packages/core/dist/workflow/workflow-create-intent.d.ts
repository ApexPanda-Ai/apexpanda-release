/** 是否启用确认模式：先回复拟创建内容，用户说「确认」后再创建 */
export declare function isCreateWorkflowConfirmMode(): boolean;
export declare function setPendingCreate(channel: string, ctx: {
    chatId?: string;
    sessionWebhook?: string;
    messageId?: string;
}, intent: CreateIntentResult): void;
export declare function getAndClearPendingCreate(channel: string, ctx: {
    chatId?: string;
    sessionWebhook?: string;
    messageId?: string;
}): CreateIntentResult | null;
/** 定时清理过期待确认创建工作流（供 index 定期调用） */
export declare function cleanupExpiredPendingCreates(): void;
/** 用户消息是否为「确认」 */
export declare function isConfirmMessage(text: string): boolean;
export interface CreateIntentResult {
    templateId?: string;
    name?: string;
    cron?: string;
    reason?: string;
    error?: string;
    /** 无完全匹配时，最接近的模板 id，用于引导用户到 Dashboard 编辑 */
    suggestedTemplateId?: string;
}
/** 调用 LLM 解析用户描述，匹配模板并提取参数 */
export declare function parseCreateWorkflowIntent(userDescription: string): Promise<CreateIntentResult>;
/** 渠道上下文（与 server.ChannelContext 兼容） */
export interface CreateWorkflowChannelContext {
    channel: string;
    ctx: {
        chatId?: string;
        sessionWebhook?: string;
        messageId?: string;
        chatType?: 'p2p' | 'group';
        userId?: string;
    };
}
/** 根据解析结果创建工作流，渠道创建时可传入 channelContext，定时结果将自动发回该渠道 */
export declare function createWorkflowFromIntent(intent: CreateIntentResult, channelContext?: CreateWorkflowChannelContext): Promise<{
    success: boolean;
    workflow?: {
        id: string;
        name: string;
    };
    error?: string;
}>;
/** 生成面向用户的回复文案 */
export declare function formatCreateResult(result: {
    success: boolean;
    workflow?: {
        id: string;
        name: string;
    };
    error?: string;
}, intent?: CreateIntentResult): Promise<string>;
/** 生成待确认的回复文案（Phase 2） */
export declare function formatPendingCreatePreview(intent: CreateIntentResult): Promise<string>;
//# sourceMappingURL=workflow-create-intent.d.ts.map