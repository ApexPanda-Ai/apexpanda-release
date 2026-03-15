/**
 * Slack Socket 模式
 * 无需 Webhook，无需公网 URL
 * 方案 B：支持多实例 startSlackSocket(instanceId)
 */
import { getSlackBotToken, getSlackAppToken } from '../config/loader.js';
const appsByInstance = new Map();
export async function startSlackSocket(instanceId) {
    const botToken = getSlackBotToken(instanceId);
    const appToken = getSlackAppToken(instanceId);
    if (!botToken || !appToken)
        return;
    if (appsByInstance.has(instanceId))
        return;
    const { App } = await import('@slack/bolt');
    const slackApp = new App({
        token: botToken,
        appToken,
        socketMode: true,
    });
    slackApp.message(async ({ message }) => {
        const msg = message;
        if (!msg.text?.trim() || msg.subtype === 'bot_message')
            return;
        const channelId = msg.channel ?? '';
        if (!channelId)
            return;
        const { processChannelEvent } = await import('../server.js');
        await processChannelEvent(instanceId, { content: msg.text.trim() }, { chatId: channelId });
    });
    await slackApp.start();
    appsByInstance.set(instanceId, slackApp);
    console.log(`[ApexPanda] Slack Socket 模式已启动: ${instanceId}`);
}
export async function stopSlackSocket(instanceId) {
    const app = appsByInstance.get(instanceId);
    if (app) {
        await app.stop();
        appsByInstance.delete(instanceId);
        console.log(`[Slack] Socket mode stopped: ${instanceId}`);
    }
}
export async function stopAllSlackSockets() {
    const ids = [...appsByInstance.keys()];
    for (const id of ids) {
        await stopSlackSocket(id);
    }
}
//# sourceMappingURL=slack-ws.js.map