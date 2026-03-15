/**
 * 本地 Embedding 封装
 * 使用 @huggingface/transformers + Xenova/bge-small-zh-v1.5
 * 512 维，中英文双语，完全离线
 */
const DEFAULT_MODEL = 'Xenova/bge-small-zh-v1.5';
const EMBED_DIM = 512;
/** BGE 模型 query 前缀（检索时使用） */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
let pipelineInstance = null;
let initPromise = null;
function getModelId() {
    return process.env.APEXPANDA_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
}
function getModelPath() {
    const p = process.env.APEXPANDA_EMBEDDING_MODEL_PATH?.trim();
    return p || undefined;
}
async function createPipeline() {
    const { pipeline } = await import('@huggingface/transformers');
    const modelId = getModelId();
    const modelPath = getModelPath();
    const opts = {
        quantized: true,
    };
    if (modelPath) {
        opts.local_files_only = true;
        opts.revision = 'main';
    }
    const extractor = await pipeline('feature-extraction', modelPath || modelId, opts);
    return { extractor };
}
async function getPipeline() {
    if (pipelineInstance)
        return pipelineInstance;
    if (!initPromise) {
        initPromise = createPipeline().then((p) => {
            pipelineInstance = p;
            return p;
        });
    }
    return initPromise;
}
/** 将 Tensor 转为 number[][]，支持 [batch, dim] 或 [batch, seq, dim] */
function tensorToVectors(tensor) {
    const dims = tensor.dims;
    const data = tensor.data;
    if (dims.length === 2) {
        const [batch, dim] = dims;
        const out = [];
        for (let i = 0; i < batch; i++) {
            out.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
        }
        return out;
    }
    if (dims.length === 3) {
        const [batch, seqLen, dim] = dims;
        const out = [];
        for (let i = 0; i < batch; i++) {
            const vec = new Float32Array(dim);
            for (let s = 0; s < seqLen; s++) {
                for (let d = 0; d < dim; d++) {
                    vec[d] += data[i * seqLen * dim + s * dim + d];
                }
            }
            for (let d = 0; d < dim; d++)
                vec[d] /= seqLen;
            out.push(Array.from(vec));
        }
        return out;
    }
    return [];
}
/** 模型是否已加载完成 */
export function isEmbeddingReady() {
    return pipelineInstance !== null;
}
/** 后台预加载模型，不阻塞 */
export function preloadEmbedding() {
    getPipeline().catch((e) => {
        console.warn('[Knowledge] 本地 Embedding 模型加载失败:', e instanceof Error ? e.message : e);
    });
}
/** 获取向量维度 */
export function getEmbedDim() {
    return EMBED_DIM;
}
/**
 * 批量生成文本向量
 * @param texts 文本列表
 * @param isQuery 若为 true，对 query 加 BGE 检索前缀
 */
export async function embedTexts(texts, isQuery = false) {
    if (texts.length === 0)
        return [];
    const { extractor } = await getPipeline();
    const prefix = isQuery ? QUERY_PREFIX : '';
    const inputs = texts.map((t) => prefix + (t ?? ''));
    const out = await extractor(inputs, { pooling: 'mean', normalize: true });
    if (!out || typeof out !== 'object' || !('data' in out) || !Array.isArray(out.dims)) {
        return texts.map(() => []);
    }
    const o = out;
    const vecs = tensorToVectors(o);
    if (vecs.length >= texts.length)
        return vecs.slice(0, texts.length);
    return vecs;
}
//# sourceMappingURL=local-embedding.js.map