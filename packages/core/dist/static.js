/**
 * 静态文件服务（生产环境 Serving 管理后台）
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
const MIMES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};
export async function serveStatic(res, pathname, baseDir) {
    const clean = pathname.replace(/^\//, '') || '';
    const isAsset = clean.startsWith('assets/');
    let filePath = clean || 'index.html';
    if (!isAsset && !filePath.includes('.')) {
        filePath = 'index.html';
    }
    let fullPath = join(baseDir, filePath);
    try {
        const st = await stat(fullPath);
        if (!st.isFile()) {
            if (filePath !== 'index.html')
                fullPath = join(baseDir, 'index.html');
            else
                return false;
        }
    }
    catch {
        fullPath = join(baseDir, 'index.html');
    }
    try {
        await stat(fullPath);
    }
    catch {
        return false;
    }
    const ext = extname(fullPath);
    res.setHeader('Content-Type', MIMES[ext] ?? 'application/octet-stream');
    createReadStream(fullPath).pipe(res);
    return true;
}
//# sourceMappingURL=static.js.map