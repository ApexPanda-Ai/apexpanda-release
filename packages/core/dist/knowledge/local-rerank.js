const DEFAULT_MODEL = 'Xenova/bge-reranker-base';
let rerankerInstance = null;
let initPromise = null;
function getModelId() {
    return process.env.APEXPANDA_RERANK_MODEL?.trim() || DEFAULT_MODEL;
}
function getModelPath() {
    const p = process.env.APEXPANDA_RERANK_MODEL_PATH?.trim();
    return p || undefined;
}
async function createReranker() {
    const { pipeline } = await import('@huggingface/transformers');
    const modelId = getModelId();
    const modelPath = getModelPath();
    const opts = { quantized: true };
    if (modelPath) {
        opts.local_files_only = true;
        opts.revision = 'main';
    }
    const classifier = await pipeline('text-classification', modelPath || modelId, opts);
    return { classifier };
}
async function getReranker() {
    if (rerankerInstance)
        return rerankerInstance;
    if (!initPromise) {
        initPromise = createReranker().then((r) => {
            rerankerInstance = r;
            return r;
        });
    }
    return initPromise;
}
/** BGE Reranker 输入格式：query 与 document 用换行分隔 */
function formatPair(query, document) {
    return `${query}\n\n${document}`;
}
/**
 * 对候选 chunks 按 query 相关性重排
 */
export async function localRerank(query, chunks, topK) {
    if (chunks.length === 0)
        return [];
    const k = typeof topK === 'number' && topK >= 1 ? Math.min(topK, chunks.length) : chunks.length;
    const { classifier } = await getReranker();
    const pairs = chunks.map((c) => formatPair(query, c.content ?? ''));
    const scores = [];
    for (let i = 0; i < pairs.length; i++) {
        try {
            const out = await classifier(pairs[i], { top_k: 1 });
            const result = Array.isArray(out) ? out[0] : out;
            const score = result && typeof result === 'object' && 'score' in result
                ? result.score
                : 0;
            scores.push(score);
        }
        catch {
            scores.push(0);
        }
    }
    const indexed = chunks.map((c, i) => ({ chunk: c, score: scores[i] ?? 0 }));
    indexed.sort((a, b) => b.score - a.score);
    return indexed.slice(0, k).map(({ chunk, score }) => ({ ...chunk, score }));
}
//# sourceMappingURL=local-rerank.js.map