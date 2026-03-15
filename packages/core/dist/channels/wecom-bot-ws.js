/**
 * 企业微信智能机器人 WebSocket 长连接模式
 * 使用 @wecom/aibot-node-sdk 连接 wss://openws.work.weixin.qq.com
 * 无需公网，支持私聊和群聊
 * @see https://developer.work.weixin.qq.com/document/path/101463
 */
import { getWecomBotId, getWeComSecret } from '../config/loader.js';
const clientsByInstance = new Map();
/** 获取指定实例的 Wecom Bot 客户端（用于回复） */
export function getWecomBotClient(instanceId) {
    return clientsByInstance.get(instanceId);
}
/** 使用 replyStream 发送文本回复（SDK 无 replyText，用 replyStream finish=true 模拟）。无客户端时返回 false */
export async function replyWecomBotText(instanceId, frame, content) {
    const client = getWecomBotClient(instanceId);
    if (!client)
        return false;
    const streamId = `apexpanda_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await client.replyStream(frame, streamId, content, true);
    return true;
}
/** 主动发送 Markdown 文本（SDK 使用 sendMessage + markdown）。无客户端时返回 false */
export async function sendWecomBotText(instanceId, chatId, content) {
    const client = getWecomBotClient(instanceId);
    if (!client)
        return false;
    await client.sendMessage(chatId, { msgtype: 'markdown', markdown: { content } });
    return true;
}
/** 使用 replyStream 发送 Markdown 回复 */
export async function replyWecomBotMarkdown(instanceId, frame, content) {
    return replyWecomBotText(instanceId, frame, content);
}
/** 将 ChannelFileReply 的 fileType 映射为企微媒体类型 */
function toWecomMediaType(fileType) {
    if (fileType === 'audio')
        return 'voice';
    return fileType;
}
/** 上传并发送文件：有 frame 则 replyMedia，否则 sendMediaMessage。返回 true 表示成功 */
export async function sendWecomBotFile(instanceId, ctx, fileBuffer, fileType, filename, caption) {
    const client = getWecomBotClient(instanceId);
    if (!client || (!ctx.wecomFrame && !ctx.chatId))
        return false;
    const mediaType = toWecomMediaType(fileType);
    try {
        const result = await client.uploadMedia(fileBuffer, { type: mediaType, filename });
        const mediaId = result?.media_id;
        if (!mediaId)
            return false;
        if (ctx.wecomFrame) {
            await client.replyMedia(ctx.wecomFrame, mediaType, mediaId);
        }
        else if (ctx.chatId) {
            await client.sendMediaMessage(ctx.chatId, mediaType, mediaId);
        }
        if (caption?.trim()) {
            const credId = instanceId;
            if (ctx.wecomFrame) {
                await replyWecomBotText(credId, ctx.wecomFrame, caption.trim());
            }
            else if (ctx.chatId) {
                await sendWecomBotText(credId, ctx.chatId, caption.trim());
            }
        }
        return true;
    }
    catch (e) {
        console.error('[Wecom-Bot] sendWecomBotFile error:', e instanceof Error ? e.message : e);
        return false;
    }
}
export async function startWecomBotClient(instanceId) {
    const botId = getWecomBotId(instanceId);
    const secret = getWeComSecret(instanceId);
    if (!botId?.trim() || !secret?.trim())
        return;
    if (clientsByInstance.has(instanceId))
        return;
    const sdk = await import('@wecom/aibot-node-sdk');
    const AiBot = sdk.default ?? sdk;
    const WSClient = AiBot?.WSClient ?? sdk.WSClient;
    if (!WSClient)
        throw new Error('@wecom/aibot-node-sdk: WSClient not found');
    /** 关闭 AiBotSDK 调试日志（Heartbeat 等） */
    const quietLogger = { debug: () => { }, info: () => { }, warn: () => { }, error: (e) => console.error('[Wecom-Bot]', e) };
    const wsClient = new WSClient({
        botId: botId.trim(),
        secret: secret.trim(),
        logger: quietLogger,
    });
    const toCtx = (frame) => {
        const body = frame.body ?? {};
        const userId = body.from?.userid ?? '';
        const chatId = body.chatid ?? userId;
        return { chatId, chatType: body.chattype === 'group' ? 'group' : 'p2p', userId, wecomFrame: frame };
    };
    wsClient.on('message.text', async (frame) => {
        const content = (frame.body?.text?.content ?? '').trim();
        if (!content)
            return;
        const { processChannelEvent } = await import('../server.js');
        await processChannelEvent(instanceId, { content }, toCtx(frame));
    });
    wsClient.on('message.image', async (frame) => {
        const { processChannelEvent } = await import('../server.js');
        await processChannelEvent(instanceId, { content: '[图片消息]' }, toCtx(frame));
    });
    wsClient.on('error', (err) => {
        console.error(`[Wecom-Bot] ${instanceId} error:`, err instanceof Error ? err.message : err);
    });
    wsClient.connect();
    clientsByInstance.set(instanceId, wsClient);
    console.log(`[ApexPanda] 企业微信智能机器人已连接: ${instanceId}`);
}
export async function stopWecomBotClient(instanceId) {
    const c = clientsByInstance.get(instanceId);
    if (c) {
        try {
            if (typeof c.disconnect === 'function') {
                c.disconnect();
            }
        }
        catch {
            /* ignore */
        }
        clientsByInstance.delete(instanceId);
        console.log(`[Wecom-Bot] Client stopped: ${instanceId}`);
    }
}
export async function stopAllWecomBotClients() {
    const ids = [...clientsByInstance.keys()];
    for (const id of ids) {
        await stopWecomBotClient(id);
    }
}
//# sourceMappingURL=wecom-bot-ws.js.map