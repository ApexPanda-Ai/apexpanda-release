/**
 * 无法识别文件的兜底处理抽象
 * 用于语音、图片、文档等类型的「主识别失败 → 脚本兜底」统一流程
 * @see docs/渠道文件识别兜底方案分析与改进.md 方案三
 */
export type UnrecognizedFailureReason = 'rate_limit' | 'script_failed' | 'download_failed' | 'api_error' | 'unknown';
export interface UnrecognizedFileResult {
    text: string;
    error?: string;
    savedPath?: string;
    reason?: UnrecognizedFailureReason;
}
export interface UnrecognizedFileHandler {
    type: 'voice' | 'image' | 'document' | 'unknown';
    /** 兜底脚本候选路径（相对工作区），按优先级排序 */
    fallbackScriptPaths: readonly string[];
    /** 检查是否存在可用的兜底脚本 */
    scriptExistsChecker: () => Promise<boolean>;
    /** 执行兜底脚本，context 含类型特定参数（如 voice: fileKey, messageId） */
    runScript: (scriptPath: string, context: Record<string, unknown>) => Promise<UnrecognizedFileResult>;
    /** 主识别能力（平台 API 或内置 Skill） */
    primaryRecognizer: (input: unknown) => Promise<UnrecognizedFileResult>;
    /** 构建 Agent 兜底指令消息 */
    buildAgentFallbackMessage: (savedPath: string, reason: string, workspaceDir: string) => Promise<string>;
    /** 根据失败原因返回用户提示文案 */
    getUserPrompt: (reason?: UnrecognizedFailureReason) => string;
}
/**
 * 注册无法识别文件处理器
 */
export declare function registerUnrecognizedHandler(handler: UnrecognizedFileHandler): void;
/**
 * 获取已注册的处理器
 */
export declare function getUnrecognizedHandler(type: string): UnrecognizedFileHandler | undefined;
/**
 * 执行兜底流程：先检查脚本 → 有则执行脚本，无/失败则主识别 → 失败则返回带 savedPath 的结果供 Agent 兜底
 */
export declare function runUnrecognizedFallback(type: 'voice' | 'image' | 'document', input: unknown, context?: Record<string, unknown>): Promise<UnrecognizedFileResult>;
/** 初始化内置处理器（语音），需在首次使用前调用 */
export declare function initBuiltinHandlers(): Promise<void>;
//# sourceMappingURL=unrecognized-handler.d.ts.map