type PendingDelete = {
    path: string;
    workspaceDir: string;
    type: "file";
    createdAt: number;
} | {
    type: "shell";
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    createdAt: number;
};
export declare function setPendingDelete(sessionId: string, data: {
    path: string;
    workspaceDir: string;
    type?: "file";
} | {
    type: "shell";
    command: string;
    cwd?: string;
    env?: Record<string, string>;
}): void;
export declare function getAndClearPendingDelete(sessionId: string): PendingDelete | null;
export declare function getPendingDelete(sessionId: string): PendingDelete | null;
/** 定时清理过期待确认删除（供 index 定期调用，避免僵尸状态积累） */
export declare function cleanupExpiredPendingDeletes(): void;
/** 执行待确认的文件删除（路径限制在工作区内） */
export declare function executePendingDelete(path: string, workspaceDir: string): Promise<{
    ok: boolean;
    error?: string;
}>;
/** 执行待确认的 shell 删除命令 */
export declare function executePendingShellDelete(opts: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
}): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function isConfirmIntent(msg: string): boolean;
export declare function isCancelIntent(msg: string): boolean;
export {};
//# sourceMappingURL=store.d.ts.map