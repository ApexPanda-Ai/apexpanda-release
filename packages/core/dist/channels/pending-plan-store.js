/**
 * 多 Agent 动态规划 — 待确认计划存储
 * 当 planConfirmRequired=true 时，planWithLLM 生成计划后先缓存，
 * 等用户回复「确认」才执行。
 *
 * 持久化：计划保存到 .apexpanda/pending-plans.json，重启后仍可恢复。
 * - onProgress（函数）和 wecomFrame（活跃 WS 对象）不可序列化，保存时剥离。
 * - 加载时自动丢弃已超过 TTL 的过期条目。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const TTL_MS = 10 * 60 * 1000; // 10 分钟
const pendingPlans = new Map();
/** TTL 清理定时器，key 与 pendingPlans 一一对应 */
const ttlTimers = new Map();
// ─── 文件持久化 ─────────────────────────────────────────────────────────────
function getStorePath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'pending-plans.json');
}
/** 将内存中所有计划序列化写入磁盘（非阻塞，错误只记日志） */
function saveToDisk() {
    const path = getStorePath();
    const data = {};
    for (const [sessionId, plan] of pendingPlans) {
        const { onProgress: _fn, ...inputRest } = plan.input;
        const { wecomFrame: _wf, ...ctxRest } = plan.ctx;
        data[sessionId] = { ...plan, input: inputRest, ctx: ctxRest };
    }
    mkdir(dirname(path), { recursive: true })
        .then(() => writeFile(path, JSON.stringify(data, null, 0), 'utf-8'))
        .catch((e) => console.warn('[PendingPlan] 持久化写入失败:', e instanceof Error ? e.message : e));
}
/** 启动时从磁盘加载，过期条目自动丢弃，有效条目恢复 TTL 定时器 */
async function loadFromDisk() {
    const path = getStorePath();
    try {
        const raw = await readFile(path, 'utf-8');
        const data = JSON.parse(raw);
        const now = Date.now();
        for (const [sessionId, plan] of Object.entries(data)) {
            if (!plan?.createdAt || now - plan.createdAt >= TTL_MS)
                continue; // 已过期
            const remaining = TTL_MS - (now - plan.createdAt);
            // 恢复到内存（onProgress / wecomFrame 不可恢复，保持 undefined）
            pendingPlans.set(sessionId, plan);
            const timer = setTimeout(() => {
                pendingPlans.delete(sessionId);
                ttlTimers.delete(sessionId);
                saveToDisk();
            }, remaining);
            ttlTimers.set(sessionId, timer);
        }
        if (pendingPlans.size > 0) {
            console.log(`[PendingPlan] 已恢复 ${pendingPlans.size} 条待确认计划`);
        }
    }
    catch {
        // 文件不存在或格式错误，忽略
    }
}
let _loaded = false;
async function ensureLoaded() {
    if (!_loaded) {
        _loaded = true;
        await loadFromDisk();
    }
}
// ─── 公共 API ────────────────────────────────────────────────────────────────
/** 以 channelSessionId 为 key 存储待确认计划，并持久化到磁盘 */
export async function setPendingPlan(sessionId, plan) {
    await ensureLoaded();
    // 清除旧定时器（如有）
    const old = ttlTimers.get(sessionId);
    if (old)
        clearTimeout(old);
    pendingPlans.set(sessionId, plan);
    const timer = setTimeout(() => {
        pendingPlans.delete(sessionId);
        ttlTimers.delete(sessionId);
        saveToDisk();
    }, TTL_MS);
    ttlTimers.set(sessionId, timer);
    saveToDisk();
}
/** 取出待确认计划（取出后自动删除并更新磁盘） */
export async function getAndClearPendingPlan(sessionId) {
    await ensureLoaded();
    const p = pendingPlans.get(sessionId);
    if (p) {
        pendingPlans.delete(sessionId);
        const timer = ttlTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            ttlTimers.delete(sessionId);
        }
        saveToDisk();
    }
    return p;
}
/** 是否有待确认计划 */
export async function hasPendingPlan(sessionId) {
    await ensureLoaded();
    return pendingPlans.has(sessionId);
}
/** 判断消息是否为「确认」指令 */
export function isPlanConfirmMessage(msg) {
    return /^(确认|confirm|ok|好的|执行|开始执行|是的|yes)\s*$/i.test(msg.trim());
}
/** 判断消息是否为「取消」指令 */
export function isPlanCancelMessage(msg) {
    return /^(取消|cancel|算了|不了|no|放弃)\s*$/i.test(msg.trim());
}
//# sourceMappingURL=pending-plan-store.js.map