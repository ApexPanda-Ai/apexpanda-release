/**
 * Discord Gateway（WebSocket）模式
 * 通过 discord.js 连接 Gateway 接收消息，无 HTTP Webhook
 * 方案 B：支持多实例 startDiscordClient(instanceId)
 */
import { getDiscordBotToken } from '../config/loader.js';
const clientsByInstance = new Map();
export async function startDiscordClient(instanceId) {
    const botToken = getDiscordBotToken(instanceId);
    if (!botToken)
        return;
    if (clientsByInstance.has(instanceId))
        return;
    const discord = await import('discord.js');
    const { Client, GatewayIntentBits } = discord;
    const discordClient = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    });
    discordClient.on('messageCreate', async (message) => {
        if (message.author.bot)
            return;
        const content = message.content?.trim();
        if (!content)
            return;
        const { processChannelEvent } = await import('../server.js');
        await processChannelEvent(instanceId, { content }, { chatId: message.channel.id });
    });
    discordClient.once('ready', () => {
        console.log(`[ApexPanda] Discord Bot 已登录: ${instanceId} ${discordClient.user?.tag ?? 'unknown'}`);
    });
    await discordClient.login(botToken);
    clientsByInstance.set(instanceId, discordClient);
}
export async function stopDiscordClient(instanceId) {
    const c = clientsByInstance.get(instanceId);
    if (c) {
        c.destroy();
        clientsByInstance.delete(instanceId);
        console.log(`[Discord] Client stopped: ${instanceId}`);
    }
}
export async function stopAllDiscordClients() {
    const ids = [...clientsByInstance.keys()];
    for (const id of ids) {
        await stopDiscordClient(id);
    }
}
//# sourceMappingURL=discord-ws.js.map