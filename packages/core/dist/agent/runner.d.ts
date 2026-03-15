/**
 * Agent 核心：消息 -> LLM -> (Tool Call) -> 回复
 * 支持 RAG 知识库增强与 Skill 工具调用
 */
import type { LLMProvider } from '../llm/types.js';
import type { VectorStore } from '../knowledge/types.js';
export interface AgentConfig {
    /** 可选；不传时由 runner 按 effectiveModel 内部获取 */
    llm?: LLMProvider;
    knowledgeStore?: VectorStore;
    topK?: number;
    enableTools?: boolean;
    model?: string;
    systemPrompt?: string;
    /** Worker Agent IDs for Supervisor-Worker mode */
    workerIds?: string[];
    /** 该 Agent 可用的 MCP Server ID 列表；undefined/null=全部，[]=无 MCP 工具 */
    mcpServerIds?: string[] | null;
    /** 该 Agent 可用的 Skill 名称列表；undefined/null=全部，[]=无 Skill 工具 */
    skillIds?: string[] | null;
    /** 是否注入设备节点工具；undefined/true=注入（默认），false=不注入 */
    nodeToolsEnabled?: boolean;
    /**
     * 当前委托深度，用于防止无限递归。
     * 0 = 主控（顶层）；1 = 一级 Worker；2 = 二级 Worker（不再往下委托）。
     * 不传时视为 0。
     */
    delegationDepth?: number;
}
export interface AgentInput {
    message: string;
    sessionId?: string;
    history?: Array<{
        role: string;
        content: string;
    }>;
    /** Phase 5: 细粒度 scope 提示，如 user:xxx、group:yyy */
    memoryScopeHint?: string;
    /** Phase 7: 当前 Agent ID，用于 memory scope 推导 */
    agentId?: string;
    /** Phase 7: 当前 Agent 记忆可见性，由调用方（server.ts）预解析传入 */
    agentMemoryVisibility?: 'shared' | 'agent-only';
    /** Phase 7: 当前用户 ID，群组 agent-only 场景三维 scope 隔离需要 */
    userId?: string;
    /** 渠道进度回调：当 content 以冒号结尾且含 tool call 时，推送中间进展到渠道（仅渠道调用时传入） */
    onProgress?: (message: string) => void | Promise<void>;
    /** 删除操作来源：user/channel=需二次确认，agent=不弹确认；默认 agent */
    deleteSource?: 'user' | 'channel' | 'agent';
}
export interface RAGSource {
    id: string;
    content: string;
    source?: string;
}
export interface FileReply {
    fileType: 'image' | 'file' | 'audio' | 'video';
    filePath: string;
    mimeType: string;
    caption?: string;
}
export interface AgentOutput {
    reply: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
    model?: string;
    sources?: RAGSource[];
    /** 文件直通：工具产生文件时跳过 LLM，直接发给渠道（单文件） */
    fileReply?: FileReply;
    /** 文件直通：多文件情形 */
    fileReplies?: FileReply[];
}
export declare function runAgent(config: AgentConfig, input: AgentInput): Promise<AgentOutput>;
//# sourceMappingURL=runner.d.ts.map