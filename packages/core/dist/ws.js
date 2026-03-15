import { WebSocketServer } from 'ws';
import { handleNodeConnect } from './node/ws-handler.js';
import { listOnlineNodes } from './node/store.js';
const clients = new Set();
let nodeWss;
export function attachWebSocket(server) {
    const wss = new WebSocketServer({ noServer: true });
    nodeWss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const pathname = url.pathname;
        if (pathname !== '/ws') {
            socket.destroy();
            return;
        }
        const role = url.searchParams.get('role') ?? 'client';
        if (role === 'node') {
            nodeWss.handleUpgrade(req, socket, head, (ws) => {
                nodeWss.emit('connection', ws, req);
                handleNodeConnect(ws, req);
            });
        }
        else {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
                clients.add(ws);
                ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
                ws.on('close', () => clients.delete(ws));
            });
        }
    });
    return wss;
}
export function broadcast(event) {
    const msg = JSON.stringify(event);
    for (const ws of clients) {
        if (ws.readyState === 1)
            ws.send(msg);
    }
}
/** 向所有已连接节点广播（如 voicewake 配置变更） */
export function broadcastToNodes(event) {
    const msg = JSON.stringify(event);
    for (const conn of listOnlineNodes()) {
        if (conn.ws.readyState === 1) {
            try {
                conn.ws.send(msg);
            }
            catch {
                /* ignore */
            }
        }
    }
}
//# sourceMappingURL=ws.js.map