/**
 * 飞书长连接（WebSocket）接收消息
 * 使用 @larksuiteoapi/node-sdk 的 WSClient，无需公网 URL
 */
import * as Lark from '@larksuiteoapi/node-sdk';
import { getFeishuAppId, getFeishuAppSecret } from '../config/loader.js';
import { logMem } from '../debug-mem.js';
import { enqueueFeishuJob, registerMemoryEnqueue, } from './channel-queue.js';
let wsClient = null;
/**
 * 已处理的 message_id 去重表
 * - TTL 24 小时：覆盖飞书 webhook 重试、补发等延迟投递场景
 * - 最大 50000 条：限制内存占用，超限时淘汰最老条目
 *  PR #22675：去重应在「即将派发」时记录，避免策略拒绝/解析失败的消息被误标记导致重投无法处理
 */
const processedMessageIds = new Map();
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEDUP_MAX_SIZE = 50_000;
function evictIfNeeded(now) {
    // 1. 先按 TTL 清理过期
    for (const [id, ts] of processedMessageIds) {
        if (now - ts > DEDUP_TTL_MS)
            processedMessageIds.delete(id);
    }
    // 2. 仍超限则淘汰最老 10%
    if (processedMessageIds.size < DEDUP_MAX_SIZE)
        return;
    const entries = [...processedMessageIds.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = Math.ceil(entries.length * 0.1);
    for (let i = 0; i < toRemove && i < entries.length; i++) {
        processedMessageIds.delete(entries[i][0]);
    }
}
export function isDuplicateFeishuMessage(messageId) {
    return tryCheckAndRecord(messageId);
}
/**
 * 检查是否已处理；若未处理则记录。
 * @returns true=重复应跳过，false=新消息可处理
 */
function tryCheckAndRecord(messageId) {
    const now = Date.now();
    evictIfNeeded(now);
    if (processedMessageIds.has(messageId))
        return true;
    processedMessageIds.set(messageId, now);
    return false;
}
function parseMessageContent(content, messageType) {
    try {
        const parsed = JSON.parse(content);
        if (messageType === 'text')
            return parsed.text ?? '';
        if (messageType === 'post') {
            const p = parsed;
            const title = p.title ?? '';
            const blocks = p.content ?? [];
            let text = title ? `${title}\n\n` : '';
            for (const para of blocks) {
                if (Array.isArray(para)) {
                    for (const el of para) {
                        if (el && typeof el === 'object' && el.tag === 'text') {
                            text += el.text ?? '';
                        }
                        else if (el?.tag === 'at') {
                            text += `@${el.user_name ?? ''}`;
                        }
                    }
                }
                text += '\n';
            }
            return text.trim() || '[富文本消息]';
        }
        return content;
    }
    catch {
        return content;
    }
}
/** 解析语音消息的 file_key */
function parseAudioFileKey(content) {
    try {
        const parsed = JSON.parse(content);
        return parsed.file_key ?? null;
    }
    catch {
        return null;
    }
}
/** 解析图片消息的 image_key */
function parseImageKey(content) {
    try {
        const parsed = JSON.parse(content);
        return parsed.image_key ?? null;
    }
    catch {
        return null;
    }
}
/** 渠道事件队列：同 chatId 串行，不同 chatId 并发（限 3） */
const channelEventQueue = [];
const processingChatIds = new Set();
const WS_QUEUE_CONCURRENCY = 3;
function pickNextFromQueue() {
    for (let i = 0; i < channelEventQueue.length; i++) {
        const item = channelEventQueue[i];
        const chatId = item.event.message?.chat_id ?? '';
        if (!processingChatIds.has(chatId) && processingChatIds.size < WS_QUEUE_CONCURRENCY) {
            return { ...item, index: i };
        }
    }
    return null;
}
function processQueue() {
    const next = pickNextFromQueue();
    if (!next)
        return;
    channelEventQueue.splice(next.index, 1);
    const chatId = next.event.message?.chat_id ?? '';
    processingChatIds.add(chatId);
    handleFeishuMessageSync(next.event)
        .catch((e) => console.error('[Feishu WS] queue processor', e))
        .finally(() => {
        processingChatIds.delete(chatId);
        processQueue();
    });
}
/** 实际处理逻辑（耗时的 ASR/图片下载），供队列消费者调用 */
export async function handleFeishuMessageSync(event) {
    const messageId = event.message.message_id;
    const messageType = event.message.message_type;
    console.log('[Feishu] 收到消息', { messageId, messageType, contentLength: event.message.content?.length });
    let text;
    if (messageType === 'audio') {
        console.log('[Feishu] 收到语音消息', {
            messageType,
            contentRaw: event.message.content?.slice(0, 500),
            contentLength: event.message.content?.length,
        });
        const fileKey = parseAudioFileKey(event.message.content);
        if (!fileKey) {
            console.warn('[Feishu] 语音消息缺少 file_key，content:', event.message.content);
            return;
        }
        console.log('[Feishu] 语音 file_key:', fileKey);
        const { runUnrecognizedFallback, getUnrecognizedHandler } = await import('./unrecognized-handler.js');
        const result = await runUnrecognizedFallback('voice', { fileKey, messageId }, {
            input: { fileKey, messageId },
        });
        if (result.error) {
            console.error('[Feishu] 语音识别失败:', result.error);
            if (result.savedPath) {
                const { getWorkspaceDir } = await import('../config/loader.js');
                const handler = getUnrecognizedHandler('voice');
                const ws = getWorkspaceDir();
                text = handler
                    ? await handler.buildAgentFallbackMessage(result.savedPath, result.error, ws)
                    : `[语音识别失败，Agent 兜底] 音频已保存到 ${result.savedPath}`;
                console.log('[Feishu] 进入脚本兜底流程，将调用 processChannelEvent');
                try {
                    const { sendFeishuReply } = await import('./feishu-client.js');
                    const userPrompt = handler?.getUserPrompt(result.reason) ?? '识别遇到问题，正在尝试其他方式，请稍候…';
                    await sendFeishuReply(messageId, userPrompt);
                }
                catch (e) {
                    console.warn('[Feishu] 发送兜底提示失败', e);
                }
            }
            else {
                return;
            }
        }
        else {
            text = result.text;
            if (!text.trim()) {
                console.warn('[Feishu] 语音识别结果为空');
                return;
            }
        }
    }
    else if (messageType === 'image') {
        const imageKey = parseImageKey(event.message.content);
        if (!imageKey) {
            console.warn('[Feishu] 图片消息缺少 image_key，content:', event.message.content);
            return;
        }
        try {
            const { getFeishuMessageResource } = await import('./feishu-client.js');
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const buf = await getFeishuMessageResource(messageId, imageKey, 'image');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-images');
            await mkdir(dir, { recursive: true });
            const safeId = messageId.replace(/[/\\?*:]/g, '_').slice(0, 64);
            const ext = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : 'jpg';
            const filePath = `.apexpanda/channel-images/${safeId}.${ext}`;
            const fullPath = join(getWorkspaceDir(), filePath);
            await writeFile(fullPath, buf);
            console.log('[Feishu] 图片已保存', { filePath, size: buf.length });
            text = `【用户发送了一张图片】请用 ocr-baidu_recognize 工具识别图中文字。图片路径（path 参数）：${filePath}`;
        }
        catch (e) {
            console.error('[Feishu] 图片下载或保存失败:', e);
            text = `[图片处理失败] 用户发送了图片但下载失败：${e instanceof Error ? e.message : String(e)}。请告知用户稍后重试。`;
        }
    }
    else if (messageType === 'file') {
        try {
            const parsed = JSON.parse(event.message.content ?? '{}');
            const fileKey = parsed.file_key;
            const fileName = (parsed.file_name ?? 'file').replace(/[/\\?*:<>|]/g, '_').slice(0, 128) || 'file';
            if (!fileKey) {
                console.warn('[Feishu] 文件消息缺少 file_key');
                return;
            }
            const { getFeishuMessageResource } = await import('./feishu-client.js');
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const buf = await getFeishuMessageResource(messageId, fileKey, 'file');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-files');
            await mkdir(dir, { recursive: true });
            const safeId = messageId.replace(/[/\\?*:]/g, '_').slice(0, 64);
            const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
            const baseName = ext ? fileName.slice(0, -ext.length) : fileName;
            const safeName = `${safeId}_${(baseName || 'file').slice(0, 60)}${ext}`;
            const filePath = `.apexpanda/channel-files/${safeName}`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            const extLower = ext.toLowerCase();
            if (extLower === '.docx') {
                text = `【用户发送了 Word 文档】已保存到 ${filePath}。请用 office-reader_extractDocxFromPath 提取正文（path 参数：${filePath}）`;
            }
            else if (extLower === '.xlsx' || extLower === '.xls') {
                text = `【用户发送了 Excel 表格】已保存到 ${filePath}。请用 office-reader_extractXlsxFromPath 提取内容（path 参数：${filePath}）`;
            }
            else {
                text = `【用户发送了文件 ${fileName}】已保存到 ${filePath}。可根据需要读取或处理。`;
            }
        }
        catch (e) {
            console.error('[Feishu] 文件下载或保存失败:', e);
            text = `[文件处理失败] 用户发送了文件但下载失败：${e instanceof Error ? e.message : String(e)}。请告知用户稍后重试。`;
        }
    }
    else {
        const rawContent = event.message.content ?? '';
        text = parseMessageContent(rawContent, messageType).trim();
        if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
            console.log('[Feishu-内容调试] parseMessageContent', {
                rawLen: rawContent.length,
                parsedLen: text.length,
                rawPreview: rawContent.slice(0, 120),
                parsedPreview: text.slice(0, 120),
                parsedLast50: text.length > 50 ? text.slice(-50) : '',
            });
        }
    }
    if (!text) {
        console.log('[Feishu] 非语音或解析后无文本，messageType:', messageType, 'contentSample:', event.message.content?.slice(0, 200));
        return;
    }
    // 去重放在「即将派发」前，解析/策略失败的消息可被重投后再次处理（ PR #22675）
    if (tryCheckAndRecord(messageId)) {
        console.log(`[Feishu] 跳过重复消息 ${messageId}`);
        return;
    }
    if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
        console.log('[Feishu-内容调试] 即将 processChannelEvent textLen=', text.length, 'fullText=', text);
    }
    const { processChannelEvent } = await import('../server.js');
    const chatId = event.message?.chat_id;
    const chatType = event.message?.chat_type === 'p2p' || event.message?.chat_type === 'group'
        ? event.message.chat_type
        : undefined;
    const userId = event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id;
    await processChannelEvent('feishu', { content: text }, {
        messageId,
        chatId,
        chatType,
        userId: userId ?? undefined,
    });
}
/** 入队后立即 return，不阻塞 WS 接收 */
function handleFeishuMessage(event) {
    void enqueueFeishuJob({ kind: 'ws', event });
}
function pushToMemoryQueue(payload) {
    channelEventQueue.push({ channel: 'feishu', event: payload.event });
    setImmediate(() => processQueue());
}
export function startFeishuWebSocket() {
    const appId = getFeishuAppId();
    const appSecret = getFeishuAppSecret();
    if (!appId || !appSecret)
        return;
    registerMemoryEnqueue((p) => {
        if (p.kind === 'ws')
            pushToMemoryQueue(p);
    });
    if (wsClient) {
        console.log('[Feishu] WebSocket already running');
        return;
    }
    const domain = process.env.FEISHU_DOMAIN === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;
    const client = new Lark.WSClient({
        appId,
        appSecret,
        domain,
        loggerLevel: Lark.LoggerLevel.info,
    });
    const eventDispatcher = new Lark.EventDispatcher({
        encryptKey: process.env.FEISHU_ENCRYPT_KEY || undefined,
        verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || undefined,
    });
    eventDispatcher.register({
        'im.message.receive_v1': (data) => {
            try {
                const event = data;
                handleFeishuMessage(event);
            }
            catch (e) {
                console.error('[Feishu]', e);
            }
        },
        'im.message.message_read_v1': async () => { },
    });
    logMem('feishu-ws:before-client.start');
    client.start({ eventDispatcher });
    wsClient = client;
    logMem('feishu-ws:after-client.start');
    console.log('[Feishu] WebSocket long connection started');
}
export function stopFeishuWebSocket() {
    if (wsClient) {
        wsClient = null;
        console.log('[Feishu] WebSocket stopped');
    }
}
//# sourceMappingURL=feishu-ws.js.map