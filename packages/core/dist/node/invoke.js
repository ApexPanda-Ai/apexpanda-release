/**
 * node.invoke RPC 执行逻辑 + 批量执行
 */
import { addAudit } from '../audit/store.js';
import { getNodeConnection, listOnlineNodes, getGracePeriodCapabilities } from './store.js';
import { saveNodeMedia } from './media.js';
import { addExecHistory } from './exec-history.js';
const pendingMap = new Map();
export async function invokeNode(nodeId, command, params, timeoutMs = 30_000, approvalContext) {
    const conn = getNodeConnection(nodeId);
    if (!conn)
        throw new Error(`节点 ${nodeId} 不在线`);
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const invokeParams = { command, params };
    if (approvalContext?.sessionId) {
        invokeParams._approvalContext = { sessionId: approvalContext.sessionId };
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingMap.get(nodeId)?.delete(reqId);
            reject(new Error(`node.invoke 超时（${timeoutMs}ms）: ${command}`));
        }, timeoutMs);
        if (!pendingMap.has(nodeId))
            pendingMap.set(nodeId, new Map());
        pendingMap.get(nodeId).set(reqId, { resolve, reject, timer, timeoutMs, command });
        conn.ws.send(JSON.stringify({
            type: 'req',
            id: reqId,
            method: 'node.invoke',
            params: invokeParams,
        }));
    });
}
/** 收到 res_stream_chunk 时重置超时，避免长时任务因无输出而被误杀 */
export function onStreamChunk(nodeId, reqId) {
    const rpc = pendingMap.get(nodeId)?.get(reqId);
    if (!rpc)
        return;
    clearTimeout(rpc.timer);
    rpc.timer = setTimeout(() => {
        pendingMap.get(nodeId)?.delete(reqId);
        rpc.reject(new Error(`node.invoke 超时（${rpc.timeoutMs}ms）: ${rpc.command}`));
    }, rpc.timeoutMs);
}
export function rejectAllPending(nodeId) {
    const pending = pendingMap.get(nodeId);
    if (!pending)
        return;
    for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error('节点已断开连接'));
    }
    pendingMap.delete(nodeId);
}
export function resolveRpc(nodeId, reqId, ok, payload) {
    const rpc = pendingMap.get(nodeId)?.get(reqId);
    if (!rpc)
        return;
    clearTimeout(rpc.timer);
    pendingMap.get(nodeId).delete(reqId);
    if (ok)
        rpc.resolve(payload);
    else
        rpc.reject(new Error(String(payload?.error ?? '节点调用失败')));
}
export function getPendingCount(nodeId) {
    return pendingMap.get(nodeId)?.size ?? 0;
}
/** 调用节点并处理媒体落盘（API 调试用，与 executeNodeTool 的落盘逻辑一致） */
export async function invokeNodeWithMediaHandling(nodeId, command, params, timeoutMs = 30_000) {
    const cmdParams = command === 'system.run'
        ? { command: params.command ?? '', cwd: params.cwd, env: params.env, timeout: params.timeout ?? 30_000 }
        : command === 'system.which'
            ? { command: params.command ?? '' }
            : params;
    const effectiveTimeout = getTimeoutForCommand(command, cmdParams, timeoutMs);
    let result = (await invokeNode(nodeId, command, cmdParams, effectiveTimeout));
    if (MEDIA_COMMANDS.has(command) && result?.base64 && typeof result.base64 === 'string') {
        const ext = result.ext || (VIDEO_COMMANDS.has(command) ? 'mp4' : 'jpg');
        const saved = await saveNodeMedia({
            nodeId,
            base64: result.base64,
            ext: String(ext).replace(/^\./, ''),
            width: result.width,
            height: result.height,
            format: result.format,
        });
        result = { ok: true, filePath: saved.filePath, width: saved.width, height: saved.height, format: saved.format };
    }
    return result;
}
const SENSITIVE_KEYS = /^(password|passwd|pwd|secret|token|api[_-]?key|auth|credential)/i;
/** 脱敏 params，避免审计日志泄露 env 中的密码等 */
export function sensitiveRedact(params) {
    if (!params || typeof params !== 'object')
        return params;
    const out = { ...params };
    if (out.env && typeof out.env === 'object') {
        const env = out.env;
        const redacted = {};
        for (const [k, v] of Object.entries(env)) {
            redacted[k] = SENSITIVE_KEYS.test(k) && typeof v === 'string' ? '***' : v;
        }
        out.env = redacted;
    }
    if (typeof out.command === 'string' && out.command.length > 200) {
        out.command = out.command.slice(0, 200) + '…';
    }
    return out;
}
/** 工具 ID -> 节点 command 映射 */
const TOOL_TO_COMMAND = {
    sysRun: 'system.run',
    sysWhich: 'system.which',
    sysReadFile: 'system.readFile',
    sysWriteFile: 'system.writeFile',
    sysListDir: 'system.listDir',
    sysClipboardRead: 'system.clipboardRead',
    sysClipboardWrite: 'system.clipboardWrite',
    sysProcessList: 'system.processList',
    sysProcessKill: 'system.processKill',
    cameraSnap: 'camera.snap',
    cameraClip: 'camera.clip',
    screenRecord: 'screen.record',
    canvasSnapshot: 'canvas.snapshot',
    canvasNavigate: 'canvas.navigate',
    locationGet: 'location.get',
    uiTap: 'ui.tap',
    uiInput: 'ui.input',
    uiSwipe: 'ui.swipe',
    uiBack: 'ui.back',
    uiHome: 'ui.home',
    uiDump: 'ui.dump',
    uiLongPress: 'ui.longPress',
    uiLaunch: 'ui.launch',
    screenOcr: 'screen.ocr',
    uiAnalyze: 'ui.analyze',
    uiScroll: 'ui.scroll',
    uiWaitFor: 'ui.waitFor',
    uiSequence: 'ui.sequence',
};
/** 节点 command -> capability 映射 */
const COMMAND_TO_CAPABILITY = {
    'system.run': 'system.run',
    'system.which': 'system.which',
    'system.readFile': 'system.readFile',
    'system.writeFile': 'system.writeFile',
    'system.listDir': 'system.listDir',
    'system.clipboardRead': 'system.clipboardRead',
    'system.clipboardWrite': 'system.clipboardWrite',
    'system.processList': 'system.processList',
    'system.processKill': 'system.processKill',
    'camera.snap': 'camera.snap',
    'camera.clip': 'camera.clip',
    'screen.record': 'screen.record',
    'canvas.snapshot': 'canvas.snapshot',
    'canvas.navigate': 'canvas.navigate',
    'location.get': 'location.get',
    'ui.tap': 'ui.tap',
    'ui.input': 'ui.input',
    'ui.swipe': 'ui.swipe',
    'ui.back': 'ui.back',
    'ui.home': 'ui.home',
    'ui.dump': 'ui.dump',
    'ui.longPress': 'ui.longPress',
    'ui.launch': 'ui.launch',
    'screen.ocr': 'screen.ocr',
    'ui.analyze': 'ui.analyze',
    'ui.scroll': 'ui.scroll',
    'ui.waitFor': 'ui.waitFor',
    'ui.sequence': 'ui.sequence',
};
/** 媒体类 command：返回 base64 时需落盘 */
const MEDIA_COMMANDS = new Set(['camera.snap', 'camera.clip', 'screen.record', 'canvas.snapshot']);
/** 图片类 command：用于渠道发图时设置 fileType */
const IMAGE_COMMANDS = new Set(['camera.snap', 'canvas.snapshot']);
const VIDEO_COMMANDS = new Set(['camera.clip', 'screen.record']);
/** 按 command 计算超时（方案 §3.5） */
function getTimeoutForCommand(command, params, defaultMs) {
    if (command === 'camera.snap' || command === 'canvas.snapshot')
        return 15_000;
    if (command === 'canvas.navigate')
        return 10_000;
    if (command === 'location.get')
        return 15_000;
    if (command.startsWith('ui.') || command === 'screen.ocr')
        return command === 'ui.sequence' ? 60_000 : 15_000;
    if (command === 'system.which')
        return 5_000;
    if (command === 'system.readFile' || command === 'system.writeFile' || command === 'system.listDir')
        return 60_000;
    if (command === 'system.clipboardRead' || command === 'system.clipboardWrite')
        return 5_000;
    if (command === 'system.processList')
        return 15_000;
    if (command === 'system.processKill')
        return 5_000;
    if (command === 'camera.clip' || command === 'screen.record') {
        const duration = Number(params.duration ?? 10) || 10;
        return Math.min(70_000, (duration + 10) * 1000);
    }
    return defaultMs;
}
/** 根据在线节点+宽限期节点能力聚合可用 capability 集合（断线 30s 内工具保持可见） */
export function getAvailableNodeCapabilities() {
    const caps = new Set();
    for (const conn of listOnlineNodes()) {
        for (const c of conn.capabilities)
            caps.add(String(c));
    }
    for (const c of getGracePeriodCapabilities())
        caps.add(c);
    return caps;
}
/** 从 system.run 的 command 推断所需环境工具，如 adb、docker */
function inferRequiredEnvTools(command) {
    const cmd = (command || '').trim().toLowerCase();
    if (cmd.startsWith('adb ') || cmd === 'adb')
        return ['adb'];
    if (cmd.startsWith('docker ') || cmd === 'docker')
        return ['docker'];
    if (cmd.startsWith('npm ') || cmd.startsWith('npx ') || cmd.includes(' node '))
        return ['node'];
    if (cmd.startsWith('python ') || cmd.startsWith('python3 ') || cmd.includes(' python'))
        return ['python', 'python3'];
    if (cmd.startsWith('git '))
        return ['git'];
    return [];
}
/** 选取支持某能力的节点（方案 §5.5：优先 nodeId → preferredNodeId → platform/nodeName/envTools/tags 匹配 → connectedAt 最早） */
async function pickNodeForCapability(capability, preferredNodeId, requiredEnvTools, requiredTags, platform, nodeName) {
    let nodes = listOnlineNodes().filter((c) => c.capabilities.includes(capability));
    if (nodes.length === 0)
        return null;
    if (platform) {
        const byPlatform = nodes.filter((n) => n.platform === platform);
        if (byPlatform.length > 0)
            nodes = byPlatform;
    }
    if (nodeName && nodeName.trim()) {
        const needle = nodeName.trim().toLowerCase();
        const byName = nodes.filter((n) => (n.displayName ?? '').toLowerCase().includes(needle));
        if (byName.length > 0)
            nodes = byName;
    }
    if (requiredEnvTools?.length) {
        const hasEnv = (n) => {
            const et = (n.envTools ?? []);
            return requiredEnvTools.some((t) => et.includes(t));
        };
        const withEnv = nodes.filter(hasEnv);
        if (withEnv.length > 0)
            nodes = withEnv;
    }
    if (requiredTags?.length) {
        const { getNodeTags } = await import('./tags-store.js');
        const hasTags = async (n) => {
            const connTags = (n.tags ?? []);
            const stored = await getNodeTags(n.nodeId);
            const all = [...new Set([...connTags, ...stored])];
            return requiredTags.every((t) => all.includes(t));
        };
        const withTags = [];
        for (const n of nodes) {
            if (await hasTags(n))
                withTags.push(n);
        }
        if (withTags.length > 0)
            nodes = withTags;
    }
    const preferred = preferredNodeId ? nodes.find((n) => n.nodeId === preferredNodeId) : null;
    if (preferred)
        return preferred.nodeId;
    const sorted = [...nodes].sort((a, b) => a.connectedAt - b.connectedAt);
    return sorted[0].nodeId;
}
/** 执行 node-invoke 工具（由 registry.invokeTool 调用） */
export async function executeNodeTool(toolId, params, execContext, timeoutMs = 30_000) {
    const command = TOOL_TO_COMMAND[toolId];
    if (!command)
        throw new Error(`Unknown node-invoke tool: ${toolId}`);
    const capability = COMMAND_TO_CAPABILITY[command];
    if (!capability)
        throw new Error(`No capability for command: ${command}`);
    let preferredNodeId = params.nodeId;
    if (!preferredNodeId && execContext?.agentId) {
        const { getAgent } = await import('../agent/store.js');
        const agent = await getAgent(execContext.agentId);
        preferredNodeId = agent?.preferredNodeId;
    }
    const requiredEnvTools = command === 'system.run' && params.command
        ? inferRequiredEnvTools(String(params.command))
        : undefined;
    const requiredTags = Array.isArray(params.nodeTags) ? params.nodeTags.filter(Boolean) : undefined;
    const platform = typeof params.nodePlatform === 'string' && params.nodePlatform.trim()
        ? params.nodePlatform.trim()
        : undefined;
    const nodeName = typeof params.nodeName === 'string' && params.nodeName.trim()
        ? params.nodeName.trim()
        : undefined;
    const nodeId = await pickNodeForCapability(capability, preferredNodeId, requiredEnvTools, requiredTags, platform, nodeName);
    if (!nodeId) {
        throw new Error(`无在线节点支持 ${capability}，请先连接 Headless 或桌面节点`);
    }
    let cmdParams;
    if (command === 'system.run') {
        cmdParams = {
            command: params.command ?? '',
            cwd: params.cwd,
            env: params.env,
            timeout: params.timeout ?? 30_000,
        };
    }
    else if (command === 'system.which') {
        cmdParams = { command: params.command ?? '' };
    }
    else if (command === 'system.readFile') {
        cmdParams = { path: params.path ?? '', encoding: params.encoding };
    }
    else if (command === 'system.writeFile') {
        cmdParams = { path: params.path ?? '', content: params.content ?? '', encoding: params.encoding };
    }
    else if (command === 'system.listDir') {
        cmdParams = { path: params.path ?? '' };
    }
    else if (command === 'system.clipboardRead') {
        cmdParams = {};
    }
    else if (command === 'system.clipboardWrite') {
        cmdParams = { content: params.content ?? '' };
    }
    else if (command === 'system.processList') {
        cmdParams = {};
    }
    else if (command === 'system.processKill') {
        cmdParams = { pid: params.pid, signal: params.signal };
    }
    else if (command === 'screen.ocr') {
        // includeBase64 默认 false：screen.ocr 主要返回文字，不主动把截图发到渠道
        // 如需附带截图，调用方显式传 includeBase64: true
        cmdParams = { maxWidth: params.maxWidth, includeBase64: params.includeBase64 ?? false };
    }
    else {
        cmdParams = params;
    }
    const effectiveTimeout = getTimeoutForCommand(command, cmdParams, timeoutMs);
    const approvalContext = execContext?.sessionId ? { sessionId: execContext.sessionId } : undefined;
    const startAt = Date.now();
    try {
        let result = await invokeNode(nodeId, command, cmdParams, effectiveTimeout, approvalContext);
        if (MEDIA_COMMANDS.has(command) && result?.base64 && typeof result.base64 === 'string') {
            const ext = result.ext || (command === 'screen.record' || command === 'camera.clip' ? 'mp4' : 'jpg');
            const saved = await saveNodeMedia({
                nodeId,
                base64: result.base64,
                ext: String(ext).replace(/^\./, ''),
                width: result.width,
                height: result.height,
                format: result.format,
            });
            result = { ok: true, filePath: saved.filePath, width: saved.width, height: saved.height, format: saved.format };
            // 渠道发图：runner 识别 _fileReply 后调用 sendFileToChannel（方案 §4.3）
            result._fileReply = true;
            result.fileType = VIDEO_COMMANDS.has(command) ? 'video' : 'image';
            result.mimeType =
                VIDEO_COMMANDS.has(command) ? 'video/mp4' : (saved.format === 'png' ? 'image/png' : 'image/jpeg');
            result.caption = IMAGE_COMMANDS.has(command) ? '拍照/截图完成' : '录屏完成';
        }
        else if (command === 'screen.ocr' && result?.base64 && typeof result.base64 === 'string') {
            // 即使节点返回了 base64，只保存为文件供后续引用，不设 _fileReply
            // 避免截图直通到渠道，遮盖 OCR 文字结果
            const saved = await saveNodeMedia({
                nodeId,
                base64: result.base64,
                ext: 'png',
                width: result.width,
                height: result.height,
                format: result.format,
            });
            result.filePath = saved.filePath;
            delete result.base64;
        }
        const durationMs = Date.now() - startAt;
        addAudit({
            type: 'node',
            action: 'invoke',
            detail: {
                source: 'agent',
                nodeId,
                command,
                toolId,
                ok: true,
                durationMs,
                params: sensitiveRedact(cmdParams),
            },
        });
        if (command === 'system.run') {
            const r = result;
            addExecHistory({
                nodeId,
                command: String(cmdParams.command ?? ''),
                ok: true,
                exitCode: r.exitCode ?? 0,
                durationMs,
                timestamp: Date.now(),
                source: 'agent',
            }).catch(() => { });
        }
        return result;
    }
    catch (e) {
        const durationMs = Date.now() - startAt;
        addAudit({
            type: 'node',
            action: 'invoke',
            detail: {
                source: 'agent',
                nodeId,
                command,
                toolId,
                ok: false,
                durationMs,
                error: e instanceof Error ? e.message : String(e),
                params: sensitiveRedact(cmdParams),
            },
        });
        if (command === 'system.run') {
            addExecHistory({
                nodeId,
                command: String(cmdParams.command ?? ''),
                ok: false,
                durationMs,
                timestamp: Date.now(),
                source: 'agent',
                error: e instanceof Error ? e.message : String(e),
            }).catch(() => { });
        }
        throw e;
    }
}
/** 批量执行：选取目标节点（nodeIds > nodePlatform > nodeTags > 全部） */
async function selectNodesForBatch(nodeIds, nodeTags, nodePlatform) {
    let nodes = listOnlineNodes().filter((n) => n.capabilities.includes('system.run'));
    if (nodes.length === 0)
        return [];
    if (nodePlatform) {
        const byPlatform = nodes.filter((n) => n.platform === nodePlatform);
        if (byPlatform.length > 0)
            nodes = byPlatform;
    }
    if (Array.isArray(nodeIds) && nodeIds.length > 0) {
        const idSet = new Set(nodeIds);
        nodes = nodes.filter((n) => idSet.has(n.nodeId));
    }
    if (Array.isArray(nodeTags) && nodeTags.length > 0) {
        const { getNodeTags } = await import('./tags-store.js');
        const withTags = [];
        for (const n of nodes) {
            const connTags = (n.tags ?? []);
            const stored = await getNodeTags(n.nodeId);
            const all = [...new Set([...connTags, ...stored])];
            if (nodeTags.every((t) => all.includes(t)))
                withTags.push(n);
        }
        nodes = withTags;
    }
    return nodes.map((n) => ({ nodeId: n.nodeId, displayName: n.displayName }));
}
/** 批量执行：同一 system.run 命令在多个节点并发执行 */
export async function invokeNodeBatch(command, params, options = {}) {
    if (command !== 'system.run') {
        throw new Error('批量执行仅支持 system.run 命令');
    }
    const nodes = await selectNodesForBatch(options.nodeIds, options.nodeTags, options.nodePlatform);
    if (nodes.length === 0) {
        throw new Error('无符合条件的在线节点（需支持 system.run，并满足 nodeIds/nodeTags 条件）');
    }
    const cmdParams = {
        command: params.command ?? '',
        cwd: params.cwd,
        env: params.env,
        timeout: params.timeout ?? 30_000,
    };
    const timeoutMs = options.timeoutMs ?? 60_000;
    const effectiveTimeout = getTimeoutForCommand('system.run', cmdParams, timeoutMs);
    const promises = nodes.map(async (n) => {
        const startAt = Date.now();
        try {
            const payload = await invokeNodeWithMediaHandling(n.nodeId, command, cmdParams, effectiveTimeout);
            const durationMs = Date.now() - startAt;
            const r = payload;
            addExecHistory({
                nodeId: n.nodeId,
                command: String(cmdParams.command),
                ok: true,
                exitCode: r?.exitCode ?? 0,
                durationMs,
                timestamp: Date.now(),
                source: 'batch',
            }).catch(() => { });
            return { nodeId: n.nodeId, displayName: n.displayName, ok: true, payload };
        }
        catch (e) {
            const durationMs = Date.now() - startAt;
            const errMsg = e instanceof Error ? e.message : String(e);
            addExecHistory({
                nodeId: n.nodeId,
                command: String(cmdParams.command),
                ok: false,
                durationMs,
                timestamp: Date.now(),
                source: 'batch',
                error: errMsg,
            }).catch(() => { });
            return { nodeId: n.nodeId, displayName: n.displayName, ok: false, error: errMsg };
        }
    });
    const results = await Promise.all(promises);
    return { results };
}
/** 执行 node-invoke 批量工具（node-invoke_batchSysRun） */
export async function executeBatchNodeTool(params, execContext, timeoutMs = 60_000) {
    const command = String(params.command ?? '');
    if (!command.trim())
        throw new Error('批量执行需提供 command 参数');
    const nodeIds = Array.isArray(params.nodeIds) ? params.nodeIds.filter(Boolean) : undefined;
    const nodeTags = Array.isArray(params.nodeTags) ? params.nodeTags.filter(Boolean) : undefined;
    const nodePlatform = typeof params.nodePlatform === 'string' && params.nodePlatform.trim() ? params.nodePlatform.trim() : undefined;
    const startAt = Date.now();
    const { results } = await invokeNodeBatch('system.run', params, { nodeIds, nodeTags, nodePlatform, timeoutMs });
    const durationMs = Date.now() - startAt;
    addAudit({
        type: 'node',
        action: 'invoke',
        detail: {
            source: 'agent',
            toolId: 'batchSysRun',
            ok: true,
            durationMs,
            nodeCount: results.length,
            params: sensitiveRedact({ command, nodeIds, nodeTags }),
        },
    });
    return {
        results,
        summary: `在 ${results.length} 个节点执行：成功 ${results.filter((r) => r.ok).length}，失败 ${results.filter((r) => !r.ok).length}`,
    };
}
//# sourceMappingURL=invoke.js.map