/**
 * 会话存储（内存 + 可选文件持久化）
 * 按 sessionId 保存对话历史，支持多租户 tenantId 隔离
 * 会话元数据：渠道、Agent、创建/最后活跃时间（Phase 2）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const sessions = new Map();
const sessionMetaMap = new Map();
/** 单会话最大消息数，超出时丢弃最旧（用于 Phase 4 压缩前沉淀） */
export const SESSION_MAX_HISTORY = 20;
/** 单条消息最大存储字符数，防止截图 base64 等大体积数据撑爆历史 */
const MAX_MSG_CHARS = 80_000;
/**
 * 存入历史前清理大体积内容：
 * 1. 替换 data URL base64 图片
 * 2. 替换 JSON 中的 imageBase64 字段
 * 3. 总长度超限时截断
 */
function sanitizeForHistory(content) {
    if (content.length <= MAX_MSG_CHARS)
        return content;
    // 替换 data:image/...;base64,... 格式
    let s = content.replace(/data:image\/[^;,\s]{1,30};base64,[A-Za-z0-9+/]{200,}={0,2}/g, '[图片Base64已省略]');
    // 替换 JSON 中 "imageBase64": "..." 字段
    s = s.replace(/"imageBase64"\s*:\s*"[A-Za-z0-9+/]{200,}={0,2}"/g, '"imageBase64":"[已省略]"');
    if (s.length <= MAX_MSG_CHARS)
        return s;
    return s.slice(0, MAX_MSG_CHARS) + `\n[内容已截断，原始长度 ${content.length} 字符]`;
}
function sessionKey(tenantId, sessionId) {
    return tenantId ? `t:${tenantId}:${sessionId}` : sessionId;
}
function getSessionsPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'sessions.json');
}
function getMetaPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'sessions-meta.json');
}
async function loadFromFile() {
    const path = getSessionsPath();
    try {
        const raw = await readFile(path, 'utf-8');
        const data = JSON.parse(raw);
        sessions.clear();
        for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v))
                sessions.set(k, v);
        }
    }
    catch {
        // 文件不存在或格式错误
    }
}
async function loadMetaFromFile() {
    const path = getMetaPath();
    try {
        const raw = await readFile(path, 'utf-8');
        const data = JSON.parse(raw);
        sessionMetaMap.clear();
        for (const [k, v] of Object.entries(data)) {
            if (v && typeof v.createdAt === 'number' && typeof v.lastActivityAt === 'number') {
                sessionMetaMap.set(k, { ...v });
            }
        }
    }
    catch {
        // 文件不存在或格式错误
    }
}
async function saveToFile() {
    if (process.env.APEXPANDA_SESSIONS_PERSIST === 'false')
        return;
    const path = getSessionsPath();
    const data = Object.fromEntries(sessions);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 0), 'utf-8');
}
async function saveMetaToFile() {
    if (process.env.APEXPANDA_SESSIONS_PERSIST === 'false')
        return;
    const path = getMetaPath();
    const data = Object.fromEntries(sessionMetaMap);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 0), 'utf-8');
}
let loaded = false;
async function ensureLoaded() {
    if (!loaded) {
        if (process.env.APEXPANDA_SESSIONS_PERSIST !== 'false') {
            await loadFromFile();
            await loadMetaFromFile();
        }
        loaded = true;
    }
}
export async function getSessionHistory(sessionId, tenantId) {
    await ensureLoaded();
    const key = sessionKey(tenantId, sessionId);
    return sessions.get(key) ?? [];
}
export async function appendToSession(sessionId, role, content, tenantId, meta) {
    await ensureLoaded();
    const key = sessionKey(tenantId, sessionId);
    const arr = sessions.get(key) ?? [];
    arr.push({ role, content: sanitizeForHistory(content) });
    if (arr.length > SESSION_MAX_HISTORY)
        arr.splice(0, arr.length - SESSION_MAX_HISTORY);
    sessions.set(key, arr);
    const now = Date.now();
    if (meta) {
        const existing = sessionMetaMap.get(key);
        sessionMetaMap.set(key, {
            ...existing,
            ...meta,
            createdAt: existing?.createdAt ?? now,
            lastActivityAt: now,
        });
        saveMetaToFile().catch(() => { });
    }
    else {
        const existing = sessionMetaMap.get(key);
        if (existing) {
            existing.lastActivityAt = now;
            saveMetaToFile().catch(() => { });
        }
    }
    saveToFile().catch(() => { });
}
export async function listSessionIds(tenantId) {
    await ensureLoaded();
    const keys = Array.from(sessions.keys());
    if (!tenantId)
        return keys.filter((k) => !k.startsWith('t:'));
    const prefix = `t:${tenantId}:`;
    return keys
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
}
export async function listSessionsWithMeta(tenantId) {
    await ensureLoaded();
    const keys = Array.from(sessions.keys());
    const prefix = tenantId ? `t:${tenantId}:` : '';
    const filtered = !tenantId
        ? keys.filter((k) => !k.startsWith('t:'))
        : keys.filter((k) => k.startsWith(prefix));
    return filtered.map((storageKey) => {
        const id = tenantId ? storageKey.slice(prefix.length) : storageKey;
        const arr = sessions.get(storageKey) ?? [];
        const meta = sessionMetaMap.get(storageKey);
        return { id, messageCount: arr.length, meta };
    });
}
export function getSessionMeta(sessionId, tenantId) {
    const key = sessionKey(tenantId, sessionId);
    return sessionMetaMap.get(key);
}
/** 设置/取消会话级自动执行模式，该会话后续节点命令免审批 */
export async function setSessionAutoApprove(sessionId, value, tenantId) {
    await ensureLoaded();
    const key = sessionKey(tenantId, sessionId);
    const now = Date.now();
    const existing = sessionMetaMap.get(key);
    sessionMetaMap.set(key, {
        ...existing,
        channel: existing?.channel,
        agentId: existing?.agentId,
        userId: existing?.userId,
        peer: existing?.peer,
        autoApprove: value,
        createdAt: existing?.createdAt ?? now,
        lastActivityAt: now,
    });
    saveMetaToFile().catch(() => { });
}
export async function clearSession(sessionId, tenantId) {
    const key = sessionKey(tenantId, sessionId);
    sessions.delete(key);
    sessionMetaMap.delete(key);
    saveToFile().catch(() => { });
    saveMetaToFile().catch(() => { });
}
/** 删除指定租户所有会话（PIPL 用户数据删除/被遗忘权） */
export async function deleteAllSessionsForTenant(tenantId) {
    await ensureLoaded();
    const prefix = `t:${tenantId}:`;
    let count = 0;
    for (const k of Array.from(sessions.keys())) {
        if (k.startsWith(prefix)) {
            sessions.delete(k);
            sessionMetaMap.delete(k);
            count++;
        }
    }
    if (count > 0) {
        saveToFile().catch(() => { });
        saveMetaToFile().catch(() => { });
    }
    return count;
}
/** 批量删除会话 */
export async function clearSessionsBulk(ids, tenantId) {
    await ensureLoaded();
    let count = 0;
    for (const id of ids) {
        const key = sessionKey(tenantId, id);
        if (sessions.has(key)) {
            sessions.delete(key);
            sessionMetaMap.delete(key);
            count++;
        }
    }
    if (count > 0) {
        saveToFile().catch(() => { });
        saveMetaToFile().catch(() => { });
    }
    return count;
}
//# sourceMappingURL=store.js.map