/**
 * MCP (Model Context Protocol) 服务端
 * SSE 传输，暴露 Skills 作为 Tools，供 Cursor / Claude Code 等客户端接入
 */
import { randomUUID } from 'node:crypto';
const PROTOCOL_VERSION = '2024-11-05';
const sessions = new Map();
export function handleMcpSse(req, res) {
    const sessionId = randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const baseUrl = process.env.APEXPANDA_BASE_URL ?? `http://localhost:${process.env.APEXPANDA_PORT ?? 18790}`;
    const endpoint = `${baseUrl.replace(/\/$/, '')}/mcp/message?session=${sessionId}`;
    const write = (data) => {
        res.write(`event: message\ndata: ${data}\n\n`);
        res.flushHeaders?.();
    };
    sessions.set(sessionId, { res, write });
    res.write(`event: endpoint\ndata: ${JSON.stringify({ endpoint })}\n\n`);
    res.flushHeaders?.();
    req.on('close', () => {
        sessions.delete(sessionId);
    });
    return true;
}
export function handleMcpMessage(req, res, sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Session not found' }));
        return true;
    }
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end();
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
        let msg;
        try {
            msg = JSON.parse(body || '{}');
        }
        catch {
            session.write(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
            }));
            return;
        }
        const id = msg.id;
        const method = msg.method ?? '';
        if (method === 'initialize') {
            const result = {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: {
                        tools: { listChanged: false },
                    },
                    serverInfo: { name: 'ApexPanda', version: '0.1.0' },
                    instructions: 'ApexPanda MCP Server: 暴露 Skills 为 Tools，供 AI 模型调用。',
                },
            };
            session.write(JSON.stringify(result));
            return;
        }
        if (method === 'notifications/initialized') {
            return;
        }
        if (method === 'ping') {
            session.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
            return;
        }
        if (method === 'tools/list') {
            try {
                const { getToolsForLLM } = await import('../skills/registry.js');
                const llmTools = await getToolsForLLM();
                const tools = llmTools.map((t) => ({
                    name: t.function.name,
                    description: t.function.description ?? `Call ${t.function.name}`,
                    inputSchema: {
                        type: 'object',
                        properties: t.function.parameters && typeof t.function.parameters === 'object'
                            ? t.function.parameters.properties ?? {}
                            : {},
                        required: t.function.parameters?.required ?? [],
                    },
                }));
                session.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    result: { tools },
                }));
            }
            catch (e) {
                session.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32603,
                        message: e instanceof Error ? e.message : 'Internal error',
                    },
                }));
            }
            return;
        }
        if (method === 'tools/call') {
            const params = (msg.params ?? {});
            const toolName = params.name;
            const args = params.arguments ?? {};
            if (!toolName) {
                session.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32602, message: 'Missing tool name' },
                }));
                return;
            }
            try {
                const { invokeToolByName, resolveToolNameForInvocation } = await import('../skills/registry.js');
                const raw = await invokeToolByName(resolveToolNameForInvocation(toolName), args);
                const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
                session.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text }],
                        isError: false,
                    },
                }));
            }
            catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                session.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: `Error: ${errMsg}` }],
                        isError: true,
                    },
                }));
            }
            return;
        }
        session.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
        }));
    });
    return true;
}
//# sourceMappingURL=index.js.map