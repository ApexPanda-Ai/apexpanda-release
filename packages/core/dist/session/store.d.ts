import type { LLMMessage } from '../llm/types.js';
export interface SessionMeta {
    channel?: string;
    agentId?: string;
    userId?: string;
    peer?: string;
    /** 会话级自动执行模式：该会话下的节点命令免审批 */
    autoApprove?: boolean;
    createdAt: number;
    lastActivityAt: number;
}
/** 单会话最大消息数，超出时丢弃最旧（用于 Phase 4 压缩前沉淀） */
export declare const SESSION_MAX_HISTORY = 20;
export declare function getSessionHistory(sessionId: string, tenantId?: string): Promise<LLMMessage[]>;
export declare function appendToSession(sessionId: string, role: LLMMessage['role'], content: string, tenantId?: string, meta?: {
    channel?: string;
    agentId?: string;
    userId?: string;
    peer?: string;
}): Promise<void>;
export declare function listSessionIds(tenantId?: string): Promise<string[]>;
export interface SessionWithMeta {
    id: string;
    messageCount: number;
    meta?: SessionMeta;
}
export declare function listSessionsWithMeta(tenantId?: string): Promise<SessionWithMeta[]>;
export declare function getSessionMeta(sessionId: string, tenantId?: string): SessionMeta | undefined;
/** 设置/取消会话级自动执行模式，该会话后续节点命令免审批 */
export declare function setSessionAutoApprove(sessionId: string, value: boolean, tenantId?: string): Promise<void>;
export declare function clearSession(sessionId: string, tenantId?: string): Promise<void>;
/** 删除指定租户所有会话（PIPL 用户数据删除/被遗忘权） */
export declare function deleteAllSessionsForTenant(tenantId: string): Promise<number>;
/** 批量删除会话 */
export declare function clearSessionsBulk(ids: string[], tenantId?: string): Promise<number>;
//# sourceMappingURL=store.d.ts.map