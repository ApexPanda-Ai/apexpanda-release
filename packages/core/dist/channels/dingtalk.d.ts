/** 通过 sessionWebhook 回复（Stream 模式消息中自带） */
export declare function sendDingTalkReply(webhook: string, content: string): Promise<void>;
/** 通过 sessionWebhook 发送 Markdown 格式消息 */
export declare function sendDingTalkMarkdown(webhook: string, title: string, text: string): Promise<void>;
/** 文件直通：上传并发送图片/文件，失败时调用方降级为 sendDingTalkFileFallback */
export declare function sendDingTalkFile(webhook: string, filePath: string, fileType: 'image' | 'file' | 'audio' | 'video', mimeType: string, caption: string | undefined, instanceId?: string): Promise<void>;
/** 文件直通降级：钉钉不支持或上传失败时，发 markdown 文本说明 */
export declare function sendDingTalkFileFallback(webhook: string, caption: string, filePath: string, fileType?: string): Promise<void>;
//# sourceMappingURL=dingtalk.d.ts.map