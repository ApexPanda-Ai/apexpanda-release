/**
 * 带 Embedding 的向量存储包装
 * 入库时调用 embedding API，检索时按余弦相似度排序
 */
import type { DocumentChunk, VectorStore } from './types.js';
export declare class EmbeddingVectorStore implements VectorStore {
    private base;
    constructor(base: VectorStore);
    list(): Promise<DocumentChunk[]>;
    clear(): Promise<void>;
    upsert(docs: DocumentChunk[]): Promise<void>;
    search(query: string, topK?: number): Promise<DocumentChunk[]>;
    delete(ids: string[]): Promise<void>;
}
export declare function wrapWithEmbeddingIfEnabled(store: VectorStore): VectorStore;
//# sourceMappingURL=embedding-store.d.ts.map