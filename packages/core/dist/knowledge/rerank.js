import { localRerank } from './local-rerank.js';
/** Cohere Rerank v2 API */
async function rerankCohere(query, chunks, config) {
    const { apiKey, model = 'rerank-v3.5', topK = chunks.length } = config;
    if (!apiKey || chunks.length === 0)
        return chunks;
    const documents = chunks.map((c) => c.content);
    const res = await fetch('https://api.cohere.ai/v2/rerank', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            query,
            documents,
            top_n: Math.min(topK, documents.length),
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Cohere Rerank failed: ${res.status} ${err}`);
    }
    const data = (await res.json());
    if (!Array.isArray(data.results) || data.results.length === 0)
        return chunks;
    const byIndex = new Map(chunks.map((c, i) => [i, c]));
    return data.results
        .filter((r) => typeof r.index === 'number' && byIndex.has(r.index))
        .map((r) => {
        const chunk = byIndex.get(r.index);
        return { ...chunk, score: r.relevance_score ?? chunk.score };
    });
}
/** Jina Rerank API */
async function rerankJina(query, chunks, config) {
    const { apiKey, model = 'jina-reranker-v2-base-multilingual', topK = chunks.length } = config;
    if (!apiKey || chunks.length === 0)
        return chunks;
    const documents = chunks.map((c) => c.content);
    const res = await fetch('https://api.jina.ai/v1/rerank', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            query,
            documents,
            top_n: Math.min(topK, documents.length),
            return_documents: false,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Jina Rerank failed: ${res.status} ${err}`);
    }
    const data = (await res.json());
    if (!Array.isArray(data.results) || data.results.length === 0)
        return chunks;
    const byIndex = new Map(chunks.map((c, i) => [i, c]));
    return data.results
        .filter((r) => typeof r.index === 'number' && byIndex.has(r.index))
        .map((r) => {
        const chunk = byIndex.get(r.index);
        return { ...chunk, score: r.relevance_score ?? chunk.score };
    });
}
/** 根据配置创建 Rerank 函数，未启用或配置无效时返回 null */
export function createRerank(config) {
    if (!config?.enabled)
        return null;
    const provider = config.provider ?? 'local';
    if (provider === 'local') {
        const topK = config.topK;
        return async (query, chunks) => {
            if (chunks.length === 0)
                return chunks;
            try {
                return await localRerank(query, chunks, topK);
            }
            catch (e) {
                console.warn('[Rerank] 本地重排失败，沿用原始顺序:', e instanceof Error ? e.message : e);
                return chunks;
            }
        };
    }
    const apiKey = config.apiKey?.trim() ??
        (provider === 'cohere' ? process.env.COHERE_API_KEY : process.env.JINA_API_KEY)?.trim();
    if (!apiKey)
        return null;
    const fn = provider === 'cohere' ? rerankCohere : rerankJina;
    const opts = {
        apiKey,
        model: config.model?.trim() || undefined,
        topK: config.topK,
    };
    return async (query, chunks) => {
        if (chunks.length === 0)
            return chunks;
        try {
            return await fn(query, chunks, opts);
        }
        catch (e) {
            console.warn('[Rerank] 重排失败，沿用原始顺序:', e instanceof Error ? e.message : e);
            return chunks;
        }
    };
}
//# sourceMappingURL=rerank.js.map