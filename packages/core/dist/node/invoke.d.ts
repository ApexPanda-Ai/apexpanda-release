/** 审批上下文，透传给节点用于 exec_approval_request 会话级自动批准 */
export interface ApprovalContext {
    sessionId?: string;
}
export declare function invokeNode(nodeId: string, command: string, params: Record<string, unknown>, timeoutMs?: number, approvalContext?: ApprovalContext): Promise<unknown>;
/** 收到 res_stream_chunk 时重置超时，避免长时任务因无输出而被误杀 */
export declare function onStreamChunk(nodeId: string, reqId: string): void;
export declare function rejectAllPending(nodeId: string): void;
export declare function resolveRpc(nodeId: string, reqId: string, ok: boolean, payload: unknown): void;
export declare function getPendingCount(nodeId: string): number;
/** 调用节点并处理媒体落盘（API 调试用，与 executeNodeTool 的落盘逻辑一致） */
export declare function invokeNodeWithMediaHandling(nodeId: string, command: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
/** 脱敏 params，避免审计日志泄露 env 中的密码等 */
export declare function sensitiveRedact(params: Record<string, unknown>): Record<string, unknown>;
/** 根据在线节点+宽限期节点能力聚合可用 capability 集合（断线 30s 内工具保持可见） */
export declare function getAvailableNodeCapabilities(): Set<string>;
/** 执行 node-invoke 工具（由 registry.invokeTool 调用） */
export declare function executeNodeTool(toolId: string, params: Record<string, unknown>, execContext?: {
    agentId?: string;
    sessionId?: string;
}, timeoutMs?: number): Promise<unknown>;
/** 批量执行：同一 system.run 命令在多个节点并发执行 */
export declare function invokeNodeBatch(command: string, params: Record<string, unknown>, options?: {
    nodeIds?: string[];
    nodeTags?: string[];
    nodePlatform?: string;
    timeoutMs?: number;
}): Promise<{
    results: Array<{
        nodeId: string;
        displayName: string;
        ok: boolean;
        payload?: unknown;
        error?: string;
    }>;
}>;
/** 执行 node-invoke 批量工具（node-invoke_batchSysRun） */
export declare function executeBatchNodeTool(params: Record<string, unknown>, execContext?: {
    agentId?: string;
}, timeoutMs?: number): Promise<unknown>;
//# sourceMappingURL=invoke.d.ts.map