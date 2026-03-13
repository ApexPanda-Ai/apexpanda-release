/**
 * 会话隔离：生成 per-channel-peer SessionId
 * 确保用户 A 的内容不会出现在用户 B 的窗口
 */
import type { ChannelType } from './types.js';
export declare function createSessionId(channel: ChannelType, channelPeerId: string, tenantId: string): string;
export declare function parseSessionId(sessionId: string): {
    tenantId: string;
    channel: ChannelType;
    channelPeerId: string;
} | null;
//# sourceMappingURL=session.d.ts.map