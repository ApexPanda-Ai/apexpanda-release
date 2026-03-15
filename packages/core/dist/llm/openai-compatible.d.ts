/**
 * OpenAI 兼容 API 提供者
 * 适用于 DeepSeek / 通义千问 / GPT / Claude（通过 OpenAI 兼容端点）
 */
import type { LLMProvider } from './types.js';
export interface OpenAICompatibleConfig {
    baseUrl: string;
    apiKey: string;
    defaultModel?: string;
    /** 主模型失败时自动切换的备用模型（故障转移） */
    fallbackModel?: string;
    /** 备用模型使用独立 endpoint 时传入（跨提供商故障转移） */
    fallbackEndpoint?: {
        baseUrl: string;
        apiKey: string;
    };
}
/** 移除 content 中可能泄露的 tool call XML，避免发往渠道时报 230001 */
export declare function stripToolCallXmlFromContent(content: string): string;
export declare function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LLMProvider;
//# sourceMappingURL=openai-compatible.d.ts.map