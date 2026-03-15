/**
 * 内存向量存储（开发/测试用）
 * 生产环境可替换为 Milvus/Qdrant/PGVector
 */
import type { DocumentChunk, VectorStore } from './types.js';
export declare class MemoryVectorStore implements VectorStore {
    private chunks;
    list(): Promise<DocumentChunk[]>;
    clear(): Promise<void>;
    upsert(docs: DocumentChunk[]): Promise<void>;
    search(query: string, topK?: number): Promise<DocumentChunk[]>;
    delete(ids: string[]): Promise<void>;
}
//# sourceMappingURL=memory-store.d.ts.map