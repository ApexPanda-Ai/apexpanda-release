const RETRY_MAX = 3;
const RETRY_DELAY_MS = 1000;
/** 单次 LLM 请求超时（毫秒）。可通过 APEXPANDA_LLM_TIMEOUT_MS 覆盖，默认 120 秒 */
const LLM_FETCH_TIMEOUT_MS = (() => {
    const v = parseInt(process.env.APEXPANDA_LLM_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : 120_000;
})();
function isRetryable(status) {
    return status === 429 || status >= 500;
}
async function fetchWithRetry(url, init) {
    let lastErr = null;
    for (let i = 0; i < RETRY_MAX; i++) {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, LLM_FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...init, signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok && isRetryable(res.status) && i < RETRY_MAX - 1) {
                const delay = RETRY_DELAY_MS * Math.pow(2, i);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return res;
        }
        catch (e) {
            clearTimeout(timer);
            const isAbort = e instanceof Error && e.name === 'AbortError';
            lastErr = isAbort
                ? new Error(`LLM request timed out after ${LLM_FETCH_TIMEOUT_MS / 1000}s (attempt ${i + 1}/${RETRY_MAX})`)
                : (e instanceof Error ? e : new Error(String(e)));
            if (isAbort) {
                console.warn(`[LLM] 请求超时（${LLM_FETCH_TIMEOUT_MS / 1000}s），第 ${i + 1}/${RETRY_MAX} 次尝试`);
            }
            if (i < RETRY_MAX - 1) {
                const delay = RETRY_DELAY_MS * Math.pow(2, i);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw lastErr ?? new Error('LLM request failed after retries');
}
function isRetryableError(e) {
    if (e instanceof Error) {
        const msg = e.message.toLowerCase();
        return msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503') ||
            msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('fetch failed');
    }
    return false;
}
/**
 * 解析 DeepSeek DSML XML 格式的 function call（当模型不走标准 tool_calls 字段时的兜底）
 * 格式示例：
 *   <｜DSML｜function_calls>
 *     <｜DSML｜invoke name="web-search_search">
 *       <｜DSML｜parameter name="query" string="true">关键词</｜DSML｜parameter>
 *       <｜DSML｜parameter name="maxResults" string="false">8</｜DSML｜parameter>
 *     </｜DSML｜invoke>
 *   </｜DSML｜function_calls>
 */
function parseDSMLToolCalls(content) {
    if (!content.includes('<\uFF5CDSML\uFF5Cfunction_calls>'))
        return null;
    const toolCalls = [];
    let cleanContent = content;
    const blockRe = /<\uFF5CDSML\uFF5Cfunction_calls>([\s\S]*?)<\/\uFF5CDSML\uFF5Cfunction_calls>/g;
    let blockMatch;
    while ((blockMatch = blockRe.exec(content)) !== null) {
        const blockText = blockMatch[1];
        const invokeRe = /<\uFF5CDSML\uFF5Cinvoke\s+name="([^"]+)">([\s\S]*?)<\/\uFF5CDSML\uFF5Cinvoke>/g;
        let invokeMatch;
        while ((invokeMatch = invokeRe.exec(blockText)) !== null) {
            const toolName = invokeMatch[1];
            const paramsText = invokeMatch[2];
            const params = {};
            const paramRe = /<\uFF5CDSML\uFF5Cparameter\s+name="([^"]+)"(?:\s+string="([^"]*)")?[^>]*>([\s\S]*?)<\/\uFF5CDSML\uFF5Cparameter>/g;
            let paramMatch;
            while ((paramMatch = paramRe.exec(paramsText)) !== null) {
                const pName = paramMatch[1];
                const isStringType = paramMatch[2] !== 'false';
                const pValue = paramMatch[3].trim();
                if (!isStringType) {
                    const num = Number(pValue);
                    params[pName] = Number.isNaN(num) ? pValue : num;
                }
                else {
                    params[pName] = pValue;
                }
            }
            toolCalls.push({
                id: `dsml_${Date.now()}_${toolCalls.length}`,
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(params) },
            });
        }
        cleanContent = cleanContent.replace(blockMatch[0], '').trim();
    }
    return toolCalls.length > 0 ? { toolCalls, cleanContent } : null;
}
/** 当 DSML 解析失败时，移除 content 中的 DSML 标签，避免原始 XML 泄露给用户 */
function stripMalformedDSML(content) {
    return content
        .replace(/<\uFF5CDSML\uFF5C[^>]*>/g, '')
        .replace(/<\/\uFF5CDSML\uFF5C[^>]*>/g, '')
        .replace(/<\uFF5CDSML\uFF5C[\s\S]*$/g, '') // 截断时残留的 <｜DSML｜xxx，移除到文末
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
}
/**
 * 解析国产模型常见的 <name>...</name><arguments>...</arguments> XML 格式 function call
 * 部分文心/通义/智谱等模型在 content 中输出此格式而非标准 tool_calls
 */
function parseSimpleXmlToolCalls(content) {
    const blockRe = /<name>([\s\S]*?)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>/gi;
    const toolCalls = [];
    let cleanContent = content;
    let match;
    while ((match = blockRe.exec(content)) !== null) {
        const toolName = (match[1] ?? '').trim();
        let argsStr = (match[2] ?? '').trim();
        if (!toolName)
            continue;
        // arguments 可能是 JSON 或 <command>...</command> 等子元素，尝试解析
        let argsJson;
        if (argsStr.startsWith('{')) {
            argsJson = argsStr;
        }
        else {
            const cmdMatch = argsStr.match(/<command>([\s\S]*?)<\/command>/i);
            const queryMatch = argsStr.match(/<query>([\s\S]*?)<\/query>/i);
            const paramMatches = argsStr.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/gi);
            const params = {};
            if (cmdMatch)
                params.command = cmdMatch[1].trim();
            if (queryMatch)
                params.query = queryMatch[1].trim();
            for (const m of paramMatches) {
                const k = m[1];
                if (k && !['command', 'query'].includes(k.toLowerCase()))
                    params[k] = (m[2] ?? '').trim();
            }
            argsJson = Object.keys(params).length > 0 ? JSON.stringify(params) : argsStr;
        }
        toolCalls.push({
            id: `xml_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: { name: toolName, arguments: argsJson },
        });
        cleanContent = cleanContent.replace(match[0], '').trim();
    }
    return toolCalls.length > 0 ? { toolCalls, cleanContent } : null;
}
/** 移除 content 中可能泄露的 tool call XML，避免发往渠道时报 230001 */
export function stripToolCallXmlFromContent(content) {
    let s = content
        .replace(/<name>[\s\S]*?<\/name>\s*<arguments>[\s\S]*?<\/arguments>/gi, '')
        .replace(/<arguments>[\s\S]*?<\/arguments>\s*<name>[\s\S]*?<\/name>/gi, '')
        .replace(/<name>[\s\S]*?<\/name>/gi, '')
        .replace(/<arguments>[\s\S]*?<\/arguments>/gi, '')
        .replace(/<\uFF5CDSML\uFF5C[^>]*>[\s\S]*?<\/\uFF5CDSML\uFF5C[^>]*>/g, '')
        .replace(/<\uFF5CDSML\uFF5C[\s\S]*$/g, '') // 截断时残留的 <｜DSML｜xxx，移除到文末
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
    return s || '(内容已过滤)';
}
export function createOpenAICompatibleProvider(config) {
    const { baseUrl, apiKey, defaultModel = 'gpt-4', fallbackModel, fallbackEndpoint } = config;
    const doCompleteWithEndpoint = async (endpointBaseUrl, endpointApiKey, model, messages, options) => {
        const res = await fetchWithRetry(`${endpointBaseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${endpointApiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                max_tokens: options?.maxTokens ?? 8192,
                temperature: options?.temperature ?? 0.7,
                stream: false,
                ...(options?.tools && options.tools.length > 0 && {
                    tools: options.tools.map((t) => ({
                        type: 'function',
                        function: {
                            name: t.function.name,
                            description: t.function.description,
                            parameters: t.function.parameters ?? { type: 'object', properties: {} },
                        },
                    })),
                }),
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`LLM request failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const msg = data.choices?.[0]?.message;
        const rawContent = msg?.content ?? '';
        let toolCalls = msg?.tool_calls?.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
        let content = rawContent;
        // 兜底：解析非标准 tool call 格式（DSML、国产模型 <name><arguments> XML）
        if ((!toolCalls || toolCalls.length === 0) && rawContent) {
            const dsml = parseDSMLToolCalls(rawContent);
            if (dsml) {
                toolCalls = dsml.toolCalls;
                content = dsml.cleanContent;
            }
            else {
                const simpleXml = parseSimpleXmlToolCalls(rawContent);
                if (simpleXml) {
                    toolCalls = simpleXml.toolCalls;
                    content = simpleXml.cleanContent;
                }
                else if (rawContent.includes('<\uFF5CDSML\uFF5C')) {
                    content = stripMalformedDSML(rawContent);
                }
                else if (/<name>[\s\S]*?<\/name>\s*<arguments>/i.test(rawContent)) {
                    // 有 <name><arguments> 但解析失败，移除避免泄露
                    content = stripToolCallXmlFromContent(rawContent);
                }
            }
        }
        return {
            content,
            toolCalls,
            usage: data.usage
                ? {
                    promptTokens: data.usage.prompt_tokens ?? 0,
                    completionTokens: data.usage.completion_tokens ?? 0,
                    totalTokens: data.usage.total_tokens ?? 0,
                }
                : undefined,
        };
    };
    const doComplete = async (model, messages, options) => doCompleteWithEndpoint(baseUrl, apiKey, model, messages, options);
    return {
        id: 'openai-compatible',
        async complete(messages, options) {
            const model = options?.model ?? defaultModel;
            try {
                return await doComplete(model, messages, options);
            }
            catch (e) {
                if (fallbackModel && model !== fallbackModel && isRetryableError(e)) {
                    console.warn(`[LLM] Primary model ${model} failed, retrying with fallback ${fallbackModel}`);
                    if (fallbackEndpoint) {
                        return await doCompleteWithEndpoint(fallbackEndpoint.baseUrl, fallbackEndpoint.apiKey, fallbackModel, messages, { ...options, model: fallbackModel });
                    }
                    return await doComplete(fallbackModel, messages, { ...options, model: fallbackModel });
                }
                throw e;
            }
        },
    };
}
//# sourceMappingURL=openai-compatible.js.map