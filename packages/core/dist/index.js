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
import { getConfigSync, loadConfig, startConfigWatch, isChannelConfigured, configReloadEmitter } from './config/loader.js';
import { getMemoryConfig } from './config/loader.js';
import { createServer } from './server.js';
import { startSkillsWatch } from './skills/registry.js';
import { startFeishuWebSocket } from './channels/feishu-ws.js';
import { startChannelQueueWorker } from './channels/channel-queue.js';
import { logMem } from './debug-mem.js';
/** 按当前配置启动已配置的渠道（Telegram/Slack/Discord/飞书），已启动的会 no-op */
async function startChannelsIfConfigured() {
    if (isChannelConfigured('feishu'))
        startFeishuWebSocket();
    if (isChannelConfigured('telegram')) {
        const { startTelegramPolling } = await import('./channels/telegram-ws.js');
        startTelegramPolling().catch((e) => console.error('[Telegram]', e));
    }
    if (isChannelConfigured('slack')) {
        const { startSlackSocket } = await import('./channels/slack-ws.js');
        startSlackSocket().catch((e) => console.error('[Slack]', e));
    }
    if (isChannelConfigured('discord')) {
        const { startDiscordClient } = await import('./channels/discord-ws.js');
        startDiscordClient().catch((e) => console.error('[Discord]', e));
    }
}
async function main() {
    if (process.env.APEXPANDA_DEBUG_MEM === '1') {
        console.log('[ApexPanda] 内存调试已开启 (APEXPANDA_DEBUG_MEM=1)，将输出 [mem] 日志');
    }
    logMem('main:start');
    await loadConfig();
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
        void startChannelsIfConfigured();
    });
    server.listen(port, '0.0.0.0', async () => {
        console.log(`[ApexPanda] Gateway running at http://0.0.0.0:${port}`);
        logMem('main:listen-callback-start');
        if (isChannelConfigured('feishu'))
            startFeishuWebSocket();
        startChannelQueueWorker(async (payload) => {
            if (payload.kind === 'ws') {
                const { handleFeishuMessageSync } = await import('./channels/feishu-ws.js');
                await handleFeishuMessageSync(payload.event);
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