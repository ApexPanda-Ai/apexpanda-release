/**
 * 短链存储（内存，进程内共享）
 * 供 executor shortlink skill 与 server 重定向端点使用
 */
export interface ShortlinkEntry {
    url: string;
    createdAt: number;
}
export declare const shortlinkStore: Map<string, ShortlinkEntry>;
export declare function generateShortCode(): string;
//# sourceMappingURL=store.d.ts.map