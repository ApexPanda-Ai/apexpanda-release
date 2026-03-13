/**
 * 审计日志存储（内存，最近 N 条）
 */
export interface AuditEntry {
    id: string;
    ts: number;
    type: string;
    action: string;
    detail?: Record<string, unknown>;
    ip?: string;
}
export declare function addAudit(entry: Omit<AuditEntry, 'id' | 'ts'>): void;
export declare function listAudit(limit?: number, type?: string): AuditEntry[];
/** 合规审计日志格式（操作人、时间、类型、对象、结果、IP） */
export interface DebaoAuditRow {
    日志编号: string;
    操作时间: string;
    操作类型: string;
    操作动作: string;
    操作对象: string;
    操作结果: string;
    源IP: string;
    详情: string;
}
export declare function exportDebaoFormat(limit?: number, type?: string): DebaoAuditRow[];
//# sourceMappingURL=store.d.ts.map