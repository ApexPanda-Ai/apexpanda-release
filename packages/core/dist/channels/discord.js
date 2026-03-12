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
//# sourceMappingURL=discord.js.map