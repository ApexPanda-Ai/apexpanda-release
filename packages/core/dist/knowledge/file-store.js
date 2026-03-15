/**
 * 文件持久化向量存储
 * APEXPANDA_KNOWLEDGE_PERSIST=true 时使用，数据写入 .apexpanda/knowledge.json
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logMem } from '../debug-mem.js';
function getKnowledgePath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'knowledge.json');
}
export class FileVectorStore {
    chunks = new Map();
    loaded = false;
    static MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB，防止超大 knowledge.json 导致 OOM
    async ensureLoaded() {
        if (this.loaded)
            return;
        const path = getKnowledgePath();
        try {
            const st = await stat(path).catch(() => null);
            logMem('file-store:ensureLoaded:stat', { exists: !!st, sizeKB: st ? Math.round(st.size / 1024) : 0 });
            if (st && st.size > FileVectorStore.MAX_FILE_SIZE) {
                throw new Error(`knowledge.json 过大 (${(st.size / 1024 / 1024).toFixed(1)}MB)，超过 50MB 限制，可能导致 OOM。请先清空或拆分知识库。`);
            }
            const raw = await readFile(path, 'utf-8');
            logMem('file-store:ensureLoaded:after-read', { rawKB: Math.round(raw.length / 1024) });
            let arr;
            try {
                arr = JSON.parse(raw);
            }
            catch (e) {
                if (e instanceof RangeError)
                    throw new Error(`knowledge.json 解析失败 (可能数据过大): ${e.message}`);
                throw e;
            }
            if (!Array.isArray(arr))
                arr = [];
            this.chunks.clear();
            for (const c of arr) {
                if (c?.id && c?.content)
                    this.chunks.set(c.id, c);
            }
            logMem('file-store:ensureLoaded:after-parse', { chunks: this.chunks.size });
        }
        catch (e) {
            // 文件不存在或格式错误
            logMem('file-store:ensureLoaded:catch', { error: String(e) });
        }
        this.loaded = true;
    }
    async save() {
        const path = getKnowledgePath();
        const arr = Array.from(this.chunks.values());
        const str = JSON.stringify(arr);
        logMem('file-store:save:before-write', { chunks: arr.length, jsonKB: Math.round(str.length / 1024) });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, str, 'utf-8');
        logMem('file-store:save:after-write');
    }
    async list() {
        await this.ensureLoaded();
        return Array.from(this.chunks.values());
    }
    async clear() {
        await this.ensureLoaded();
        this.chunks.clear();
        await this.save();
    }
    async upsert(docs) {
        await this.ensureLoaded();
        for (const d of docs) {
            this.chunks.set(d.id, { ...d });
        }
        await this.save();
    }
    async search(query, topK = 5) {
        await this.ensureLoaded();
        const q = query.toLowerCase();
        const scored = Array.from(this.chunks.values()).map((c) => {
            const content = (c.content ?? '').toLowerCase();
            let score = 0;
            for (const word of q.split(/\s+/)) {
                if (word && content.includes(word))
                    score += 1;
            }
            return { ...c, score };
        });
        scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return scored.slice(0, topK).filter((c) => (c.score ?? 0) > 0);
    }
    async delete(ids) {
        await this.ensureLoaded();
        for (const id of ids)
            this.chunks.delete(id);
        await this.save();
    }
}
//# sourceMappingURL=file-store.js.map