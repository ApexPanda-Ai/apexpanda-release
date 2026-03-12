/**
 * Telegram Bot 渠道适配器
 * 支持文本、图片、文档、语音、视频、贴纸及带 caption 的媒体
 * @see https://core.telegram.org/bots/api#getting-updates
 */
import type { IncomingMessage } from './types.js';
interface TelegramPhotoSize {
    file_id: string;
    file_unique_id?: string;
    width: number;
    height: number;
    file_size?: number;
}
interface TelegramFile {
    file_id: string;
    file_unique_id?: string;
    file_size?: number;
    file_path?: string;
}
interface TelegramSticker {
    file_id: string;
    file_unique_id?: string;
    is_animated?: boolean;
    is_video?: boolean;
    width: number;
    height: number;
}
interface TelegramMessage {
    message_id: number;
    chat: {
        id: number;
        type: string;
    };
    from?: {
        id: number;
        first_name?: string;
    };
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    document?: TelegramFile & {
        file_name?: string;
    };
    voice?: TelegramFile & {
        duration?: number;
    };
    video?: TelegramFile & {
        duration?: number;
    };
    video_note?: TelegramFile & {
        duration?: number;
    };
    sticker?: TelegramSticker;
}
interface TelegramUpdate {
    update_id?: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
    callback_query?: unknown;
}
/** 解析 Telegram Update 为 IncomingMessage（仅文本，同步） */
export declare function parseTelegramUpdate(update: TelegramUpdate): IncomingMessage | null;
export interface TelegramWebhookResult {
    type: 'event';
    message: IncomingMessage;
    chatId: string;
}
/** 异步解析 Telegram 消息（含媒体），参考 OpenClaw + Feishu 模式 */
export declare function parseTelegramUpdateAsync(update: TelegramUpdate, botToken: string): Promise<IncomingMessage | null>;
/** 处理 Telegram webhook 请求（支持媒体，异步） */
export declare function handleTelegramWebhook(body: TelegramUpdate, botToken: string): Promise<TelegramWebhookResult | null>;
/** 通过 Telegram Bot API 发送消息 */
export declare function sendTelegramMessage(chatId: string, content: string, botToken: string): Promise<void>;
/** 发送图片到 Telegram（支持 filePath 绝对路径） */
export declare function sendTelegramPhoto(chatId: string, filePath: string, caption: string | undefined, botToken: string): Promise<void>;
/** 发送文件/视频/音频到 Telegram */
export declare function sendTelegramDocument(chatId: string, filePath: string, mimeType: string, caption: string | undefined, botToken: string, fileType: 'image' | 'file' | 'audio' | 'video'): Promise<void>;
export {};
//# sourceMappingURL=telegram.d.ts.map