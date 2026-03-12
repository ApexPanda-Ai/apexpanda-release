/**
 * Agent 配置：从 config.json + 环境变量加载 LLM
 * 支持按 model 选择独立 endpoint（多模型互不覆盖）
 */
import { getLLMModel, getLLMFallbackModel, getLLMConfigForModel, } from '../config/loader.js';
import { createOpenAICompatibleProvider } from '../llm/openai-compatible.js';
/** 获取指定 model 的 LLM Provider；不传 model 时用全局默认 */
export function getLLMProvider(model) {
    const defaultModel = getLLMModel();
    const effectiveModel = model || defaultModel;
    const { baseUrl, apiKey } = getLLMConfigForModel(effectiveModel);
    const fallbackModel = getLLMFallbackModel();
    let fallbackEndpoint;
    if (fallbackModel && fallbackModel !== effectiveModel) {
        const fc = getLLMConfigForModel(fallbackModel);
        if (fc.baseUrl !== baseUrl || fc.apiKey !== apiKey) {
            fallbackEndpoint = fc;
        }
    }
    if (!apiKey) {
        console.warn('[Agent] No LLM API key for model', effectiveModel, '- chat will fail. Set APEXPANDA_LLM_API_KEY or config llm.endpoints[model].apiKey');
    }
    return createOpenAICompatibleProvider({
        baseUrl,
        apiKey,
        defaultModel: effectiveModel,
        fallbackModel,
        fallbackEndpoint,
    });
}
//# sourceMappingURL=config.js.map