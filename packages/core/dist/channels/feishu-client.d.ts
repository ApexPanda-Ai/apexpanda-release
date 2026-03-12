/** 获取飞书 tenant_access_token，供 Bitable/Doc 等 Skills 复用 */
export declare function getFeishuTenantAccessToken(): Promise<string>;
export interface FeishuSendOptions {
    receiveId: string;
    receiveIdType?: 'open_id' | 'chat_id' | 'user_id';
    content: string;
}
export declare function sendFeishuMessage(options: FeishuSendOptions): Promise<void>;
export declare function sendFeishuReply(messageId: string, content: string): Promise<void>;
/** 构建 /agent 角色选择卡片并发送 */
export declare function sendFeishuAgentSelectionCard(messageId: string, agents: {
    id: string;
    name: string;
}[]): Promise<void>;
/** 发送 /help 帮助卡片 */
export declare function sendFeishuHelpCard(messageId: string, helpText: string): Promise<void>;
/** 构建多 Agent 讨论帮助卡片（纯展示） */
export declare function sendFeishuDiscussionHelpCard(messageId: string): Promise<void>;
/** 发送交互卡片作为回复（用于 /agent 选角色） */
export declare function sendFeishuReplyCard(messageId: string, card: Record<string, unknown>): Promise<void>;
/**
 * 获取消息中的资源文件（语音、图片、文件等）
 * @param messageId 消息 ID
 * @param fileKey 资源 key（语音用 file_key，图片用 image_key）
 * @param resourceType 'file' | 'image'，图片消息需传 'image'
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message-resource/get
 */
export declare function getFeishuMessageResource(messageId: string, fileKey: string, resourceType?: 'file' | 'image'): Promise<Buffer>;
/** ASR 失败原因，用于按原因选择用户提示文案 */
export type AsrFailureReason = 'rate_limit' | 'script_failed' | 'download_failed' | 'api_error' | 'unknown';
/**
 * 构建 Agent 语音兜底指令消息
 * 按 preferredLang 引导 LLM 选择脚本语言与执行方式
 */
export declare function buildVoiceAgentFallbackMessage(savedPath: string, errorDesc: string, workspaceDir: string): Promise<string>;
/** 根据失败原因返回用户提示文案 */
export declare function getVoiceFallbackUserPrompt(reason?: AsrFailureReason): string;
/** 语音兜底脚本约定路径（相对工作区），与【脚本创建规范】对齐：.agent-scripts/功能目录/主脚本 */
export declare const VOICE_ASR_SCRIPT = ".agent-scripts/voice_asr/voice_asr.py";
/**
 * 检测当前环境可用的脚本语言，结果缓存
 * 用于 Agent 兜底时优先选择的语言
 */
export declare function detectScriptingEnv(): Promise<{
    preferred: string;
    available: string[];
}>;
export declare function getAvailableVoiceAsrScript(): Promise<string | null>;
/**
 * 检查是否存在语音兜底脚本，若有则可跳过飞书 ASR 直接执行
 * @deprecated 使用 getAvailableVoiceAsrScript() 获取具体路径
 */
export declare function hasVoiceAsrScript(): Promise<boolean>;
/**
 * 使用本地文件路径运行语音识别脚本（供 Telegram 等非飞书渠道使用）
 * 音频文件需已保存到工作区，传入相对路径如 .apexpanda/channel-voice/xxx.ogg
 */
export declare function recognizeVoiceFromLocalPath(relPath: string): Promise<{
    text: string;
    error?: string;
}>;
/**
 * 使用已有脚本识别语音（跳过飞书 ASR API，避免限频）
 * 支持 .py / .js / .sh / .ps1，按 getAvailableVoiceAsrScript 返回值执行
 * 环境变量 APEX_VOICE_INPUT=音频相对路径，或通过 args 传参
 */
export declare function recognizeVoiceByScript(options: {
    fileKey: string;
    messageId: string;
    /** 指定脚本路径时跳过 getAvailableVoiceAsrScript，供 UnrecognizedFileHandler 使用 */
    scriptPath?: string;
}): Promise<{
    text: string;
    error?: string;
    reason?: AsrFailureReason;
}>;
export declare function recognizeFeishuSpeech(options: {
    fileKey?: string;
    messageId?: string;
    audioBase64?: string;
    audioUrl?: string;
    /** 节点传入的音频格式，用于映射飞书 format */
    format?: string;
}): Promise<{
    text: string;
    error?: string;
    savedPath?: string;
    reason?: AsrFailureReason;
}>;
/**
 * 上传图片到飞书并回复图片消息
 * @param messageId 需要回复的消息 ID
 * @param filePath 本地图片绝对路径
 * @param caption 可选文字说明（单独发一条文字消息）
 */
export declare function replyFeishuImage(messageId: string, filePath: string, caption?: string): Promise<void>;
/**
 * 上传文件到飞书并回复文件消息
 * @param messageId 需要回复的消息 ID
 * @param filePath 本地文件绝对路径
 * @param mimeType 文件 MIME 类型
 * @param caption 可选文字说明
 */
export declare function replyFeishuFile(messageId: string, filePath: string, mimeType: string, caption?: string): Promise<void>;
//# sourceMappingURL=feishu-client.d.ts.map