/** 去掉消息开头的 @机器人昵称 前缀（群聊中用户 @Bot 时会带上） */
function stripAtMention(text) {
    return text.replace(/^@\S+\s*/, '').trim();
}
/** 钉钉 Outgoing 回调格式 */
export function parseDingTalkOutgoing(body, tenantId = 'default') {
    const rawText = body.text?.content?.trim();
    if (!rawText)
        return null;
    // senderStaffId 优先（企业真实 userid），其次 senderId，最后 chatbotUserId 兜底
    const peerId = body.senderStaffId ?? body.senderId ?? body.chatbotUserId ?? '';
    if (!peerId)
        return null;
    // 群聊中消息内容包含 @机器人 前缀，去掉后才是真实指令
    const content = body.conversationType === '2' ? stripAtMention(rawText) : rawText;
    if (!content)
        return null;
    return {
        channel: 'dingtalk',
        channelPeerId: peerId,
        tenantId,
        content,
        raw: body,
        meta: {
            conversationType: body.conversationType,
            conversationId: body.conversationId,
            conversationTitle: body.conversationTitle,
            senderNick: body.senderNick,
        },
    };
}
export function handleDingTalkWebhook(body, tenantId = 'default') {
    const msg = parseDingTalkOutgoing(body, tenantId);
    if (!msg)
        return null;
    return {
        type: 'event',
        message: msg,
        sessionWebhook: body.sessionWebhook,
    };
}
/** 通过 sessionWebhook 回复（Outgoing 机器人） */
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
/** 文件直通降级：钉钉 Outgoing Webhook 不支持图片/文件，发 markdown 文本说明 */
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