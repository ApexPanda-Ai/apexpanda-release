/**
 * 桌面节点语音唤醒：处理 voice_audio_ready 事件
 * ASR 转写 → Agent 处理 → TTS 合成 → 节点播放
 */
import { loadVoiceWakeConfig } from '../voicewake/config.js';
import { invokeNode } from '../node/invoke.js';
import { invokeToolByName } from '../skills/registry.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getWorkspaceDir } from '../config/loader.js';
export async function handleVoiceAudioReady(nodeId, base64, format) {
    const config = await loadVoiceWakeConfig();
    const preferredAgentId = config.targetAgentId ?? undefined;
    let transcript = '';
    try {
        const { recognizeWithFallback } = await import('./asr-fallback.js');
        const cleanBase64 = base64.replace(/^data:audio\/[^;]+;base64,/, '');
        const result = await recognizeWithFallback({ audioBase64: cleanBase64, format });
        transcript = (result.text ?? '').trim();
        if (!transcript && result.error) {
            console.warn('[voice] ASR 失败:', result.error);
            transcript = '[语音识别失败，请配置飞书/阿里云/讯飞或安装 ffmpeg]';
        }
    }
    catch (e) {
        console.error('[voice] ASR 异常:', e);
        transcript = '[语音识别异常]';
    }
    if (!transcript) {
        console.log('[voice] 转写结果为空，跳过 Agent');
        return;
    }
    const sessionId = `voice-node-${nodeId}`;
    let lastReply = '';
    const { processChannelEvent } = await import('../server.js');
    const replyMode = config.replyMode ?? 'tts';
    const replyCapturer = async (content) => {
        lastReply = content;
        if (!content.trim())
            return;
        if (replyMode === 'text')
            return; // 仅文字模式：不播报 TTS
        try {
            let audioBase64;
            let audioFormat = 'mp3';
            const ttsAzure = await invokeToolByName('tts-azure#synthesize', { text: content }).catch(() => null);
            if (ttsAzure && typeof ttsAzure === 'object' && ttsAzure !== null && '_fileReply' in ttsAzure) {
                const fp = ttsAzure.filePath;
                if (fp) {
                    const absPath = fp.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fp) ? fp : join(getWorkspaceDir(), fp.replace(/^\.[/\\]/, ''));
                    const buf = await readFile(absPath);
                    audioBase64 = buf.toString('base64');
                    audioFormat = 'mp3';
                }
            }
            if (!audioBase64) {
                const ttsAliyun = await invokeToolByName('tts-aliyun#synthesize', { text: content }).catch(() => null);
                if (ttsAliyun && typeof ttsAliyun === 'object' && ttsAliyun !== null && '_fileReply' in ttsAliyun) {
                    const fp = ttsAliyun.filePath;
                    if (fp) {
                        const absPath = fp.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fp) ? fp : join(getWorkspaceDir(), fp.replace(/^\.[/\\]/, ''));
                        const buf = await readFile(absPath);
                        audioBase64 = buf.toString('base64');
                        audioFormat = ttsAliyun.mimeType?.includes('wav') ? 'wav' : 'mp3';
                    }
                }
            }
            if (audioBase64) {
                await invokeNode(nodeId, 'audio.playback', { audioBase64, format: audioFormat }, 15_000);
            }
        }
        catch (e) {
            console.error('[voice] TTS 或 playback 失败:', e);
        }
    };
    await processChannelEvent('chat', { content: transcript }, {
        chatId: sessionId,
        preferredAgentId,
        replyCapturer: (r) => { void replyCapturer(r); },
    });
}
//# sourceMappingURL=voice-handler.js.map