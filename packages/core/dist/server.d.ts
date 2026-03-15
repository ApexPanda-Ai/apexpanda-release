/**
 * Gateway HTTP 服务器
 * REST API + WebSocket
 */
import type { IncomingMessage } from 'node:http';
export type ChannelContext = {
    messageId?: string;
    sessionWebhook?: string;
    chatId?: string;
    phoneNumberId?: string;
    /** Phase 5: 聊天类型 p2p=单聊 group=群聊，用于 memoryScopeHint */
    chatType?: 'p2p' | 'group';
    /** Phase 5: 发送者 ID（如飞书 open_id），用于 user scope */
    userId?: string;
    /** Chat 渠道：用户选中的 Agent ID，优先于渠道默认 */
    preferredAgentId?: string;
    /** Chat 渠道：捕获回复内容，用于 HTTP 响应（不实际发送到 IM） */
    replyCapturer?: (content: string) => void;
    /** Chat 渠道：租户 ID，用于 session 隔离 */
    tenantId?: string;
    /** 企业微信智能机器人：WebSocket 消息 frame，用于 replyText/replyMarkdown */
    wecomFrame?: unknown;
    /** 企业微信智能机器人：实例 ID，用于定位 bot client */
    wecomInstanceId?: string;
};
export declare function processChannelEvent(channel: string, message: {
    content: string;
    explicitHistory?: Array<{
        role: string;
        content: string;
    }>;
}, ctx: ChannelContext): Promise<void>;
/** 处理 deferred 事件（audio/image/file）：完整 parse 后复用 processFeishuEvent，供 Redis Worker 调用 */
export declare function processFeishuEventDeferred(rawResult: {
    type: 'event';
    deferred: true;
    rawBody: import('./channels/feishu.js').FeishuEvent;
    messageId: string;
    chatId?: string;
    chatType?: 'p2p' | 'group';
    userId?: string;
    messageType: 'audio' | 'image' | 'file';
    /** 方案 B：多实例时传入实例 ID */
    instanceId?: string;
}): Promise<void>;
export declare function createServer(): Promise<import("http").Server<typeof IncomingMessage, typeof import("http").ServerResponse>>;
//# sourceMappingURL=server.d.ts.map