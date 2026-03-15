/**
 * 钉钉渠道适配器（Stream 模式）
 * 通过 sessionWebhook 回复，用于 channel-reply 与 cron 推送
 * 支持文本、Markdown、图片、文件直通
 * @see https://open.dingtalk.com/document/orgapp/robot-overview
 */
import { getDingTalkClientId, getDingTalkClientSecret } from '../config/loader.js';
const DINGTALK_OAPI = 'https://oapi.dingtalk.com';
/** access_token 缓存（按 instanceId，2 小时有效） */
const tokenCache = new Map();
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 - 60 * 1000; // 提前 1 分钟刷新
async function getDingTalkAccessToken(instanceId) {
    const id = instanceId ?? 'dingtalk';
    const cached = tokenCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
    }
    const clientId = getDingTalkClientId(id);
    const clientSecret = getDingTalkClientSecret(id);
    if (!clientId?.trim() || !clientSecret?.trim()) {
        throw new Error('钉钉未配置 clientId 或 clientSecret');
    }
    const url = `${DINGTALK_OAPI}/gettoken?appkey=${encodeURIComponent(clientId.trim())}&appsecret=${encodeURIComponent(clientSecret.trim())}`;
    const res = await fetch(url);
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DingTalk gettoken failed: ${res.status} ${err}`);
    }
    const data = (await res.json());
    if (data.errcode !== 0 || !data.access_token) {
        throw new Error(data.errmsg ?? 'DingTalk gettoken: no access_token');
    }
    tokenCache.set(id, { token: data.access_token, expiresAt: Date.now() + TOKEN_TTL_MS });
    return data.access_token;
}
/** 上传媒体文件，返回 media_id。type: image|voice|video|file */
async function uploadDingTalkMedia(instanceId, fileBuffer, mediaType, filename) {
    const token = await getDingTalkAccessToken(instanceId);
    const FormDataLib = (await import('form-data')).default;
    const form = new FormDataLib();
    form.append('type', mediaType);
    form.append('media', fileBuffer, { filename });
    /** 使用 getBuffer 确保 multipart 完整发送，避免 fetch+stream 导致钉钉「缺少参数 media」 */
    const body = form.getBuffer();
    const headers = form.getHeaders();
    const res = await fetch(`${DINGTALK_OAPI}/media/upload?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(body.length) },
        body: new Uint8Array(body),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DingTalk media upload failed: ${res.status} ${err}`);
    }
    const data = (await res.json());
    if (data.errcode !== 0 || !data.media_id) {
        throw new Error(data.errmsg ?? 'DingTalk media upload: no media_id');
    }
    return data.media_id;
}
/** 通过 sessionWebhook 回复（Stream 模式消息中自带） */
export async function sendDingTalkReply(webhook, content) {
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            msgtype: 'text',
            text: { content },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DingTalk reply failed: ${res.status} ${err}`);
    }
}
/** 通过 sessionWebhook 发送 Markdown 格式消息 */
export async function sendDingTalkMarkdown(webhook, title, text) {
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            msgtype: 'markdown',
            markdown: { title, text },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DingTalk markdown failed: ${res.status} ${err}`);
    }
}
/** 通过 sessionWebhook 发送图片（msgtype: image） */
async function sendDingTalkImage(webhook, mediaId) {
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            msgtype: 'image',
            image: { media_id: mediaId },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DingTalk image send failed: ${res.status} ${err}`);
    }
}
/** 通过 sessionWebhook 发送文件（msgtype: file，钉钉支持则发送，否则抛错由调用方降级） */
async function sendDingTalkFileMsg(webhook, mediaId) {
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            msgtype: 'file',
            file: { media_id: mediaId },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DingTalk file send failed: ${res.status} ${err}`);
    }
}
/** 文件直通：上传并发送图片/文件，失败时调用方降级为 sendDingTalkFileFallback */
export async function sendDingTalkFile(webhook, filePath, fileType, mimeType, caption, instanceId) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const buf = await readFile(filePath);
    const filename = basename(filePath);
    const toMediaType = (t) => {
        if (t === 'image')
            return 'image';
        if (t === 'audio')
            return 'voice';
        if (t === 'video')
            return 'video';
        return 'file';
    };
    const mediaType = toMediaType(fileType);
    const mediaId = await uploadDingTalkMedia(instanceId, buf, mediaType, filename);
    if (fileType === 'image') {
        await sendDingTalkImage(webhook, mediaId);
    }
    else {
        await sendDingTalkFileMsg(webhook, mediaId);
    }
    if (caption?.trim()) {
        await sendDingTalkReply(webhook, caption.trim());
    }
}
/** 文件直通降级：钉钉不支持或上传失败时，发 markdown 文本说明 */
export async function sendDingTalkFileFallback(webhook, caption, filePath, fileType) {
    const title = caption || '文件已生成';
    const text = `${title}\n\n- **类型**：${fileType ?? 'file'}\n- **路径**：\`${filePath}\``;
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            msgtype: 'markdown',
            markdown: { title, text },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DingTalk file fallback failed: ${res.status} ${err}`);
    }
}
//# sourceMappingURL=dingtalk.js.map