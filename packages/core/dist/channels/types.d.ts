/**
 * 渠道适配器类型
 */
import type { ChannelType } from '@apexpanda/shared';
export interface IncomingMessage {
    channel: ChannelType;
    channelPeerId: string;
    tenantId: string;
    content: string;
    raw?: unknown;
    /** 扩展元数据，如语音兜底失败原因 voiceFallbackReason */
    meta?: Record<string, unknown>;
}
export interface OutgoingMessage {
    channelPeerId: string;
    content: string;
    raw?: unknown;
}
export interface ChannelAdapter {
    id: string;
    channel: ChannelType;
    /** 接收并解析入站消息，返回标准化格式 */
    parseIncoming?(body: unknown): Promise<IncomingMessage | null>;
    /** 发送消息（若适配器支持主动推送） */
    send?(msg: OutgoingMessage): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map