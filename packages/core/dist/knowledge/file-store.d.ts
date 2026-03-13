import type { DocumentChunk, VectorStore } from './types.js';
export declare class FileVectorStore implements VectorStore {
    private chunks;
    private loaded;
    private static readonly MAX_FILE_SIZE;
    private ensureLoaded;
    private save;
    list(): Promise<DocumentChunk[]>;
    clear(): Promise<void>;
    upsert(docs: DocumentChunk[]): Promise<void>;
    search(query: string, topK?: number): Promise<DocumentChunk[]>;
    delete(ids: string[]): Promise<void>;
}
//# sourceMappingURL=file-store.d.ts.map