/**
 * Discord Gateway（WebSocket）模式
 * 通过 discord.js 连接 Gateway 接收消息，无 HTTP Webhook
 */
import { getDiscordBotToken } from '../config/loader.js';
let client = null;
export async function startDiscordClient() {
    const botToken = getDiscordBotToken();
    if (!botToken)
        return;
    if (client)
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
        await processChannelEvent('discord', { content }, { chatId: message.channel.id });
    });
    discordClient.once('ready', () => {
        console.log(`[Discord] Bot logged in as ${discordClient.user?.tag ?? 'unknown'}`);
    });
    await discordClient.login(botToken);
    client = discordClient;
}
export async function stopDiscordClient() {
    if (client) {
        client.destroy();
        client = null;
        console.log('[Discord] Client stopped');
    }
}
//# sourceMappingURL=discord-ws.js.map