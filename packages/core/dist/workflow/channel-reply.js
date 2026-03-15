/** 是否为飞书/Lark 类型（含 instanceId） */
function isFeishuChannel(channel, getInstanceType) {
    if (channel === 'feishu' || channel === 'lark')
        return true;
    const t = getInstanceType(channel);
    return t === 'feishu' || t === 'lark';
}
/** 向渠道发送文件（图片/音频/视频/通用文件），供 Agent 文件直通、工作流等复用 */
export async function sendFileToChannel(channel, ctx, fr) {
    const absPath = fr.filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fr.filePath)
        ? fr.filePath
        : (await import('node:path')).join(process.cwd(), fr.filePath.replace(/^\.[/\\]/, ''));
    const { getInstanceType } = await import('../config/loader.js');
    const isFeishu = channel === 'feishu' || channel === 'lark' || getInstanceType(channel) === 'feishu' || getInstanceType(channel) === 'lark';
    const instanceId = channel.startsWith('inst_') ? channel : undefined;
    try {
        if (isFeishu && ctx.messageId) {
            const { replyFeishuImage, replyFeishuFile } = await import('../channels/feishu-client.js');
            if (fr.fileType === 'image') {
                await replyFeishuImage(ctx.messageId, absPath, fr.caption, instanceId);
            }
            else {
                await replyFeishuFile(ctx.messageId, absPath, fr.mimeType, fr.caption, instanceId);
            }
        }
        else if ((channel === 'dingtalk' || getInstanceType(channel) === 'dingtalk') && ctx.sessionWebhook) {
            const { sendDingTalkFile, sendDingTalkFileFallback } = await import('../channels/dingtalk.js');
            try {
                await sendDingTalkFile(ctx.sessionWebhook, absPath, fr.fileType, fr.mimeType, fr.caption, instanceId);
            }
            catch (e) {
                console.warn(`[DingTalk] 文件直通失败，降级为文本说明:`, e instanceof Error ? e.message : e);
                await sendDingTalkFileFallback(ctx.sessionWebhook, fr.caption ?? '文件已生成', absPath, fr.fileType);
            }
        }
        else if ((channel === 'wecom' || getInstanceType(channel) === 'wecom') && (ctx.chatId || ctx.wecomFrame)) {
            const { readFile } = await import('node:fs/promises');
            const { basename } = await import('node:path');
            const { sendWecomBotFile } = await import('../channels/wecom-bot-ws.js');
            const credId = (channel.startsWith('inst_') ? channel : undefined) ?? channel;
            try {
                const fileBuffer = await readFile(absPath);
                const filename = basename(absPath);
                const ok = await sendWecomBotFile(credId, ctx, fileBuffer, fr.fileType, filename, fr.caption);
                if (!ok)
                    throw new Error('sendWecomBotFile returned false');
            }
            catch (wecomFileErr) {
                const { sendWecomBotText } = await import('../channels/wecom-bot-ws.js');
                const fallback = fr.caption ? `${fr.caption}，路径：${fr.filePath}` : `文件已生成，路径：${fr.filePath}`;
                await sendWecomBotText(credId, ctx.chatId ?? '', fallback);
            }
        }
        else if ((channel === 'telegram' || getInstanceType(channel) === 'telegram') && ctx.chatId) {
            const { getTelegramBotToken } = await import('../config/loader.js');
            const { sendTelegramPhoto, sendTelegramDocument } = await import('../channels/telegram.js');
            const token = getTelegramBotToken(instanceId);
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
        else if ((channel === 'slack' || getInstanceType(channel) === 'slack') && ctx.chatId) {
            const { getSlackBotToken } = await import('../config/loader.js');
            const { sendSlackFile } = await import('../channels/slack.js');
            const token = getSlackBotToken(instanceId);
            if (token) {
                await sendSlackFile(ctx.chatId, absPath, fr.mimeType, fr.caption, token);
            }
            else {
                console.log('[slack] sendFileToChannel (no token):', fr.filePath);
            }
        }
        else if ((channel === 'discord' || getInstanceType(channel) === 'discord') && ctx.chatId) {
            const { getDiscordBotToken } = await import('../config/loader.js');
            const { sendDiscordFile } = await import('../channels/discord.js');
            const token = getDiscordBotToken(instanceId);
            if (token) {
                await sendDiscordFile(ctx.chatId, absPath, fr.mimeType, fr.caption, token);
            }
            else {
                console.log('[discord] sendFileToChannel (no token):', fr.filePath);
            }
        }
        else if ((channel === 'whatsapp' || getInstanceType(channel) === 'whatsapp') && ctx.chatId && ctx.phoneNumberId) {
            const { getWhatsAppAccessToken } = await import('../config/loader.js');
            const { sendWhatsAppImage, sendWhatsAppDocument } = await import('../channels/whatsapp.js');
            const accessToken = getWhatsAppAccessToken(instanceId);
            const phoneNumberId = ctx.phoneNumberId;
            if (accessToken && phoneNumberId) {
                if (fr.fileType === 'image') {
                    await sendWhatsAppImage(ctx.chatId, absPath, fr.caption, phoneNumberId, accessToken, fr.mimeType);
                }
                else {
                    await sendWhatsAppDocument(ctx.chatId, absPath, fr.mimeType, fr.caption, phoneNumberId, accessToken);
                }
            }
            else {
                console.log('[whatsapp] sendFileToChannel (no accessToken/phoneNumberId):', fr.filePath);
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
    const { getInstanceType } = await import('../config/loader.js');
    const isFeishu = channel === 'feishu' || channel === 'lark' || getInstanceType(channel) === 'feishu' || getInstanceType(channel) === 'lark';
    const instanceId = channel.startsWith('inst_') ? channel : undefined;
    if (isFeishu && ctx.messageId) {
        const { sendFeishuHelpCard } = await import('../channels/feishu-client.js');
        await sendFeishuHelpCard(ctx.messageId, helpText, instanceId);
    }
    else if ((channel === 'dingtalk' || getInstanceType(channel) === 'dingtalk') && ctx.sessionWebhook) {
        const { sendDingTalkMarkdown } = await import('../channels/dingtalk.js');
        const title = helpText.match(/【([^】]+)】/)?.[1] ?? '渠道操作说明';
        const md = helpTextToMarkdown(helpText);
        await sendDingTalkMarkdown(ctx.sessionWebhook, title, md);
    }
    else if ((channel === 'wecom' || getInstanceType(channel) === 'wecom') && (ctx.chatId || ctx.wecomFrame)) {
        const ctxWithFrame = ctx;
        if (ctxWithFrame.wecomFrame) {
            const { replyWecomBotMarkdown } = await import('../channels/wecom-bot-ws.js');
            const credId = channel.startsWith('inst_') ? channel : channel;
            const md = helpTextToMarkdown(helpText);
            await replyWecomBotMarkdown(credId, ctxWithFrame.wecomFrame, md);
        }
        else if (ctx.chatId) {
            const { sendWecomBotText } = await import('../channels/wecom-bot-ws.js');
            const credId = channel.startsWith('inst_') ? channel : channel;
            const md = helpTextToMarkdown(helpText);
            await sendWecomBotText(credId, ctx.chatId, md);
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
    const { getInstanceType } = await import('../config/loader.js');
    const instanceId = channel.startsWith('inst_') ? channel : undefined;
    const isFeishu = channel === 'feishu' || channel === 'lark' || getInstanceType(channel) === 'feishu' || getInstanceType(channel) === 'lark';
    const isTelegram = channel === 'telegram' || getInstanceType(channel) === 'telegram';
    const isSlack = channel === 'slack' || getInstanceType(channel) === 'slack';
    const isWecom = channel === 'wecom' || getInstanceType(channel) === 'wecom';
    const isDiscord = channel === 'discord' || getInstanceType(channel) === 'discord';
    const isWhatsapp = channel === 'whatsapp' || getInstanceType(channel) === 'whatsapp';
    const doSend = async () => {
        if (channel === 'chat' && ctx.replyCapturer) {
            ctx.replyCapturer(content);
            return;
        }
        if (isFeishu && ctx.messageId) {
            const { sendFeishuReply } = await import('../channels/feishu-client.js');
            await sendFeishuReply(ctx.messageId, content, instanceId);
        }
        else if (isFeishu && ctx.chatId) {
            const { sendFeishuMessage } = await import('../channels/feishu-client.js');
            await sendFeishuMessage({ receiveId: ctx.chatId, receiveIdType: 'chat_id', content }, instanceId);
        }
        else if ((channel === 'dingtalk' || getInstanceType(channel) === 'dingtalk') && ctx.sessionWebhook) {
            const { sendDingTalkReply } = await import('../channels/dingtalk.js');
            await sendDingTalkReply(ctx.sessionWebhook, content);
        }
        else if (isTelegram && ctx.chatId) {
            const { getTelegramBotToken } = await import('../config/loader.js');
            const { sendTelegramMessage } = await import('../channels/telegram.js');
            const token = getTelegramBotToken(instanceId);
            if (token)
                await sendTelegramMessage(ctx.chatId, content, token);
            else
                console.log('[telegram] Workflow reply (no token):', content.slice(0, 80));
        }
        else if (isSlack && ctx.chatId) {
            const { getSlackBotToken } = await import('../config/loader.js');
            const { sendSlackMessage } = await import('../channels/slack.js');
            const token = getSlackBotToken(instanceId);
            if (token)
                await sendSlackMessage(ctx.chatId, content, token);
            else
                console.log('[slack] Workflow reply (no token):', content.slice(0, 80));
        }
        else if (isWhatsapp && ctx.chatId && ctx.phoneNumberId) {
            const { getWhatsAppAccessToken } = await import('../config/loader.js');
            const { sendWhatsAppMessage } = await import('../channels/whatsapp.js');
            const token = getWhatsAppAccessToken(instanceId);
            if (token)
                await sendWhatsAppMessage(ctx.chatId, content, ctx.phoneNumberId, token);
            else
                console.log('[whatsapp] Workflow reply (no token):', content.slice(0, 80));
        }
        else if (isWecom && (ctx.wecomFrame || ctx.chatId)) {
            const ctxWithFrame = ctx;
            if (ctxWithFrame.wecomFrame) {
                const { replyWecomBotText } = await import('../channels/wecom-bot-ws.js');
                const credId = channel.startsWith('inst_') ? channel : channel;
                await replyWecomBotText(credId, ctxWithFrame.wecomFrame, content);
            }
            else if (ctx.chatId) {
                const { sendWecomBotText } = await import('../channels/wecom-bot-ws.js');
                const credId = channel.startsWith('inst_') ? channel : channel;
                await sendWecomBotText(credId, ctx.chatId, content);
            }
        }
        else if (isDiscord && ctx.chatId) {
            const { getDiscordBotToken } = await import('../config/loader.js');
            const { sendDiscordMessage } = await import('../channels/discord.js');
            const token = getDiscordBotToken(channel.startsWith('inst_') ? channel : undefined);
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