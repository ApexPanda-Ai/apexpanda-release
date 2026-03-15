const MEDIA_MAX_BYTES = 5 * 1024 * 1024; // 5MB，对齐 OpenClaw mediaMaxMb
/** 解析 Telegram Update 为 IncomingMessage（仅文本，同步） */
export function parseTelegramUpdate(update) {
    const msg = update.message ?? update.edited_message;
    if (!msg?.text?.trim())
        return null;
    const chatId = msg.chat?.id;
    if (chatId == null)
        return null;
    return {
        channel: 'telegram',
        channelPeerId: String(chatId),
        tenantId: 'default',
        content: msg.text.trim(),
        raw: update,
    };
}
/** 通过 getFile + 下载获取文件内容 */
async function downloadTelegramFile(botToken, fileId, maxBytes = MEDIA_MAX_BYTES) {
    const getRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
    });
    const getData = (await getRes.json());
    if (!getData.ok || !getData.result?.file_path) {
        throw new Error(`Telegram getFile failed: ${JSON.stringify(getData)}`);
    }
    const filePath = getData.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const res = await fetch(downloadUrl);
    if (!res.ok)
        throw new Error(`Telegram file download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
        throw new Error(`文件超过大小限制 (${(maxBytes / 1024 / 1024).toFixed(1)}MB)`);
    }
    return buf;
}
/** 异步解析 Telegram 消息（含媒体），参考 OpenClaw + Feishu 模式 */
export async function parseTelegramUpdateAsync(update, botToken) {
    const msg = update.message ?? update.edited_message;
    if (!msg || msg.chat?.id == null)
        return null;
    const chatId = String(msg.chat.id);
    const caption = msg.caption?.trim() ?? '';
    const prefix = caption ? `【用户附言】${caption}\n\n` : '';
    // 纯文本
    if (msg.text?.trim()) {
        return {
            channel: 'telegram',
            channelPeerId: chatId,
            tenantId: 'default',
            content: msg.text.trim(),
            raw: update,
        };
    }
    // 图片（取最大尺寸）
    if (msg.photo && msg.photo.length > 0) {
        const largest = msg.photo[msg.photo.length - 1];
        try {
            const buf = await downloadTelegramFile(botToken, largest.file_id);
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-images');
            await mkdir(dir, { recursive: true });
            const ext = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : 'jpg';
            const safeId = `tg_${chatId}_${msg.message_id}`.replace(/[/\\?*:]/g, '_').slice(0, 64);
            const filePath = `.apexpanda/channel-images/${safeId}.${ext}`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            const text = `${prefix}【用户发送了一张图片】请用 ocr-baidu_recognize 工具识别图中文字。图片路径（path 参数）：${filePath}`;
            return { channel: 'telegram', channelPeerId: chatId, tenantId: 'default', content: text, raw: update };
        }
        catch (e) {
            console.warn('[Telegram] 图片下载或保存失败', e);
            return null;
        }
    }
    // 文档
    if (msg.document) {
        try {
            const buf = await downloadTelegramFile(botToken, msg.document.file_id);
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-files');
            await mkdir(dir, { recursive: true });
            const fileName = (msg.document.file_name ?? 'file').replace(/[/\\?*:<>|]/g, '_').slice(0, 128) || 'file';
            const safeId = `tg_${chatId}_${msg.message_id}`.replace(/[/\\?*:]/g, '_').slice(0, 40);
            const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
            const baseName = ext ? fileName.slice(0, -ext.length) : fileName;
            const safeName = `${safeId}_${(baseName || 'file').slice(0, 50)}${ext}`;
            const filePath = `.apexpanda/channel-files/${safeName}`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            const extLower = ext.toLowerCase();
            let text;
            if (extLower === '.docx') {
                text = `${prefix}【用户发送了 Word 文档】已保存到 ${filePath}。请用 office-reader_extractDocxFromPath 提取正文（path 参数：${filePath}）`;
            }
            else if (extLower === '.xlsx' || extLower === '.xls') {
                text = `${prefix}【用户发送了 Excel 表格】已保存到 ${filePath}。请用 office-reader_extractXlsxFromPath 提取内容（path 参数：${filePath}）`;
            }
            else {
                text = `${prefix}【用户发送了文件 ${fileName}】已保存到 ${filePath}。可根据需要读取或处理。`;
            }
            return { channel: 'telegram', channelPeerId: chatId, tenantId: 'default', content: text, raw: update };
        }
        catch (e) {
            console.warn('[Telegram] 文档下载或保存失败', e);
            return null;
        }
    }
    // 语音
    if (msg.voice) {
        try {
            const buf = await downloadTelegramFile(botToken, msg.voice.file_id);
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-voice');
            await mkdir(dir, { recursive: true });
            const safeId = `tg_${chatId}_${msg.message_id}`.replace(/[/\\?*:]/g, '_').slice(0, 40);
            const filePath = `.apexpanda/channel-voice/${safeId}.ogg`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            const { recognizeVoiceFromLocalPath } = await import('./feishu-client.js');
            const result = await recognizeVoiceFromLocalPath(filePath);
            const text = result.text
                ? `${prefix}${result.text}`
                : `${prefix}【用户发送了语音消息】语音识别失败。音频已保存到 ${filePath}，可根据需要处理或使用 voice_asr 脚本。`;
            return { channel: 'telegram', channelPeerId: chatId, tenantId: 'default', content: text, raw: update };
        }
        catch (e) {
            console.warn('[Telegram] 语音下载或保存失败', e);
            return null;
        }
    }
    // 视频
    if (msg.video) {
        try {
            const buf = await downloadTelegramFile(botToken, msg.video.file_id);
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-files');
            await mkdir(dir, { recursive: true });
            const safeId = `tg_${chatId}_${msg.message_id}`.replace(/[/\\?*:]/g, '_').slice(0, 40);
            const filePath = `.apexpanda/channel-files/${safeId}_video.mp4`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            const text = `${prefix}【用户发送了视频】已保存到 ${filePath}，可根据需要处理。`;
            return { channel: 'telegram', channelPeerId: chatId, tenantId: 'default', content: text, raw: update };
        }
        catch (e) {
            console.warn('[Telegram] 视频下载或保存失败', e);
            return null;
        }
    }
    // video_note（圆形短视频）
    if (msg.video_note) {
        try {
            const buf = await downloadTelegramFile(botToken, msg.video_note.file_id);
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-files');
            await mkdir(dir, { recursive: true });
            const safeId = `tg_${chatId}_${msg.message_id}`.replace(/[/\\?*:]/g, '_').slice(0, 40);
            const filePath = `.apexpanda/channel-files/${safeId}_videonote.mp4`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            const text = `${prefix}【用户发送了视频消息】已保存到 ${filePath}，可根据需要处理。`;
            return { channel: 'telegram', channelPeerId: chatId, tenantId: 'default', content: text, raw: update };
        }
        catch (e) {
            console.warn('[Telegram] 视频消息下载或保存失败', e);
            return null;
        }
    }
    // 贴纸：仅处理静态 WEBP（OpenClaw 跳过动画/视频贴纸）
    if (msg.sticker) {
        if (msg.sticker.is_animated || msg.sticker.is_video) {
            const text = `${prefix}【用户发送了贴纸】动态/视频贴纸暂不支持识别，可忽略或根据上下文理解。`;
            return { channel: 'telegram', channelPeerId: chatId, tenantId: 'default', content: text, raw: update };
        }
        try {
            const buf = await downloadTelegramFile(botToken, msg.sticker.file_id);
            const { getWorkspaceDir } = await import('../config/loader.js');
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const dir = join(getWorkspaceDir(), '.apexpanda', 'channel-images');
            await mkdir(dir, { recursive: true });
            const safeId = `tg_sticker_${chatId}_${msg.message_id}`.replace(/[/\\?*:]/g, '_').slice(0, 50);
            const filePath = `.apexpanda/channel-images/${safeId}.webp`;
            await writeFile(join(getWorkspaceDir(), filePath), buf);
            const text = `${prefix}【用户发送了贴纸】请用 ocr-baidu_recognize 或 vision 工具识别贴纸内容。图片路径：${filePath}`;
            return { channel: 'telegram', channelPeerId: chatId, tenantId: 'default', content: text, raw: update };
        }
        catch (e) {
            console.warn('[Telegram] 贴纸下载或保存失败', e);
            return null;
        }
    }
    return null;
}
/** 处理 Telegram webhook 请求（支持媒体，异步） */
export async function handleTelegramWebhook(body, botToken) {
    const msg = await parseTelegramUpdateAsync(body, botToken);
    if (!msg)
        return null;
    const chatId = (body.message ?? body.edited_message)?.chat?.id;
    return {
        type: 'event',
        message: msg,
        chatId: chatId != null ? String(chatId) : '',
    };
}
/** 通过 Telegram Bot API 发送消息 */
export async function sendTelegramMessage(chatId, content, botToken) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: content }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram send failed: ${res.status} ${err}`);
    }
}
/** 发送图片到 Telegram（支持 filePath 绝对路径） */
export async function sendTelegramPhoto(chatId, filePath, caption, botToken) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const buf = await readFile(filePath);
    const fileName = basename(filePath);
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', new Blob([buf], { type: mime }), fileName);
    if (caption)
        form.append('caption', caption);
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        body: form,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram sendPhoto failed: ${res.status} ${err}`);
    }
}
/** 发送文件/视频/音频到 Telegram */
export async function sendTelegramDocument(chatId, filePath, mimeType, caption, botToken, fileType) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const buf = await readFile(filePath);
    const fileName = basename(filePath);
    const form = new FormData();
    form.append('chat_id', chatId);
    const fieldName = fileType === 'video' ? 'video' : fileType === 'audio' ? 'audio' : 'document';
    form.append(fieldName, new Blob([buf], { type: mimeType }), fileName);
    if (caption)
        form.append('caption', caption);
    const method = fileType === 'video' ? 'sendVideo' : fileType === 'audio' ? 'sendAudio' : 'sendDocument';
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        body: form,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram ${method} failed: ${res.status} ${err}`);
    }
}
//# sourceMappingURL=telegram.js.map