type WsFrameHeaders = {
    headers: {
        req_id: string;
    };
};
type WSClientInstance = import('@wecom/aibot-node-sdk').WSClient;
/** 获取指定实例的 Wecom Bot 客户端（用于回复） */
export declare function getWecomBotClient(instanceId: string): WSClientInstance | undefined;
/** 使用 replyStream 发送文本回复（SDK 无 replyText，用 replyStream finish=true 模拟）。无客户端时返回 false */
export declare function replyWecomBotText(instanceId: string, frame: WsFrameHeaders, content: string): Promise<boolean>;
/** 主动发送 Markdown 文本（SDK 使用 sendMessage + markdown）。无客户端时返回 false */
export declare function sendWecomBotText(instanceId: string, chatId: string, content: string): Promise<boolean>;
/** 使用 replyStream 发送 Markdown 回复 */
export declare function replyWecomBotMarkdown(instanceId: string, frame: WsFrameHeaders, content: string): Promise<boolean>;
/** 上传并发送文件：有 frame 则 replyMedia，否则 sendMediaMessage。返回 true 表示成功 */
export declare function sendWecomBotFile(instanceId: string, ctx: {
    wecomFrame?: unknown;
    chatId?: string;
}, fileBuffer: Buffer, fileType: 'image' | 'file' | 'audio' | 'video', filename: string, caption?: string): Promise<boolean>;
export declare function startWecomBotClient(instanceId: string): Promise<void>;
export declare function stopWecomBotClient(instanceId: string): Promise<void>;
export declare function stopAllWecomBotClients(): Promise<void>;
export {};
//# sourceMappingURL=wecom-bot-ws.d.ts.map