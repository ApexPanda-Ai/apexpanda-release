/**
 * ASR 回退链：飞书 → 阿里云 → 讯飞
 * 当飞书失败或未配置时，依次尝试阿里云、讯飞（需 ffmpeg 转换 webm/opus → PCM）
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** 将 webm/opus/m4a/wav 等转换为 PCM 16kHz mono 16bit（需 ffmpeg）；pcm 直接解码返回 */
export async function convertToPcm16k(audioBase64, inputFormat) {
    const fmt = (inputFormat || 'webm').toLowerCase();
    if (fmt === 'pcm') {
        try {
            const buf = Buffer.from(audioBase64.replace(/^data:audio\/[^;]+;base64,/, ''), 'base64');
            return buf.length > 0 ? buf : null;
        }
        catch {
            return null;
        }
    }
    const ext = fmt === 'mp3' ? 'mp3' : fmt === 'm4a' || fmt === 'mp4' ? 'm4a' : fmt === 'wav' ? 'wav' : 'webm';
    try {
        const { execSync } = await import('node:child_process');
        const { platform } = await import('node:os');
        const cmd = platform() === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
        execSync(cmd, { stdio: 'ignore' });
    }
    catch {
        return null; // ffmpeg 未安装
    }
    let workDir;
    try {
        workDir = await mkdtemp(join(tmpdir(), 'apex-asr-'));
        const inputPath = join(workDir, `input.${ext}`);
        const outputPath = join(workDir, 'output.pcm');
        const buf = Buffer.from(audioBase64.replace(/^data:audio\/[^;]+;base64,/, ''), 'base64');
        await writeFile(inputPath, buf);
        await new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 's16le', outputPath], {
                stdio: 'ignore',
            });
            proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
            proc.on('error', reject);
        });
        const pcm = await readFile(outputPath);
        return pcm;
    }
    catch (e) {
        console.warn('[ASR Fallback] audio convert failed', e);
        return null;
    }
    finally {
        if (workDir) {
            try {
                await rm(workDir, { recursive: true, force: true });
            }
            catch {
                /* ignore */
            }
        }
    }
}
/** 带回退链的语音识别：飞书 → 阿里云 → 讯飞
 * @param options.instanceId 方案 B：多实例时传入实例 ID */
export async function recognizeWithFallback(options) {
    const { recognizeFeishuSpeech, getFeishuMessageResource } = await import('./feishu-client.js');
    const feishu = await recognizeFeishuSpeech({
        fileKey: options.fileKey,
        messageId: options.messageId,
        audioBase64: options.audioBase64,
        format: options.format,
        instanceId: options.instanceId,
    });
    if (feishu.text) {
        return { text: feishu.text, provider: 'feishu' };
    }
    const feishuSavedPath = feishu.savedPath;
    let base64ForFallback = options.audioBase64;
    let fallbackFormat = options.format ?? 'webm';
    if (!base64ForFallback && options.fileKey && options.messageId) {
        try {
            const buf = await getFeishuMessageResource(options.messageId, options.fileKey, 'file', options.instanceId);
            base64ForFallback = buf.toString('base64');
            fallbackFormat = 'opus';
        }
        catch (e) {
            console.warn('[ASR Fallback] feishu audio download failed', e);
            return { text: '', error: feishu.error ?? '飞书 ASR 失败且下载音频失败', savedPath: feishuSavedPath };
        }
    }
    if (!base64ForFallback) {
        return { text: '', error: feishu.error ?? '飞书 ASR 失败且无可回退的音频', savedPath: feishuSavedPath };
    }
    const cleanBase64 = base64ForFallback.replace(/^data:audio\/[^;]+;base64,/, '');
    const pcm = await convertToPcm16k(cleanBase64, fallbackFormat);
    if (!pcm || pcm.length === 0) {
        return {
            text: '',
            error: feishu.error ?? '飞书 ASR 失败，且无法转换音频（需安装 ffmpeg 以使用阿里云/讯飞回退）',
            savedPath: feishuSavedPath,
        };
    }
    const pcmBase64 = pcm.toString('base64');
    const { invokeTool } = await import('../skills/registry.js');
    const tryAliyun = async () => {
        try {
            const r = await invokeTool('asr-aliyun', 'recognize', {
                base64: pcmBase64,
                format: 'pcm',
                sampleRate: 16000,
            });
            const text = r?.text ?? '';
            return text.trim() || null;
        }
        catch (e) {
            console.warn('[ASR Fallback] aliyun ASR failed', e);
            return null;
        }
    };
    const tryXunfei = async () => {
        try {
            const r = await invokeTool('asr-xunfei', 'recognize', {
                base64: pcmBase64,
                format: 'pcm',
                sampleRate: 16000,
            });
            const text = r?.text ?? '';
            return text.trim() || null;
        }
        catch (e) {
            console.warn('[ASR Fallback] xunfei ASR failed', e);
            return null;
        }
    };
    let text = await tryAliyun();
    if (text)
        return { text, provider: 'aliyun' };
    console.log('[ASR Fallback] trying xunfei...');
    text = await tryXunfei();
    if (text) {
        console.log('[ASR Fallback] xunfei success');
        return { text, provider: 'xunfei' };
    }
    return {
        text: '',
        error: feishu.error ?? '所有 ASR（飞书、阿里云、讯飞）均失败，请检查配置或 ffmpeg',
        savedPath: feishuSavedPath,
    };
}
//# sourceMappingURL=asr-fallback.js.map