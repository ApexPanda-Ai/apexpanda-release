interface ApprovalRule {
    command?: string;
    args?: string[];
    pattern?: string;
    comment?: string;
}
export interface NodeApprovals {
    mode?: 'full' | 'blacklist' | 'remote-approve';
    rules?: ApprovalRule[];
    /** 信任路径：cwd 或 command 包含这些路径时自动批准，如 ["C:\\Users\\xxx\\scripts", "D:\\workspace"] */
    trustPaths?: string[];
    /** 信任正则：command 匹配时自动批准，如 ["^node .*\\.js$"] */
    trustPatterns?: string[];
    /** 审批超时毫秒，默认 30000 */
    approvalTimeoutMs?: number;
    updatedAt?: number;
}
export declare function getNodeApprovals(nodeId: string): Promise<NodeApprovals | null>;
export declare function saveNodeApprovals(nodeId: string, data: NodeApprovals): Promise<void>;
/** 向在线节点推送配置更新，节点收到后写入本地 exec-approvals.json */
export declare function pushNodeApprovals(nodeId: string, data: NodeApprovals): boolean;
export {};
//# sourceMappingURL=approvals-store.d.ts.map