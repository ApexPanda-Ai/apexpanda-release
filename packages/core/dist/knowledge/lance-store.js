/**
 * LanceDB 向量存储
 * 替代 knowledge.json，支持大规模向量检索
 */
import { connect, makeArrowTable } from '@lancedb/lancedb';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const TABLE_NAME = 'chunks';
const DEFAULT_DIM = 1536;
/** 混合检索模式下本地 bge-small-zh 维度 */
const HYBRID_DIM = 512;
let _arrow = null;
async function getArrow() {
    if (!_arrow)
        _arrow = await import('apache-arrow');
    return _arrow;
}
function getLancePath() {
    const env = process.env.APEXPANDA_KNOWLEDGE_LANCE_PATH;
    if (env?.trim())
        return env.trim();
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'knowledge.lance');
}
function getMetaPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'knowledge-meta.json');
}
async function loadMeta() {
    try {
        const raw = await readFile(getMetaPath(), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return { store: 'lance' };
    }
}
async function saveMeta(meta) {
    const path = getMetaPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(meta, null, 2), 'utf-8');
}
async function makeSchema(dim) {
    const { Field, Schema, Utf8, Float32, FixedSizeList } = await getArrow();
    return new Schema([
        new Field('id', new Utf8(), false),
        new Field('content', new Utf8(), false),
        new Field('vector', new FixedSizeList(dim, new Field('item', new Float32(), false)), false),
        new Field('metadata', new Utf8(), false),
    ]);
}
function chunkToRow(c, dim) {
    const emb = c.embedding;
    const vec = Array.isArray(emb) && emb.length === dim
        ? emb
        : Array.from({ length: dim }, () => 0);
    return {
        id: c.id,
        content: c.content ?? '',
        vector: vec,
        metadata: JSON.stringify(c.metadata ?? {}),
    };
}
function rowToChunk(row) {
    let metadata = {};
    try {
        if (typeof row.metadata === 'string')
            metadata = JSON.parse(row.metadata);
    }
    catch {
        /* ignore */
    }
    let embedding;
    if (Array.isArray(row.vector))
        embedding = row.vector;
    const chunk = {
        id: String(row.id ?? ''),
        content: String(row.content ?? ''),
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
    if (embedding && embedding.length > 0)
        chunk.embedding = embedding;
    if (typeof row._distance === 'number')
        chunk.score = 1 / (1 + row._distance);
    return chunk;
}
let upsertQueue = Promise.resolve();
export class LanceVectorStore {
    conn = null;
    table = null;
    dim = DEFAULT_DIM;
    initialized = false;
    async ensureInit() {
        if (this.initialized && this.conn)
            return this.conn;
        const path = getLancePath();
        await mkdir(dirname(path), { recursive: true });
        this.conn = await connect(path);
        const names = await this.conn.tableNames();
        if (names.includes(TABLE_NAME)) {
            this.table = await this.conn.openTable(TABLE_NAME);
            const meta = await loadMeta();
            if (typeof meta.vectorDim === 'number')
                this.dim = meta.vectorDim;
        }
        else {
            const meta = await loadMeta();
            const envDim = process.env.APEXPANDA_KNOWLEDGE_VECTOR_DIM;
            const dimFromEnv = envDim ? parseInt(envDim, 10) : NaN;
            this.dim = Number.isFinite(dimFromEnv) ? dimFromEnv : (meta.vectorDim ?? (process.env.APEXPANDA_HYBRID_SEARCH_ENABLED !== 'false' ? HYBRID_DIM : DEFAULT_DIM));
            const schema = await makeSchema(this.dim);
            await this.conn.createEmptyTable(TABLE_NAME, schema, { mode: 'create' });
            await saveMeta({ store: 'lance', vectorDim: this.dim });
            this.table = await this.conn.openTable(TABLE_NAME);
        }
        this.initialized = true;
        return this.conn;
    }
    async getTable() {
        await this.ensureInit();
        if (!this.table)
            throw new Error('LanceDB table not initialized');
        return this.table;
    }
    async list() {
        try {
            const tbl = await this.getTable();
            const out = [];
            for await (const batch of tbl.query().select(['id', 'content', 'vector', 'metadata'])) {
                const n = batch.numRows ?? 0;
                for (let i = 0; i < n; i++) {
                    const row = batch.get(i);
                    if (!row)
                        continue;
                    out.push(rowToChunk(row));
                }
            }
            return out;
        }
        catch (e) {
            console.warn('[Knowledge] 知识库读取失败，已降级为空列表。', e instanceof Error ? e.message : e);
            return [];
        }
    }
    async clear() {
        const conn = await this.ensureInit();
        const names = await conn.tableNames();
        if (names.includes(TABLE_NAME)) {
            await conn.dropTable(TABLE_NAME);
            const schema = await makeSchema(this.dim);
            await conn.createEmptyTable(TABLE_NAME, schema, { mode: 'create' });
            this.table = await conn.openTable(TABLE_NAME);
        }
    }
    async upsert(docs) {
        if (docs.length === 0)
            return;
        const firstWithEmb = docs.find((d) => Array.isArray(d.embedding) && d.embedding.length > 0);
        const dim = firstWithEmb?.embedding?.length ?? this.dim;
        if (firstWithEmb && dim !== this.dim && this.initialized) {
            throw new Error(`向量维度不一致：当前 ${this.dim}，新数据 ${dim}。请清空知识库后重新导入，或使用相同 embedding 模型。`);
        }
        if (firstWithEmb && !this.initialized) {
            this.dim = dim;
            await saveMeta({ store: 'lance', vectorDim: dim });
        }
        const prev = upsertQueue;
        upsertQueue = prev.then(async () => {
            const tbl = await this.getTable();
            const ids = docs.map((d) => d.id);
            if (ids.length > 0) {
                const escaped = ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
                await tbl.delete(`id IN (${escaped})`);
            }
            const rows = docs.map((d) => chunkToRow(d, this.dim));
            const schema = await makeSchema(this.dim);
            const arrowTable = makeArrowTable(rows, { schema });
            await tbl.add(arrowTable, { mode: 'append' });
        });
        await upsertQueue;
    }
    async search(query, topK = 5) {
        try {
            const tbl = await this.getTable();
            const q = query.toLowerCase();
            const all = [];
            for await (const batch of tbl.query().select(['id', 'content', 'vector', 'metadata'])) {
                const n = batch.numRows ?? 0;
                for (let i = 0; i < n; i++) {
                    const row = batch.get(i);
                    if (!row)
                        continue;
                    const content = (String(row.content ?? '').toLowerCase());
                    let score = 0;
                    for (const word of q.split(/\s+/)) {
                        if (word && content.includes(word))
                            score += 1;
                    }
                    if (score > 0) {
                        const c = rowToChunk(row);
                        c.score = score;
                        all.push(c);
                    }
                }
            }
            all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            return all.slice(0, topK);
        }
        catch (e) {
            console.warn('[Knowledge] 知识库检索失败，已降级为空结果。', e instanceof Error ? e.message : e);
            return [];
        }
    }
    async delete(ids) {
        if (ids.length === 0)
            return;
        const tbl = await this.getTable();
        const escaped = ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
        await tbl.delete(`id IN (${escaped})`);
    }
    /** 更新指定 chunk 的向量（供 HybridSearchStore 后台 Embed 队列调用） */
    async updateVector(chunk, vector) {
        if (vector.length !== this.dim) {
            throw new Error(`向量维度不匹配：期望 ${this.dim}，实际 ${vector.length}`);
        }
        const tbl = await this.getTable();
        const escaped = `'${String(chunk.id).replace(/'/g, "''")}'`;
        const updated = chunkToRow({ ...chunk, embedding: vector }, this.dim);
        await tbl.delete(`id IN (${escaped})`);
        const schema = await makeSchema(this.dim);
        const arrowTable = makeArrowTable([updated], { schema });
        await tbl.add(arrowTable, { mode: 'append' });
    }
    /** 向量检索（供 EmbeddingVectorStore 调用） */
    async vectorSearch(embedding, topK = 5) {
        try {
            const tbl = await this.getTable();
            const out = [];
            const q = tbl.vectorSearch(Float32Array.from(embedding)).limit(topK);
            for await (const batch of q) {
                const n = batch.numRows ?? 0;
                for (let i = 0; i < n; i++) {
                    const row = batch.get(i);
                    if (row)
                        out.push(rowToChunk(row));
                }
            }
            return out;
        }
        catch (e) {
            console.warn('[Knowledge] 知识库向量检索失败，已降级为空结果。', e instanceof Error ? e.message : e);
            return [];
        }
    }
}
//# sourceMappingURL=lance-store.js.map