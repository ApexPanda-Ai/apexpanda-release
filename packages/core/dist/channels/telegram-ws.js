/**
 * Telegram 长轮询模式（getUpdates）
 * 支持文本、图片、文档、语音、视频、贴纸及带 caption 的媒体
 * 无需 Webhook，无需公网 URL
 */
import { getTelegramBotToken } from '../config/loader.js';
import { parseTelegramUpdateAsync } from './telegram.js';
let polling = false;
let lastUpdateId = 0;
async function pollUpdates() {
    const token = getTelegramBotToken();
    if (!token)
        return;
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set('offset', String(lastUpdateId));
    url.searchParams.set('timeout', '30');
    try {
        const res = await fetch(url.toString());
        const data = (await res.json());
        if (!data.ok || !Array.isArray(data.result))
            return;
        for (const upd of data.result) {
            const u = upd;
            if (u.update_id != null)
                lastUpdateId = u.update_id + 1;
            const msg = u.message ?? u.edited_message;
            if (!msg)
                continue;
            const parsed = await parseTelegramUpdateAsync({ update_id: u.update_id, message: u.message, edited_message: u.edited_message }, token);
            if (!parsed)
                continue;
            const chatId = parsed.channelPeerId;
            const { processChannelEvent } = await import('../server.js');
            await processChannelEvent('telegram', { content: parsed.content }, { chatId });
        }
    }
    catch (e) {
        console.error('[Telegram] poll error:', e);
    }
}
function loop() {
    if (!polling)
        return;
    pollUpdates().finally(() => {
        if (polling)
            setTimeout(loop, 100);
    });
}
/** 将 offset 快进到 Telegram 服务器最新，避免重启后重放历史消息 */
async function skipPendingUpdates(token) {
    try {
        const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
        url.searchParams.set('offset', '-1');
        url.searchParams.set('limit', '1');
        const res = await fetch(url.toString());
        const data = (await res.json());
        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
            const latest = data.result[data.result.length - 1];
            if (latest.update_id != null) {
                lastUpdateId = latest.update_id + 1;
            }
        }
    }
    catch {
        // 忽略，继续正常轮询
    }
}
export async function startTelegramPolling() {
    const token = getTelegramBotToken();
    if (!token)
        return;
    if (polling)
        return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: 'POST' });
    }
    catch {
        // 忽略，可能未设置 webhook
    }
    await skipPendingUpdates(token);
    polling = true;
    loop();
    console.log('[ApexPanda] Telegram 长轮询已启动');
}
export function stopTelegramPolling() {
    polling = false;
}
//# sourceMappingURL=telegram-ws.js.map