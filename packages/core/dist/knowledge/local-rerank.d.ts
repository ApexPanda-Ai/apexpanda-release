/**
 * 本地 Rerank 封装
 * 使用 @huggingface/transformers + Xenova/bge-reranker-base
 * Cross-Encoder，完全离线
 */
import type { DocumentChunk } from './types.js';
/**
 * 对候选 chunks 按 query 相关性重排
 */
export declare function localRerank(query: string, chunks: DocumentChunk[], topK?: number): Promise<DocumentChunk[]>;
//# sourceMappingURL=local-rerank.d.ts.map