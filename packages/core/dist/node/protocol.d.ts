/**
 * 设备节点协议类型定义
 */
export declare const PROTOCOL_VERSION = "1";
export interface NodeConnectPayload {
    role: 'node';
    deviceId: string;
    token?: string;
    displayName: string;
    platform: string;
    protocolVersion?: string;
    capabilities: string[];
}
export interface ConnectResultOk {
    type: 'connect_result';
    ok: true;
    nodeId: string;
}
export interface ConnectResultNeedPairing {
    type: 'connect_result';
    ok: false;
    needPairing: true;
    requestId: string;
}
export interface ConnectResultError {
    type: 'connect_result';
    ok: false;
    error: string;
}
export type ConnectResult = ConnectResultOk | ConnectResultNeedPairing | ConnectResultError;
export interface NodeInvokeReq {
    type: 'req';
    id: string;
    method: 'node.invoke';
    params: {
        command: string;
        params: Record<string, unknown>;
    };
}
export interface NodeInvokeRes {
    type: 'res';
    id: string;
    ok: boolean;
    payload: unknown;
}
export interface PingFrame {
    type: 'ping';
    ts: number;
}
export interface PongFrame {
    type: 'pong';
    ts: number;
}
export interface PairedFrame {
    type: 'paired';
    nodeId: string;
    token: string;
}
//# sourceMappingURL=protocol.d.ts.map