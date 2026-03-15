export function getChunkConfig() {
    const size = Number(process.env.APEXPANDA_CHUNK_SIZE);
    const overlap = Number(process.env.APEXPANDA_CHUNK_OVERLAP);
    const s = Number.isFinite(size) && size >= 100 ? Math.min(size, 2000) : 500;
    const o = Number.isFinite(overlap) && overlap >= 0 ? Math.min(overlap, Math.min(200, s - 1)) : 50;
    return { size: s, overlap: o };
}
export function getChunkStrategy() {
    const v = (process.env.APEXPANDA_CHUNK_STRATEGY ?? 'char').toLowerCase();
    if (v === 'heading' || v === 'case')
        return v;
    return 'char';
}
/** 按 Markdown 标题分块（## / ### / ####），保持章节完整 */
function chunkByHeading(text) {
    const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned)
        return [];
    const sections = [];
    const headingRe = /^(#{1,6})\s+(.+)$/gm;
    let lastEnd = 0;
    let lastSection = '';
    let m;
    const resetRe = () => {
        headingRe.lastIndex = 0;
    };
    resetRe();
    while ((m = headingRe.exec(cleaned)) !== null) {
        const start = m.index;
        if (start > lastEnd) {
            const slice = cleaned.slice(lastEnd, start).trim();
            if (slice)
                sections.push({ content: slice, section: lastSection || undefined });
        }
        lastSection = m[2].trim();
        lastEnd = start;
    }
    if (lastEnd < cleaned.length) {
        const slice = cleaned.slice(lastEnd).trim();
        if (slice)
            sections.push({ content: slice, section: lastSection || undefined });
    }
    if (sections.length === 0 && cleaned)
        sections.push({ content: cleaned });
    return sections;
}
/** 按「案例 N」或「案例 ID（wooyun-xxxx）」分块，保证每个案例完整 */
function chunkByCase(text) {
    const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned)
        return [];
    const caseRe = /(?:^|\n)(?:###\s*)?(?:案例\s*(\d+)|案例\s*ID[（(]\s*(wooyun-[a-zA-Z0-9-]+)\s*[)）])/gim;
    const sections = [];
    let lastEnd = 0;
    let lastSection = '';
    let m;
    while ((m = caseRe.exec(cleaned)) !== null) {
        const start = m.index;
        if (start > lastEnd) {
            const slice = cleaned.slice(lastEnd, start).trim();
            if (slice)
                sections.push({ content: slice, section: lastSection || undefined });
        }
        lastSection = m[1] ? `案例 ${m[1]}` : (m[2] ?? '');
        lastEnd = start;
    }
    if (lastEnd < cleaned.length) {
        const slice = cleaned.slice(lastEnd).trim();
        if (slice)
            sections.push({ content: slice, section: lastSection || undefined });
    }
    if (sections.length === 0 && cleaned)
        sections.push({ content: cleaned });
    return sections;
}
/** 短文档按行/段分块，避免 5 行被切成 10000 块（UTF-16 误解析等情况），返回 null 表示使用固定大小分块 */
function chunkByLinesOrParagraphs(text) {
    const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned)
        return [];
    const paras = cleaned.split(/\n\n+/);
    if (paras.length <= 50) {
        const result = paras.map((p) => p.trim()).filter(Boolean);
        return result.length > 0 ? result : null;
    }
    const lines = cleaned.split(/\n/);
    if (lines.length <= 100) {
        const result = lines.map((l) => l.trim()).filter(Boolean);
        return result.length > 0 ? result : null;
    }
    return null;
}
/** 将长文本按固定大小分块 */
function chunkText(text, chunkSize, overlap) {
    const cfg = getChunkConfig();
    const size = typeof chunkSize === 'number' && chunkSize >= 100 ? Math.min(chunkSize, 2000) : cfg.size;
    const o = typeof overlap === 'number' && overlap >= 0 ? Math.min(overlap, Math.min(200, size - 1)) : cfg.overlap;
    const cleaned = text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!cleaned)
        return [];
    const lineBased = chunkByLinesOrParagraphs(cleaned);
    if (lineBased !== null && lineBased.length <= 200) {
        return lineBased;
    }
    const chunks = [];
    let start = 0;
    while (start < cleaned.length && chunks.length < MAX_CHUNKS_PER_DOC) {
        let end = Math.min(start + size, cleaned.length);
        if (end < cleaned.length) {
            const lastSpace = cleaned.lastIndexOf(' ', end);
            if (lastSpace > start)
                end = lastSpace;
            else {
                const lastNewline = cleaned.lastIndexOf('\n', end);
                if (lastNewline > start)
                    end = lastNewline;
            }
        }
        const slice = cleaned.slice(start, end).trim();
        if (slice)
            chunks.push(slice);
        start = end - o;
        if (start >= cleaned.length)
            break;
    }
    return chunks;
}
/** 按策略获取分块结果（content + section 元数据） */
function getSegments(text, opts) {
    const strategy = opts?.strategy ?? getChunkStrategy();
    if (strategy === 'heading') {
        return chunkByHeading(text);
    }
    if (strategy === 'case') {
        return chunkByCase(text);
    }
    const cfg = getChunkConfig();
    const size = typeof opts?.size === 'number' && opts.size >= 100 ? Math.min(opts.size, 2000) : cfg.size;
    const overlap = typeof opts?.overlap === 'number' && opts.overlap >= 0 ? Math.min(opts.overlap, Math.min(200, size - 1)) : cfg.overlap;
    const raw = chunkText(text, size, overlap);
    return raw.map((content) => ({ content }));
}
/** PDF 最大 50MB，避免 Uint8Array 分配过大导致 Invalid array length */
const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** TXT/MD 最大 20MB，防止超大文本导致分块过多引发 RangeError */
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
/** 单文档最大 chunk 数，防止数组过大导致 Invalid array length */
const MAX_CHUNKS_PER_DOC = 10000;
/** 检测并解码文本（支持 UTF-8、UTF-16 LE/BE BOM，及无 BOM 的 UTF-16 启发式检测） */
function decodeBufferToText(buffer) {
    if (buffer.length > MAX_TEXT_BYTES || buffer.length <= 0) {
        throw new Error(`文本文件大小异常 (${buffer.length} bytes)，限制 1B–20MB`);
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.subarray(2).toString('utf16le');
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        const swapped = Buffer.from(buffer);
        swapped.swap16();
        return swapped.subarray(2).toString('utf16le');
    }
    return buffer.toString('utf-8');
}
/** 解析 PDF 并分块 */
export async function ingestPdf(buffer, docId, opts) {
    if (buffer.length > MAX_PDF_BYTES || buffer.length <= 0) {
        throw new Error(`PDF 大小异常 (${buffer.length} bytes)，限制 1B–50MB`);
    }
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
        const result = await parser.getText();
        const text = (result?.text ?? '').trim();
        if (!text)
            return [];
        const segments = getSegments(text, opts);
        const ts = Date.now();
        return segments.map((s, i) => ({
            id: `pdf-${docId}-${ts}-${i}`,
            content: s.content,
            metadata: { source: docId, ...(s.section && { section: s.section }) },
        }));
    }
    finally {
        await parser.destroy();
    }
}
/** 解析 TXT/MD 并分块 */
export function ingestText(content, docId, opts) {
    const text = content.replace(/\r\n/g, '\n').trim();
    if (!text)
        return [];
    const segments = getSegments(text, opts);
    if (segments.length > MAX_CHUNKS_PER_DOC) {
        throw new Error(`分块数量 ${segments.length} 超过单文档上限 ${MAX_CHUNKS_PER_DOC}，请增大 APEXPANDA_CHUNK_SIZE 或拆分文档`);
    }
    const ts = Date.now();
    return segments.map((s, i) => ({
        id: `txt-${docId}-${ts}-${i}`,
        content: s.content,
        metadata: { source: docId, ...(s.section && { section: s.section }) },
    }));
}
/** DOCX 为 ZIP 格式，文件头为 PK；旧版 .doc 为 OLE 格式，不支持 */
const DOCX_ZIP_HEADER = Buffer.from([0x50, 0x4b]);
/** 解析 DOCX 并分块（仅支持 .docx，不支持 .doc） */
export async function ingestDocx(buffer, docId, opts) {
    if (buffer.length < 2 || !buffer.subarray(0, 2).equals(DOCX_ZIP_HEADER)) {
        throw new Error('不是有效的 .docx 文件：文档可能已损坏，或为旧版 .doc 格式。请用 Word 等软件另存为 .docx 后重新上传。');
    }
    const mammoth = await import('mammoth');
    try {
        const result = await mammoth.extractRawText({ buffer });
        const text = (result.value ?? '').replace(/\r\n/g, '\n').trim();
        if (!text)
            return [];
        const segments = getSegments(text, opts);
        const ts = Date.now();
        return segments.map((s, i) => ({
            id: `docx-${docId}-${ts}-${i}`,
            content: s.content,
            metadata: { source: docId, ...(s.section && { section: s.section }) },
        }));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('central directory') || msg.includes('zip')) {
            throw new Error('无法解析 Word 文档：可能为旧版 .doc 格式或文件已损坏，请另存为 .docx 后上传。');
        }
        throw e;
    }
}
/** 解析 XLSX 并分块（首个 Sheet，转为表格文本） */
export async function ingestXlsx(buffer, docId, opts) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer', cellText: true });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet)
        return [];
    const ws = wb.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const text = rows.slice(0, 1000).map((r) => (Array.isArray(r) ? r.map(String).join(',') : JSON.stringify(r))).join('\n');
    if (!text.trim())
        return [];
    const segments = getSegments(text, opts);
    const ts = Date.now();
    return segments.map((s, i) => ({
        id: `xlsx-${docId}-${ts}-${i}`,
        content: s.content,
        metadata: { source: docId, ...(s.section && { section: s.section }) },
    }));
}
/** 解析 HTML 并分块（提取正文，去除脚本样式） */
export async function ingestHtml(html, docId, opts) {
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    $('script, style, nav, footer').remove();
    const text = ($('body').text() || $('html').text() || html).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    if (!text)
        return [];
    const segments = getSegments(text, opts);
    const ts = Date.now();
    return segments.map((s, i) => ({
        id: `html-${docId}-${ts}-${i}`,
        content: s.content,
        metadata: { source: docId, ...(s.section && { section: s.section }) },
    }));
}
/** 从 URL 抓取网页并分块导入 */
export async function ingestFromUrl(url, opts) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('URL 必须以 http:// 或 https:// 开头');
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok)
        throw new Error(`请求失败: ${res.status} ${res.statusText}`);
    const docId = url.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80);
    const html = await res.text();
    return ingestHtml(html, docId, opts);
}
/** 根据文件扩展名选择解析器 */
export async function ingestDocument(buffer, filename, opts) {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    const docId = filename.replace(/\s+/g, '-').slice(0, 80);
    if (ext === 'pdf')
        return ingestPdf(buffer, docId, opts);
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
        return ingestText(decodeBufferToText(buffer), docId, opts);
    }
    if (ext === 'docx')
        return ingestDocx(buffer, docId, opts);
    if (ext === 'doc') {
        throw new Error('旧版 .doc 格式不支持，请用 Word 等软件另存为 .docx 后上传。');
    }
    if (ext === 'xlsx' || ext === 'xls')
        return ingestXlsx(buffer, docId, opts);
    if (ext === 'html' || ext === 'htm') {
        return ingestHtml(decodeBufferToText(buffer), docId, opts);
    }
    throw new Error(`Unsupported format: .${ext}. Use .pdf, .txt, .md, .docx (not .doc), .xlsx, .html`);
}
//# sourceMappingURL=document-ingest.js.map