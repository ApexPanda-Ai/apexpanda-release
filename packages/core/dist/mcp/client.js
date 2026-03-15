/**
 * MCP 客户端：通过 stdio 或 SSE/Streamable HTTP 连接外部 MCP Server
 */
import { spawn } from 'node:child_process';
const DEFAULT_CALL_TIMEOUT_MS = 60000;
/** 单 MCP 连接阶段超时（initialize + tools/list），防止拖死整体 */
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
/** 快速路径：MCP 未就绪时等待上限，超时则先返回 Skills-only 供渠道快速响应 */
const DEFAULT_FAST_PATH_TIMEOUT_MS = 3000;
const MCP_PROTOCOL_VERSION = '2024-11-05';
let nextId = 0;
function nextRequestId() {
    return ++nextId;
}
/** 带超时的 Promise.race */
function withTimeout(p, ms) {
    return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`MCP request timeout after ${ms}ms`)), ms)),
    ]);
}
/** 转义参数以安全拼接为 shell 命令 */
function escapeShellArg(s) {
    if (!/[\s"$`\\]/.test(s))
        return s;
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
/** 过滤会干扰子进程 npx 的 env（如 npm_config_recursive 会导致 Unknown env config 和 executable 解析失败） */
function buildMcpEnv(extra) {
    const base = { ...process.env, ...extra };
    const out = {};
    for (const [k, v] of Object.entries(base)) {
        if (v === undefined)
            continue;
        if (/^npm_config_recursive$/i.test(k))
            continue; // 避免 Unknown env config "recursive"
        out[k] = v;
    }
    return out;
}
/** 单个 MCP Server 的 stdio 连接 */
async function connectStdio(serverId, command, args, env, callTimeoutMs) {
    const spawnEnv = buildMcpEnv(env);
    let proc;
    if (process.platform === 'win32') {
        // Windows: npx 为 .cmd，需 shell；避免 DEP0190 用单字符串而非 args
        const cmdStr = [command, ...args].map(escapeShellArg).join(' ');
        proc = spawn(cmdStr, [], {
            env: spawnEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            shell: true,
        });
    }
    else {
        proc = spawn(command, args, {
            env: spawnEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
    }
    const pending = new Map();
    let buffer = '';
    const send = (method, params) => {
        return new Promise((resolve, reject) => {
            const id = nextRequestId();
            pending.set(id, { resolve, reject });
            const req = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n';
            proc.stdin?.write(req, (err) => {
                if (err) {
                    pending.delete(id);
                    reject(err);
                }
            });
        });
    };
    const handleLine = (line) => {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            return;
        }
        if (msg.id != null && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error)
                p.reject(new Error(msg.error.message ?? 'MCP error'));
            else
                p.resolve(msg.result);
        }
        if (msg.method === 'notifications/initialized')
            return;
    };
    proc.stdout?.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line)
                handleLine(line);
        }
    });
    proc.stderr?.on('data', (chunk) => {
        const s = chunk.toString('utf8').trim();
        if (s)
            console.warn(`[MCP ${serverId}] stderr:`, s);
    });
    proc.on('error', (err) => {
        for (const p of pending.values())
            p.reject(err);
        pending.clear();
    });
    proc.on('exit', (code) => {
        if (code != null && code !== 0) {
            const err = new Error(`MCP ${serverId} exited with code ${code}`);
            for (const p of pending.values())
                p.reject(err);
            pending.clear();
        }
    });
    // 1. initialize
    const initRes = (await send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ApexPanda', version: '0.1.0' },
    }));
    if (!initRes)
        throw new Error('MCP initialize failed');
    // 2. notifications/initialized (no response)
    proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n', () => { });
    // 3. tools/list
    const listRes = (await send('tools/list'));
    const tools = (listRes?.tools ?? []).map((t) => ({
        name: t.name ?? 'unknown',
        description: t.description,
        inputSchema: t.inputSchema,
    }));
    const timeout = callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const callTool = async (name, args) => {
        const sendPromise = send('tools/call', { name, arguments: args });
        const res = (await withTimeout(sendPromise, timeout));
        if (res?.content?.length) {
            const text = res.content
                .filter((c) => c.type === 'text' && c.text != null)
                .map((c) => c.text)
                .join('\n');
            if (res.isError)
                throw new Error(text || 'MCP tool error');
            return text ?? '';
        }
        return '';
    };
    return {
        serverId,
        tools,
        callTool,
        close: () => proc.kill('SIGTERM'),
    };
}
/** SSE / Streamable HTTP 连接：通过 fetch POST JSON-RPC 到远程 MCP 端点 */
async function connectStreamableHttp(serverId, baseUrl, callTimeoutMs) {
    const url = baseUrl.replace(/\/$/, '');
    let sessionId = null;
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    };
    const send = async (method, params) => {
        const id = nextRequestId();
        const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
        const reqHeaders = { ...headers };
        if (sessionId)
            reqHeaders['MCP-Session-Id'] = sessionId;
        const res = await fetch(url, {
            method: 'POST',
            headers: reqHeaders,
            body,
        });
        const sid = res.headers.get('MCP-Session-Id');
        if (sid)
            sessionId = sid;
        if (!res.ok)
            throw new Error(`MCP HTTP ${res.status}: ${res.statusText}`);
        if (res.status === 202)
            return undefined;
        const ct = res.headers.get('Content-Type') ?? '';
        if (ct.includes('application/json')) {
            const text = await res.text();
            if (!text.trim())
                return undefined;
            const data = JSON.parse(text);
            if (data.error)
                throw new Error(data.error.message ?? 'MCP error');
            return data.result;
        }
        throw new Error('Unexpected MCP response content-type');
    };
    const initRes = (await send('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ApexPanda', version: '0.1.0' },
    }));
    if (!initRes)
        throw new Error('MCP initialize failed');
    await send('notifications/initialized');
    const listRes = (await send('tools/list'));
    const tools = (listRes?.tools ?? []).map((t) => ({
        name: t.name ?? 'unknown',
        description: t.description,
        inputSchema: t.inputSchema,
    }));
    const timeout = callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const callTool = async (name, args) => {
        const sendPromise = send('tools/call', { name, arguments: args });
        const res = (await withTimeout(sendPromise, timeout));
        if (res?.content?.length) {
            const text = res.content
                .filter((c) => c.type === 'text' && c.text != null)
                .map((c) => c.text)
                .join('\n');
            if (res.isError)
                throw new Error(text || 'MCP tool error');
            return text ?? '';
        }
        return '';
    };
    return {
        serverId,
        tools,
        callTool,
        close: () => {
            /* HTTP 无长连接需关闭，可选：DELETE 结束 session */
        },
    };
}
let connections = [];
let connectionsPromise = null;
/** 单次连接任务的 connectTimeout，从 config 或 env 读取，默认 15s */
function getConnectTimeoutMs(cfg) {
    const env = process.env.APEXPANDA_MCP_CONNECT_TIMEOUT_MS;
    if (env != null) {
        const n = parseInt(env, 10);
        if (!isNaN(n) && n > 0)
            return n;
    }
    return cfg.mcp?.client?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
}
/** 按 config 连接所有 MCP Server，缓存 connections。并行连接 + 单 MCP 超时。 */
export async function ensureMcpConnections(opts) {
    const { loadConfig } = await import('../config/loader.js');
    const cfg = await loadConfig();
    const servers = cfg.mcp?.client?.servers ?? [];
    if (servers.length === 0)
        return [];
    if (connections.length > 0)
        return connections;
    const runConnections = () => {
        if (connectionsPromise)
            return connectionsPromise;
        connectionsPromise = (async () => {
            const { loadConfig: load } = await import('../config/loader.js');
            const cfg = await load();
            const serversList = (cfg.mcp?.client?.servers ?? []);
            const allowed = cfg.mcp?.client?.allowedCommands;
            const callTimeoutMs = cfg.mcp?.client?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
            const connectTimeoutMs = getConnectTimeoutMs(cfg);
            const tasks = [];
            for (const s of serversList) {
                const sid = s.id;
                if (!sid)
                    continue;
                if (s.transport === 'sse' && s.url) {
                    tasks.push(withTimeout(connectStreamableHttp(sid, s.url, callTimeoutMs).catch((e) => {
                        console.warn(`[MCP] Failed to connect SSE ${sid}:`, e instanceof Error ? e.message : e);
                        return null;
                    }), connectTimeoutMs).catch((e) => {
                        console.warn(`[MCP] SSE ${sid} 连接超时:`, e instanceof Error ? e.message : e);
                        return null;
                    }));
                    continue;
                }
                if (s.transport !== 'stdio' || !s.command || !Array.isArray(s.args))
                    continue;
                const cmd = s.command.split(/[\\/]/).pop()?.toLowerCase() ?? s.command.toLowerCase();
                const allowedLower = (allowed ?? []).map((a) => String(a).toLowerCase());
                if (Array.isArray(allowed) && allowed.length > 0 && !allowedLower.includes(cmd)) {
                    console.warn(`[MCP] Command "${s.command}" not in allowedCommands, skipping ${sid}`);
                    continue;
                }
                tasks.push(withTimeout(connectStdio(sid, s.command, s.args, s.env, callTimeoutMs).catch((e) => {
                    console.warn(`[MCP] Failed to connect ${sid}:`, e instanceof Error ? e.message : e);
                    return null;
                }), connectTimeoutMs).catch((e) => {
                    console.warn(`[MCP] ${sid} 连接超时:`, e instanceof Error ? e.message : e);
                    return null;
                }));
            }
            const results = await Promise.allSettled(tasks);
            const conns = [];
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value)
                    conns.push(r.value);
            }
            connections = conns;
            connectionsPromise = null;
        })();
        return connectionsPromise;
    };
    runConnections();
    if (opts?.fastPathTimeoutMs != null && opts.fastPathTimeoutMs > 0 && connectionsPromise) {
        try {
            await withTimeout(connectionsPromise, opts.fastPathTimeoutMs);
        }
        catch {
            return [];
        }
        return connections;
    }
    if (connectionsPromise)
        await connectionsPromise;
    return connections;
}
/** 关闭所有 MCP 连接 */
export function closeMcpConnections() {
    for (const c of connections)
        c.close();
    connections = [];
    connectionsPromise = null;
}
/** 获取 MCP 工具列表（供 getToolsForLLM 合并）。启用快速路径时，超时则返回 [] 不阻塞渠道。 */
export async function getMcpTools(opts) {
    const envMs = process.env.APEXPANDA_MCP_FAST_PATH_TIMEOUT_MS;
    const fastPathMs = opts?.fastPathTimeoutMs ?? (envMs != null ? parseInt(String(envMs), 10) : DEFAULT_FAST_PATH_TIMEOUT_MS);
    const conns = await ensureMcpConnections(fastPathMs > 0 ? { fastPathTimeoutMs: fastPathMs } : undefined);
    return conns.map((c) => ({ serverId: c.serverId, tools: c.tools }));
}
/** 单独测试某个 MCP Server 连接并返回其 tools（一次性连接，不缓存） */
export async function testMcpServerConnection(serverId) {
    const { loadConfig } = await import('../config/loader.js');
    const cfg = await loadConfig();
    const servers = (cfg.mcp?.client?.servers ?? []);
    const s = servers.find((x) => x.id === serverId);
    if (!s)
        return { serverId, error: `Server ${serverId} not found` };
    if (s.transport === 'sse' && s.url) {
        try {
            const timeoutMs = cfg.mcp?.client?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
            const conn = await connectStreamableHttp(serverId, s.url, timeoutMs);
            return { serverId, tools: conn.tools };
        }
        catch (e) {
            return { serverId, error: e instanceof Error ? e.message : String(e) };
        }
    }
    if (s.transport !== 'stdio' || !s.command || !Array.isArray(s.args)) {
        return { serverId, error: `Server ${serverId} invalid config (stdio needs command+args)` };
    }
    const allowed = cfg.mcp?.client?.allowedCommands;
    const cmd = s.command.split(/[\\/]/).pop()?.toLowerCase() ?? s.command.toLowerCase();
    const allowedLower = (allowed ?? []).map((a) => String(a).toLowerCase());
    if (Array.isArray(allowed) && allowed.length > 0 && !allowedLower.includes(cmd)) {
        return { serverId, error: `Command "${s.command}" not in allowedCommands` };
    }
    try {
        const timeoutMs = cfg.mcp?.client?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
        const conn = await connectStdio(s.id, s.command, s.args, s.env, timeoutMs);
        const tools = conn.tools;
        conn.close();
        return { serverId, tools };
    }
    catch (e) {
        return { serverId, error: e instanceof Error ? e.message : String(e) };
    }
}
/** 调用 MCP 工具，name 格式为 mcp_<serverId>_<toolName> */
export async function invokeMcpTool(name, args) {
    if (!name.startsWith('mcp_'))
        throw new Error(`Not an MCP tool: ${name}`);
    const rest = name.slice(4);
    const idx = rest.indexOf('_');
    const serverId = idx > 0 ? rest.slice(0, idx) : rest;
    const toolName = idx > 0 ? rest.slice(idx + 1) : rest;
    if (!serverId || !toolName)
        throw new Error(`Invalid MCP tool name: ${name}`);
    const conns = await ensureMcpConnections();
    const conn = conns.find((c) => c.serverId === serverId);
    if (!conn)
        throw new Error(`MCP server not connected: ${serverId}`);
    try {
        const result = await conn.callTool(toolName, args);
        try {
            const { addAudit } = await import('../audit/store.js');
            addAudit({ type: 'mcp', action: 'call', detail: { serverId, toolName, ok: true } });
        }
        catch {
            /* audit optional */
        }
        return result;
    }
    catch (e) {
        try {
            const { addAudit } = await import('../audit/store.js');
            addAudit({ type: 'mcp', action: 'call', detail: { serverId, toolName, ok: false, error: e instanceof Error ? e.message : String(e) } });
        }
        catch {
            /* audit optional */
        }
        throw e;
    }
}
//# sourceMappingURL=client.js.map