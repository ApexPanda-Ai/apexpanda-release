/**
 * WebSocket 节点连接处理
 * 握手、心跳、消息路由
 */
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
export declare function handleNodeConnect(ws: WebSocket, _req: IncomingMessage): void;
//# sourceMappingURL=ws-handler.d.ts.map