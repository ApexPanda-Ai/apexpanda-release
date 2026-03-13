/**
 * Voice Wake 语音唤醒配置
 * 存储于 .apexpanda/settings/voicewake.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const DEFAULT_CONFIG = {
    enabled: false,
    triggerWords: ['你好小A'],
    language: 'zh-CN',
    silenceTimeout: 1500,
    hardStopTimeout: 120000,
    debounce: 350,
    soundEnabled: true,
    targetAgentId: null,
    replyMode: 'tts',
    recognitionMode: 'server', // 默认服务端，避免国内 network 错误
};
function getVoiceWakePath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'settings', 'voicewake.json');
}
export async function loadVoiceWakeConfig() {
    try {
        const path = getVoiceWakePath();
        const raw = await readFile(path, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_CONFIG,
            ...parsed,
            triggerWords: Array.isArray(parsed.triggerWords)
                ? parsed.triggerWords.filter((w) => typeof w === 'string' && w.trim().length > 0)
                : DEFAULT_CONFIG.triggerWords,
        };
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
export async function saveVoiceWakeConfig(config) {
    const path = getVoiceWakePath();
    await mkdir(dirname(path), { recursive: true });
    const current = await loadVoiceWakeConfig();
    const merged = {
        ...current,
        ...config,
        triggerWords: config.triggerWords !== undefined
            ? (Array.isArray(config.triggerWords)
                ? config.triggerWords
                : [config.triggerWords]).filter((w) => typeof w === 'string' && w.trim().length > 0)
            : current.triggerWords,
    };
    await writeFile(path, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
}
//# sourceMappingURL=config.js.map