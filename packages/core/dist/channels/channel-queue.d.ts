/**
 * 渠道事件队列：内存队列
 * 用于飞书媒体消息（语音/图片/文件）的异步处理，统一 HTTP deferred 与 WS 消息
 */
export type FeishuQueuePayload = {
    kind: 'ws';
    event: FeishuWsEvent;
} | {
    kind: 'deferred';
    rawBody: FeishuEventBody;
    messageId: string;
    chatId?: string;
    chatType?: 'p2p' | 'group';
    userId?: string;
    messageType: 'audio' | 'image' | 'file';
};
/** 飞书 WS 消息事件（可序列化） */
export interface FeishuWsEvent {
    sender: {
        sender_id: {
            open_id?: string;
            user_id?: string;
        };
        sender_type?: string;
        tenant_key?: string;
    };
    message: {
        message_id: string;
        chat_id: string;
        chat_type: string;
        message_type: string;
        content: string;
    };
}
/** 飞书 Webhook 原始 body（可序列化） */
export interface FeishuEventBody {
    challenge?: string;
    event?: {
        message?: {
            message_id?: string;
            message_type?: string;
            content?: string;
            chat_id?: string;
            chat_type?: 'p2p' | 'group';
            sender?: {
                sender_id?: {
                    open_id?: string;
                    user_id?: string;
                };
            };
        };
        sender?: {
            sender_id?: {
                open_id?: string;
                user_id?: string;
            };
        };
    };
}
type EnqueueCallback = (payload: FeishuQueuePayload) => void;
/** 注册内存队列的入队回调（供 feishu-ws 使用） */
export declare function registerMemoryEnqueue(cb: EnqueueCallback): void;
/** 入队飞书事件（WS 或 HTTP deferred） */
export declare function enqueueFeishuJob(payload: FeishuQueuePayload): Promise<void>;
/** 内存队列由 feishu-ws 自行消费，此函数保留为空实现以兼容调用方 */
export declare function startChannelQueueWorker(_handler: (payload: FeishuQueuePayload) => Promise<void>): void;
export {};
//# sourceMappingURL=channel-queue.d.ts.map