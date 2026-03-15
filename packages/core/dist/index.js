/**
 * ApexPanda Gateway 入口
 */
// RangeError: Invalid array length 等致命错误时输出完整堆栈
process.on('uncaughtException', (err) => {
    if (err instanceof RangeError && err.message.includes('Invalid array length')) {
        console.error('[ApexPanda] RangeError: Invalid array length - 完整堆栈:');
        console.error(err.stack);
    }
});
import { getConfigSync, loadConfig, startConfigWatch, isChannelConfigured, getChannelInstances, configReloadEmitter, logConfigSummary } from './config/loader.js';
import { getMemoryConfig } from './config/loader.js';
import { createServer } from './server.js';
import { startSkillsWatch } from './skills/registry.js';
import { startFeishuWebSocket, stopAllFeishuWebSockets } from './channels/feishu-ws.js';
import { startChannelQueueWorker } from './channels/channel-queue.js';
import { logMem } from './debug-mem.js';
/** 按当前配置启动/停止渠道：方案 B 按实例列表遍历，未配置则停止，已配置则启动。配置热加载时调用。 */
async function startChannelsIfConfigured() {
    const instances = getChannelInstances();
    // 飞书/Lark：方案 B 多实例
    const feishuInstances = instances.filter((i) => (i.type === 'feishu' || i.type === 'lark') && isChannelConfigured(i.id));
    stopAllFeishuWebSockets();
    for (const inst of feishuInstances) {
        console.log('[ApexPanda] 正在启动渠道: 飞书', inst.id);
        try {
            startFeishuWebSocket(inst.id);
        }
        catch (e) {
            console.error('[ApexPanda] 渠道 飞书 启动失败:', inst.id, e);
        }
    }
    // Telegram：方案 B 多实例
    const { stopAllTelegramPolling, startTelegramPolling } = await import('./channels/telegram-ws.js');
    const telegramInstances = instances.filter((i) => i.type === 'telegram' && isChannelConfigured(i.id));
    stopAllTelegramPolling();
    for (const inst of telegramInstances) {
        console.log('[ApexPanda] 正在启动渠道: Telegram', inst.id);
        startTelegramPolling(inst.id).catch((e) => console.error('[ApexPanda] 渠道 Telegram 启动失败:', inst.id, e));
    }
    // Slack：方案 B 多实例
    const { stopAllSlackSockets, startSlackSocket } = await import('./channels/slack-ws.js');
    const slackInstances = instances.filter((i) => i.type === 'slack' && isChannelConfigured(i.id));
    await stopAllSlackSockets().catch(() => { });
    for (const inst of slackInstances) {
        console.log('[ApexPanda] 正在启动渠道: Slack', inst.id);
        startSlackSocket(inst.id).catch((e) => console.error('[ApexPanda] 渠道 Slack 启动失败:', inst.id, e));
    }
    // Discord：方案 B 多实例
    const { stopAllDiscordClients, startDiscordClient } = await import('./channels/discord-ws.js');
    const discordInstances = instances.filter((i) => i.type === 'discord' && isChannelConfigured(i.id));
    await stopAllDiscordClients().catch(() => { });
    for (const inst of discordInstances) {
        console.log('[ApexPanda] 正在启动渠道: Discord', inst.id);
        startDiscordClient(inst.id).catch((e) => console.error('[ApexPanda] 渠道 Discord 启动失败:', inst.id, e));
    }
    // 企业微信智能机器人：方案 B 多实例（长连接模式）
    const { stopAllWecomBotClients, startWecomBotClient } = await import('./channels/wecom-bot-ws.js');
    const wecomBotInstances = instances.filter((i) => i.type === 'wecom' && isChannelConfigured(i.id));
    await stopAllWecomBotClients().catch(() => { });
    for (const inst of wecomBotInstances) {
        console.log('[ApexPanda] 正在启动渠道: 企业微信智能机器人', inst.id);
        startWecomBotClient(inst.id).catch((e) => console.error('[ApexPanda] 渠道 企业微信智能机器人 启动失败:', inst.id, e));
    }
    // 钉钉 Stream 模式：方案 B 多实例（长连接，无 Webhook）
    const { stopAllDingTalkStreamClients, startDingTalkStreamClient } = await import('./channels/dingtalk-stream-ws.js');
    const dingtalkInstances = instances.filter((i) => i.type === 'dingtalk' && isChannelConfigured(i.id));
    await stopAllDingTalkStreamClients().catch(() => { });
    for (const inst of dingtalkInstances) {
        console.log('[ApexPanda] 正在启动渠道: 钉钉', inst.id);
        startDingTalkStreamClient(inst.id).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            const code = e instanceof Error ? e.code : '';
            if (code === 'ECONNRESET' || /socket disconnected|TLS connection|ECONNRESET/i.test(msg)) {
                console.warn(`[ApexPanda] 钉钉连接失败 (${inst.id})：网络被中断，可能是防火墙/代理、限流或网络不稳定，请稍后重试`);
            }
            else {
                console.error('[ApexPanda] 渠道 钉钉 启动失败:', inst.id, e);
            }
        });
    }
}
async function main() {
    if (process.env.APEXPANDA_DEBUG_MEM === '1') {
        console.log('[ApexPanda] 内存调试已开启 (APEXPANDA_DEBUG_MEM=1)，将输出 [mem] 日志');
    }
    logMem('main:start');
    await loadConfig();
    logConfigSummary();
    logMem('main:after-loadConfig');
    // 仅在已完成安装时初始化 API Key（未安装时跳过，由安装向导生成，避免绕过安装流程）
    const { isInstalled } = await import('./install/wizard.js');
    if (isInstalled()) {
        const { getConfiguredApiKey } = await import('./auth/api-key.js');
        getConfiguredApiKey();
    }
    else {
        console.log('[ApexPanda] Setup required. Please visit http://localhost:18790/install to complete installation.');
    }
    logMem('main:after-apiKey');
    const { ensureCronRunnerStarted } = await import('./cron-scheduler/store.js');
    ensureCronRunnerStarted();
    logMem('main:after-cron');
    const { refreshWorkflowCronScheduler } = await import('./workflow/scheduler.js');
    await refreshWorkflowCronScheduler();
    logMem('main:after-workflow');
    startSkillsWatch();
    logMem('main:after-skillsWatch');
    startConfigWatch();
    logMem('main:after-configWatch');
    const cfg = getConfigSync();
    const port = Number(process.env.APEXPANDA_PORT ?? cfg.port ?? 18790);
    const server = await createServer();
    logMem('main:after-createServer');
    configReloadEmitter.on('reload', () => {
        logConfigSummary();
        console.log('[ApexPanda] 配置已重载，正在重启渠道...');
        void startChannelsIfConfigured();
    });
    server.listen(port, '0.0.0.0', async () => {
        console.log(`[ApexPanda] Gateway running at http://0.0.0.0:${port}`);
        logMem('main:listen-callback-start');
        startChannelQueueWorker(async (payload) => {
            if (payload.kind === 'ws') {
                const { handleFeishuMessageSync } = await import('./channels/feishu-ws.js');
                await handleFeishuMessageSync(payload.instanceId, payload.event);
            }
            else {
                const { processFeishuEventDeferred } = await import('./server.js');
                await processFeishuEventDeferred({
                    type: 'event',
                    deferred: true,
                    rawBody: payload.rawBody,
                    messageId: payload.messageId,
                    chatId: payload.chatId,
                    chatType: payload.chatType,
                    userId: payload.userId,
                    messageType: payload.messageType,
                });
            }
        });
        logMem('main:listen-callback-after-feishu');
        await startChannelsIfConfigured();
        const { cleanNodeMediaDir } = await import('./node/media.js');
        const { cleanupExpiredPending } = await import('./node/store.js');
        const retentionMs = 3600_000;
        setInterval(() => cleanNodeMediaDir(retentionMs).then((n) => n > 0 && console.log(`[node-media] 清理 ${n} 个超期文件`)), retentionMs);
        setInterval(cleanupExpiredPending, 5 * 60 * 1000);
        // 定时清理各类待确认内存状态（pendingDelete / pendingWorkflowCreate / pendingAgentCreate / activeDiscussion）
        setInterval(async () => {
            const { cleanupExpiredPendingDeletes } = await import('./delete-confirm/store.js');
            const { cleanupExpiredPendingCreates } = await import('./workflow/workflow-create-intent.js');
            const { cleanupExpiredPendingAgentCreates } = await import('./agent/agent-create-intent.js');
            const { cleanupExpiredDiscussions } = await import('./discussion/store.js');
            cleanupExpiredPendingDeletes();
            cleanupExpiredPendingCreates();
            cleanupExpiredPendingAgentCreates();
            cleanupExpiredDiscussions();
        }, 5 * 60 * 1000);
        // 活起来 P3: 周期性记忆 consolidation
        // MCP 启动预热：异步连接 MCP Server，不阻塞 listen，避免渠道消息首次请求时长时间等待
        try {
            const { ensureMcpConnections } = await import('./mcp/client.js');
            void ensureMcpConnections()
                .then((c) => {
                if (c.length > 0)
                    console.log(`[MCP] 预热完成，已连接 ${c.length} 个 MCP Server`);
            })
                .catch((e) => console.warn('[MCP] 预热失败:', e instanceof Error ? e.message : e));
        }
        catch {
            /* mcp 模块可能未使用 */
        }
        const memCfg = getMemoryConfig();
        if (memCfg.consolidationEnabled && memCfg.consolidationCron) {
            const cronMod = await import('node-cron');
            if (cronMod.default.validate(memCfg.consolidationCron)) {
                cronMod.default.schedule(memCfg.consolidationCron, async () => {
                    const { runMemoryConsolidation } = await import('./memory/consolidation.js');
                    try {
                        const n = await runMemoryConsolidation();
                        if (n > 0)
                            console.log(`[ApexPanda] Memory consolidation 归档 ${n} 条记忆`);
                    }
                    catch (e) {
                        console.error('[ApexPanda] Memory consolidation 失败:', e);
                    }
                });
                console.log(`[ApexPanda] Memory consolidation 已调度: ${memCfg.consolidationCron}`);
            }
            else {
                console.warn(`[ApexPanda] 无效的 consolidationCron: ${memCfg.consolidationCron}`);
            }
        }
    });
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map