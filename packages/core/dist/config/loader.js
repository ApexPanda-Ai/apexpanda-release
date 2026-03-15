/**
 * 配置加载：支持 .apexpanda/config.json + 环境变量覆盖
 * 支持 config 文件热加载：文件变更时自动重新读取，修改默认模型等无需重启
 */
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { watch, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** 配置重载时触发，用于启动新配置的渠道（如 Docker 下安装向导创建 config 后） */
export const configReloadEmitter = new EventEmitter();
import { DEFAULT_INTENT_MAPPINGS } from './default-intent-mappings.js';
export { DEFAULT_INTENT_MAPPINGS };
let cached = null;
/** 获取有效意图映射：内置默认 + 用户自定义，同 phrase 时用户覆盖默认 */
export function getEffectiveIntentMappings() {
    const user = cached?.intentMappings ?? [];
    const byPhrase = new Map();
    for (const m of DEFAULT_INTENT_MAPPINGS) {
        if (m.phrase?.trim() && m.tool?.trim()) {
            byPhrase.set(m.phrase.trim(), { ...m, params: m.params ?? {} });
        }
    }
    for (const m of user) {
        if (m?.phrase?.trim() && m?.tool?.trim()) {
            byPhrase.set(m.phrase.trim(), {
                phrase: m.phrase.trim(),
                tool: m.tool.trim(),
                params: m.params ?? {},
            });
        }
    }
    return Array.from(byPhrase.values());
}
export function getConfigPath() {
    const env = process.env.APEXPANDA_CONFIG_PATH;
    if (env)
        return env;
    const workspace = process.env.APEXPANDA_WORKSPACE ?? '.apexpanda/workspace';
    const base = workspace.split('/')[0] ?? '.apexpanda';
    const defaultPath = join(process.cwd(), base, 'config.json');
    if (existsSync(defaultPath))
        return defaultPath;
    // Monorepo 回退：从项目根运行 (pnpm dev:gateway) 时 cwd 可能是根目录，实际配置在 packages/core
    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const pkgPath = join(__dirname, '..', '..', '.apexpanda', 'config.json');
        if (existsSync(pkgPath))
            return pkgPath;
    }
    catch {
        // ignore
    }
    return defaultPath;
}
export async function loadConfig() {
    if (cached)
        return cached;
    const path = getConfigPath();
    try {
        const raw = await readFile(path, 'utf-8');
        cached = JSON.parse(raw);
    }
    catch {
        cached = {};
    }
    return cached;
}
export function getConfigSync() {
    return cached ?? {};
}
/** 方案 B：从 legacy channels.feishu/telegram 等迁移为 instances（仅内存，不写回文件） */
const LEGACY_TYPES = ['feishu', 'lark', 'telegram', 'slack', 'discord', 'dingtalk', 'wecom', 'whatsapp'];
const LEGACY_NAMES = {
    feishu: '飞书',
    lark: 'Lark',
    telegram: 'Telegram',
    slack: 'Slack',
    discord: 'Discord',
    dingtalk: '钉钉',
    wecom: '企业微信',
    whatsapp: 'WhatsApp',
};
function hasCredentialsForType(cfg, type) {
    if (!cfg)
        return false;
    if (type === 'feishu' || type === 'lark')
        return !!(_trim(cfg.appId) && _trim(cfg.appSecret));
    if (type === 'telegram')
        return !!_trim(cfg.botToken);
    if (type === 'slack')
        return !!_trim(cfg.botToken) && (!!_trim(cfg.appToken) || !!_trim(cfg.signingSecret));
    if (type === 'whatsapp')
        return !!(_trim(cfg.verifyToken) && _trim(cfg.accessToken));
    if (type === 'dingtalk')
        return !!(_trim(cfg.clientId) && _trim(cfg.clientSecret));
    if (type === 'wecom')
        return !!(_trim(cfg.botId) && _trim(cfg.secret));
    if (type === 'discord')
        return !!_trim(cfg.botToken);
    return false;
}
function migrateLegacyToInstances() {
    const instances = cached?.channels?.instances;
    if (instances && Array.isArray(instances) && instances.length > 0) {
        return instances;
    }
    const out = [];
    for (const type of LEGACY_TYPES) {
        const stored = cached?.channels?.[type];
        if (!stored || !hasCredentialsForType(stored, type))
            continue;
        out.push({
            id: `inst_${type}_0`,
            type,
            name: LEGACY_NAMES[type],
            ...stored,
        });
    }
    return out;
}
/** 方案 B：获取所有渠道实例（含从 legacy 迁移的） */
export function getChannelInstances() {
    return migrateLegacyToInstances();
}
/** 方案 B：根据 instanceId 获取实例配置 */
export function getInstanceConfig(instanceId) {
    const instances = getChannelInstances();
    return instances.find((i) => i.id === instanceId);
}
/** 方案 B：根据 instanceId 获取渠道类型（用于 reply 分发） */
export function getInstanceType(instanceId) {
    const inst = getInstanceConfig(instanceId);
    return inst?.type;
}
/** 方案 B：获取绑定到指定 Agent 的渠道实例列表（用于 Agent 员工列表展示）
 * 条件：defaultAgentId === agentId 或 chatRouting 中任一 value === agentId */
export function getChannelsForAgent(agentId) {
    const instances = getChannelInstances();
    const result = [];
    for (const inst of instances) {
        if (!isChannelConfigured(inst.id))
            continue;
        const bound = (inst.defaultAgentId?.trim() === agentId) ||
            (inst.chatRouting && typeof inst.chatRouting === 'object' && Object.values(inst.chatRouting).some((v) => typeof v === 'string' && v.trim() === agentId));
        if (bound) {
            const tpl = CHANNEL_TYPE_TEMPLATES[inst.type];
            result.push({
                id: inst.id,
                type: inst.type,
                name: inst.name ?? tpl?.name ?? inst.type,
            });
        }
    }
    return result;
}
/** 方案 B：渠道类型模板元数据（id, name, connectionMode, webhookPath, configFields） */
export const CHANNEL_TYPE_TEMPLATES = {
    feishu: { name: '飞书', connectionMode: 'ws', webhookPath: '/webhooks/feishu', configFields: ['appId', 'appSecret', 'defaultAgentId', 'mentionEnabled'] },
    lark: { name: 'Lark（飞书国际版）', connectionMode: 'ws', webhookPath: '/webhooks/lark', configFields: ['appId', 'appSecret', 'defaultAgentId', 'mentionEnabled'] },
    dingtalk: { name: '钉钉', connectionMode: 'ws', webhookPath: '/webhooks/dingtalk', configFields: ['clientId', 'clientSecret', 'defaultAgentId', 'mentionEnabled'] },
    wecom: { name: '企业微信', connectionMode: 'ws', webhookPath: '/webhooks/wecom', configFields: ['botId', 'secret', 'defaultAgentId', 'mentionEnabled'] },
    telegram: { name: 'Telegram', connectionMode: 'ws', webhookPath: '/webhooks/telegram', configFields: ['botToken', 'defaultAgentId', 'mentionEnabled'] },
    slack: { name: 'Slack', connectionMode: 'ws', webhookPath: '/webhooks/slack', configFields: ['botToken', 'appToken', 'signingSecret', 'defaultAgentId', 'mentionEnabled'] },
    whatsapp: { name: 'WhatsApp', connectionMode: 'webhook', webhookPath: '/webhooks/whatsapp', configFields: ['verifyToken', 'accessToken', 'phoneNumberId', 'defaultAgentId', 'mentionEnabled'] },
    discord: { name: 'Discord', connectionMode: 'ws', webhookPath: '/webhooks/discord', configFields: ['botToken', 'defaultAgentId', 'mentionEnabled'] },
};
/** 方案 B：添加渠道实例，若 instances 为空则先从 legacy 迁移 */
export async function addChannelInstance(input) {
    const current = await loadConfig();
    const channels = current.channels ?? {};
    let instances = channels.instances ?? [];
    if (!Array.isArray(instances) || instances.length === 0) {
        const migrated = migrateLegacyToInstances();
        instances = migrated;
    }
    const id = `inst_${input.type}_${Date.now()}`;
    const instance = { ...input, id };
    instances = [...instances, instance];
    await saveConfig({ channels: { ...channels, instances } });
    return instance;
}
/** 方案 B：更新渠道实例（不直接修改 cached，确保持久化正确） */
export async function updateChannelInstance(instanceId, patch) {
    const current = await loadConfig();
    const channels = current.channels ?? {};
    const instances = channels.instances ?? [];
    if (!Array.isArray(instances))
        return null;
    const idx = instances.findIndex((i) => i.id === instanceId);
    if (idx < 0)
        return null;
    const next = { ...instances[idx], ...patch };
    const updatedInstances = instances.map((inst, i) => (i === idx ? next : inst));
    const channelsPatch = { ...channels, instances: updatedInstances };
    await saveConfig({ channels: channelsPatch });
    return next;
}
/** 方案 B：删除渠道实例 */
export async function deleteChannelInstance(instanceId) {
    const current = await loadConfig();
    const channels = current.channels ?? {};
    const instances = channels.instances ?? [];
    if (!Array.isArray(instances))
        return false;
    const filtered = instances.filter((i) => i.id !== instanceId);
    if (filtered.length === instances.length)
        return false;
    await saveConfig({ channels: { ...channels, instances: filtered } });
    return true;
}
/** 获取 OpenClaw 兼容的 per-skill 环境变量（用于脚本执行时注入） */
export function getSkillEntryEnv(skillName, primaryEnv, altKey) {
    const cfg = cached ?? {};
    const entry = cfg.skills?.entries?.[skillName] ?? (altKey ? cfg.skills?.entries?.[altKey] : undefined);
    if (!entry)
        return {};
    const out = {};
    if (entry.env && typeof entry.env === 'object') {
        for (const [k, v] of Object.entries(entry.env)) {
            if (typeof v === 'string')
                out[k] = v;
        }
    }
    if (primaryEnv && entry.apiKey && typeof entry.apiKey === 'string') {
        out[primaryEnv] = entry.apiKey;
    }
    return out;
}
/** 获取 per-skill 的 config（供 OpenClaw 脚本通过 APEX_SKILL_CONFIG 环境变量读取） */
export function getSkillEntryConfig(skillName, altKey) {
    const cfg = cached ?? {};
    const entry = cfg.skills?.entries?.[skillName] ?? (altKey ? cfg.skills?.entries?.[altKey] : undefined);
    if (!entry?.config || typeof entry.config !== 'object')
        return {};
    return entry.config;
}
/** 清除缓存，下次 loadConfig 会重新读取 */
export function invalidateConfigCache() {
    cached = null;
}
/** 输出当前配置摘要到终端（供排查问题，不输出密钥） */
export function logConfigSummary() {
    const cfg = cached ?? {};
    const enabled = [];
    const names = { feishu: '飞书', lark: 'Lark', telegram: 'Telegram', slack: 'Slack', discord: 'Discord', dingtalk: '钉钉', wecom: '企业微信', whatsapp: 'WhatsApp' };
    for (const id of Object.keys(names)) {
        if (isChannelConfigured(id))
            enabled.push(names[id] ?? id);
    }
    const llm = cfg.llm;
    const model = llm?.model ?? process.env.APEXPANDA_LLM_MODEL ?? '-';
    const baseUrl = llm?.baseUrl ?? process.env.APEXPANDA_LLM_BASE_URL ?? process.env.OPENAI_API_BASE_URL ?? '-';
    const host = typeof baseUrl === 'string' && baseUrl !== '-' ? baseUrl.replace(/^https?:\/\//, '').split('/')[0] ?? baseUrl : baseUrl;
    const epCount = Object.keys(llm?.endpoints ?? {}).length;
    console.log('[ApexPanda] 配置已加载 | 模型:', model, '| API:', host, epCount > 0 ? `| 端点:${epCount}个` : '', '| 渠道:', enabled.length > 0 ? enabled.join('、') : '无');
}
let _configWatchActive = false;
let _configWatchPollTimer = null;
function _doWatchConfig(path) {
    if (_configWatchActive)
        return;
    _configWatchActive = true;
    if (_configWatchPollTimer) {
        clearInterval(_configWatchPollTimer);
        _configWatchPollTimer = null;
    }
    let debounce = null;
    try {
        watch(path, (event, filename) => {
            if (event !== 'change' || !filename)
                return;
            if (debounce)
                clearTimeout(debounce);
            debounce = setTimeout(() => {
                debounce = null;
                cached = null;
                loadConfig().then(() => {
                    logConfigSummary();
                    console.log('[ApexPanda] 配置热加载完成，渠道将自动重载');
                    configReloadEmitter.emit('reload');
                }).catch(() => { });
            }, 300);
        });
    }
    catch {
        _configWatchActive = false;
    }
}
/** 启动 config 文件监视，变更时自动热加载（无需重启网关） */
/** 若启动时文件不存在（如 Docker 首次运行），则轮询等待文件创建后再注册 watch */
export function startConfigWatch() {
    const path = getConfigPath();
    if (existsSync(path)) {
        _doWatchConfig(path);
        return;
    }
    if (_configWatchPollTimer)
        return;
    _configWatchPollTimer = setInterval(() => {
        if (existsSync(path)) {
            if (_configWatchPollTimer) {
                clearInterval(_configWatchPollTimer);
                _configWatchPollTimer = null;
            }
            _doWatchConfig(path);
        }
    }, 5000);
}
/** 保存配置到 config.json（合并现有配置），保存后立即更新内存缓存 */
export async function saveConfig(patch) {
    const current = await loadConfig();
    let llm = patch.llm ? { ...current.llm, ...patch.llm } : current.llm;
    if (patch.llm) {
        let endpoints = patch.llm.endpointsToRemove?.length
            ? Object.fromEntries(Object.entries(current.llm?.endpoints ?? {}).filter(([k]) => !patch.llm.endpointsToRemove.includes(k)))
            : current.llm?.endpoints ?? {};
        if (patch.llm.endpoints !== undefined) {
            for (const [k, v] of Object.entries(patch.llm.endpoints)) {
                if (v && typeof v.baseUrl === 'string') {
                    const cur = (endpoints[k] || {});
                    endpoints[k] = {
                        baseUrl: v.baseUrl,
                        apiKey: v.apiKey ?? cur.apiKey,
                    };
                }
            }
        }
        if (patch.llm.endpoints !== undefined || patch.llm.endpointsToRemove?.length) {
            llm = { ...llm, endpoints };
        }
        const newModel = patch.llm.model?.trim();
        if (newModel) {
            const ep = endpoints[newModel];
            if (ep?.baseUrl) {
                llm = { ...llm, baseUrl: ep.baseUrl };
            }
            if (ep?.apiKey) {
                llm = { ...llm, apiKey: ep.apiKey };
            }
        }
    }
    if (llm && 'endpointsToRemove' in llm) {
        const { endpointsToRemove: _, ...rest } = llm;
        llm = rest;
    }
    const discussion = patch.discussion
        ? { ...current.discussion, ...patch.discussion }
        : current.discussion;
    const memory = patch.memory
        ? { ...current.memory, ...patch.memory }
        : current.memory;
    const mcp = patch.mcp
        ? {
            ...current.mcp,
            ...patch.mcp,
            client: patch.mcp.client
                ? { ...(current.mcp?.client ?? {}), ...patch.mcp.client }
                : current.mcp?.client,
        }
        : current.mcp;
    const multiAgent = patch.multiAgent !== undefined && typeof patch.multiAgent === 'object'
        ? { ...current.multiAgent, ...patch.multiAgent }
        : current.multiAgent;
    const next = {
        ...current,
        ...patch,
        llm,
        channels: patch.channels ? { ...current.channels, ...patch.channels } : current.channels,
        discussion,
        memory,
        mcp,
        multiAgent,
    };
    const path = getConfigPath();
    await mkdir(dirname(path), { recursive: true });
    const toWrite = JSON.stringify(next, null, 2);
    await writeFile(path, toWrite, 'utf-8');
    invalidateConfigCache();
    cached = JSON.parse(toWrite);
    startConfigWatch();
    const parts = [];
    if (patch.channels)
        parts.push('渠道');
    if (patch.llm)
        parts.push('模型');
    if (patch.workspace !== undefined)
        parts.push('工作区');
    if (patch.mcp !== undefined)
        parts.push('MCP');
    if (patch.skills !== undefined)
        parts.push('Skills');
    if (patch.intentMappings !== undefined)
        parts.push('意图映射');
    if (patch.defaultAgentId !== undefined)
        parts.push('默认Agent');
    if (patch.multiAgent !== undefined)
        parts.push('multiAgent');
    if (parts.length > 0)
        console.log('[ApexPanda] 配置已保存:', parts.join('、'), '→', path);
    configReloadEmitter.emit('reload');
    if (patch.mcp !== undefined) {
        try {
            const { closeMcpConnections } = await import('../mcp/client.js');
            closeMcpConnections();
        }
        catch {
            /* mcp/client may not be loaded */
        }
    }
}
/** 获取渠道配置（环境变量优先，其次 config）
 * 方案 B：channelId 可为 instanceId，此时从 getInstanceConfig 获取 */
export function getChannelConfig(channelIdOrInstanceId) {
    const inst = getInstanceConfig(channelIdOrInstanceId);
    if (inst)
        return inst;
    const fromConfig = cached?.channels?.[channelIdOrInstanceId];
    if (channelIdOrInstanceId === 'feishu' || channelIdOrInstanceId === 'lark') {
        const feishuCfg = cached?.channels?.feishu;
        const larkCfg = cached?.channels?.lark;
        return {
            appId: process.env.FEISHU_APP_ID ?? fromConfig?.appId ?? (channelIdOrInstanceId === 'lark' ? feishuCfg?.appId : larkCfg?.appId),
            appSecret: process.env.FEISHU_APP_SECRET ?? fromConfig?.appSecret ?? (channelIdOrInstanceId === 'lark' ? feishuCfg?.appSecret : larkCfg?.appSecret),
        };
    }
    if (channelIdOrInstanceId === 'telegram') {
        return { botToken: process.env.TELEGRAM_BOT_TOKEN ?? fromConfig?.botToken };
    }
    if (channelIdOrInstanceId === 'slack') {
        return {
            botToken: process.env.SLACK_BOT_TOKEN ?? fromConfig?.botToken,
            signingSecret: process.env.SLACK_SIGNING_SECRET ?? fromConfig?.signingSecret,
            appToken: process.env.SLACK_APP_TOKEN ?? fromConfig?.appToken,
        };
    }
    if (channelIdOrInstanceId === 'whatsapp') {
        return {
            verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? fromConfig?.verifyToken,
            accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? fromConfig?.accessToken,
            phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? fromConfig?.phoneNumberId,
        };
    }
    if (channelIdOrInstanceId === 'dingtalk') {
        return {
            clientId: process.env.DINGTALK_CLIENT_ID ?? fromConfig?.clientId,
            clientSecret: process.env.DINGTALK_CLIENT_SECRET ?? fromConfig?.clientSecret,
        };
    }
    if (channelIdOrInstanceId === 'wecom') {
        return {
            botId: process.env.WECOM_BOT_ID ?? fromConfig?.botId,
            secret: process.env.WECOM_SECRET ?? fromConfig?.secret,
        };
    }
    if (channelIdOrInstanceId === 'discord') {
        return {
            botToken: process.env.DISCORD_BOT_TOKEN ?? fromConfig?.botToken,
        };
    }
    return fromConfig;
}
export function getFeishuAppId() {
    return getChannelConfig('feishu')?.appId ?? '';
}
export function getFeishuAppSecret() {
    return getChannelConfig('feishu')?.appSecret ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getTelegramBotToken(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'telegram')?.botToken ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getSlackBotToken(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'slack')?.botToken ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getSlackSigningSecret(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'slack')?.signingSecret ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getSlackAppToken(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'slack')?.appToken ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getDiscordBotToken(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'discord')?.botToken ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getWhatsAppVerifyToken(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'whatsapp')?.verifyToken ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getWhatsAppAccessToken(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'whatsapp')?.accessToken ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getWhatsAppPhoneNumberId(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'whatsapp')?.phoneNumberId ?? '';
}
/** 钉钉 Stream 模式 Client ID（AppKey） */
export function getDingTalkClientId(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'dingtalk')?.clientId ?? '';
}
/** 钉钉 Stream 模式 Client Secret（AppSecret） */
export function getDingTalkClientSecret(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'dingtalk')?.clientSecret ?? '';
}
/** @param channelOrInstanceId 方案 B：多实例时传入 instanceId */
export function getWeComSecret(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'wecom')?.secret ?? '';
}
/** 企业微信智能机器人 Bot ID */
export function getWecomBotId(channelOrInstanceId) {
    return getChannelConfig(channelOrInstanceId ?? 'wecom')?.botId ?? '';
}
/** 获取微信公众号 AppID（用于 wechat-mp-publish skill，来源：环境变量或 skills.entries） */
export function getWechatMpAppId() {
    const fromEnv = process.env.WECHAT_MP_APP_ID;
    if (fromEnv?.trim())
        return fromEnv.trim();
    const entry = cached?.skills?.entries?.['wechat-mp-publish'];
    return (entry?.env?.WECHAT_MP_APP_ID ?? '').trim();
}
/** 获取微信公众号 AppSecret */
export function getWechatMpAppSecret() {
    const fromEnv = process.env.WECHAT_MP_APP_SECRET;
    if (fromEnv?.trim())
        return fromEnv.trim();
    const entry = cached?.skills?.entries?.['wechat-mp-publish'];
    return (entry?.env?.WECHAT_MP_APP_SECRET ?? '').trim();
}
/** 获取全局默认 Agent ID（Chat 页面未选 Agent、渠道未配置 defaultAgentId 时使用） */
export function getDefaultAgentId() {
    return cached?.defaultAgentId?.trim() || undefined;
}
/** 获取渠道绑定的默认 ApexPanda Agent ID（@ 未匹配时使用），渠道未配置时回退到全局 defaultAgentId */
export function getChannelDefaultAgentId(channelId) {
    const ch = getChannelConfig(channelId);
    const channelDefault = ch?.defaultAgentId?.trim();
    if (channelDefault)
        return channelDefault;
    const global = cached?.defaultAgentId?.trim();
    return global || undefined;
}
/** 获取会话级路由的 Agent ID（chatRouting[chatId]），未命中时返回 undefined
 * 方案 B：channelId 可为 instanceId，从 getInstanceConfig 获取 chatRouting */
export function getChannelChatRoutingAgentId(channelId, chatId) {
    if (!chatId?.trim())
        return undefined;
    const ch = getChannelConfig(channelId);
    const routing = ch?.chatRouting;
    if (!routing || typeof routing !== 'object')
        return undefined;
    const agentId = routing[chatId.trim()];
    return typeof agentId === 'string' && agentId.trim() ? agentId.trim() : undefined;
}
/** 渠道是否启用 @Agent 解析，默认 true */
export function getChannelMentionEnabled(channelId) {
    const ch = getChannelConfig(channelId);
    if (ch?.mentionEnabled === false)
        return false;
    return true;
}
/** 定时工作流结果推送目标，配置 workflows.cronOutput 后返回 { channel, ctx }
 * 方案 B：instanceId 优先于 channel，用于多实例推送 */
export function getWorkflowCronOutputConfig() {
    const cfg = cached?.workflows?.cronOutput;
    const instanceId = cfg?.instanceId?.trim();
    if (instanceId) {
        const inst = getInstanceConfig(instanceId);
        if (!inst)
            return null;
        if (inst.type === 'dingtalk' && cfg?.sessionWebhook?.trim()) {
            return { channel: instanceId, ctx: { sessionWebhook: cfg.sessionWebhook.trim(), chatType: 'group' } };
        }
        if ((inst.type === 'feishu' || inst.type === 'lark' || inst.type === 'telegram' || inst.type === 'slack' || inst.type === 'wecom' || inst.type === 'discord') && cfg?.chatId?.trim()) {
            return { channel: instanceId, ctx: { chatId: cfg.chatId.trim(), chatType: 'group' } };
        }
        if (inst.type === 'whatsapp' && cfg?.chatId?.trim()) {
            const phoneNumberId = cfg.phoneNumberId?.trim() || getWhatsAppPhoneNumberId(instanceId);
            if (phoneNumberId) {
                return { channel: instanceId, ctx: { chatId: cfg.chatId.trim(), phoneNumberId, chatType: 'group' } };
            }
        }
    }
    if (!cfg?.channel?.trim())
        return null;
    const ch = cfg.channel.trim().toLowerCase();
    if (ch === 'dingtalk' && cfg.sessionWebhook?.trim()) {
        return { channel: 'dingtalk', ctx: { sessionWebhook: cfg.sessionWebhook.trim(), chatType: 'group' } };
    }
    if ((ch === 'feishu' || ch === 'lark' || ch === 'telegram' || ch === 'slack' || ch === 'wecom' || ch === 'discord') && cfg.chatId?.trim()) {
        return { channel: ch === 'lark' ? 'feishu' : ch, ctx: { chatId: cfg.chatId.trim(), chatType: 'group' } };
    }
    if (ch === 'whatsapp' && cfg.chatId?.trim()) {
        const phoneNumberId = cfg.phoneNumberId?.trim() || getWhatsAppPhoneNumberId('whatsapp');
        if (phoneNumberId) {
            return { channel: 'whatsapp', ctx: { chatId: cfg.chatId.trim(), phoneNumberId, chatType: 'group' } };
        }
    }
    return null;
}
function _trim(s) {
    return (typeof s === 'string' ? s.trim() : '') || '';
}
/** 判断渠道是否有有效凭证（不检查 enabled 开关）
 * 方案 B：channelId 可为 instanceId */
function hasChannelCredentials(channelId) {
    const cfg = getChannelConfig(channelId);
    if (!cfg)
        return false;
    const inst = getInstanceConfig(channelId);
    const type = inst?.type ?? (LEGACY_TYPES.includes(channelId) ? channelId : undefined);
    if (type)
        return hasCredentialsForType(cfg, type);
    return false;
}
/** 判断渠道是否已配置并启用（有凭证且未手动停用）
 * 方案 B：channelId 可为 instanceId */
export function isChannelConfigured(channelId) {
    if (!hasChannelCredentials(channelId))
        return false;
    const inst = getInstanceConfig(channelId);
    if (inst)
        return inst.enabled !== false;
    const stored = cached?.channels?.[channelId];
    if (stored && stored.enabled === false)
        return false;
    return true;
}
/** 渠道是否有有效凭证（用于 UI 显示停用/启用按钮） */
export function hasChannelCredentialsForUi(channelId) {
    return hasChannelCredentials(channelId);
}
/** 渠道是否允许通过消息创建 Agent（channels.<id>.agentCreateEnabled，默认 true） */
export function isChannelAgentCreateEnabled(channelId) {
    const cfg = getChannelConfig(channelId);
    if (!cfg)
        return true;
    return cfg.agentCreateEnabled !== false;
}
const DEFAULT_DISCUSSION_END_PHRASES = [
    '结束讨论', '讨论结束', '结束', '停止讨论', '停止',
    '可以了', '好了', '行了', '出结果吧', '给总结吧', '结束会议', '散会',
];
/** 获取长期记忆配置，未配置时使用默认值 */
export function getMemoryConfig() {
    const m = cached?.memory ?? {};
    const fromEnv = process.env.APEXPANDA_MEMORY_PERSIST;
    const persist = fromEnv !== undefined
        ? fromEnv === 'true' || fromEnv === '1'
        : (m.persist ?? true);
    return {
        persist: !!persist,
        decayHalfLifeDays: Math.max(0, Math.min(3650, m.decayHalfLifeDays ?? 30)),
        logHalfLifeDays: Math.max(1, Math.min(90, m.logHalfLifeDays ?? 7)),
        exportMarkdown: !!m.exportMarkdown,
        postDialogueFlushRounds: Math.max(0, Math.min(20, m.postDialogueFlushRounds ?? 0)),
        preCompactionFlush: !!m.preCompactionFlush,
        sessionIndexInSearch: !!m.sessionIndexInSearch,
        maxEntriesPerScope: Math.max(0, Math.min(10000, m.maxEntriesPerScope ?? 500)),
        sessionContextBoost: m.sessionContextBoost !== false,
        graphExpand: m.graphExpand !== false,
        consolidationEnabled: !!m.consolidationEnabled,
        consolidationCron: typeof m.consolidationCron === 'string' ? m.consolidationCron.trim() : '',
        preInjectTopK: Math.max(0, Math.min(20, m.preInjectTopK ?? 5)),
    };
}
/** 获取多 Agent 协同配置 */
export function getMultiAgentConfig() {
    const m = cached?.multiAgent ?? {};
    const ls = m.leaderSelection;
    const validLs = ls === 'first' || ls === 'capability' ? ls : 'workerIds';
    const cm = m.collabMode;
    const validCm = cm === 'pipeline' || cm === 'parallel' || cm === 'plan' ? cm : 'supervisor';
    const llmFallback = m.llmModeSelectionFallback !== false;
    return { leaderSelection: validLs, collabMode: validCm, planConfirmRequired: m.planConfirmRequired === true, llmModeSelectionFallback: llmFallback };
}
/** 阶段三：获取 Verify 验证配置（无 config 时默认开启） */
export function getVerifyConfig() {
    const m = cached?.multiAgent ?? {};
    return {
        enabled: m.verifyEnabled !== false,
        maxRetries: Math.max(1, Math.min(10, m.verifyMaxRetries ?? 3)),
    };
}
/** 阶段一：获取 Agent 自动选择器配置 */
export function getAgentSelectorConfig() {
    const m = cached?.multiAgent ?? {};
    const enabled = m.autoSelectAgent !== false; // 无 config 时默认开启
    const maxAgents = Math.max(1, Math.min(5, m.autoSelectMaxAgents ?? 3));
    const threshold = typeof m.autoSelectThreshold === 'number' ? Math.max(0, Math.min(1, m.autoSelectThreshold)) : 0.6;
    return { enabled, maxAgents, threshold };
}
/** 获取讨论配置（创新模式），未配置时使用默认值 */
export function getDiscussionConfig() {
    const d = cached?.discussion ?? {};
    return {
        defaultRounds: d.defaultRounds ?? 3,
        maxRounds: Math.min(10, d.maxRounds ?? 10),
        maxAgents: d.maxAgents ?? 5,
        endPhrases: (d.endPhrases?.length ? d.endPhrases : DEFAULT_DISCUSSION_END_PHRASES),
        timeoutMinutes: d.timeoutMinutes ?? 15,
    };
}
/** 混合检索是否启用（config 优先，env APEXPANDA_HYBRID_SEARCH_ENABLED 可覆盖） */
export function getHybridSearchEnabled() {
    const v = process.env.APEXPANDA_HYBRID_SEARCH_ENABLED;
    if (v !== undefined && v !== '')
        return v !== 'false';
    const cfg = cached?.knowledge?.hybridSearch?.enabled;
    if (typeof cfg === 'boolean')
        return cfg;
    return true;
}
/** 知识库 Rerank 配置（环境变量 APEXPANDA_RERANK_ENABLED 可覆盖 enabled） */
export function getKnowledgeRerankConfig() {
    const r = cached?.knowledge?.rerank;
    const envEnabled = process.env.APEXPANDA_RERANK_ENABLED;
    const enabled = envEnabled !== undefined ? envEnabled === 'true' : (r?.enabled ?? false);
    if (!enabled)
        return null;
    const provider = (r?.provider === 'cohere' ? 'cohere' : r?.provider === 'jina' ? 'jina' : 'local');
    if (provider === 'local') {
        return {
            enabled: true,
            provider: 'local',
            model: r?.model?.trim() || undefined,
            topK: typeof r?.topK === 'number' && r.topK >= 1 ? r.topK : undefined,
        };
    }
    const apiKey = r?.apiKey?.trim() ??
        (provider === 'cohere' ? process.env.COHERE_API_KEY : process.env.JINA_API_KEY)?.trim();
    if (!apiKey)
        return null;
    return {
        enabled: true,
        provider,
        model: r?.model?.trim() || undefined,
        topK: typeof r?.topK === 'number' && r.topK >= 1 ? r.topK : undefined,
        apiKey,
    };
}
/** 获取 LLM baseUrl（config 优先，env 覆盖） */
export function getLLMBaseUrl() {
    return (process.env.APEXPANDA_LLM_BASE_URL ??
        cached?.llm?.baseUrl ??
        'https://api.openai.com/v1');
}
/** 是否仅从环境变量读取密钥（禁用 config.json 中的明文） */
export function isSecretsFromEnvOnly() {
    return process.env.APEXPANDA_SECRETS_FROM_ENV_ONLY === 'true';
}
/** 获取 LLM API Key（APEXPANDA_SECRETS_FROM_ENV_ONLY=true 时不读 config.json） */
export function getLLMApiKey() {
    const fromEnv = process.env.APEXPANDA_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    if (fromEnv)
        return fromEnv;
    if (isSecretsFromEnvOnly())
        return '';
    return cached?.llm?.apiKey ?? '';
}
/** 获取 LLM 模型（config 优先级：当 config 有 endpoints 时，使用 config.model，便于 Settings 选择生效） */
export function getLLMModel() {
    const fromConfig = cached?.llm?.model?.trim();
    const fromEnv = process.env.APEXPANDA_LLM_MODEL?.trim();
    const hasEndpoints = cached?.llm?.endpoints && Object.keys(cached.llm.endpoints).length > 0;
    if (hasEndpoints && fromConfig)
        return fromConfig;
    return fromEnv ?? fromConfig ?? 'gpt-4o-mini';
}
/** 获取 LLM 备用模型（主模型失败时自动切换） */
export function getLLMFallbackModel() {
    const v = process.env.APEXPANDA_LLM_FALLBACK_MODEL ?? cached?.llm?.fallbackModel;
    return v?.trim() || undefined;
}
/** 获取 LLM 输出 token 上限，默认 8192（兼容大部分 API；环境变量 APEXPANDA_MAX_OUTPUT_TOKENS 可覆盖） */
export function getMaxOutputTokens() {
    const env = process.env.APEXPANDA_MAX_OUTPUT_TOKENS;
    if (env) {
        const n = parseInt(env, 10);
        if (Number.isFinite(n) && n > 0)
            return Math.min(n, 131072);
    }
    const cfg = cached?.llm?.maxOutputTokens;
    if (typeof cfg === 'number' && cfg > 0)
        return Math.min(cfg, 131072);
    return 8192;
}
/** 根据 model 获取对应 baseUrl + apiKey；无 endpoint 时用全局 baseUrl/apiKey */
export function getLLMConfigForModel(model) {
    const ep = cached?.llm?.endpoints?.[model];
    const baseUrl = ep?.baseUrl ?? getLLMBaseUrl();
    let apiKey;
    if (isSecretsFromEnvOnly()) {
        apiKey = getLLMApiKey();
    }
    else if (ep?.apiKey && typeof ep.apiKey === 'string') {
        apiKey = ep.apiKey;
    }
    else {
        apiKey = getLLMApiKey();
    }
    return { baseUrl, apiKey };
}
/** 获取工作区目录 */
export function getWorkspaceDir() {
    return (process.env.APEXPANDA_WORKSPACE ??
        cached?.workspace ??
        '.apexpanda/workspace');
}
/** 获取 Agent 产出根目录（相对工作区），默认 .apexpanda/output */
export function getOutputDir() {
    return process.env.APEXPANDA_OUTPUT_DIR ?? ".apexpanda/output";
}
/** 删除操作是否需二次确认，默认 true；环境变量优先，其次 config */
export function getDeleteConfirmRequired() {
    const v = process.env.APEXPANDA_DELETE_CONFIRM_REQUIRED;
    if (v !== undefined && v !== "")
        return v === "true" || v === "1";
    if (cached?.deleteConfirmRequired === false)
        return false;
    if (cached?.deleteConfirmRequired === true)
        return true;
    return true;
}
/** 产出路径中的 ID 安全化，避免文件系统非法字符 */
function sanitizeScopeId(id) {
    return String(id).replace(/[/\\?*:]/g, "_").replace(/^\.+/, "") || "default";
}
/**
 * 根据 Agent 可见性与会话信息，推导产出基础路径（相对工作区）
 * 与记忆 scope 设计一致：shared→user/group；agent-only→agent/{id}/user|group/...
 */
export function getOutputBasePath(opts) {
    const outputDir = getOutputDir();
    const { agentId, agentMemoryVisibility = "shared", userId, memoryScopeHint } = opts;
    const hint = memoryScopeHint ?? "";
    const isGroup = hint.startsWith("group:");
    const isUserScope = hint.startsWith("user:");
    const groupId = isGroup ? sanitizeScopeId(hint.slice(6)) : "";
    const effectiveUserId = userId ? sanitizeScopeId(userId) : isUserScope ? sanitizeScopeId(hint.slice(5)) : "";
    if (!effectiveUserId && !groupId) {
        return `${outputDir}/default`;
    }
    if (agentMemoryVisibility === "agent-only" && agentId) {
        const safeAgentId = sanitizeScopeId(agentId);
        if (isGroup && groupId && effectiveUserId) {
            return `${outputDir}/agent/${safeAgentId}/group/${groupId}/user/${effectiveUserId}`;
        }
        if (effectiveUserId) {
            return `${outputDir}/agent/${safeAgentId}/user/${effectiveUserId}`;
        }
    }
    if (isGroup && groupId) {
        return `${outputDir}/group/${groupId}`;
    }
    if (effectiveUserId) {
        return `${outputDir}/user/${effectiveUserId}`;
    }
    return `${outputDir}/default`;
}
//# sourceMappingURL=loader.js.map