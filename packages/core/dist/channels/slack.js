/**
 * Slack Events API 渠道适配器
 * @see https://api.slack.com/events-api
 */
import { createHmac } from 'node:crypto';
/** 验证 Slack 请求签名（需 X-Slack-Signature 与 X-Slack-Request-Timestamp） */
export function verifySlackSignatureRaw(rawBody, signingSecret, signatureHeader, timestampHeader) {
    if (!signingSecret || !signatureHeader || !timestampHeader)
        return false;
    const ts = parseInt(timestampHeader, 10);
    if (isNaN(ts))
        return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 60 * 5)
        return false; // 5 min replay window
    const sigBase = `v0:${timestampHeader}:${rawBody}`;
    const hmac = createHmac('sha256', signingSecret);
    hmac.update(sigBase);
    const computed = 'v0=' + hmac.digest('hex');
    return signatureHeader === computed;
}
/** 解析 Slack event 为 IncomingMessage */
export function parseSlackEvent(payload) {
    const ev = payload.event;
    if (!ev?.text?.trim())
        return null;
    if (ev.type !== 'message' && ev.type !== 'app_mention')
        return null;
    if (ev.subtype === 'bot_message')
        return null;
    const channelId = ev.channel;
    if (!channelId)
        return null;
    return {
        channel: 'slack',
        channelPeerId: channelId,
        tenantId: payload.team_id ?? 'default',
        content: ev.text.trim(),
        raw: payload,
    };
}
/** 处理 Slack webhook（需传入原始 body 以便验签） */
export function handleSlackWebhook(body, rawBody, signingSecret, signature, timestamp) {
    if (!verifySlackSignatureRaw(rawBody, signingSecret, signature, timestamp)) {
        return null;
    }
    if (body.type === 'url_verification' && body.challenge) {
        return { type: 'challenge', challenge: body.challenge };
    }
    const msg = parseSlackEvent(body);
    if (!msg)
        return null;
    const channelId = body.event?.channel ?? '';
    return {
        type: 'event',
        message: msg,
        channelId,
    };
}
/** 通过 Slack API 发送消息 */
export async function sendSlackMessage(channelId, content, botToken) {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
            channel: channelId,
            text: content,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Slack send failed: ${res.status} ${err}`);
    }
    const data = (await res.json());
    if (!data.ok) {
        throw new Error(`Slack API error: ${JSON.stringify(data)}`);
    }
}
/** 文件直通：通过 Slack files.upload 上传并发送到频道 */
export async function sendSlackFile(channelId, filePath, mimeType, caption, botToken) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const buf = await readFile(filePath);
    const form = new FormData();
    form.append('token', botToken);
    form.append('channels', channelId);
    form.append('file', new Blob([buf], mimeType ? { type: mimeType } : undefined), basename(filePath));
    form.append('filename', basename(filePath));
    form.append('filetype', 'auto');
    if (caption)
        form.append('initial_comment', caption);
    const res = await fetch('https://slack.com/api/files.upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${botToken}` },
        body: form,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Slack file upload failed: ${res.status} ${err}`);
    }
    const data = (await res.json());
    if (!data.ok) {
        throw new Error(`Slack file upload error: ${data.error ?? JSON.stringify(data)}`);
    }
}
//# sourceMappingURL=slack.js.map