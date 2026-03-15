/** 解析 WhatsApp webhook 为 IncomingMessage */
export function parseWhatsAppWebhook(body) {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    if (!msg?.text?.body?.trim())
        return null;
    const from = msg.from;
    if (!from)
        return null;
    return {
        channel: 'whatsapp',
        channelPeerId: from,
        tenantId: 'default',
        content: msg.text.body.trim(),
        raw: body,
    };
}
/** 处理 WhatsApp webhook GET 验证请求 */
export function handleWhatsAppVerify(hubMode, hubVerifyToken, hubChallenge, expectedVerifyToken) {
    if (hubMode !== 'subscribe')
        return null;
    if (hubVerifyToken !== expectedVerifyToken)
        return null;
    return { type: 'verify', challenge: hubChallenge };
}
/** 处理 WhatsApp webhook POST 事件 */
export function handleWhatsAppWebhook(body) {
    const msg = parseWhatsAppWebhook(body);
    if (!msg)
        return null;
    const entry = body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    return {
        type: 'event',
        message: msg,
        phoneNumberId: value?.metadata?.phone_number_id,
    };
}
const WHATSAPP_API = 'https://graph.facebook.com/v21.0';
/** 通过 WhatsApp Cloud API 发送文本消息 */
export async function sendWhatsAppMessage(to, content, phoneNumberId, accessToken) {
    const url = `${WHATSAPP_API}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to.replace(/\D/g, ''),
            type: 'text',
            text: { body: content },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`WhatsApp send failed: ${res.status} ${err}`);
    }
}
/** 上传媒体获取 media_id */
async function uploadWhatsAppMedia(filePath, mimeType, phoneNumberId, accessToken) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const buf = await readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mimeType }), basename(filePath));
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    const res = await fetch(`${WHATSAPP_API}/${phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`WhatsApp media upload failed: ${res.status} ${err}`);
    }
    const data = (await res.json());
    if (!data.id)
        throw new Error(`WhatsApp media upload: no id, ${data.error?.message ?? JSON.stringify(data)}`);
    return data.id;
}
const IMAGE_EXT_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};
/** 文件直通：发送图片 */
export async function sendWhatsAppImage(to, filePath, caption, phoneNumberId, accessToken, mimeType) {
    const ext = (await import('node:path')).extname(filePath).toLowerCase();
    const mime = mimeType ?? IMAGE_EXT_MIME[ext] ?? 'image/jpeg';
    const mediaId = await uploadWhatsAppMedia(filePath, mime, phoneNumberId, accessToken);
    const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace(/\D/g, ''),
        type: 'image',
        image: { id: mediaId },
    };
    if (caption)
        body.image.caption = caption;
    const res = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`WhatsApp image send failed: ${res.status} ${err}`);
    }
}
/** 文件直通：发送文档/音频/视频等 */
export async function sendWhatsAppDocument(to, filePath, mimeType, caption, phoneNumberId, accessToken) {
    const mediaId = await uploadWhatsAppMedia(filePath, mimeType, phoneNumberId, accessToken);
    const { basename } = await import('node:path');
    const doc = { id: mediaId, filename: basename(filePath) };
    if (caption)
        doc.caption = caption;
    const res = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to.replace(/\D/g, ''),
            type: 'document',
            document: doc,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`WhatsApp document send failed: ${res.status} ${err}`);
    }
}
//# sourceMappingURL=whatsapp.js.map