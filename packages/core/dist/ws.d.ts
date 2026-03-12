/**
 * WebSocket 服务
 * 用于管理后台实时状态、消息推送 + 设备节点连接
 */
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
export declare function attachWebSocket(server: Server): import("ws").Server<typeof WebSocket, typeof import("http").IncomingMessage>;
export declare function broadcast(event: {
    type: string;
    payload?: unknown;
}): void;
/** 向所有已连接节点广播（如 voicewake 配置变更） */
export declare function broadcastToNodes(event: {
    type: string;
    payload?: unknown;
}): void;
//# sourceMappingURL=ws.d.ts.map