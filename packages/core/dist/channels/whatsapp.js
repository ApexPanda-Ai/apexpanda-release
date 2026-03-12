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
//# sourceMappingURL=whatsapp.js.map