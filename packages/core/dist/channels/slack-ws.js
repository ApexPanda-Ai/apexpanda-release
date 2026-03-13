/**
 * Slack Socket 模式
 * 无需 Webhook，无需公网 URL
 */
import { getSlackBotToken, getSlackAppToken } from '../config/loader.js';
let app = null;
export async function startSlackSocket() {
    const botToken = getSlackBotToken();
    const appToken = getSlackAppToken();
    if (!botToken || !appToken)
        return;
    if (app)
        return;
    const { App } = await import('@slack/bolt');
    const slackApp = new App({
        token: botToken,
        appToken,
        socketMode: true,
    });
    slackApp.message(async ({ message, say }) => {
        const msg = message;
        if (!msg.text?.trim() || msg.subtype === 'bot_message')
            return;
        const channelId = msg.channel ?? '';
        if (!channelId)
            return;
        const { processChannelEvent } = await import('../server.js');
        await processChannelEvent('slack', { content: msg.text.trim() }, { chatId: channelId });
    });
    await slackApp.start();
    app = slackApp;
    console.log('[ApexPanda] Slack Socket 模式已启动');
}
export async function stopSlackSocket() {
    if (app) {
        await app.stop();
        app = null;
        console.log('[Slack] Socket mode stopped');
    }
}
//# sourceMappingURL=slack-ws.js.map