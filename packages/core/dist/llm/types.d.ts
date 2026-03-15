/**
 * LLM 接入层类型
 * 支持 OpenAI 兼容 API（DeepSeek / 通义 / Claude 等）
 */
export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/** 工具结果消息（OpenAI tool role） */
export interface LLMToolMessage {
    role: 'tool';
    content: string;
    tool_call_id?: string;
}
export interface LLMTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters?: object;
    };
}
export interface LLMToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface LLMCompletionOptions {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    tools?: LLMTool[];
}
export interface LLMCompletionResult {
    content: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    toolCalls?: LLMToolCall[];
}
export interface LLMProvider {
    id: string;
    complete(messages: Array<LLMMessage | LLMToolMessage | Record<string, unknown>>, options?: LLMCompletionOptions): Promise<LLMCompletionResult>;
}
//# sourceMappingURL=types.d.ts.map