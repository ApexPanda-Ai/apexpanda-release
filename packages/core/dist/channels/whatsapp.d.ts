/**
 * WhatsApp Cloud API 渠道适配器
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 */
import type { IncomingMessage } from './types.js';
interface WhatsAppWebhookPayload {
    object?: string;
    entry?: Array<{
        id?: string;
        changes?: Array<{
            value?: {
                messaging_product?: string;
                metadata?: {
                    phone_number_id?: string;
                };
                contacts?: Array<{
                    profile?: {
                        name?: string;
                    };
                    wa_id?: string;
                }>;
                messages?: Array<{
                    id?: string;
                    from?: string;
                    timestamp?: string;
                    type?: string;
                    text?: {
                        body?: string;
                    };
                }>;
            };
        }>;
    }>;
}
/** 解析 WhatsApp webhook 为 IncomingMessage */
export declare function parseWhatsAppWebhook(body: WhatsAppWebhookPayload): IncomingMessage | null;
export interface WhatsAppVerifyResult {
    type: 'verify';
    challenge: string;
}
export interface WhatsAppEventResult {
    type: 'event';
    message: IncomingMessage;
    phoneNumberId?: string;
}
/** 处理 WhatsApp webhook GET 验证请求 */
export declare function handleWhatsAppVerify(hubMode: string, hubVerifyToken: string, hubChallenge: string, expectedVerifyToken: string): WhatsAppVerifyResult | null;
/** 处理 WhatsApp webhook POST 事件 */
export declare function handleWhatsAppWebhook(body: WhatsAppWebhookPayload): WhatsAppEventResult | null;
/** 通过 WhatsApp Cloud API 发送文本消息 */
export declare function sendWhatsAppMessage(to: string, content: string, phoneNumberId: string, accessToken: string): Promise<void>;
export {};
//# sourceMappingURL=whatsapp.d.ts.map