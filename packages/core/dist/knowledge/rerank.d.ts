/**
 * RAG Rerank 默认实现
 * 支持本地（Xenova/bge-reranker-base）、Cohere、Jina API
 */
import type { DocumentChunk } from './types.js';
export interface RerankConfig {
    enabled?: boolean;
    provider?: 'local' | 'cohere' | 'jina';
    model?: string;
    topK?: number;
    apiKey?: string;
}
/** 根据配置创建 Rerank 函数，未启用或配置无效时返回 null */
export declare function createRerank(config: RerankConfig | null | undefined): ((query: string, chunks: DocumentChunk[]) => Promise<DocumentChunk[]>) | null;
//# sourceMappingURL=rerank.d.ts.map