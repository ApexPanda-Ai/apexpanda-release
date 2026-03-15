export interface RecognizeResult {
    text: string;
    error?: string;
    provider?: 'feishu' | 'aliyun' | 'xunfei';
    /** 飞书失败时保存的音频路径，供 Agent 兜底 */
    savedPath?: string;
}
/** 将 webm/opus/m4a/wav 等转换为 PCM 16kHz mono 16bit（需 ffmpeg）；pcm 直接解码返回 */
export declare function convertToPcm16k(audioBase64: string, inputFormat: string): Promise<Buffer | null>;
/** 带回退链的语音识别：飞书 → 阿里云 → 讯飞
 * @param options.instanceId 方案 B：多实例时传入实例 ID */
export declare function recognizeWithFallback(options: {
    audioBase64?: string;
    format?: string;
    fileKey?: string;
    messageId?: string;
    instanceId?: string;
}): Promise<RecognizeResult>;
//# sourceMappingURL=asr-fallback.d.ts.map