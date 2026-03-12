/**
 * 文档导入：PDF / TXT / MD 解析并分块
 */
import type { DocumentChunk } from './types.js';
export type ChunkStrategy = 'char' | 'heading' | 'case';
export declare function getChunkConfig(): {
    size: number;
    overlap: number;
};
export declare function getChunkStrategy(): ChunkStrategy;
export interface ChunkOptions {
    size?: number;
    overlap?: number;
    strategy?: ChunkStrategy;
}
/** 解析 PDF 并分块 */
export declare function ingestPdf(buffer: Buffer, docId: string, opts?: ChunkOptions): Promise<DocumentChunk[]>;
/** 解析 TXT/MD 并分块 */
export declare function ingestText(content: string, docId: string, opts?: ChunkOptions): DocumentChunk[];
/** 解析 DOCX 并分块（仅支持 .docx，不支持 .doc） */
export declare function ingestDocx(buffer: Buffer, docId: string, opts?: ChunkOptions): Promise<DocumentChunk[]>;
/** 解析 XLSX 并分块（首个 Sheet，转为表格文本） */
export declare function ingestXlsx(buffer: Buffer, docId: string, opts?: ChunkOptions): Promise<DocumentChunk[]>;
/** 解析 HTML 并分块（提取正文，去除脚本样式） */
export declare function ingestHtml(html: string, docId: string, opts?: ChunkOptions): Promise<DocumentChunk[]>;
/** 从 URL 抓取网页并分块导入 */
export declare function ingestFromUrl(url: string, opts?: ChunkOptions): Promise<DocumentChunk[]>;
/** 根据文件扩展名选择解析器 */
export declare function ingestDocument(buffer: Buffer, filename: string, opts?: ChunkOptions): Promise<DocumentChunk[]>;
//# sourceMappingURL=document-ingest.d.ts.map