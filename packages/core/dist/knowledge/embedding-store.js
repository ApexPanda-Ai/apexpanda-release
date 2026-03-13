import { embedTexts, isEmbeddingEnabled } from './embedding.js';
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
export class EmbeddingVectorStore {
    base;
    constructor(base) {
        this.base = base;
    }
    async list() {
        const list = await this.base.list?.();
        return list ?? [];
    }
    async clear() {
        await this.base.clear?.();
    }
    async upsert(docs) {
        const toEmbed = docs.filter((d) => !Array.isArray(d.embedding) || d.embedding.length === 0);
        const texts = toEmbed.map((d) => d.content);
        if (texts.length > 0) {
            try {
                const embeddings = await embedTexts(texts);
                for (let i = 0; i < toEmbed.length; i++) {
                    if (embeddings[i]) {
                        toEmbed[i].embedding = embeddings[i];
                    }
                }
            }
            catch (e) {
                console.warn('[Knowledge] Embedding API 失败，将仅存储文本（检索时使用关键词匹配）:', e instanceof Error ? e.message : e);
                // 不阻断上传，无向量的 chunk 在 search 时会走 base.search 关键词匹配
            }
        }
        await this.base.upsert(docs);
    }
    async search(query, topK = 5) {
        const baseWithVectorSearch = this.base;
        const list = await this.base.list?.();
        if (!list || list.length === 0)
            return [];
        const hasEmbedding = list.some((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
        if (!hasEmbedding) {
            return this.base.search(query, topK);
        }
        const toReembed = list.filter((c) => !Array.isArray(c.embedding) || c.embedding.length === 0);
        if (toReembed.length > 0) {
            try {
                const texts = toReembed.map((c) => c.content);
                const embeddings = await embedTexts(texts);
                for (let i = 0; i < toReembed.length; i++) {
                    if (embeddings[i])
                        toReembed[i].embedding = embeddings[i];
                }
                await this.base.upsert(toReembed);
            }
            catch {
                /* 忽略，后续用关键词匹配 */
            }
        }
        let queryEmb;
        try {
            [queryEmb] = await embedTexts([query]);
        }
        catch {
            return this.base.search(query, topK);
        }
        if (!queryEmb)
            return this.base.search(query, topK);
        if (typeof baseWithVectorSearch.vectorSearch === 'function') {
            return baseWithVectorSearch.vectorSearch(queryEmb, topK);
        }
        const scored = list.map((c) => {
            const emb = c.embedding;
            const score = Array.isArray(emb) && emb.length > 0 ? cosineSimilarity(queryEmb, emb) : 0;
            return { ...c, score };
        });
        scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return scored.slice(0, topK);
    }
    async delete(ids) {
        await this.base.delete(ids);
    }
}
export function wrapWithEmbeddingIfEnabled(store) {
    return isEmbeddingEnabled() ? new EmbeddingVectorStore(store) : store;
}
//# sourceMappingURL=embedding-store.js.map