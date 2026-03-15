/**
 * 知识库 / RAG 类型定义
 */
export interface DocumentChunk {
    id: string;
    content: string;
    metadata?: Record<string, unknown>;
    score?: number;
    /** 向量 embedding（语义检索时由 EmbeddingVectorStore 填充） */
    embedding?: number[];
}
export interface VectorStore {
    /** 插入文档块 */
    upsert(chunks: DocumentChunk[]): Promise<void>;
    /** 语义检索 */
    search(query: string, topK?: number): Promise<DocumentChunk[]>;
    /** 按 ID 删除 */
    delete(ids: string[]): Promise<void>;
    /** 更新指定 chunk 的向量（可选，供 HybridSearchStore 后台队列调用，需传入完整 chunk 以保留 content/metadata） */
    updateVector?(chunk: DocumentChunk, vector: number[]): Promise<void>;
}
export interface RAGConfig {
    vectorStore: VectorStore;
    topK?: number;
    rerank?: (query: string, chunks: DocumentChunk[]) => Promise<DocumentChunk[]>;
}
//# sourceMappingURL=types.d.ts.map