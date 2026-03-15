/**
 * 钉钉 Stream 模式 WebSocket 长连接
 * 使用 dingtalk-stream 连接钉钉开放平台，无需公网
 * @see https://open.dingtalk.com/document/development/introduction-to-stream-mode
 */
import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import { getDingTalkClientId, getDingTalkClientSecret } from '../config/loader.js';
const clientsByInstance = new Map();
const FRIENDLY_MSG = '[钉钉] 连接异常：网络不稳定或无法访问钉钉服务器，将自动重试。如持续失败，请检查网络、防火墙或代理设置。';
const THROTTLE_MS = 15000;
/** 拦截 dingtalk-stream 内部的 socket error 输出，改为友好提示（库内部使用 console.warn("ERROR", err)） */
function installFriendlyDingTalkErrorHandler() {
    const orig = console.warn;
    if (orig.__dingtalkPatched)
        return;
    orig.__dingtalkPatched = true;
    let lastLogged = 0;
    console.warn = function (...args) {
        if (args.length >= 2 && args[0] === 'ERROR' && args[1] instanceof Error) {
            const err = args[1];
            const isDingTalkNetwork = err.code === 'ECONNRESET' ||
                /socket disconnected|TLS connection|ECONNRESET/i.test(err.message ?? '') ||
                (err.host?.includes('dingtalk') ?? false);
            if (isDingTalkNetwork) {
                const now = Date.now();
                if (now - lastLogged >= THROTTLE_MS) {
                    lastLogged = now;
                    orig.call(console, FRIENDLY_MSG);
                }
                return;
            }
        }
        orig.apply(console, args);
    };
}
/** 去掉消息开头的 @机器人昵称 前缀 */
function stripAtMention(text) {
    return text.replace(/^@\S+\s*/, '').trim();
}
/** 解析机器人消息为 IncomingMessage 格式 */
function parseRobotMessage(data, instanceId) {
    const rawText = data.text?.content?.trim();
    if (!rawText)
        return null;
    const peerId = data.senderStaffId ?? data.senderId ?? data.chatbotUserId ?? '';
    if (!peerId)
        return null;
    const content = data.conversationType === '2' ? stripAtMention(rawText) : rawText;
    if (!content)
        return null;
    return {
        message: {
            channel: 'dingtalk',
            channelPeerId: peerId,
            tenantId: 'default',
            content,
            raw: data,
            meta: {
                conversationType: data.conversationType,
                conversationId: data.conversationId,
                conversationTitle: data.conversationTitle,
                senderNick: data.senderNick,
            },
        },
        sessionWebhook: data.sessionWebhook ?? '',
    };
}
export async function startDingTalkStreamClient(instanceId) {
    installFriendlyDingTalkErrorHandler();
    const clientId = getDingTalkClientId(instanceId);
    const clientSecret = getDingTalkClientSecret(instanceId);
    if (!clientId?.trim() || !clientSecret?.trim())
        return;
    if (clientsByInstance.has(instanceId))
        return;
    const client = new DWClient({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
    });
    client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
        try {
            const data = JSON.parse(res.data);
            const parsed = parseRobotMessage(data, instanceId);
            if (!parsed?.sessionWebhook)
                return;
            const { processChannelEvent } = await import('../server.js');
            await processChannelEvent(instanceId, parsed.message, {
                sessionWebhook: parsed.sessionWebhook,
            });
            client.socketCallBackResponse(res.headers.messageId, { response: null });
        }
        catch (e) {
            console.error('[DingTalk-Stream]', e);
        }
    });
    try {
        await client.connect();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = e instanceof Error ? e.code : '';
        if (code === 'ECONNRESET' || /socket disconnected|TLS connection|ECONNRESET/i.test(msg)) {
            console.warn(`[钉钉] Stream 连接失败 (${instanceId})：网络连接被中断。可能原因：网络不稳定、防火墙/代理限制、钉钉限流或地域限制。请检查网络环境或稍后重试。`);
        }
        else {
            console.warn(`[钉钉] Stream 连接失败 (${instanceId}):`, msg);
        }
        throw e;
    }
    clientsByInstance.set(instanceId, client);
    console.log(`[ApexPanda] 钉钉 Stream 模式已连接: ${instanceId}`);
}
export async function stopDingTalkStreamClient(instanceId) {
    const c = clientsByInstance.get(instanceId);
    if (c) {
        try {
            c.disconnect();
        }
        catch {
            /* ignore */
        }
        clientsByInstance.delete(instanceId);
        console.log(`[DingTalk-Stream] Client stopped: ${instanceId}`);
    }
}
export async function stopAllDingTalkStreamClients() {
    const ids = [...clientsByInstance.keys()];
    for (const id of ids) {
        await stopDingTalkStreamClient(id);
    }
}
//# sourceMappingURL=dingtalk-stream-ws.js.map