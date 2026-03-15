/**
 * BM25 倒排索引
 * 纯 JavaScript 实现，零外部依赖
 * 中文 bigram 分词，英文/数字整词保留
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
/** 常见停用词（简短过滤） */
const STOP_WORDS = new Set(['的', '是', '在', '了', '和', '与', '或', '一个', '有', '这', '那', '它', '他', '她']);
/**
 * 分词：英文/数字整词 + 中文 bigram
 * 示例：CVE-2021-44228 远程代码执行 → ["CVE-2021-44228", "远程", "程代", "代码", "码执", "执行", "行漏", "漏洞"]
 */
export function tokenize(text) {
    if (!text || typeof text !== 'string')
        return [];
    const tokens = [];
    let i = 0;
    const s = text.trim();
    const len = s.length;
    while (i < len) {
        const c = s[i];
        const code = c.charCodeAt(0);
        // 英文、数字、连字符（CVE-xxx）
        if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '-') {
            let j = i;
            while (j < len) {
                const cc = s[j].charCodeAt(0);
                if ((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || s[j] === '-' || s[j] === '_') {
                    j++;
                }
                else
                    break;
            }
            const word = s.slice(i, j).toLowerCase();
            if (word.length >= 2)
                tokens.push(word);
            i = j;
            continue;
        }
        // 中文字符（CJK 范围），bigram
        if (code >= 0x4e00 && code <= 0x9fff) {
            let j = i;
            while (j < len && s[j].charCodeAt(0) >= 0x4e00 && s[j].charCodeAt(0) <= 0x9fff)
                j++;
            const seg = s.slice(i, j);
            for (let k = 0; k < seg.length - 1; k++) {
                const bigram = seg[k] + seg[k + 1];
                if (!STOP_WORDS.has(bigram))
                    tokens.push(bigram);
            }
            i = j;
            continue;
        }
        i++;
    }
    return [...new Set(tokens)];
}
export class BM25Index {
    docCount = 0;
    avgDocLen = 0;
    docLens = new Map();
    docTokens = new Map();
    docChunks = new Map();
    termDocFreq = new Map();
    termFreqInDoc = new Map();
    k1;
    b;
    constructor(options = {}) {
        this.k1 = options.k1 ?? 1.2;
        this.b = options.b ?? 0.75;
    }
    /** 增量更新：删除旧文档，添加新文档 */
    update(chunks) {
        if (chunks.length === 0)
            return;
        const ids = new Set(chunks.map((c) => c.id));
        for (const id of ids) {
            this.remove(id);
        }
        for (const c of chunks) {
            const toks = tokenize(c.content ?? '');
            this.docTokens.set(c.id, toks);
            this.docLens.set(c.id, toks.length);
            this.docChunks.set(c.id, { id: c.id, content: c.content ?? '', metadata: c.metadata });
            for (const t of toks) {
                if (!this.termDocFreq.has(t))
                    this.termDocFreq.set(t, new Set());
                this.termDocFreq.get(t).add(c.id);
                if (!this.termFreqInDoc.has(t))
                    this.termFreqInDoc.set(t, new Map());
                const m = this.termFreqInDoc.get(t);
                m.set(c.id, (m.get(c.id) ?? 0) + 1);
            }
        }
        this.recomputeStats();
    }
    /** 按 ID 删除文档 */
    delete(ids) {
        for (const id of ids)
            this.remove(id);
    }
    remove(id) {
        const toks = this.docTokens.get(id);
        if (!toks)
            return;
        this.docTokens.delete(id);
        this.docLens.delete(id);
        this.docChunks.delete(id);
        for (const t of toks) {
            this.termDocFreq.get(t)?.delete(id);
            this.termFreqInDoc.get(t)?.delete(id);
        }
        this.recomputeStats();
    }
    recomputeStats() {
        const lens = [...this.docLens.values()];
        this.docCount = lens.length;
        this.avgDocLen = lens.length > 0 ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    }
    /** 清空索引 */
    clear() {
        this.docCount = 0;
        this.avgDocLen = 0;
        this.docLens.clear();
        this.docTokens.clear();
        this.docChunks.clear();
        this.termDocFreq.clear();
        this.termFreqInDoc.clear();
    }
    /** 全量重建（从 chunks 列表） */
    rebuild(chunks) {
        this.clear();
        this.update(chunks);
    }
    /**
     * 检索，返回按 BM25 分数排序的 chunk 列表（含 content、metadata）
     */
    search(query, topK) {
        const qToks = tokenize(query);
        if (qToks.length === 0 || this.docCount === 0)
            return [];
        const scores = new Map();
        const N = this.docCount;
        const avgdl = this.avgDocLen;
        for (const t of qToks) {
            const df = this.termDocFreq.get(t)?.size ?? 0;
            const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
            const tfMap = this.termFreqInDoc.get(t);
            if (!tfMap)
                continue;
            const docIds = this.termDocFreq.get(t);
            if (!docIds)
                continue;
            for (const docId of docIds) {
                const tf = tfMap.get(docId) ?? 0;
                const docLen = this.docLens.get(docId) ?? 0;
                const norm = 1 - this.b + this.b * (docLen / (avgdl || 1));
                const score = idf * (tf * (this.k1 + 1)) / (tf + this.k1 * norm);
                scores.set(docId, (scores.get(docId) ?? 0) + score);
            }
        }
        const sorted = [...scores.entries()]
            .filter(([, s]) => s > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, topK);
        const out = [];
        for (const [id, score] of sorted) {
            const c = this.docChunks.get(id);
            if (c)
                out.push({ ...c, score });
        }
        return out;
    }
    /** 返回当前索引中的文档 ID 集合 */
    getDocIds() {
        return new Set(this.docTokens.keys());
    }
    get docCountValue() {
        return this.docCount;
    }
    /** 序列化为可 JSON 的结构（供持久化） */
    toJSON() {
        const termDocFreq = {};
        for (const [t, set] of this.termDocFreq) {
            termDocFreq[t] = [...set];
        }
        const termFreqInDoc = {};
        for (const [t, m] of this.termFreqInDoc) {
            termFreqInDoc[t] = Object.fromEntries(m);
        }
        const docLens = Object.fromEntries(this.docLens);
        const docTokens = Object.fromEntries(this.docTokens);
        const docChunks = Object.fromEntries(this.docChunks);
        return {
            v: 1,
            k1: this.k1,
            b: this.b,
            docCount: this.docCount,
            avgDocLen: this.avgDocLen,
            docLens,
            docTokens,
            docChunks,
            termDocFreq,
            termFreqInDoc,
        };
    }
    /** 持久化到文件 */
    async save(path) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(this.toJSON()), 'utf-8');
    }
    /** 从序列化结构恢复 */
    static fromJSON(data) {
        const idx = new BM25Index({ k1: data.k1, b: data.b });
        idx.docCount = data.docCount;
        idx.avgDocLen = data.avgDocLen;
        idx.docLens = new Map(Object.entries(data.docLens ?? {}));
        idx.docTokens = new Map(Object.entries(data.docTokens ?? {}));
        idx.docChunks = new Map(Object.entries(data.docChunks ?? {}));
        idx.termDocFreq = new Map(Object.entries(data.termDocFreq ?? {}).map(([t, arr]) => [t, new Set(arr)]));
        idx.termFreqInDoc = new Map(Object.entries(data.termFreqInDoc ?? {}).map(([t, obj]) => [t, new Map(Object.entries(obj))]));
        return idx;
    }
    /** 从文件加载 */
    static async load(path) {
        try {
            const raw = await readFile(path, 'utf-8');
            const data = JSON.parse(raw);
            if (data?.v !== 1 || !data.docChunks)
                return null;
            return BM25Index.fromJSON(data);
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=bm25-index.js.map