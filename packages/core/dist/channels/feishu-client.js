/**
 * 飞书开放平台 API 客户端
 * 用于发送消息回复
 * @see https://open.feishu.cn/document/server-docs/im-v1/message/create
 */
import { stripToolCallXmlFromContent } from '../llm/openai-compatible.js';
const FEISHU_API = 'https://open.feishu.cn/open-apis';
const FETCH_RETRY_COUNT = 3;
const FETCH_RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15_000;
/**
 * 对飞书 API 的 fetch 封装：
 * 1. 强制 Connection: close，避免 undici 连接池复用已被 Feishu 关闭的长连接（ECONNRESET 根因）
 * 2. 请求超时 15s，防止挂起
 * 3. ECONNRESET 等瞬时错误自动重试
 */
async function fetchWithRetry(url, options) {
    const mergedOptions = {
        ...options,
        headers: {
            Connection: 'close',
            ...options.headers,
        },
    };
    let lastErr;
    for (let i = 0; i < FETCH_RETRY_COUNT; i++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...mergedOptions, signal: controller.signal });
            clearTimeout(timer);
            return res;
        }
        catch (e) {
            clearTimeout(timer);
            lastErr = e;
            const cause = e instanceof Error ? e.cause : undefined;
            const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
            const msg = e instanceof Error ? e.message : String(e);
            const isRetryable = code === 'ECONNRESET' ||
                code === 'ETIMEDOUT' ||
                code === 'ECONNREFUSED' ||
                code === 'ENOTFOUND' ||
                msg.includes('fetch failed') ||
                msg.includes('aborted');
            if (!isRetryable || i === FETCH_RETRY_COUNT - 1)
                throw e;
            // ECONNRESET 时强制清空 token 缓存，避免下次复用已失效的连接上获取的 token
            if (code === 'ECONNRESET')
                cachedTokens.clear();
            const delay = FETCH_RETRY_DELAY_MS * Math.pow(2, i);
            console.warn(`[Feishu] fetch 失败，${delay}ms 后重试 (${i + 1}/${FETCH_RETRY_COUNT})`, msg, code);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastErr;
}
/** 方案 B：按 instanceId 缓存 token，未传时用 'feishu' 兼容旧逻辑 */
const cachedTokens = new Map();
/** 获取飞书 tenant_access_token，供 Bitable/Doc 等 Skills 复用
 * @param instanceId 方案 B：多实例时传入实例 ID，否则用全局 feishu 配置 */
export async function getFeishuTenantAccessToken(instanceId) {
    const cacheKey = instanceId ?? 'feishu';
    const cached = cachedTokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
        return cached.token;
    }
    const { getChannelConfig } = await import('../config/loader.js');
    const cfg = getChannelConfig(instanceId ?? 'feishu');
    const appId = cfg?.appId?.trim();
    const appSecret = cfg?.appSecret?.trim();
    if (!appId || !appSecret) {
        throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET required for sending messages');
    }
    const res = await fetchWithRetry(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = (await res.json());
    if (!data.tenant_access_token) {
        throw new Error('Failed to get Feishu tenant_access_token');
    }
    cachedTokens.set(cacheKey, {
        token: data.tenant_access_token,
        expiresAt: Date.now() + (data.expire ?? 7200) * 1000,
    });
    return data.tenant_access_token;
}
export async function sendFeishuMessage(options, instanceId) {
    const token = await getFeishuTenantAccessToken(instanceId);
    const { receiveId, receiveIdType = 'open_id', content } = options;
    const url = new URL(`${FEISHU_API}/im/v1/messages`);
    url.searchParams.set('receive_id_type', receiveIdType);
    const res = await fetchWithRetry(url.toString(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            receive_id: receiveId,
            msg_type: 'text',
            content: JSON.stringify({ text: content }),
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Feishu send failed: ${res.status} ${err}`);
    }
}
/** 发送前清理可能导致 230001 的 tool call XML 等无效内容 */
function sanitizeReplyContent(content) {
    const s = stripToolCallXmlFromContent(content);
    return s.length > 0 ? s : '（回复内容已过滤）';
}
export async function sendFeishuReply(messageId, content, instanceId) {
    const token = await getFeishuTenantAccessToken(instanceId);
    const sanitized = sanitizeReplyContent(content);
    const origLen = content?.length ?? 0;
    const sanitLen = sanitized?.length ?? 0;
    if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
        console.log(`[渠道调试] sendFeishuReply messageId=${messageId} originalLen=${origLen} sanitizedLen=${sanitLen} last50="${(sanitized ?? '').slice(-50).replace(/\n/g, '\\n')}"`);
    }
    const res = await fetchWithRetry(`${FEISHU_API}/im/v1/messages/${messageId}/reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            msg_type: 'text',
            content: JSON.stringify({ text: sanitized }),
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        let errObj = {};
        try {
            errObj = JSON.parse(err);
        }
        catch {
            // ignore
        }
        const code = errObj.code ?? errObj.error?.code;
        if (code === 230011) {
            console.warn('[Feishu] 230011 原消息已撤回，跳过回复');
            return;
        }
        if (code === 230001) {
            console.warn('[Feishu] 230001 消息内容校验失败，已尝试过滤后仍失败:', sanitized.slice(0, 100));
            return;
        }
        throw new Error(`Feishu reply failed: ${res.status} ${err}`);
    }
}
/** 构建 /agent 角色选择卡片并发送 */
export async function sendFeishuAgentSelectionCard(messageId, agents) {
    const card = buildAgentSelectionCard(agents);
    await sendFeishuReplyCard(messageId, card);
}
/** 将帮助文本转为飞书卡片元素（美化展示） */
function buildHelpCardElements(helpText) {
    const elements = [];
    const body = helpText
        .replace(/^【[^】]+】\n\n?/, '')
        .replace(/\n\n输入 \/help[^\n]*$/m, '')
        .trim();
    const parts = body.split(/\n\n+/).filter((p) => p.trim());
    for (let i = 0; i < parts.length; i++) {
        if (i > 0)
            elements.push({ tag: 'hr' });
        const trimmed = parts[i].trim();
        // 加粗小节标题（一、标题 | English），规范列表格式
        const md = trimmed
            .replace(/^([一二三四五六七八九十\d]+)、([^\n]+)/gm, '**$1、$2**')
            .replace(/^  •\s+/gm, '\n• ')
            .replace(/^    /gm, '\n  ');
        elements.push({
            tag: 'div',
            text: { tag: 'lark_md', content: md.trim() },
        });
    }
    elements.push({ tag: 'hr' });
    elements.push({
        tag: 'div',
        text: { tag: 'plain_text', content: '💡 输入 /help 或 /帮助 可再次查看本说明', emoji: true },
    });
    return elements;
}
/** 发送 /help 帮助卡片
 * @param instanceId 方案 B：多实例时传入实例 ID */
export async function sendFeishuHelpCard(messageId, helpText, instanceId) {
    const isDetail = helpText.includes('【') && !helpText.includes('一、与智能体对话');
    const title = isDetail ? helpText.match(/【([^】]+)】/)?.[1] ?? '帮助说明' : '渠道操作说明';
    const elements = buildHelpCardElements(helpText);
    const card = {
        header: {
            title: { tag: 'plain_text', content: title, emoji: true },
            template: 'blue',
        },
        elements,
    };
    await sendFeishuReplyCard(messageId, card, instanceId);
}
/** 构建多 Agent 讨论帮助卡片（纯展示） */
export async function sendFeishuDiscussionHelpCard(messageId) {
    const card = {
        header: {
            title: { tag: 'plain_text', content: '多 Agent 讨论 - 使用说明 | Discussion', emoji: true },
            template: 'blue',
        },
        elements: [
            {
                tag: 'div',
                text: {
                    tag: 'plain_text',
                    content: '触发：/讨论 /debate',
                },
            },
            {
                tag: 'div',
                text: {
                    tag: 'plain_text',
                    content: '格式：/讨论 问题 [轮数] [@Agent1 @Agent2...] 或 /debate 问题 [轮数] [@Agent1 @Agent2...]\n• 问题、轮数、@Agent 顺序任意\n• 轮数默认 3（最大 10），@Agent 省略则全员参与',
                },
            },
            {
                tag: 'div',
                text: {
                    tag: 'plain_text',
                    content: '示例：\n/讨论 这个需求是否值得做MVP\n/讨论 5 定价策略 @产品 @技术\n/debate 技术选型 2 @架构师',
                },
            },
            {
                tag: 'div',
                text: {
                    tag: 'plain_text',
                    content: '结束：输入「结束讨论」「停止」「可以了」或 "stop"',
                },
            },
        ],
    };
    await sendFeishuReplyCard(messageId, card);
}
/** 构建 /agent 角色选择卡片（纯展示，无按钮，避免未配置回调时 200340 报错） */
function buildAgentSelectionCard(agents) {
    const names = agents.map((a) => a.name).join('、');
    return {
        header: {
            title: { tag: 'plain_text', content: '选择助手' },
            template: 'blue',
        },
        elements: [
            {
                tag: 'div',
                text: {
                    tag: 'plain_text',
                    content: `可用助手：${names || '暂无'}`,
                },
            },
            {
                tag: 'div',
                text: {
                    tag: 'plain_text',
                    content: '指定方式：\n• /agent 助手名 问题  如 /agent 产品经理 写个PRD\n• @助手名 问题  如 @产品经理 需求分析',
                },
            },
        ],
    };
}
/** 发送交互卡片作为回复（用于 /agent 选角色） */
export async function sendFeishuReplyCard(messageId, card, instanceId) {
    const token = await getFeishuTenantAccessToken(instanceId);
    const res = await fetchWithRetry(`${FEISHU_API}/im/v1/messages/${messageId}/reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            msg_type: 'interactive',
            content: JSON.stringify(card),
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Feishu reply card failed: ${res.status} ${err}`);
    }
}
/**
 * 获取消息中的资源文件（语音、图片、文件等）
 * @param messageId 消息 ID
 * @param fileKey 资源 key（语音用 file_key，图片用 image_key）
 * @param resourceType 'file' | 'image'，图片消息需传 'image'
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message-resource/get
 */
export async function getFeishuMessageResource(messageId, fileKey, resourceType = 'file', instanceId) {
    const token = await getFeishuTenantAccessToken(instanceId);
    const url = `${FEISHU_API}/im/v1/messages/${messageId}/resources/${fileKey}?type=${resourceType}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Feishu get message resource failed: ${res.status} ${err}`);
    }
    return Buffer.from(await res.arrayBuffer());
}
/** 上次 ASR 调用时间，用于限频保护 */
let lastAsrCallTime = 0;
/** 飞书 ASR 限频较严，间隔 5 秒；限频重试等待 10 秒 */
const ASR_MIN_INTERVAL_MS = 5000;
const ASR_RATE_LIMIT_RETRY_DELAY_MS = 10000;
/**
 * 构建 Agent 语音兜底指令消息
 * 按 preferredLang 引导 LLM 选择脚本语言与执行方式
 */
export async function buildVoiceAgentFallbackMessage(savedPath, errorDesc, workspaceDir) {
    const env = await detectScriptingEnv();
    const { preferred } = env;
    const base = `[语音识别失败，Agent 兜底，必须使用工具] 用户发送了语音消息，平台识别失败（${errorDesc}）。音频已保存到 ${savedPath}（工作区 ${workspaceDir}）。`;
    const voiceDir = '.agent-scripts/voice_asr';
    if (preferred === 'python') {
        return `${base}你必须立即：1) 用 file-tools_write_file 在 ${voiceDir}/voice_asr.py 创建脚本（从 sys.argv[1] 或 os.environ.get("APEX_VOICE_INPUT") 读取音频路径，用 SpeechRecognition/pydub+whisper 识别 opus）；2) 用 code-runner_runPythonFile 执行，path 为 ${voiceDir}/voice_asr.py，args 为 ["${savedPath}"]。不可只回复文字，必须调用上述工具。`;
    }
    if (preferred === 'node') {
        return `${base}你必须立即：1) 用 file-tools_write_file 在 ${voiceDir}/voice_asr.js 创建脚本（从 process.argv[2] 或 process.env.APEX_VOICE_INPUT 读取音频路径，可用 @xenova/transformers 或 whisper-node 识别 opus）；2) 用 shell-exec_run 执行，command 为 "node ${voiceDir}/voice_asr.js ${savedPath}"，cwd 为工作区。不可只回复文字，必须调用上述工具。`;
    }
    if (preferred === 'shell') {
        const isWin = process.platform === 'win32';
        if (isWin && env.available.includes('powershell')) {
            return `${base}你必须立即：1) 用 file-tools_write_file 在 ${voiceDir}/voice_asr.ps1 创建脚本（$args[0] 或 $env:APEX_VOICE_INPUT 为音频路径）；2) 用 shell-exec_run 执行，command 为 "powershell -NoProfile -ExecutionPolicy Bypass -File ${voiceDir}/voice_asr.ps1 ${savedPath}"，cwd 为工作区。不可只回复文字，必须调用上述工具。`;
        }
        return `${base}你必须立即：1) 用 file-tools_write_file 在 ${voiceDir}/voice_asr.sh 创建脚本（$1 或 $APEX_VOICE_INPUT 为音频路径，可用 ffmpeg+whisper/cli 等）；2) 用 shell-exec_run 执行，command 为 "bash ${voiceDir}/voice_asr.sh ${savedPath}"，cwd 为工作区。不可只回复文字，必须调用上述工具。`;
    }
    return `${base}你必须立即：1) 用 file-tools_write_file 在 ${voiceDir}/voice_asr.py 创建脚本（从 sys.argv[1] 或 os.environ.get("APEX_VOICE_INPUT") 读取音频路径，用 SpeechRecognition/pydub+whisper 识别 opus）；2) 用 code-runner_runPythonFile 执行，path 为 ${voiceDir}/voice_asr.py，args 为 ["${savedPath}"]。不可只回复文字，必须调用上述工具。`;
}
/** 根据失败原因返回用户提示文案 */
export function getVoiceFallbackUserPrompt(reason) {
    switch (reason) {
        case 'rate_limit':
            return '识别请求较多，正在尝试其他方式，请稍候…';
        case 'download_failed':
            return '文件获取失败，请稍后重试';
        case 'script_failed':
        case 'api_error':
        case 'unknown':
        default:
            return '识别遇到问题，正在尝试其他方式，请稍候…';
    }
}
/** ASR 失败时若已下载音频，保存到工作区供 Agent 用脚本识别 */
const VOICE_SAVE_DIR = '.apexpanda/voice';
/** 语音兜底脚本约定路径（相对工作区），与【脚本创建规范】对齐：.agent-scripts/功能目录/主脚本 */
export const VOICE_ASR_SCRIPT = '.agent-scripts/voice_asr/voice_asr.py';
let cachedScriptingEnv = null;
/**
 * 检测当前环境可用的脚本语言，结果缓存
 * 用于 Agent 兜底时优先选择的语言
 */
export async function detectScriptingEnv() {
    if (cachedScriptingEnv)
        return cachedScriptingEnv;
    const { execSync } = await import('node:child_process');
    const available = [];
    const checks = process.platform === 'win32'
        ? [
            { name: 'python', cmd: 'python --version' },
            { name: 'python', cmd: 'python3 --version' },
            { name: 'node', cmd: 'node --version' },
            { name: 'powershell', cmd: 'powershell -NoProfile -Command "echo 1"' },
        ]
        : [
            { name: 'python', cmd: 'python3 --version' },
            { name: 'python', cmd: 'python --version' },
            { name: 'node', cmd: 'node --version' },
            { name: 'shell', cmd: 'bash --version' },
        ];
    const seen = new Set();
    for (const { name, cmd } of checks) {
        if (seen.has(name))
            continue;
        try {
            execSync(cmd, { stdio: 'ignore', timeout: 3000 });
            available.push(name);
            seen.add(name);
        }
        catch {
            // 忽略，继续检测下一个
        }
    }
    const preferred = available.includes('python')
        ? 'python'
        : available.includes('node')
            ? 'node'
            : available.includes('shell') || available.includes('powershell')
                ? 'shell'
                : 'python';
    cachedScriptingEnv = { preferred, available };
    return cachedScriptingEnv;
}
/**
 * 获取第一个存在的语音兜底脚本路径（相对工作区）
 * 按 .py → .js → .sh → .ps1 顺序检查
 */
/** 新路径（规范对齐）与旧路径（向后兼容） */
const VOICE_ASR_PATHS = (ext) => [
    `.agent-scripts/voice_asr/voice_asr.${ext}`,
    `.agent-scripts/voice_asr.${ext}`,
];
export async function getAvailableVoiceAsrScript() {
    const { getWorkspaceDir } = await import('../config/loader.js');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const ws = getWorkspaceDir();
    const exts = process.platform === 'win32' ? ['py', 'js', 'ps1', 'sh'] : ['py', 'js', 'sh'];
    for (const ext of exts) {
        for (const rel of VOICE_ASR_PATHS(ext)) {
            if (existsSync(join(ws, rel)))
                return rel;
        }
    }
    return null;
}
/**
 * 检查是否存在语音兜底脚本，若有则可跳过飞书 ASR 直接执行
 * @deprecated 使用 getAvailableVoiceAsrScript() 获取具体路径
 */
export async function hasVoiceAsrScript() {
    return (await getAvailableVoiceAsrScript()) !== null;
}
/**
 * 根据脚本扩展名返回执行命令与参数
 */
function getRunnerForScript(scriptRelPath) {
    const ext = scriptRelPath.split('.').pop()?.toLowerCase();
    if (ext === 'py') {
        const py = process.platform === 'win32' ? 'python' : 'python3';
        return { cmd: py, args: ['-u'] };
    }
    if (ext === 'js')
        return { cmd: 'node', args: [] };
    if (ext === 'sh')
        return { cmd: 'bash', args: [] };
    if (ext === 'ps1')
        return { cmd: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] };
    return null;
}
/**
 * 使用本地文件路径运行语音识别脚本（供 Telegram 等非飞书渠道使用）
 * 音频文件需已保存到工作区，传入相对路径如 .apexpanda/channel-voice/xxx.ogg
 */
export async function recognizeVoiceFromLocalPath(relPath) {
    const scriptRel = await getAvailableVoiceAsrScript();
    if (!scriptRel)
        return { text: '', error: '无可用语音兜底脚本' };
    const runner = getRunnerForScript(scriptRel);
    if (!runner)
        return { text: '', error: `不支持的脚本类型: ${scriptRel}` };
    const { getWorkspaceDir } = await import('../config/loader.js');
    const { join } = await import('node:path');
    const { spawn } = await import('node:child_process');
    const ws = getWorkspaceDir();
    const scriptPath = join(ws, scriptRel);
    try {
        const result = await new Promise((resolve, reject) => {
            const proc = spawn(runner.cmd, [...runner.args, scriptPath, relPath], {
                timeout: 30000,
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: ws,
                env: { ...process.env, APEX_VOICE_INPUT: relPath },
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => resolve({ stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000), exitCode: code }));
            proc.on('error', (e) => reject(e));
        });
        const text = (result.stdout ?? '').trim();
        if (result.exitCode !== 0) {
            return { text: '', error: `脚本执行失败 (exit ${result.exitCode}): ${result.stderr || result.stdout}` };
        }
        return text ? { text } : { text: '', error: '脚本输出为空' };
    }
    catch (e) {
        return { text: '', error: e instanceof Error ? e.message : String(e) };
    }
}
/**
 * 使用已有脚本识别语音（跳过飞书 ASR API，避免限频）
 * 支持 .py / .js / .sh / .ps1，按 getAvailableVoiceAsrScript 返回值执行
 * 环境变量 APEX_VOICE_INPUT=音频相对路径，或通过 args 传参
 */
export async function recognizeVoiceByScript(options) {
    const { getWorkspaceDir } = await import('../config/loader.js');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { spawn } = await import('node:child_process');
    const scriptRel = options.scriptPath ?? (await getAvailableVoiceAsrScript());
    if (!scriptRel) {
        return { text: '', error: '无可用语音兜底脚本', reason: 'script_failed' };
    }
    const runner = getRunnerForScript(scriptRel);
    if (!runner) {
        return { text: '', error: `不支持的脚本类型: ${scriptRel}`, reason: 'script_failed' };
    }
    const ws = getWorkspaceDir();
    const workDir = ws;
    try {
        const buf = await getFeishuMessageResource(options.messageId, options.fileKey);
        console.log('[Feishu ASR] 脚本兜底：下载语音成功', { size: buf.length });
        const dir = join(workDir, VOICE_SAVE_DIR);
        await mkdir(dir, { recursive: true });
        const filename = `${options.messageId.replace(/[/\\?*]/g, '_')}.opus`;
        const fp = join(dir, filename);
        await writeFile(fp, buf);
        const relPath = `${VOICE_SAVE_DIR}/${filename}`;
        console.log('[Feishu ASR] 脚本兜底：音频已保存', { path: relPath, script: scriptRel });
        const scriptPath = join(workDir, scriptRel);
        const spawnArgs = [...runner.args, scriptPath, relPath];
        const result = await new Promise((resolve, reject) => {
            const proc = spawn(runner.cmd, spawnArgs, {
                timeout: 30000,
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: workDir,
                env: { ...process.env, APEX_VOICE_INPUT: relPath },
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => resolve({ stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000), exitCode: code }));
            proc.on('error', (e) => reject(e));
        });
        const text = (result.stdout ?? '').trim();
        if (result.exitCode !== 0) {
            console.warn('[Feishu ASR] 脚本兜底：执行失败', { exitCode: result.exitCode, stderr: result.stderr });
            return {
                text: '',
                error: `脚本执行失败 (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
                reason: 'script_failed',
            };
        }
        if (!text) {
            return { text: '', error: '脚本输出为空', reason: 'script_failed' };
        }
        console.log('[Feishu ASR] 脚本兜底：识别成功', { textLen: text.length });
        return { text };
    }
    catch (e) {
        console.error('[Feishu ASR] 脚本兜底：异常', e);
        return {
            text: '',
            error: e instanceof Error ? e.message : String(e),
            reason: 'script_failed',
        };
    }
}
/**
 * 语音识别（ASR）——飞书内置能力
 * 支持：fileKey+messageId（飞书消息资源）、audioBase64、audioUrl
 * 限频保护：连续调用间隔 ≥5s；触发限频时等待 10s 后重试 1 次
 * 失败时：若有 fileKey+messageId，将音频保存到工作区 .apexpanda/voice/ 供 Agent 用 code-runner 兜底
 */
/** 节点传入的格式 → 飞书 ASR 支持的 format（opus/pcm/m4a 等） */
function mapFormatForFeishu(inputFormat) {
    const fmt = (inputFormat || '').toLowerCase();
    if (fmt === 'm4a' || fmt === 'mp4')
        return 'm4a';
    if (fmt === 'webm')
        return 'opus'; // webm 常含 opus 编码，飞书 opus 可能兼容
    if (fmt === 'ogg')
        return 'opus';
    if (fmt === 'wav' || fmt === 'pcm')
        return 'pcm';
    if (fmt === 'mp3')
        return 'mp3';
    if (fmt === '3gp')
        return 'opus'; // 3gp/AMR 飞书可能不支持，尝试 opus 兜底
    return 'opus'; // 默认
}
/** @param options.instanceId 方案 B：多实例时传入实例 ID */
export async function recognizeFeishuSpeech(options) {
    const { getChannelConfig, getWorkspaceDir } = await import('../config/loader.js');
    const cfg = getChannelConfig(options.instanceId ?? 'feishu');
    const appId = cfg?.appId?.trim();
    const appSecret = cfg?.appSecret?.trim();
    if (!appId || !appSecret) {
        return { text: '', error: '飞书需配置 FEISHU_APP_ID、FEISHU_APP_SECRET', reason: 'api_error' };
    }
    let speechBase64;
    let voiceBuffer;
    if (options.fileKey && options.messageId) {
        try {
            const buf = await getFeishuMessageResource(options.messageId, options.fileKey, 'file', options.instanceId);
            voiceBuffer = buf;
            speechBase64 = buf.toString('base64');
            console.log('[Feishu ASR] 下载语音成功', { size: buf.length });
        }
        catch (e) {
            console.error('[Feishu ASR] 下载语音失败', { messageId: options.messageId, fileKey: options.fileKey, err: e });
            return {
                text: '',
                error: `下载语音失败: ${e instanceof Error ? e.message : String(e)}`,
                reason: 'download_failed',
            };
        }
    }
    else if (options.audioBase64) {
        speechBase64 = options.audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
    }
    else if (options.audioUrl) {
        try {
            const res = await fetch(options.audioUrl);
            if (!res.ok)
                throw new Error(`fetch failed: ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            speechBase64 = buf.toString('base64');
        }
        catch (e) {
            return {
                text: '',
                error: `下载音频失败: ${e instanceof Error ? e.message : String(e)}`,
                reason: 'download_failed',
            };
        }
    }
    else {
        return { text: '', error: '需提供 fileKey+messageId、audioBase64 或 audioUrl 其一', reason: 'api_error' };
    }
    if (!speechBase64) {
        return { text: '', error: '音频数据为空' };
    }
    const doRecognize = async () => {
        const Lark = await import('@larksuiteoapi/node-sdk');
        const domain = process.env.FEISHU_DOMAIN === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;
        const client = new Lark.Client({ appId, appSecret, domain });
        const fileId = options.messageId ?? `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const feishuFormat = mapFormatForFeishu(options.format ?? '');
        const payload = {
            data: {
                speech: { speech: speechBase64 },
                config: {
                    file_id: fileId,
                    format: feishuFormat,
                    engine_type: '16k_cloud',
                },
            },
        };
        const resp = await client.speech_to_text.v1.speech.fileRecognize(payload);
        const data = resp;
        if (data.code && data.code !== 0) {
            return { text: '', error: `ASR 返回错误: ${JSON.stringify(data)}` };
        }
        const text = (data.data?.recognition_text ?? '').trim();
        return { text };
    };
    const now = Date.now();
    const elapsed = now - lastAsrCallTime;
    if (elapsed > 0 && elapsed < ASR_MIN_INTERVAL_MS) {
        const wait = ASR_MIN_INTERVAL_MS - elapsed;
        await new Promise((r) => setTimeout(r, wait));
    }
    const isRateLimit = (e) => {
        const err = e;
        const code = err.response?.data?.code;
        const msg = String(err.message ?? JSON.stringify(e));
        return code === 99991400 || msg.includes('99991400') || msg.includes('frequency limit') || msg.includes('trigger frequency');
    };
    const saveVoiceForFallback = async () => {
        if (!voiceBuffer || !options.messageId)
            return undefined;
        try {
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const ws = getWorkspaceDir();
            const dir = join(ws, VOICE_SAVE_DIR);
            await mkdir(dir, { recursive: true });
            const ext = 'opus';
            const filename = `${options.messageId.replace(/[/\\?*]/g, '_')}.${ext}`;
            const fp = join(dir, filename);
            await writeFile(fp, voiceBuffer);
            const relPath = `${VOICE_SAVE_DIR}/${filename}`;
            console.log('[Feishu ASR] 音频已保存供脚本识别', { path: relPath });
            return relPath;
        }
        catch (e) {
            console.warn('[Feishu ASR] 保存音频失败', e);
            return undefined;
        }
    };
    const tryWithRetries = async () => {
        lastAsrCallTime = Date.now();
        const attempt1 = await doRecognize();
        if (!attempt1.error)
            return attempt1;
        if (!attempt1.error.includes('99991400'))
            return attempt1;
        console.warn(`[Feishu ASR] 触发限频，${ASR_RATE_LIMIT_RETRY_DELAY_MS / 1000} 秒后重试 1 次`);
        await new Promise((r) => setTimeout(r, ASR_RATE_LIMIT_RETRY_DELAY_MS));
        lastAsrCallTime = Date.now();
        const attempt = await doRecognize();
        if (!attempt.error)
            return attempt;
        return attempt1;
    };
    const toReason = (err) => err.includes('99991400') || err.includes('frequency limit') || err.includes('trigger frequency')
        ? 'rate_limit'
        : 'api_error';
    try {
        let result = await tryWithRetries();
        if (result.error) {
            console.error('[Feishu ASR] API 返回错误', result.error);
            const saved = await saveVoiceForFallback();
            return { ...result, savedPath: saved, reason: toReason(result.error) };
        }
        console.log('[Feishu ASR] 识别结果', { textLen: result.text.length, preview: result.text.slice(0, 50) });
        return result;
    }
    catch (e) {
        const reason = isRateLimit(e) ? 'rate_limit' : 'unknown';
        if (isRateLimit(e)) {
            console.warn(`[Feishu ASR] 触发限频(异常形式)，${ASR_RATE_LIMIT_RETRY_DELAY_MS / 1000} 秒后重试 1 次`);
            await new Promise((r) => setTimeout(r, ASR_RATE_LIMIT_RETRY_DELAY_MS));
            lastAsrCallTime = Date.now();
            try {
                const retry = await doRecognize();
                if (!retry.error)
                    return retry;
            }
            catch (retryErr) {
                console.error('[Feishu ASR] 重试仍失败', retryErr);
            }
            console.error('[Feishu ASR] 限频，请稍后再发语音');
        }
        const saved = await saveVoiceForFallback();
        return {
            text: '',
            error: `语音识别失败: ${e instanceof Error ? e.message : String(e)}`,
            savedPath: saved,
            reason,
        };
    }
}
/**
 * 上传图片到飞书并回复图片消息
 * @param messageId 需要回复的消息 ID
 * @param filePath 本地图片绝对路径
 * @param caption 可选文字说明（单独发一条文字消息）
 */
/** @param instanceId 方案 B：多实例时传入实例 ID */
export async function replyFeishuImage(messageId, filePath, caption, instanceId) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const token = await getFeishuTenantAccessToken(instanceId);
    const buf = await readFile(filePath);
    const fileName = basename(filePath);
    // 上传图片，获取 image_key
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([buf], { type: 'image/png' }), fileName);
    const uploadRes = await fetch(`${FEISHU_API}/im/v1/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });
    if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`Feishu image upload failed: ${uploadRes.status} ${err}`);
    }
    const uploadData = (await uploadRes.json());
    const imageKey = uploadData.data?.image_key;
    if (!imageKey)
        throw new Error('Feishu image upload: no image_key returned');
    // 回复图片消息
    const replyRes = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}/reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            msg_type: 'image',
            content: JSON.stringify({ image_key: imageKey }),
        }),
    });
    if (!replyRes.ok) {
        const err = await replyRes.text();
        throw new Error(`Feishu image reply failed: ${replyRes.status} ${err}`);
    }
    // 如果有说明文字，追加发一条文本回复
    if (caption) {
        await sendFeishuReply(messageId, caption, instanceId);
    }
}
/**
 * 上传文件到飞书并回复文件消息
 * @param instanceId 方案 B：多实例时传入实例 ID
 */
export async function replyFeishuFile(messageId, filePath, mimeType, caption, instanceId) {
    const { readFile } = await import('node:fs/promises');
    const { basename, extname } = await import('node:path');
    const token = await getFeishuTenantAccessToken(instanceId);
    const buf = await readFile(filePath);
    const fileName = basename(filePath);
    const ext = extname(fileName).replace('.', '').toLowerCase();
    // 飞书文件类型映射（支持 Word/Excel/PPT/PDF/TXT 等文档）
    const feishuFileType = ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'opus' ? 'audio' :
        ext === 'mp4' || ext === 'mov' ? 'mp4' :
            ext === 'pdf' ? 'pdf' :
                ext === 'doc' ? 'doc' :
                    ext === 'docx' ? 'docx' :
                        ext === 'xls' ? 'xls' :
                            ext === 'xlsx' ? 'xlsx' :
                                ext === 'ppt' ? 'ppt' :
                                    ext === 'pptx' ? 'pptx' :
                                        'stream';
    const form = new FormData();
    form.append('file_type', feishuFileType);
    form.append('file_name', fileName);
    form.append('file', new Blob([buf], { type: mimeType }), fileName);
    const uploadRes = await fetch(`${FEISHU_API}/im/v1/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });
    if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`Feishu file upload failed: ${uploadRes.status} ${err}`);
    }
    const uploadData = (await uploadRes.json());
    const fileKey = uploadData.data?.file_key;
    if (!fileKey)
        throw new Error('Feishu file upload: no file_key returned');
    // 回复文件消息
    const replyRes = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}/reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            msg_type: 'file',
            content: JSON.stringify({ file_key: fileKey }),
        }),
    });
    if (!replyRes.ok) {
        const err = await replyRes.text();
        throw new Error(`Feishu file reply failed: ${replyRes.status} ${err}`);
    }
    if (caption) {
        await sendFeishuReply(messageId, caption, instanceId);
    }
}
//# sourceMappingURL=feishu-client.js.map