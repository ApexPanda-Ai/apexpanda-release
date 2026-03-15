/**
 * 无法识别文件的兜底处理抽象
 * 用于语音、图片、文档等类型的「主识别失败 → 脚本兜底」统一流程
 * @see docs/渠道文件识别兜底方案分析与改进.md 方案三
 */
import { getVoiceFallbackUserPrompt } from './feishu-client.js';
const handlers = new Map();
/**
 * 注册无法识别文件处理器
 */
export function registerUnrecognizedHandler(handler) {
    handlers.set(handler.type, handler);
}
/**
 * 获取已注册的处理器
 */
export function getUnrecognizedHandler(type) {
    return handlers.get(type);
}
let builtinHandlersInit = false;
/**
 * 执行兜底流程：先检查脚本 → 有则执行脚本，无/失败则主识别 → 失败则返回带 savedPath 的结果供 Agent 兜底
 */
export async function runUnrecognizedFallback(type, input, context = {}) {
    if (!builtinHandlersInit) {
        await initBuiltinHandlers();
        builtinHandlersInit = true;
    }
    const handler = handlers.get(type);
    if (!handler) {
        return { text: '', error: `未注册的处理器类型: ${type}`, reason: 'unknown' };
    }
    const hasScript = await handler.scriptExistsChecker();
    if (hasScript) {
        const scriptPath = await getFirstExistingScript(handler.fallbackScriptPaths);
        if (scriptPath) {
            const result = await handler.runScript(scriptPath, { ...context, input });
            if (result.text)
                return result;
            console.warn(`[UnrecognizedHandler] ${type} 脚本兜底失败，回退到主识别`, result.error);
        }
    }
    return handler.primaryRecognizer(input);
}
/** 获取第一个存在的脚本路径 */
async function getFirstExistingScript(paths) {
    const { getWorkspaceDir } = await import('../config/loader.js');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const ws = getWorkspaceDir();
    for (const rel of paths) {
        if (existsSync(join(ws, rel)))
            return rel;
    }
    return null;
}
/** 新路径（规范）优先，旧路径（向后兼容）兜底 */
const VOICE_FALLBACK_SCRIPT_PATHS = [
    '.agent-scripts/voice_asr/voice_asr.py',
    '.agent-scripts/voice_asr/voice_asr.js',
    '.agent-scripts/voice_asr/voice_asr.ps1',
    '.agent-scripts/voice_asr/voice_asr.sh',
    '.agent-scripts/voice_asr.py',
    '.agent-scripts/voice_asr.js',
    '.agent-scripts/voice_asr.ps1',
    '.agent-scripts/voice_asr.sh',
];
/** 创建语音处理器（飞书 ASR + 脚本兜底），供 registerUnrecognizedHandler 使用 */
function createVoiceUnrecognizedHandler() {
    return {
        type: 'voice',
        fallbackScriptPaths: VOICE_FALLBACK_SCRIPT_PATHS,
        scriptExistsChecker: async () => {
            const { hasVoiceAsrScript } = await import('./feishu-client.js');
            return hasVoiceAsrScript();
        },
        runScript: async (scriptPath, context) => {
            const { recognizeVoiceByScript } = await import('./feishu-client.js');
            const input = context.input;
            if (!input?.fileKey || !input?.messageId) {
                return { text: '', error: 'voice 需 fileKey 和 messageId', reason: 'unknown' };
            }
            return recognizeVoiceByScript({
                fileKey: input.fileKey,
                messageId: input.messageId,
                scriptPath,
            });
        },
        primaryRecognizer: async (input) => {
            const { recognizeWithFallback } = await import('./asr-fallback.js');
            const o = input;
            if (!o?.fileKey || !o?.messageId) {
                return { text: '', error: 'voice 需 fileKey 和 messageId', reason: 'api_error' };
            }
            const r = await recognizeWithFallback({ fileKey: o.fileKey, messageId: o.messageId, instanceId: o.instanceId });
            return { text: r.text, error: r.error, savedPath: r.savedPath };
        },
        buildAgentFallbackMessage: async (savedPath, reason, workspaceDir) => {
            const { buildVoiceAgentFallbackMessage } = await import('./feishu-client.js');
            return buildVoiceAgentFallbackMessage(savedPath, reason, workspaceDir);
        },
        getUserPrompt: (reason) => getVoiceFallbackUserPrompt(reason),
    };
}
/** 初始化内置处理器（语音），需在首次使用前调用 */
export async function initBuiltinHandlers() {
    registerUnrecognizedHandler(createVoiceUnrecognizedHandler());
}
//# sourceMappingURL=unrecognized-handler.js.map