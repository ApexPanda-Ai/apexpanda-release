import type { DocumentChunk, VectorStore } from './types.js';
export declare class LanceVectorStore implements VectorStore {
    private conn;
    private table;
    private dim;
    private initialized;
    private ensureInit;
    private getTable;
    list(): Promise<DocumentChunk[]>;
    clear(): Promise<void>;
    upsert(docs: DocumentChunk[]): Promise<void>;
    search(query: string, topK?: number): Promise<DocumentChunk[]>;
    delete(ids: string[]): Promise<void>;
    /** 更新指定 chunk 的向量（供 HybridSearchStore 后台 Embed 队列调用） */
    updateVector(chunk: DocumentChunk, vector: number[]): Promise<void>;
    /** 向量检索（供 EmbeddingVectorStore 调用） */
    vectorSearch(embedding: number[], topK?: number): Promise<DocumentChunk[]>;
}
//# sourceMappingURL=lance-store.d.ts.map