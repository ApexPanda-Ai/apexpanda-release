/**
 * ApexPanda 核心类型定义
 * 多租户、会话隔离、权限模型
 */
/** 租户 ID */
export type TenantId = string;
/** 用户 ID（在租户内唯一） */
export type UserId = string;
/** 会话 ID（按 channel + peer 隔离） */
export type SessionId = string;
/** 渠道类型 */
export type ChannelType = 'telegram' | 'whatsapp' | 'slack' | 'discord' | 'feishu' | 'dingtalk' | 'wecom' | 'web' | 'api';
/** 会话隔离策略：per-channel-peer 默认启用 */
export type SessionScope = 'per-channel-peer' | 'per-channel' | 'global';
/** 会话配置 */
export interface SessionConfig {
    scope: SessionScope;
    /** 每天自动重置时间，如 "04:00" */
    resetTime?: string;
}
/** 租户配置 */
export interface TenantConfig {
    id: TenantId;
    name: string;
    session: SessionConfig;
    /** 身份关联：同一用户在不同渠道的 ID 映射 */
    identityLinks?: Record<UserId, string[]>;
}
/** 消息队列配置 */
export interface QueueConfig {
    mode: 'collect' | 'serial' | 'drop';
    debounceMs: number;
    cap: number;
    dropStrategy: 'oldest' | 'summarize';
}
//# sourceMappingURL=types.d.ts.map