/**
 * Embedding 客户端：OpenAI 兼容 API
 * 支持 OpenAI、Ollama、LocalAI 等
 * 注意：DeepSeek、豆包等部分模型不支持 /embeddings，需单独配置 APEXPANDA_EMBEDDING_* 或使用支持 embedding 的 endpoint
 */
import { getConfigSync, getLLMModel, getLLMConfigForModel } from '../config/loader.js';
/** 不支持 /embeddings 的 host（返回 404），需优先选用其他 endpoint */
const EMBEDDING_UNSUPPORTED_HOSTS = ['deepseek.com', 'api.deepseek.com'];
function hostSupportsEmbedding(baseUrl) {
    const host = baseUrl.replace(/^https?:\/\//, '').split('/')[0] ?? '';
    return !EMBEDDING_UNSUPPORTED_HOSTS.some((h) => host.includes(h));
}
function getEmbeddingConfig() {
    const defaultModel = getLLMModel();
    let { baseUrl: llmBaseUrl, apiKey: llmApiKey } = getLLMConfigForModel(defaultModel);
    // 若默认模型所在 provider 不支持 embedding（如 DeepSeek），尝试从其他 endpoint 中选用支持 embedding 的
    if (!hostSupportsEmbedding(llmBaseUrl) || !llmApiKey) {
        const cfg = getConfigSync();
        const eps = cfg?.llm?.endpoints;
        if (eps && typeof eps === 'object') {
            for (const [, ep] of Object.entries(eps)) {
                if (ep?.baseUrl && ep?.apiKey && hostSupportsEmbedding(ep.baseUrl)) {
                    llmBaseUrl = ep.baseUrl;
                    llmApiKey = ep.apiKey;
                    break;
                }
            }
            // 若仍无，取任一有 apiKey 的（兜底，可能仍 404）
            if (!llmApiKey) {
                for (const [, ep] of Object.entries(eps)) {
                    if (ep?.baseUrl && ep?.apiKey) {
                        llmBaseUrl = ep.baseUrl;
                        llmApiKey = ep.apiKey;
                        break;
                    }
                }
            }
        }
    }
    const baseUrl = (process.env.APEXPANDA_EMBEDDING_BASE_URL ??
        llmBaseUrl).replace(/\/$/, '');
    const apiKey = process.env.APEXPANDA_EMBEDDING_API_KEY ??
        llmApiKey;
    let model = process.env.APEXPANDA_EMBEDDING_MODEL;
    if (!model?.trim()) {
        const host = baseUrl.replace(/^https?:\/\//, '').split('/')[0] ?? '';
        if (host.includes('deepseek.com'))
            model = 'text-embedding-large';
        else
            model = 'text-embedding-3-small';
    }
    return { baseUrl, apiKey, model };
}
function isEmbeddingEnabled() {
    const v = process.env.APEXPANDA_EMBEDDING_ENABLED;
    if (v !== undefined && v !== '')
        return v === 'true';
    const cfg = getConfigSync();
    const fromConfig = cfg?.knowledge?.embedding?.enabled;
    if (typeof fromConfig === 'boolean')
        return fromConfig;
    return true; // 默认开启
}
/** 单次请求最大文本数（多数 API 限制 2048 或更低） */
const BATCH_SIZE = 100;
/**
 * 调用 embedding API，支持单条或批量
 */
export async function embedTexts(texts) {
    if (texts.length === 0)
        return [];
    const { baseUrl, apiKey, model } = getEmbeddingConfig();
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const res = await fetch(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                model,
                input: batch.length === 1 ? batch[0] : batch,
            }),
            signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
            const err = await res.text();
            const hint = res.status === 404
                ? ' 部分模型（如 DeepSeek）不支持 Embedding，请设置 APEXPANDA_EMBEDDING_BASE_URL 指向 OpenAI 等，或 APEXPANDA_EMBEDDING_ENABLED=false 关闭。'
                : '';
            throw new Error(`Embedding API 失败: ${res.status} ${err}${hint}`);
        }
        const data = (await res.json());
        const embeddings = data.data ?? [];
        for (const item of embeddings) {
            if (item?.embedding)
                results.push(item.embedding);
        }
    }
    return results;
}
export { getEmbeddingConfig, isEmbeddingEnabled };
//# sourceMappingURL=embedding.js.map