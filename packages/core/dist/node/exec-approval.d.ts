/**
 * exec 远程审批：节点请求执行命令时的 pending 状态
 */
import type { WebSocket } from 'ws';
export interface PendingExecApproval {
    reqId: string;
    nodeId: string;
    displayName: string;
    command: string;
    params?: Record<string, unknown>;
    requestedAt: number;
    ws: WebSocket;
    timer: ReturnType<typeof setTimeout>;
}
/** 超时回调：返回 true 表示按规则放行（批准），false 表示拒绝 */
export type OnExecApprovalTimeout = (p: PendingExecApproval) => boolean | Promise<boolean>;
export declare function addPendingExecApproval(reqId: string, nodeId: string, displayName: string, command: string, params: Record<string, unknown> | undefined, ws: WebSocket, onTimeout: OnExecApprovalTimeout, timeoutMs?: number): void;
export declare function resolveExecApproval(reqId: string, approved: boolean): boolean;
export declare function getPendingExecApprovals(): PendingExecApproval[];
/** 批准指定节点的全部待审批请求 */
export declare function resolveAllByNodeId(nodeId: string, approved: boolean): number;
//# sourceMappingURL=exec-approval.d.ts.map