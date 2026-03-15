/**
 * Telegram 长轮询模式（getUpdates）
 * 支持文本、图片、文档、语音、视频、贴纸及带 caption 的媒体
 * 无需 Webhook，无需公网 URL
 * 方案 B：支持多实例，每个 instanceId 独立轮询
 */
import { getTelegramBotToken } from '../config/loader.js';
import { parseTelegramUpdateAsync } from './telegram.js';
/** 方案 B：按 instanceId 维护轮询状态 */
const pollState = new Map();
/** 连续错误计数，用于指数退避；成功后清零 */
const errorCount = new Map();
/** 获取下次重试间隔（秒）：1, 2, 4, 8, 16, 30, 60... */
function getRetryDelaySeconds(instanceId) {
    const n = errorCount.get(instanceId) ?? 0;
    const sec = Math.min(2 ** Math.min(n, 5), 60);
    return sec;
}
/** chatId → 待处理任务列表 */
const telegramChatQueues = new Map();
/** 正在处理中的 chatId 集合 */
const telegramProcessing = new Set();
/**
 * 单个 Telegram 任务最大处理时长（毫秒）。
 * 超时后强制释放 chatId 占位，任务本身在后台继续运行。
 * 复用 APEXPANDA_TASK_TIMEOUT_MS 环境变量，默认 15 分钟。
 */
const TG_TASK_TIMEOUT_MS = (() => {
    const v = parseInt(process.env.APEXPANDA_TASK_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : 15 * 60 * 1000;
})();
/** 将消息入队，并尝试启动该 chatId 的队列消费 */
function enqueueTelegramJob(job) {
    const q = telegramChatQueues.get(job.chatId) ?? [];
    q.push(job);
    telegramChatQueues.set(job.chatId, q);
    drainTelegramQueue(job.chatId);
}
/** 消费 chatId 队列中的下一条任务（已在处理中则直接返回） */
function drainTelegramQueue(chatId) {
    if (telegramProcessing.has(chatId))
        return;
    const q = telegramChatQueues.get(chatId);
    const job = q?.shift();
    if (!job) {
        telegramChatQueues.delete(chatId);
        return;
    }
    telegramProcessing.add(chatId);
    let guardTimer = null;
    const guardPromise = new Promise((_, reject) => {
        guardTimer = setTimeout(() => {
            reject(new Error(`任务超时（${TG_TASK_TIMEOUT_MS / 1000}s），已强制释放 chatId=${chatId}`));
        }, TG_TASK_TIMEOUT_MS);
    });
    const task = import('../server.js').then(({ processChannelEvent }) => processChannelEvent(job.instanceId, { content: job.content }, { chatId: job.chatId }));
    Promise.race([task, guardPromise])
        .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('已强制释放')) {
            console.warn(`[Telegram] ${msg}`);
        }
        else {
            console.error('[Telegram] 消息处理异常:', e);
        }
    })
        .finally(() => {
        if (guardTimer !== null)
            clearTimeout(guardTimer);
        telegramProcessing.delete(chatId);
        drainTelegramQueue(chatId);
    });
}
// ─────────────────────────────────────────────────────────────────────────────
async function pollUpdates(instanceId) {
    const state = pollState.get(instanceId);
    if (!state?.polling)
        return;
    const token = getTelegramBotToken(instanceId);
    if (!token)
        return;
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set('offset', String(state.lastUpdateId));
    url.searchParams.set('timeout', '30');
    try {
        const res = await fetch(url.toString());
        const data = (await res.json());
        if (!data.ok || !Array.isArray(data.result))
            return;
        errorCount.set(instanceId, 0);
        for (const upd of data.result) {
            const u = upd;
            // lastUpdateId 在派发前立即推进，确保下次轮询正确 offset，与任务是否完成无关
            if (u.update_id != null)
                state.lastUpdateId = u.update_id + 1;
            const msg = u.message ?? u.edited_message;
            if (!msg)
                continue;
            const parsed = await parseTelegramUpdateAsync({ update_id: u.update_id, message: u.message, edited_message: u.edited_message }, token);
            if (!parsed)
                continue;
            // 非阻塞派发：入队后立即继续处理下一条，不 await processChannelEvent
            enqueueTelegramJob({ instanceId, chatId: parsed.channelPeerId, content: parsed.content });
        }
    }
    catch (e) {
        const prev = errorCount.get(instanceId) ?? 0;
        errorCount.set(instanceId, prev + 1);
        const delay = getRetryDelaySeconds(instanceId);
        const cause = e && typeof e === 'object' && 'cause' in e ? e.cause : undefined;
        const code = cause && typeof cause === 'object' ? cause.code : undefined;
        const isNetwork = code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED';
        if (prev === 0 || prev % 5 === 0) {
            console.warn(`[Telegram] ${instanceId} 连接失败${isNetwork ? '（网络无法访问 api.telegram.org，若在国内需配置代理）' : ''}，${delay} 秒后重试`);
        }
    }
}
function loop(instanceId) {
    const state = pollState.get(instanceId);
    if (!state?.polling)
        return;
    pollUpdates(instanceId).finally(() => {
        const st = pollState.get(instanceId);
        if (!st?.polling)
            return;
        const delay = errorCount.get(instanceId) ?? 0;
        const ms = delay > 0 ? getRetryDelaySeconds(instanceId) * 1000 : 100;
        setTimeout(() => loop(instanceId), ms);
    });
}
/** 将 offset 快进到 Telegram 服务器最新，避免重启后重放历史消息 */
async function skipPendingUpdates(token, instanceId) {
    try {
        const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
        url.searchParams.set('offset', '-1');
        url.searchParams.set('limit', '1');
        const res = await fetch(url.toString());
        const data = (await res.json());
        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
            const latest = data.result[data.result.length - 1];
            const state = pollState.get(instanceId);
            if (state && latest.update_id != null) {
                state.lastUpdateId = latest.update_id + 1;
            }
        }
    }
    catch {
        // 忽略，继续正常轮询
    }
}
/** 方案 B：按 instanceId 启动 Telegram 长轮询 */
export async function startTelegramPolling(instanceId) {
    const token = getTelegramBotToken(instanceId);
    if (!token)
        return;
    if (pollState.has(instanceId) && pollState.get(instanceId).polling)
        return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: 'POST' });
    }
    catch {
        // 忽略，可能未设置 webhook
    }
    pollState.set(instanceId, { polling: true, lastUpdateId: 0 });
    await skipPendingUpdates(token, instanceId);
    loop(instanceId);
    console.log('[ApexPanda] Telegram 长轮询已启动:', instanceId);
}
/** 方案 B：停止指定实例；stopAllTelegramPolling 停止所有 */
export function stopTelegramPolling(instanceId) {
    const state = pollState.get(instanceId);
    if (state) {
        state.polling = false;
        pollState.delete(instanceId);
        errorCount.delete(instanceId);
        console.log('[ApexPanda] Telegram 长轮询已停止:', instanceId);
    }
}
/** 方案 B：停止所有 Telegram 实例（配置重载时调用） */
export function stopAllTelegramPolling() {
    for (const id of [...pollState.keys()]) {
        stopTelegramPolling(id);
    }
}
//# sourceMappingURL=telegram-ws.js.map