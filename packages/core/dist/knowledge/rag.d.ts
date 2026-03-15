/**
 * RAG 检索流程
 * 语义检索 -> (可选 Rerank) -> 构建增强 Prompt
 */
import type { DocumentChunk, RAGConfig } from './types.js';
export declare function retrieve(config: RAGConfig, query: string): Promise<DocumentChunk[]>;
export declare function buildContext(chunks: DocumentChunk[]): string;
/** 构建引用来源列表，供前端展示 */
export declare function buildSources(chunks: DocumentChunk[]): Array<{
    id: string;
    content: string;
    source?: string;
}>;
//# sourceMappingURL=rag.d.ts.map