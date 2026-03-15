import type { WebSocket } from 'ws';
export interface NodeConnection {
    ws: WebSocket;
    nodeId: string;
    deviceId: string;
    displayName: string;
    platform: string;
    capabilities: string[];
    envTools: string[];
    /** 节点 connect 时可选的 tags，用于分组 */
    tags: string[];
    connectedAt: number;
    lastPongAt: number;
}
export interface NodePairing {
    deviceId: string;
    displayName: string;
    token: string;
    nodeId: string;
    approvedAt: number;
    approvedBy?: string;
    revoked?: boolean;
}
export interface PendingPairing {
    requestId: string;
    deviceId: string;
    displayName: string;
    platform: string;
    requestedAt: number;
    ws: WebSocket;
}
export declare const nodeConnections: Map<string, NodeConnection>;
export declare function getNodeConnection(nodeId: string): NodeConnection | undefined;
export declare function addNodeConnection(conn: NodeConnection): void;
export declare function removeNodeConnection(nodeId: string): void;
export declare function addNodeToGracePeriod(nodeId: string, capabilities: string[]): void;
export declare function removeNodeFromGracePeriod(nodeId: string): void;
/** 宽限期内节点的能力聚合（用于保持工具可见） */
export declare function getGracePeriodCapabilities(): Set<string>;
export declare const pendingPairings: Map<string, PendingPairing>;
export declare function findPairingByDeviceId(deviceId: string): Promise<NodePairing | undefined>;
export declare function findPairingByToken(token: string): Promise<NodePairing | undefined>;
export declare function findPairingByNodeId(nodeId: string): Promise<NodePairing | undefined>;
export declare function savePairing(pairing: NodePairing): Promise<void>;
export declare function revokePairing(deviceId: string): Promise<void>;
export declare function listOnlineNodes(): NodeConnection[];
export declare function addPendingPairing(p: PendingPairing): void;
export declare function getPendingPairing(requestId: string): PendingPairing | undefined;
/** 按 deviceId 查找已有 pending（方案 §5.3：同 deviceId 复用 requestId） */
export declare function findPendingByDeviceId(deviceId: string): PendingPairing | undefined;
export declare function removePendingPairing(requestId: string): void;
export declare function listPendingPairings(): PendingPairing[];
export declare function generateNodeId(): string;
export declare function generateRequestId(): string;
/** 审批通过：生成 nodeId+token，保存，向节点推送 paired，移除 pending */
export declare function approvePairing(requestId: string): Promise<{
    nodeId: string;
    token: string;
} | {
    error: string;
}>;
/** 拒绝配对 */
export declare function rejectPairing(requestId: string): boolean;
/** 清理超时的 pending 配对 */
export declare function cleanupExpiredPending(): void;
//# sourceMappingURL=store.d.ts.map