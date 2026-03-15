/**
 * Discord 渠道适配器
 * @see https://discord.com/developers/docs/resources/channel#create-message
 */
/** 通过 Discord REST API 发送消息 */
export declare function sendDiscordMessage(channelId: string, content: string, botToken: string): Promise<void>;
/** 文件直通：通过 Discord API 发送文件附件 */
export declare function sendDiscordFile(channelId: string, filePath: string, mimeType: string, caption: string | undefined, botToken: string): Promise<void>;
//# sourceMappingURL=discord.d.ts.map