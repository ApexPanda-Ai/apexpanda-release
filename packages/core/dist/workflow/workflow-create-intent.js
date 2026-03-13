/**
 * 渠道消息创建工作流：AI 推理 + 模板匹配 + 参数提取
 * 支持命令：/创建工作流 描述 / /create-workflow 描述
 * Phase 2：可选确认模式（APEXPANDA_WORKFLOW_CREATE_CONFIRM=true）
 */
import { getLLMProvider } from '../agent/config.js';
import { listWorkflowTemplatesMerged, getWorkflowTemplateMerged } from './templates.js';
import { createWorkflow, listWorkflows } from './store.js';
import { refreshWorkflowCronScheduler } from './scheduler.js';
/** 正在创建中的工作流名称集合，防止并发重复创建 */
const pendingNames = new Set();
/** 是否启用确认模式：先回复拟创建内容，用户说「确认」后再创建 */
export function isCreateWorkflowConfirmMode() {
    return process.env.APEXPANDA_WORKFLOW_CREATE_CONFIRM === 'true';
}
const pendingCreates = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 分钟
/** 近期创建的工作流缓存，用于防止飞书等多渠道重复投递同一内容导致重复创建 */
const recentCreates = new Map();
const RECENT_CREATE_TTL_MS = 90 * 1000; // 90 秒内相同参数视为重复
function getSessionKey(channel, ctx) {
    return `${channel}:${ctx.chatId ?? ctx.sessionWebhook ?? ctx.messageId ?? 'default'}`;
}
function getRecentCreateKey(channel, chatId, templateId, name, cron) {
    return `${channel}:${chatId ?? ''}:${templateId}:${(name ?? '').trim()}:${(cron ?? '').trim()}`;
}
export function setPendingCreate(channel, ctx, intent) {
    const key = getSessionKey(channel, ctx);
    pendingCreates.set(key, { intent, createdAt: Date.now() });
}
export function getAndClearPendingCreate(channel, ctx) {
    const key = getSessionKey(channel, ctx);
    const pending = pendingCreates.get(key);
    if (!pending)
        return null;
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
        pendingCreates.delete(key);
        return null;
    }
    pendingCreates.delete(key);
    return pending.intent;
}
/** 定时清理过期待确认创建工作流（供 index 定期调用） */
export function cleanupExpiredPendingCreates() {
    const now = Date.now();
    for (const [k, v] of pendingCreates) {
        if (now - v.createdAt > PENDING_TTL_MS)
            pendingCreates.delete(k);
    }
    for (const [k, v] of recentCreates) {
        if (now - v.createdAt > RECENT_CREATE_TTL_MS)
            recentCreates.delete(k);
    }
}
/** 用户消息是否为「确认」 */
export function isConfirmMessage(text) {
    const t = text.trim().toLowerCase();
    return t === '确认' || t === '确定' || t === 'ok' || t === 'yes' || t === '好' || t === '创建';
}
/** 调用 LLM 解析用户描述，匹配模板并提取参数 */
export async function parseCreateWorkflowIntent(userDescription) {
    const templates = await listWorkflowTemplatesMerged();
    const templateList = templates
        .map((t) => `- ${t.id}: ${t.name}（${t.description}）${t.suggestedCron ? '，可定时' : ''}`)
        .join('\n');
    const systemPrompt = `你是工作流创建助手。用户用自然语言描述想创建的工作流，你需要：
1. 从以下模板中选出最匹配的一个（templateId）
2. 提取工作流展示名称（name），规则如下：
   - 舆情监测类：name 格式为「{关键词}舆情监测」，关键词部分最多保留 10 个汉字；若有多个监测对象，用「·」连接各简称（取前 4~5 字），如「XX电子·图灵教育舆情监测」；单个监测对象超长时截取核心简称，如「XXXXXX有限责任公司」→「XXXXXX」
   - 其他类型：name 不超过 15 个汉字，可基于用户描述微调
3. 若用户提到定时（如"每天9点"、"工作日18点"、"每2小时"、"每天16:25"），则输出 cron 表达式（cron）

模板列表：
${templateList}

cron 示例：每天9点=0 9 * * *，每天18点=0 18 * * *，工作日18点=0 18 * * 1-5，每2小时=0 */2 * * *，每周一9点=0 9 * * 1，每天16:25=25 16 * * *，每天16:36=36 16 * * *

必须返回 JSON，且只包含以下字段（无其他文字）：
{"templateId":"模板id 或 空字符串表示无法匹配","name":"工作流名称","cron":"cron表达式 或 空字符串表示不需要定时","reason":"简要说明匹配原因","suggestedTemplateId":"当 templateId 为空时，填写最接近的模板 id，用于引导用户；有匹配时可为空"}
若无法匹配任何模板，templateId 为空字符串，suggestedTemplateId 填最接近的模板 id，reason 说明原因。`;
    const userMsg = userDescription.trim() || '帮我创建个工作流';
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
        return { templateId: '', reason: '无法解析 AI 返回结果', error: content.slice(0, 200) };
    }
}
/** 根据解析结果创建工作流，渠道创建时可传入 channelContext，定时结果将自动发回该渠道 */
export async function createWorkflowFromIntent(intent, channelContext) {
    const { templateId, name, cron } = intent;
    if (!templateId || !templateId.trim()) {
        return { success: false, error: intent.reason ?? '未匹配到合适的工作流模板' };
    }
    const tpl = await getWorkflowTemplateMerged(templateId.trim());
    if (!tpl) {
        return { success: false, error: `模板 ${templateId} 不存在` };
    }
    const finalName = (name ?? tpl.name).trim() || tpl.name;
    // 1. 并发锁：若同名正在创建中，直接跳过
    if (pendingNames.has(finalName)) {
        console.log(`[Workflow] 跳过并发重复创建（${finalName}）`);
        const existing = (await listWorkflows()).find((w) => w.name === finalName);
        if (existing)
            return { success: true, workflow: { id: existing.id, name: existing.name } };
        return { success: false, error: '正在创建中，请稍后重试' };
    }
    // 2. 同名工作流去重：已存在同名工作流则直接返回，不重复创建
    const allWorkflows = await listWorkflows();
    const sameNameWf = allWorkflows.find((w) => w.name === finalName);
    if (sameNameWf) {
        console.log(`[Workflow] 同名工作流已存在，跳过创建（${finalName}）`);
        return { success: true, workflow: { id: sameNameWf.id, name: sameNameWf.name } };
    }
    // 3. 短窗口内存去重（兜底：同 chat + 参数 90 秒内视为重复）
    if (channelContext) {
        const dedupKey = getRecentCreateKey(channelContext.channel, channelContext.ctx.chatId, templateId.trim(), finalName, (cron ?? '').trim());
        const now = Date.now();
        const cached = recentCreates.get(dedupKey);
        if (cached && now - cached.createdAt < RECENT_CREATE_TTL_MS) {
            console.log(`[Workflow] 跳过重复创建（${cached.workflow.name}）`);
            return { success: true, workflow: cached.workflow };
        }
        // 淘汰过期条目
        for (const [k, v] of recentCreates) {
            if (now - v.createdAt > RECENT_CREATE_TTL_MS)
                recentCreates.delete(k);
        }
    }
    pendingNames.add(finalName);
    const triggers = [];
    triggers.push({ type: 'message', command: '/workflow', enabled: true });
    let cronAdded = false;
    if (cron?.trim()) {
        try {
            const cronMod = await import('node-cron');
            if (cronMod.validate(cron.trim())) {
                triggers.push({ type: 'cron', expression: cron.trim(), enabled: true });
                cronAdded = true;
            }
        }
        catch {
            // node-cron validate might throw for invalid
        }
    }
    const outputChannelContext = channelContext && cronAdded && (channelContext.ctx.chatId || channelContext.ctx.sessionWebhook)
        ? { channel: channelContext.channel, ctx: { ...channelContext.ctx, chatType: channelContext.ctx.chatType ?? 'group' } }
        : undefined;
    let w;
    try {
        w = await createWorkflow({
            name: finalName,
            description: tpl.description,
            nodes: tpl.nodes,
            edges: tpl.edges,
            triggers: triggers.length > 0 ? triggers : undefined,
            outputChannelContext,
        });
    }
    finally {
        pendingNames.delete(finalName);
    }
    await refreshWorkflowCronScheduler();
    const workflowResult = { id: w.id, name: w.name };
    if (channelContext) {
        const dedupKey = getRecentCreateKey(channelContext.channel, channelContext.ctx.chatId, templateId.trim(), w.name, (cron ?? '').trim());
        recentCreates.set(dedupKey, { workflow: workflowResult, createdAt: Date.now() });
    }
    return { success: true, workflow: workflowResult };
}
/** 生成面向用户的回复文案 */
export async function formatCreateResult(result, intent) {
    if (result.success && result.workflow) {
        const lines = [
            `✅ 已创建工作流「${result.workflow.name}」`,
            `• 消息触发：\`/workflow ${result.workflow.name} 输入内容\``,
            `• 若已设置定时，结果将自动发送至本群`,
            `• 可在 Dashboard 中编辑或设置定时`,
        ];
        return lines.join('\n');
    }
    // 无完全匹配时，若有最接近模板则引导到 Dashboard 编辑
    if (intent?.suggestedTemplateId?.trim()) {
        const tpl = await getWorkflowTemplateMerged(intent.suggestedTemplateId.trim());
        if (tpl) {
            return `❌ 未找到完全匹配的模板。建议从「${tpl.name}」修改后创建：\n• 前往 Dashboard 工作流页，点击「✓ ${tpl.name}」旁的「编辑」按钮\n• 在编辑器中调整后保存为新工作流`;
        }
    }
    return `❌ 创建工作流失败：${result.error ?? '未知错误'}`;
}
/** 生成待确认的回复文案（Phase 2） */
export async function formatPendingCreatePreview(intent) {
    const tpl = intent.templateId ? await getWorkflowTemplateMerged(intent.templateId.trim()) : null;
    const name = (intent.name ?? tpl?.name ?? '').trim() || '未命名';
    const cron = intent.cron?.trim();
    const lines = [
        `📋 拟创建工作流「${name}」`,
        cron ? `• 定时：${cron}` : `• 仅消息触发`,
        `• 确认请回复：确认`,
        `• 5 分钟内有效，取消请忽略`,
    ];
    return lines.join('\n');
}
//# sourceMappingURL=workflow-create-intent.js.map