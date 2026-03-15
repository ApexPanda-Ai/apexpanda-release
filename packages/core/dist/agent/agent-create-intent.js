/**
 * 渠道消息创建 Agent：命令/自然语言解析 + 模板匹配 + 参数推理
 * 支持命令：/创建agent 描述 / /create-agent 描述
 * Phase 2：确认模式、model、workerIds 模板参数
 */
import { getLLMProvider } from './config.js';
import { createAgent } from './store.js';
/** Agent 模板（workerIds 可扩展为预置 Worker Agent ID） */
export const AGENT_TEMPLATES = [
    { id: 'general', name: '通用助手', description: '通用对话、任务执行' },
    { id: 'data-analysis', name: '数据分析', description: '数据解读、报表、图表' },
    { id: 'customer-service', name: '客服助手', description: '客服、售后、FAQ' },
    { id: 'code-assistant', name: '代码助手', description: '编程、调试、重构' },
    { id: 'research', name: '研究助手', description: '调研、归纳、引用' },
];
const TEMPLATE_WORKER_IDS = {
    general: [],
    'data-analysis': [],
    'customer-service': [],
    'code-assistant': [],
    research: [],
};
const DEFAULT_SYSTEM_PROMPT = `你是一个 helpful 的 AI 助手，能够理解用户意图并高效完成任务。`;
const TEMPLATE_PROMPTS = {
    general: DEFAULT_SYSTEM_PROMPT,
    'data-analysis': `你是数据分析助手，擅长解读数据、生成图表与报告。能使用 chart-gen、file-tools 等工具进行数据处理与可视化。`,
    'customer-service': `你是客服助手，礼貌、专业，能解答常见问题并记录用户反馈。`,
    'code-assistant': `你是代码助手，擅长编写、调试、重构代码。能使用 code-runner、file-tools 等工具。`,
    research: `你是研究助手，擅长检索信息、归纳总结、引用来源。能使用 web-search 等工具。`,
};
/** Phase 2：是否启用确认模式（APEXPANDA_AGENT_CREATE_CONFIRM=true） */
export function isCreateAgentConfirmMode() {
    return process.env.APEXPANDA_AGENT_CREATE_CONFIRM === 'true';
}
const pendingAgentCreates = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;
function getAgentSessionKey(channel, ctx) {
    return `agent:${channel}:${ctx.chatId ?? ctx.sessionWebhook ?? ctx.messageId ?? 'default'}`;
}
export function setPendingAgentCreate(channel, ctx, intent) {
    const key = getAgentSessionKey(channel, ctx);
    pendingAgentCreates.set(key, { intent, createdAt: Date.now() });
}
export function getAndClearPendingAgentCreate(channel, ctx) {
    const key = getAgentSessionKey(channel, ctx);
    const pending = pendingAgentCreates.get(key);
    if (!pending)
        return null;
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
        pendingAgentCreates.delete(key);
        return null;
    }
    pendingAgentCreates.delete(key);
    return pending.intent;
}
/** 定时清理过期待确认创建 Agent（供 index 定期调用） */
export function cleanupExpiredPendingAgentCreates() {
    const now = Date.now();
    for (const [k, v] of pendingAgentCreates) {
        if (now - v.createdAt > PENDING_TTL_MS)
            pendingAgentCreates.delete(k);
    }
}
/** 生成待确认的回复文案 */
export function formatPendingAgentCreatePreview(intent) {
    const tpl = AGENT_TEMPLATES.find((t) => t.id === (intent.templateId ?? 'general'));
    const name = (intent.name ?? tpl?.name ?? '').trim() || '未命名';
    const handle = sanitizeHandle(intent.handle);
    const lines = [
        `📋 拟创建 Agent「${name}」`,
        intent.description ? `• 用途：${intent.description}` : `• 模板：${tpl?.name ?? intent.templateId ?? 'general'}`,
        handle ? `• 短别名：@${handle}` : '',
        intent.model ? `• 模型：${intent.model}` : '',
        `• 确认请回复：确认`,
        `• 5 分钟内有效，取消请忽略`,
    ];
    return lines.filter(Boolean).join('\n');
}
/** 检测消息是否为「创建 Agent」意图 */
export function isCreateAgentTrigger(text) {
    const t = text.trim();
    if (/^\/(?:创建(?:agent|智能体)|create-agent)\s*[，,：:]*/i.test(t))
        return true;
    // 关键词：创建/建个/帮我做个/新建 agent、助手、机器人
    const keywords = /(?:创建|建个?|帮我做个?|新建\s*一个?)\s*(?:个|一个)?\s*(?:agent|助手|机器人)/i;
    if (keywords.test(t) && t.length < 200)
        return true;
    return false;
}
/** 提取命令/关键词后的描述部分 */
export function extractAgentDescription(text) {
    const t = text.trim();
    const cmdMatch = t.match(/^\/(?:创建(?:agent|智能体)|create-agent)\s*[，,：:]*\s*(.*)$/si);
    if (cmdMatch)
        return (cmdMatch[1] ?? '').trim();
    // 创建个/建个/帮我做个/新建 XXX助手：提取中间或后续描述
    const prefix = /^(?:创建|建个?|帮我做个?|新建\s*一个?)\s*(?:个|一个)?\s*/i;
    const kwMatch = t.match(new RegExp(`(?:创建|建个?|帮我做个?|新建\\s*一个?)\\s*(?:个|一个)?\\s*(.*?)(?:agent|助手|机器人)\\s*[，,：:]*\\s*(.*)$`, 'i'));
    if (kwMatch) {
        const mid = (kwMatch[1] ?? '').trim();
        const tail = (kwMatch[2] ?? '').trim();
        return (tail ? `${mid} ${tail}` : mid).trim() || mid || tail;
    }
    const agentFirst = t.match(/(?:创建|建)\s*agent\s+(.+)$/i);
    if (agentFirst)
        return (agentFirst[1] ?? '').trim();
    return t.replace(prefix, '').trim() || t;
}
/** 调用 LLM 解析用户描述，匹配模板并提取 name、description、handle、systemPrompt */
export async function parseCreateAgentIntent(userInput) {
    const templateList = AGENT_TEMPLATES
        .map((t) => `- ${t.id}: ${t.name}（${t.description}）`)
        .join('\n');
    const systemPrompt = `你是 Agent 创建助手。用户用自然语言描述想创建的 Agent，你需要：
1. 从以下模板中选出最匹配的一个（templateId）
2. 提取 Agent 展示名称（name），可基于用户描述微调，2-12 字中文
3. 提取 Agent 简介（description），1 句话说明用途
4. 生成 handle：短别名用于 @提及，2-20 字符，仅小写字母、数字、连字符，如 数据分析助手→data 或 sjfx，客服助手→kf，代码助手→code
5. 生成 systemPrompt：根据用户描述定制的系统提示词，1-3 句话，明确该 Agent 的角色、擅长领域、可用工具。需具体化，勿用"你是一个 helpful 的 AI 助手"这类泛泛表述。参考模板方向：data-analysis 侧重数据图表、customer-service 侧重礼貌FAQ、code-assistant 侧重编程调试、research 侧重检索归纳。若用户描述过简可写空字符串，将用模板默认
6. 若用户明确指定模型（如"用 gpt-4"），则提取 model；否则为空字符串

模板列表：
${templateList}

必须返回 JSON，且只包含以下字段（无其他文字）：
{"templateId":"模板id","name":"Agent名称","description":"一句话简介","handle":"短别名","systemPrompt":"定制的系统提示词或空","model":"模型id或空","reason":"匹配原因"}`;
    const userMsg = userInput.trim() || '帮我创建个助手';
    const provider = getLLMProvider();
    const result = await provider.complete([{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }], { temperature: 0.2, maxTokens: 512 });
    const content = result.content?.trim() ?? '';
    let jsonStr = content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch)
        jsonStr = jsonMatch[0];
    try {
        const parsed = JSON.parse(jsonStr);
        return parsed;
    }
    catch {
        return {
            templateId: 'general',
            name: userInput.slice(0, 20) || '新助手',
            description: userInput || '通用 AI 助手',
            reason: '解析失败，使用默认',
            error: content.slice(0, 150),
        };
    }
}
/** 校验 handle：仅小写字母、数字、连字符，2-20 字符 */
function sanitizeHandle(s) {
    if (!s?.trim())
        return undefined;
    const cleaned = s.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    return cleaned.length >= 2 && cleaned.length <= 20 ? cleaned : undefined;
}
/** 根据解析结果创建 Agent */
export async function createAgentFromIntent(intent) {
    const templateId = (intent.templateId ?? 'general').trim() || 'general';
    const name = (intent.name ?? '').trim() || '新助手';
    const desc = (intent.description ?? '').trim();
    const description = desc || (AGENT_TEMPLATES.find((t) => t.id === templateId)?.description ?? '');
    const llmPrompt = (intent.systemPrompt ?? '').trim();
    const systemPrompt = llmPrompt.length > 20
        ? llmPrompt
        : (TEMPLATE_PROMPTS[templateId] ?? DEFAULT_SYSTEM_PROMPT);
    const handle = sanitizeHandle(intent.handle);
    const model = intent.model?.trim() || undefined;
    const workerIds = intent.workerIds?.length ? intent.workerIds : (TEMPLATE_WORKER_IDS[templateId] ?? []);
    try {
        const agent = await createAgent({
            name,
            description,
            systemPrompt,
            handle,
            model: model || undefined,
            workerIds: workerIds.length > 0 ? workerIds : undefined,
        });
        return { success: true, agent: { id: agent.id, name: agent.name, handle: agent.handle } };
    }
    catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return { success: false, error: err };
    }
}
/** 生成创建成功后的使用说明文案 */
export function formatAgentCreateResult(result) {
    if (result.success && result.agent) {
        const { name, handle } = result.agent;
        const lines = [
            `✅ Agent「${name}」已创建成功`,
            '',
            '【如何使用】',
            `1. @${name} 你的问题    — 在群里 @ 并提问`,
            `2. #${name} 你的问题    — 部分渠道支持 # 格式`,
            `3. /agent ${name} 问题   — 命令式调用`,
        ];
        if (handle) {
            lines.push(`4. @${handle} 你的问题    — 使用短别名`);
        }
        lines.push('', '提示：可在 Dashboard 中进一步配置该 Agent 的模型、提示词等。');
        return lines.join('\n');
    }
    return `❌ 创建 Agent 失败：${result.error ?? '未知错误'}\n\n请检查名称是否重复，或稍后重试。也可在 Dashboard 手动创建。`;
}
//# sourceMappingURL=agent-create-intent.js.map