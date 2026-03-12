/**
 * 飞书 / Lark 渠道适配器
 * 支持 机器人 webhook、事件订阅
 * @see https://open.feishu.cn/document/ukTMukTMukTM/ucTM5YjL3ETO24yNxkjN
 */
import type { ChannelAdapter, IncomingMessage } from './types.js';
export interface FeishuEvent {
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
/** 解析飞书事件为 IncomingMessage（支持文本、语音、图片），含耗时操作（ASR、下载） */
export declare function parseFeishuEvent(body: FeishuEvent, tenantId: string): Promise<IncomingMessage | null>;
export declare function createFeishuAdapter(tenantId: string): ChannelAdapter;
export interface FeishuWebhookResult {
    type: 'challenge';
    challenge: string;
}
export interface FeishuEventResult {
    type: 'event';
    message: IncomingMessage;
    messageId: string;
    chatId?: string;
    chatType?: 'p2p' | 'group';
    userId?: string;
}
/** audio/image 的快速返回结构，完整解析移至 processFeishuEventDeferred */
export interface FeishuDeferredEventResult {
    type: 'event';
    deferred: true;
    rawBody: FeishuEvent;
    messageId: string;
    chatId?: string;
    chatType?: 'p2p' | 'group';
    userId?: string;
    messageType: 'audio' | 'image' | 'file';
}
/** 处理飞书 webhook 请求，返回需响应的 body（含 challenge 等）
 * - text: 完整 parse，快
 * - audio/image: quickParse 仅提取元数据，返回 deferred，不阻塞 HTTP
 */
export declare function handleFeishuWebhook(body: FeishuEvent, tenantId?: string): Promise<FeishuWebhookResult | FeishuEventResult | FeishuDeferredEventResult | null>;
//# sourceMappingURL=feishu.d.ts.map