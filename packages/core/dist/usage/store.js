/** 常见模型单价（$/1M tokens，输入/输出） */
const MODEL_PRICES = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4': { input: 30, output: 60 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
    'deepseek-chat': { input: 0.14, output: 0.28 },
    'deepseek-coder': { input: 0.14, output: 0.28 },
    'deepseek-r1': { input: 0.55, output: 2.19 },
    'qwen-turbo': { input: 0.3, output: 0.6 },
    'qwen-plus': { input: 0.4, output: 1.2 },
    'qwen-max': { input: 2, output: 6 },
    'moonshot-v1': { input: 0.4, output: 1.75 },
    'doubao': { input: 0.3, output: 0.9 },
    'ernie': { input: 0.12, output: 0.12 },
    'claude-3-5-sonnet': { input: 3, output: 15 },
};
function matchModelPrice(model) {
    const lower = model.toLowerCase();
    for (const [k, v] of Object.entries(MODEL_PRICES)) {
        if (lower.includes(k))
            return v;
    }
    return null;
}
export function estimateCostUsd(model, promptTokens, completionTokens) {
    const p = matchModelPrice(model);
    if (!p)
        return 0;
    return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}
const daily = new Map();
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}
export function recordUsage(promptTokens, completionTokens, model) {
    const key = todayKey();
    const cur = daily.get(key) ?? {
        prompt: 0,
        completion: 0,
        requests: 0,
        byModel: {},
    };
    cur.prompt += promptTokens;
    cur.completion += completionTokens;
    cur.requests += 1;
    const m = model ?? 'default';
    const bm = cur.byModel[m] ?? { prompt: 0, completion: 0, requests: 0 };
    bm.prompt += promptTokens;
    bm.completion += completionTokens;
    bm.requests += 1;
    cur.byModel[m] = bm;
    daily.set(key, cur);
}
function emptyDay() {
    return { prompt: 0, completion: 0, requests: 0, byModel: {} };
}
export function getUsage(days = 7) {
    const result = [];
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const cur = daily.get(key) ?? emptyDay();
        result.unshift({
            date: key,
            promptTokens: cur.prompt,
            completionTokens: cur.completion,
            totalTokens: cur.prompt + cur.completion,
            requests: cur.requests,
        });
    }
    return result;
}
export function getUsageByModel(days = 7) {
    const byModel = new Map();
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const cur = daily.get(key) ?? emptyDay();
        for (const [m, v] of Object.entries(cur.byModel ?? {})) {
            const b = byModel.get(m) ?? { prompt: 0, completion: 0, requests: 0 };
            b.prompt += v.prompt;
            b.completion += v.completion;
            b.requests += v.requests;
            byModel.set(m, b);
        }
    }
    return Array.from(byModel.entries()).map(([model, v]) => ({
        model,
        promptTokens: v.prompt,
        completionTokens: v.completion,
        totalTokens: v.prompt + v.completion,
        requests: v.requests,
        estimatedCostUsd: estimateCostUsd(model, v.prompt, v.completion),
    }));
}
/** 基于所有模型估算总成本（按实际使用模型分别计算） */
function getTotalEstimatedCostUsd() {
    const byModel = getUsageByModel(365);
    return byModel.reduce((sum, m) => sum + (m.estimatedCostUsd ?? 0), 0);
}
export function getTotalUsage() {
    let prompt = 0;
    let completion = 0;
    let requests = 0;
    for (const v of daily.values()) {
        prompt += v.prompt;
        completion += v.completion;
        requests += v.requests;
    }
    return {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
        requests,
        estimatedCostUsd: getTotalEstimatedCostUsd() || undefined,
    };
}
//# sourceMappingURL=store.js.map