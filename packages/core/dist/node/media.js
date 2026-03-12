/**
 * 节点媒体落盘：camera.snap、screen.record 等返回 base64 时写入磁盘，返回文件引用
 * Phase 4 桌面端有摄像头/录屏能力后，本模块供 node-invoke 工具调用
 */
import { mkdir, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
const dataBase = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
const NODE_MEDIA_DIR = join(dataBase, 'node-media');
const DEFAULT_RETENTION_MS = 3600_000; // 1 小时
/** 将 base64 媒体写入 .apexpanda/node-media/{nodeId}/{timestamp}.{ext} */
export async function saveNodeMedia(opts) {
    const { nodeId, base64, ext, width, height, format } = opts;
    const dir = join(NODE_MEDIA_DIR, nodeId);
    await mkdir(dir, { recursive: true });
    const ts = Date.now();
    const filename = `${ts}.${ext.replace(/^\./, '')}`;
    const filePath = join(dir, filename);
    const buf = Buffer.from(base64, 'base64');
    await writeFile(filePath, buf);
    const result = { filePath };
    if (width != null)
        result.width = width;
    if (height != null)
        result.height = height;
    if (format != null)
        result.format = format;
    return result;
}
/** 清理超期媒体文件，retentionMs 内创建的文件保留 */
export async function cleanNodeMediaDir(retentionMs = DEFAULT_RETENTION_MS) {
    const cutoff = Date.now() - retentionMs;
    let deleted = 0;
    try {
        const nodeDirs = await readdir(NODE_MEDIA_DIR, { withFileTypes: true });
        for (const dirent of nodeDirs) {
            if (!dirent.isDirectory())
                continue;
            const nodePath = join(NODE_MEDIA_DIR, dirent.name);
            const files = await readdir(nodePath);
            for (const f of files) {
                const fp = join(nodePath, f);
                try {
                    const st = await stat(fp);
                    if (st.mtimeMs < cutoff) {
                        await unlink(fp);
                        deleted++;
                    }
                }
                catch {
                    /* ignore stat/unlink errors */
                }
            }
        }
    }
    catch (e) {
        if (e.code !== 'ENOENT') {
            console.error('[node-media] cleanNodeMediaDir error:', e);
        }
    }
    return deleted;
}
/** 获取节点媒体根目录（用于测试或直接路径） */
export function getNodeMediaDir() {
    return NODE_MEDIA_DIR;
}
//# sourceMappingURL=media.js.map