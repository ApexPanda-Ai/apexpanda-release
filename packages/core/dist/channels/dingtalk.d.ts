/**
 * 钉钉渠道适配器
 * 支持 群机器人 Webhook、Outgoing 机器人
 * @see https://open.dingtalk.com/document/orgapp/robot-overview
 */
import type { IncomingMessage } from './types.js';
interface DingTalkOutgoing {
    msgtype?: string;
    text?: {
        content?: string;
    };
    msgId?: string;
    createAt?: number;
    conversationType?: string;
    conversationId?: string;
    conversationTitle?: string;
    /** 企业内部成员 userid（线上版本才有，优先级最高） */
    senderStaffId?: string;
    /** 加密发送者 ID（开发测试版本） */
    senderId?: string;
    senderNick?: string;
    senderCorpId?: string;
    sessionWebhook?: string;
    chatbotUserId?: string;
    robotCode?: string;
}
/** 钉钉 Outgoing 回调格式 */
export declare function parseDingTalkOutgoing(body: DingTalkOutgoing, tenantId?: string): IncomingMessage | null;
export interface DingTalkWebhookResult {
    type: 'event';
    message: IncomingMessage;
    sessionWebhook?: string;
}
export declare function handleDingTalkWebhook(body: DingTalkOutgoing, tenantId?: string): DingTalkWebhookResult | null;
/** 通过 sessionWebhook 回复（Outgoing 机器人） */
export declare function sendDingTalkReply(webhook: string, content: string): Promise<void>;
/** 通过 sessionWebhook 发送 Markdown 格式消息 */
export declare function sendDingTalkMarkdown(webhook: string, title: string, text: string): Promise<void>;
/** 文件直通降级：钉钉 Outgoing Webhook 不支持图片/文件，发 markdown 文本说明 */
export declare function sendDingTalkFileFallback(webhook: string, caption: string, filePath: string, fileType?: string): Promise<void>;
export {};
//# sourceMappingURL=dingtalk.d.ts.map