import type { DocumentChunk, VectorStore } from './types.js';
export declare class HybridSearchStore implements VectorStore {
    private lance;
    private bm25;
    private embedQueue;
    private bm25Ready;
    private initPromise;
    private persistTimer;
    constructor();
    private ensureBm25FromLance;
    private schedulePersist;
    list(): Promise<DocumentChunk[]>;
    clear(): Promise<void>;
    upsert(docs: DocumentChunk[]): Promise<void>;
    search(query: string, topK?: number): Promise<DocumentChunk[]>;
    delete(ids: string[]): Promise<void>;
}
//# sourceMappingURL=hybrid-store.d.ts.map