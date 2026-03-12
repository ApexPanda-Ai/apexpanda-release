/** 解析飞书事件为 IncomingMessage（支持文本、语音、图片），含耗时操作（ASR、下载） */
export async function parseFeishuEvent(body, tenantId) {
    if (body.challenge)
        return null;
    const msg = body.event?.message;
    if (!msg?.content)
        return null;
    const messageType = msg.message_type ?? 'text';
    let text = '';
    let voiceFallbackReason;
    console.log('[Feishu Webhook] 解析消息', { messageType, contentRaw: msg.content?.slice(0, 500) });
    if (messageType === 'image') {
        try {
            const parsed = JSON.parse(msg.content);
            const imageKey = parsed.image_key;
            if (!imageKey || !msg.message_id)
                return null;
            const { getFeishuMessageResource } = await import('./feishu-client.js');
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const buf = await getFeishuMessageResource(msg.message_id, imageKey, 'image');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-images');
            await mkdir(dir, { recursive: true });
            const safeId = (msg.message_id ?? '').replace(/[/\\?*:]/g, '_').slice(0, 64);
            const ext = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : 'jpg';
            const filePath = `.apexpanda/channel-images/${safeId}.${ext}`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            text = `【用户发送了一张图片】请用 ocr-baidu_recognize 工具识别图中文字。图片路径（path 参数）：${filePath}`;
        }
        catch (e) {
            console.warn('[Feishu Webhook] 图片下载或保存失败', e);
            return null;
        }
    }
    else if (messageType === 'file') {
        try {
            const parsed = JSON.parse(msg.content);
            const fileKey = parsed.file_key;
            const fileName = (parsed.file_name ?? 'file').replace(/[/\\?*:<>|]/g, '_').slice(0, 128) || 'file';
            if (!fileKey || !msg.message_id)
                return null;
            const { getFeishuMessageResource } = await import('./feishu-client.js');
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const buf = await getFeishuMessageResource(msg.message_id, fileKey, 'file');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-files');
            await mkdir(dir, { recursive: true });
            const safeId = (msg.message_id ?? '').replace(/[/\\?*:]/g, '_').slice(0, 64);
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
            console.warn('[Feishu Webhook] 文件下载或保存失败', e);
            return null;
        }
    }
    else if (messageType === 'audio') {
        try {
            const parsed = JSON.parse(msg.content);
            const fileKey = parsed.file_key;
            console.log('[Feishu Webhook] 语音消息 file_key:', fileKey, 'message_id:', msg.message_id);
            if (!fileKey || !msg.message_id)
                return null;
            const { runUnrecognizedFallback, getUnrecognizedHandler } = await import('./unrecognized-handler.js');
            const result = await runUnrecognizedFallback('voice', { fileKey, messageId: msg.message_id }, {
                input: { fileKey, messageId: msg.message_id },
            });
            if (result.error || !result.text.trim()) {
                console.warn('[Feishu Webhook] 语音识别失败或为空', { error: result.error, textLen: result.text?.length });
                if (result.savedPath) {
                    voiceFallbackReason = result.reason;
                    const { getWorkspaceDir } = await import('../config/loader.js');
                    const handler = getUnrecognizedHandler('voice');
                    const ws = getWorkspaceDir();
                    text = handler
                        ? await handler.buildAgentFallbackMessage(result.savedPath, result.error ?? '结果为空', ws)
                        : `[语音识别失败，Agent 兜底] 音频已保存到 ${result.savedPath}`;
                }
                else {
                    return null;
                }
            }
            else {
                text = result.text;
            }
        }
        catch {
            return null;
        }
    }
    else {
        try {
            const parsed = JSON.parse(msg.content);
            text = parsed.text ?? '';
        }
        catch {
            text = String(msg.content);
        }
    }
    const peerId = msg.sender?.sender_id?.open_id ?? msg.sender?.sender_id?.user_id ?? msg.chat_id ?? '';
    if (!peerId || !text.trim())
        return null;
    const out = {
        channel: 'feishu',
        channelPeerId: peerId,
        tenantId,
        content: text.trim(),
        raw: body,
    };
    if (voiceFallbackReason)
        out.meta = { voiceFallbackReason };
    return out;
}
export function createFeishuAdapter(tenantId) {
    return {
        id: 'feishu',
        channel: 'feishu',
        parseIncoming: (body) => {
            return parseFeishuEvent(body, tenantId);
        },
    };
}
/** 处理飞书 webhook 请求，返回需响应的 body（含 challenge 等）
 * - text: 完整 parse，快
 * - audio/image: quickParse 仅提取元数据，返回 deferred，不阻塞 HTTP
 */
export async function handleFeishuWebhook(body, tenantId = 'default') {
    if (body.challenge) {
        return { type: 'challenge', challenge: body.challenge };
    }
    const msg = body.event?.message;
    if (!msg?.content)
        return null;
    const messageType = msg.message_type ?? 'text';
    const feishuMsg = msg;
    const sender = feishuMsg?.sender ?? body.event?.sender;
    const openId = sender?.sender_id?.open_id ?? sender?.sender_id?.user_id;
    const messageId = feishuMsg?.message_id ?? '';
    const chatId = feishuMsg?.chat_id;
    const chatType = feishuMsg?.chat_type === 'p2p' || feishuMsg?.chat_type === 'group' ? feishuMsg.chat_type : undefined;
    if (messageType === 'audio') {
        try {
            const parsed = JSON.parse(msg.content);
            const fileKey = parsed.file_key;
            if (!fileKey || !messageId)
                return null;
            console.log('[Feishu Webhook] 语音消息 quickParse，返回 deferred', { fileKey, messageId });
            return {
                type: 'event',
                deferred: true,
                rawBody: body,
                messageId,
                chatId,
                chatType,
                userId: openId ?? undefined,
                messageType: 'audio',
            };
        }
        catch {
            return null;
        }
    }
    if (messageType === 'image') {
        try {
            const parsed = JSON.parse(msg.content);
            const imageKey = parsed.image_key;
            if (!imageKey || !messageId)
                return null;
            console.log('[Feishu Webhook] 图片消息 quickParse，返回 deferred', { imageKey, messageId });
            return {
                type: 'event',
                deferred: true,
                rawBody: body,
                messageId,
                chatId,
                chatType,
                userId: openId ?? undefined,
                messageType: 'image',
            };
        }
        catch {
            return null;
        }
    }
    if (messageType === 'file') {
        try {
            const parsed = JSON.parse(msg.content);
            const fileKey = parsed.file_key;
            if (!fileKey || !messageId)
                return null;
            console.log('[Feishu Webhook] 文件消息 quickParse，返回 deferred', { fileKey, messageId });
            return {
                type: 'event',
                deferred: true,
                rawBody: body,
                messageId,
                chatId,
                chatType,
                userId: openId ?? undefined,
                messageType: 'file',
            };
        }
        catch {
            return null;
        }
    }
    const msg_ = await parseFeishuEvent(body, tenantId);
    if (!msg_)
        return null;
    return {
        type: 'event',
        message: msg_,
        messageId,
        chatId,
        chatType,
        userId: openId ?? undefined,
    };
}
//# sourceMappingURL=feishu.js.map