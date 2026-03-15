/**
 * Discord 渠道适配器
 * @see https://discord.com/developers/docs/resources/channel#create-message
 */
/** 通过 Discord REST API 发送消息 */
export async function sendDiscordMessage(channelId, content, botToken) {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Discord send failed: ${res.status} ${err}`);
    }
}
/** 文件直通：通过 Discord API 发送文件附件 */
export async function sendDiscordFile(channelId, filePath, mimeType, caption, botToken) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const buf = await readFile(filePath);
    const filename = basename(filePath);
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: caption ?? '' }));
    form.append('files[0]', new Blob([buf], { type: mimeType }), filename);
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}` },
        body: form,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Discord file send failed: ${res.status} ${err}`);
    }
}
//# sourceMappingURL=discord.js.map