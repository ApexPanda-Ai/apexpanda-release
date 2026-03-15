/**
 * 工作流完成后，将结果发送回 IM 渠道
 * 与 server.processChannelEvent 中的回复逻辑保持一致
 * 方案 B：channel 可为 instanceId（inst_xxx），需按 getInstanceType 路由并传 instanceId 取凭证
 */
import type { WorkflowChannelContext } from './types.js';
/** 文件直通结构，与 agent/runner FileReply 一致 */
export interface ChannelFileReply {
    fileType: 'image' | 'file' | 'audio' | 'video';
    filePath: string;
    mimeType: string;
    caption?: string;
}
/** 向渠道发送文件（图片/音频/视频/通用文件），供 Agent 文件直通、工作流等复用 */
export declare function sendFileToChannel(channel: string, ctx: WorkflowChannelContext, fr: ChannelFileReply): Promise<void>;
/** 发送帮助信息（飞书用卡片、钉钉用 Markdown、其他用纯文本） */
export declare function sendHelpToChannel(channel: string, ctx: WorkflowChannelContext, helpText: string): Promise<void>;
export declare function sendReplyToChannel(channel: string, ctx: WorkflowChannelContext, content: string, options?: {
    retries?: number;
}): Promise<void>;
//# sourceMappingURL=channel-reply.d.ts.map