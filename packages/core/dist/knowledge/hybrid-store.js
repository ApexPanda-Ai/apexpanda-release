/**
 * 混合检索存储：BM25 + 向量 + RRF 融合
 * 完全本地，不依赖第三方 API
 */
import { join } from 'node:path';
import { BM25Index } from './bm25-index.js';
import { LanceVectorStore } from './lance-store.js';
import { embedTexts, isEmbeddingReady, preloadEmbedding } from './local-embedding.js';
function getBm25PersistPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'bm25-index.json');
}
function isBm25PersistEnabled() {
    return process.env.APEXPANDA_BM25_PERSIST === 'true';
}
const RRF_K = 60;
/** RRF 融合：score(d) = Σ 1/(k + rank_i(d)) */
function rrfMerge(vectorResults, bm25Results, k = RRF_K) {
    const scores = new Map();
    const chunks = new Map();
    vectorResults.forEach((c, i) => {
        const rrf = 1 / (k + i + 1);
        scores.set(c.id, (scores.get(c.id) ?? 0) + rrf);
        if (!chunks.has(c.id))
            chunks.set(c.id, c);
    });
    bm25Results.forEach((c, i) => {
        const rrf = 1 / (k + i + 1);
        scores.set(c.id, (scores.get(c.id) ?? 0) + rrf);
        if (!chunks.has(c.id))
            chunks.set(c.id, c);
    });
    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => chunks.get(id))
        .filter(Boolean);
}
/** Embedding 后台队列 */
class EmbedQueue {
    onEmbed;
    queue = [];
    processing = false;
    batchSize = 8;
    delayMs = 100;
    constructor(onEmbed) {
        this.onEmbed = onEmbed;
    }
    enqueue(chunks) {
        const needEmbed = chunks.filter((c) => !Array.isArray(c.embedding) || c.embedding.length === 0);
        if (needEmbed.length === 0)
            return;
        this.queue.push(...needEmbed);
        this.process();
    }
    async process() {
        if (this.processing || this.queue.length === 0)
            return;
        this.processing = true;
        try {
            while (this.queue.length > 0) {
                const batch = this.queue.splice(0, this.batchSize);
                const texts = batch.map((c) => c.content ?? '');
                try {
                    const embeddings = await embedTexts(texts, false);
                    for (let i = 0; i < batch.length; i++) {
                        const vec = embeddings[i];
                        if (vec && vec.length > 0) {
                            await this.onEmbed(batch[i], vec);
                        }
                    }
                }
                catch (e) {
                    console.warn('[Knowledge] Embed 队列失败:', e instanceof Error ? e.message : e);
                    this.queue.unshift(...batch);
                    await new Promise((r) => setTimeout(r, this.delayMs * 2));
                }
            }
        }
        finally {
            this.processing = false;
        }
    }
}
export class HybridSearchStore {
    lance;
    bm25;
    embedQueue;
    bm25Ready = false;
    initPromise = null;
    persistTimer = null;
    constructor() {
        this.lance = new LanceVectorStore();
        this.bm25 = new BM25Index();
        this.embedQueue = new EmbedQueue(async (chunk, vector) => {
            if (typeof this.lance.updateVector === 'function') {
                await this.lance.updateVector(chunk, vector);
            }
        });
        preloadEmbedding();
    }
    async ensureBm25FromLance() {
        if (this.bm25Ready)
            return;
        if (!this.initPromise) {
            this.initPromise = (async () => {
                try {
                    if (isBm25PersistEnabled()) {
                        const loaded = await BM25Index.load(getBm25PersistPath());
                        if (loaded && loaded.docCountValue > 0) {
                            this.bm25 = loaded;
                            this.bm25Ready = true;
                            return;
                        }
                    }
                    const list = await this.lance.list();
                    if (list.length > 0) {
                        this.bm25.rebuild(list);
                        if (isBm25PersistEnabled()) {
                            await this.bm25.save(getBm25PersistPath());
                        }
                    }
                    this.bm25Ready = true;
                }
                catch (e) {
                    console.warn('[Knowledge] BM25 索引初始化失败:', e instanceof Error ? e.message : e);
                    this.bm25Ready = true;
                }
            })();
        }
        await this.initPromise;
    }
    schedulePersist() {
        if (!isBm25PersistEnabled())
            return;
        if (this.persistTimer)
            clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this.bm25.save(getBm25PersistPath()).catch((e) => {
                console.warn('[Knowledge] BM25 持久化失败:', e instanceof Error ? e.message : e);
            });
        }, 2000);
    }
    async list() {
        return this.lance.list();
    }
    async clear() {
        await this.lance.clear();
        this.bm25.clear();
        this.bm25Ready = true;
        this.schedulePersist();
    }
    async upsert(docs) {
        if (docs.length === 0)
            return;
        const withoutEmbedding = docs.map((d) => ({ ...d, embedding: undefined }));
        await this.lance.upsert(withoutEmbedding);
        this.bm25.update(docs);
        this.bm25Ready = true;
        this.schedulePersist();
        this.embedQueue.enqueue(docs);
    }
    async search(query, topK = 5) {
        const candidateK = Math.max(topK * 3, 20);
        await this.ensureBm25FromLance();
        let vectorResults = [];
        let bm25Results = [];
        if (isEmbeddingReady()) {
            try {
                const [queryEmb] = await embedTexts([query], true);
                if (queryEmb && queryEmb.length > 0) {
                    vectorResults = await this.lance.vectorSearch(queryEmb, candidateK);
                }
            }
            catch (e) {
                console.warn('[Knowledge] 向量检索失败:', e instanceof Error ? e.message : e);
            }
        }
        bm25Results = this.bm25.search(query, candidateK);
        let merged;
        if (vectorResults.length === 0 && bm25Results.length === 0) {
            return [];
        }
        if (vectorResults.length === 0) {
            merged = bm25Results;
        }
        else if (bm25Results.length === 0) {
            merged = vectorResults;
        }
        else {
            merged = rrfMerge(vectorResults, bm25Results);
        }
        return merged.slice(0, topK);
    }
    async delete(ids) {
        await this.lance.delete(ids);
        this.bm25.delete(ids);
        this.schedulePersist();
    }
}
//# sourceMappingURL=hybrid-store.js.map