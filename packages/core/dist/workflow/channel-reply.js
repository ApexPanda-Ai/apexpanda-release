/** 向渠道发送文件（图片/音频/视频/通用文件），供 Agent 文件直通、工作流等复用 */
export async function sendFileToChannel(channel, ctx, fr) {
    const absPath = fr.filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fr.filePath)
        ? fr.filePath
        : (await import('node:path')).join(process.cwd(), fr.filePath.replace(/^\.[/\\]/, ''));
    try {
        if (channel === 'feishu' && ctx.messageId) {
            const { replyFeishuImage, replyFeishuFile } = await import('../channels/feishu-client.js');
            if (fr.fileType === 'image') {
                await replyFeishuImage(ctx.messageId, absPath, fr.caption);
            }
            else {
                await replyFeishuFile(ctx.messageId, absPath, fr.mimeType, fr.caption);
            }
        }
        else if (channel === 'dingtalk' && ctx.sessionWebhook) {
            const { sendDingTalkFileFallback } = await import('../channels/dingtalk.js');
            await sendDingTalkFileFallback(ctx.sessionWebhook, fr.caption ?? '文件已生成', absPath, fr.fileType);
        }
        else if (channel === 'wecom' && ctx.chatId) {
            const { getWeComCorpId, getWeComAgentId, getWeComSecret } = await import('../config/loader.js');
            const { sendWeComImage, sendWeComFile } = await import('../channels/wecom.js');
            const corpId = getWeComCorpId();
            const agentId = getWeComAgentId();
            const secret = getWeComSecret();
            if (corpId && agentId && secret) {
                const opts = { corpId, agentId, secret };
                if (fr.fileType === 'image') {
                    await sendWeComImage(ctx.chatId, absPath, fr.caption, opts);
                }
                else {
                    await sendWeComFile(ctx.chatId, absPath, fr.mimeType, fr.caption, opts);
                }
            }
            else {
                console.log('[wecom] sendFileToChannel (no corpId/agentId/secret):', fr.filePath);
            }
        }
        else if (channel === 'telegram' && ctx.chatId) {
            const { getTelegramBotToken } = await import('../config/loader.js');
            const { sendTelegramPhoto, sendTelegramDocument } = await import('../channels/telegram.js');
            const token = getTelegramBotToken();
            if (token) {
                if (fr.fileType === 'image') {
                    await sendTelegramPhoto(ctx.chatId, absPath, fr.caption, token);
                }
                else {
                    await sendTelegramDocument(ctx.chatId, absPath, fr.mimeType, fr.caption, token, fr.fileType);
                }
            }
            else {
                console.log('[telegram] sendFileToChannel (no token):', fr.filePath);
            }
        }
        else {
            console.log(`[${channel}] sendFileToChannel (渠道暂不支持发文件):`, fr.filePath);
        }
    }
    catch (fileErr) {
        console.error(`[sendFileToChannel] 文件发送失败 (${channel}):`, fileErr);
        await sendReplyToChannel(channel, ctx, `${fr.caption ?? '文件已生成'}，路径：${fr.filePath}`).catch(() => { });
    }
}
/** 将帮助文本转为 Markdown（用于钉钉、企微等） */
function helpTextToMarkdown(text) {
    return text
        .replace(/^【([^】]+)】/, '## $1\n\n')
        .replace(/^([一二三四五六七八九十\d]+)、/gm, '### $1、\n')
        .replace(/^  •/gm, '- ')
        .replace(/\n\n输入 \/help[^\n]*$/m, '\n\n*输入 /help 或 /帮助 可再次查看*');
}
/** 发送帮助信息（飞书用卡片、钉钉用 Markdown、其他用纯文本） */
export async function sendHelpToChannel(channel, ctx, helpText) {
    if (channel === 'feishu' && ctx.messageId) {
        const { sendFeishuHelpCard } = await import('../channels/feishu-client.js');
        await sendFeishuHelpCard(ctx.messageId, helpText);
    }
    else if (channel === 'dingtalk' && ctx.sessionWebhook) {
        const { sendDingTalkMarkdown } = await import('../channels/dingtalk.js');
        const title = helpText.match(/【([^】]+)】/)?.[1] ?? '渠道操作说明';
        const md = helpTextToMarkdown(helpText);
        await sendDingTalkMarkdown(ctx.sessionWebhook, title, md);
    }
    else if (channel === 'wecom' && ctx.chatId) {
        const { getWeComCorpId, getWeComAgentId, getWeComSecret } = await import('../config/loader.js');
        const { sendWeComMarkdown } = await import('../channels/wecom.js');
        const corpId = getWeComCorpId();
        const agentId = getWeComAgentId();
        const secret = getWeComSecret();
        if (corpId && agentId && secret) {
            const md = helpTextToMarkdown(helpText);
            await sendWeComMarkdown(ctx.chatId, md, { corpId, agentId, secret });
        }
        else {
            await sendReplyToChannel(channel, ctx, helpText);
        }
    }
    else {
        await sendReplyToChannel(channel, ctx, helpText);
    }
}
/** 是否为由网络引起的可重试错误 */
function isTransientNetworkError(e) {
    const msg = e instanceof Error ? (e.message + (e.cause instanceof Error ? e.cause.message : '')) : String(e);
    return /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|network/i.test(msg);
}
export async function sendReplyToChannel(channel, ctx, content, options) {
    const maxRetries = Math.max(0, options?.retries ?? 2);
    if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
        const len = content?.length ?? 0;
        const first50 = content?.slice(0, 50) ?? '';
        const last50 = len > 50 ? content.slice(-50) : '';
        console.log(`[渠道调试] sendReplyToChannel channel=${channel} len=${len} first50="${first50.replace(/\n/g, '\\n')}" last50="${last50.replace(/\n/g, '\\n')}"`);
    }
    const doSend = async () => {
        if (channel === 'chat' && ctx.replyCapturer) {
            ctx.replyCapturer(content);
            return;
        }
        if (channel === 'feishu' && ctx.messageId) {
            const { sendFeishuReply } = await import('../channels/feishu-client.js');
            await sendFeishuReply(ctx.messageId, content);
        }
        else if (channel === 'feishu' && ctx.chatId) {
            const { sendFeishuMessage } = await import('../channels/feishu-client.js');
            await sendFeishuMessage({ receiveId: ctx.chatId, receiveIdType: 'chat_id', content });
        }
        else if (channel === 'dingtalk' && ctx.sessionWebhook) {
            const { sendDingTalkReply } = await import('../channels/dingtalk.js');
            await sendDingTalkReply(ctx.sessionWebhook, content);
        }
        else if (channel === 'telegram' && ctx.chatId) {
            const { getTelegramBotToken } = await import('../config/loader.js');
            const { sendTelegramMessage } = await import('../channels/telegram.js');
            const token = getTelegramBotToken();
            if (token)
                await sendTelegramMessage(ctx.chatId, content, token);
            else
                console.log('[telegram] Workflow reply (no token):', content.slice(0, 80));
        }
        else if (channel === 'slack' && ctx.chatId) {
            const { getSlackBotToken } = await import('../config/loader.js');
            const { sendSlackMessage } = await import('../channels/slack.js');
            const token = getSlackBotToken();
            if (token)
                await sendSlackMessage(ctx.chatId, content, token);
            else
                console.log('[slack] Workflow reply (no token):', content.slice(0, 80));
        }
        else if (channel === 'whatsapp' && ctx.chatId && ctx.phoneNumberId) {
            const { getWhatsAppAccessToken } = await import('../config/loader.js');
            const { sendWhatsAppMessage } = await import('../channels/whatsapp.js');
            const token = getWhatsAppAccessToken();
            if (token)
                await sendWhatsAppMessage(ctx.chatId, content, ctx.phoneNumberId, token);
            else
                console.log('[whatsapp] Workflow reply (no token):', content.slice(0, 80));
        }
        else if (channel === 'wecom' && ctx.chatId) {
            const { getWeComCorpId, getWeComAgentId, getWeComSecret } = await import('../config/loader.js');
            const { sendWeComMessage } = await import('../channels/wecom.js');
            const corpId = getWeComCorpId();
            const agentId = getWeComAgentId();
            const secret = getWeComSecret();
            if (corpId && agentId && secret) {
                await sendWeComMessage(ctx.chatId, content, { corpId, agentId, secret });
            }
            else {
                console.log('[wecom] Workflow reply (no corpId/agentId/secret):', content.slice(0, 80));
            }
        }
        else if (channel === 'discord' && ctx.chatId) {
            const { getDiscordBotToken } = await import('../config/loader.js');
            const { sendDiscordMessage } = await import('../channels/discord.js');
            const token = getDiscordBotToken();
            if (token)
                await sendDiscordMessage(ctx.chatId, content, token);
            else
                console.log('[discord] Workflow reply (no token):', content.slice(0, 80));
        }
        else {
            console.log(`[${channel}] Workflow reply (no sender, not sent):`, content.slice(0, 80));
        }
    };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await doSend();
            return;
        }
        catch (e) {
            if (attempt < maxRetries && isTransientNetworkError(e)) {
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                continue;
            }
            throw e;
        }
    }
}
//# sourceMappingURL=channel-reply.js.map