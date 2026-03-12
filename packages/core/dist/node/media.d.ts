export interface SaveNodeMediaOptions {
    nodeId: string;
    base64: string;
    ext: string;
    width?: number;
    height?: number;
    format?: string;
}
export interface SaveNodeMediaResult {
    filePath: string;
    width?: number;
    height?: number;
    format?: string;
}
/** 将 base64 媒体写入 .apexpanda/node-media/{nodeId}/{timestamp}.{ext} */
export declare function saveNodeMedia(opts: SaveNodeMediaOptions): Promise<SaveNodeMediaResult>;
/** 清理超期媒体文件，retentionMs 内创建的文件保留 */
export declare function cleanNodeMediaDir(retentionMs?: number): Promise<number>;
/** 获取节点媒体根目录（用于测试或直接路径） */
export declare function getNodeMediaDir(): string;
//# sourceMappingURL=media.d.ts.map