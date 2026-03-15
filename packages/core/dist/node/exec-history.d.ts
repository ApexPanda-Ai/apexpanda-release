export interface ExecHistoryEntry {
    id: string;
    nodeId: string;
    command: string;
    ok: boolean;
    exitCode?: number;
    durationMs: number;
    timestamp: number;
    source: string;
    error?: string;
}
export declare function addExecHistory(entry: Omit<ExecHistoryEntry, 'id'>): Promise<void>;
export declare function getExecHistory(options?: {
    nodeId?: string;
    limit?: number;
    since?: number;
}): Promise<ExecHistoryEntry[]>;
//# sourceMappingURL=exec-history.d.ts.map