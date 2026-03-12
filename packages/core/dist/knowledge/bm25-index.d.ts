import type { DocumentChunk } from './types.js';
/**
 * 分词：英文/数字整词 + 中文 bigram
 * 示例：CVE-2021-44228 远程代码执行 → ["CVE-2021-44228", "远程", "程代", "代码", "码执", "执行", "行漏", "漏洞"]
 */
export declare function tokenize(text: string): string[];
export interface BM25Options {
    k1?: number;
    b?: number;
}
export declare class BM25Index {
    private docCount;
    private avgDocLen;
    private docLens;
    private docTokens;
    private docChunks;
    private termDocFreq;
    private termFreqInDoc;
    private readonly k1;
    private readonly b;
    constructor(options?: BM25Options);
    /** 增量更新：删除旧文档，添加新文档 */
    update(chunks: DocumentChunk[]): void;
    /** 按 ID 删除文档 */
    delete(ids: string[]): void;
    private remove;
    private recomputeStats;
    /** 清空索引 */
    clear(): void;
    /** 全量重建（从 chunks 列表） */
    rebuild(chunks: DocumentChunk[]): void;
    /**
     * 检索，返回按 BM25 分数排序的 chunk 列表（含 content、metadata）
     */
    search(query: string, topK: number): DocumentChunk[];
    /** 返回当前索引中的文档 ID 集合 */
    getDocIds(): Set<string>;
    get docCountValue(): number;
    /** 序列化为可 JSON 的结构（供持久化） */
    toJSON(): BM25Serialized;
    /** 持久化到文件 */
    save(path: string): Promise<void>;
    /** 从序列化结构恢复 */
    static fromJSON(data: BM25Serialized): BM25Index;
    /** 从文件加载 */
    static load(path: string): Promise<BM25Index | null>;
}
export interface BM25Serialized {
    v: number;
    k1: number;
    b: number;
    docCount: number;
    avgDocLen: number;
    docLens: Record<string, number>;
    docTokens: Record<string, string[]>;
    docChunks: Record<string, DocumentChunk>;
    termDocFreq: Record<string, string[]>;
    termFreqInDoc: Record<string, Record<string, number>>;
}
//# sourceMappingURL=bm25-index.d.ts.map