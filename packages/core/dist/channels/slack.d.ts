import type { IncomingMessage } from './types.js';
interface SlackEventPayload {
    type?: string;
    token?: string;
    challenge?: string;
    team_id?: string;
    event?: {
        type?: string;
        subtype?: string;
        channel?: string;
        user?: string;
        text?: string;
        ts?: string;
        channel_type?: string;
    };
}
/** 验证 Slack 请求签名（需 X-Slack-Signature 与 X-Slack-Request-Timestamp） */
export declare function verifySlackSignatureRaw(rawBody: string, signingSecret: string, signatureHeader: string | undefined, timestampHeader: string | undefined): boolean;
/** 解析 Slack event 为 IncomingMessage */
export declare function parseSlackEvent(payload: SlackEventPayload): IncomingMessage | null;
export interface SlackWebhookResult {
    type: 'challenge';
    challenge: string;
}
export interface SlackEventResult {
    type: 'event';
    message: IncomingMessage;
    channelId: string;
}
/** 处理 Slack webhook（需传入原始 body 以便验签） */
export declare function handleSlackWebhook(body: SlackEventPayload, rawBody: string, signingSecret: string, signature: string | undefined, timestamp: string | undefined): SlackWebhookResult | SlackEventResult | null;
/** 通过 Slack API 发送消息 */
export declare function sendSlackMessage(channelId: string, content: string, botToken: string): Promise<void>;
/** 文件直通：通过 Slack files.upload 上传并发送到频道 */
export declare function sendSlackFile(channelId: string, filePath: string, mimeType: string, caption: string | undefined, botToken: string): Promise<void>;
export {};
//# sourceMappingURL=slack.d.ts.map