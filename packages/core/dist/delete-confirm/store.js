/**
 * 删除操作二次确认：待确认队列
 * 当 APEXPANDA_DELETE_CONFIRM_REQUIRED=true 时，删除需用户确认
 */
import { unlink } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { spawn } from "node:child_process";
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 分钟
const pendingMap = new Map();
function pruneExpired() {
    const now = Date.now();
    for (const [k, v] of pendingMap) {
        if (now - v.createdAt > PENDING_TTL_MS)
            pendingMap.delete(k);
    }
}
export function setPendingDelete(sessionId, data) {
    pruneExpired();
    const now = Date.now();
    if (data.type === "shell") {
        pendingMap.set(sessionId, {
            type: "shell",
            command: data.command,
            cwd: data.cwd,
            env: data.env,
            createdAt: now,
        });
    }
    else {
        pendingMap.set(sessionId, {
            path: data.path,
            workspaceDir: data.workspaceDir,
            type: "file",
            createdAt: now,
        });
    }
}
export function getAndClearPendingDelete(sessionId) {
    pruneExpired();
    const v = pendingMap.get(sessionId);
    if (v)
        pendingMap.delete(sessionId);
    return v ?? null;
}
export function getPendingDelete(sessionId) {
    pruneExpired();
    const v = pendingMap.get(sessionId);
    if (v && Date.now() - v.createdAt > PENDING_TTL_MS) {
        pendingMap.delete(sessionId);
        return null;
    }
    return v ?? null;
}
/** 定时清理过期待确认删除（供 index 定期调用，避免僵尸状态积累） */
export function cleanupExpiredPendingDeletes() {
    const now = Date.now();
    for (const [k, v] of pendingMap) {
        if (now - v.createdAt > PENDING_TTL_MS)
            pendingMap.delete(k);
    }
}
/** 执行待确认的文件删除（路径限制在工作区内） */
export async function executePendingDelete(path, workspaceDir) {
    try {
        const baseResolved = resolve(workspaceDir);
        const fp = resolve(baseResolved, path);
        const rel = relative(baseResolved, fp);
        if (rel.startsWith("..") || rel.startsWith("/") || (rel.length > 0 && resolve(rel) === rel)) {
            return { ok: false, error: "路径超出工作区" };
        }
        await unlink(fp);
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
/** 执行待确认的 shell 删除命令 */
export async function executePendingShellDelete(opts) {
    const { command, cwd, env } = opts;
    const shellBin = process.platform === "win32" ? "powershell" : "sh";
    const shellArgs = process.platform === "win32"
        ? ["-NoProfile", "-NonInteractive", "-Command", command]
        : ["-c", command];
    const mergeEnv = env ? { ...process.env, ...env } : process.env;
    return new Promise((res) => {
        const proc = spawn(shellBin, shellArgs, {
            cwd: cwd ?? process.cwd(),
            env: mergeEnv,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        proc.stderr?.on("data", (d) => (stderr += d.toString()));
        proc.on("close", (code) => {
            if (code === 0)
                res({ ok: true });
            else
                res({ ok: false, error: stderr.slice(0, 500) || `exit ${code}` });
        });
        proc.on("error", (e) => res({ ok: false, error: e.message }));
    });
}
const CONFIRM_PATTERNS = /^(确认|是|执行|删除|确定|确认删除|确认执行|ok|yes)$/i;
const CANCEL_PATTERNS = /^(取消|不|放弃|算了|no|cancel)$/i;
export function isConfirmIntent(msg) {
    return CONFIRM_PATTERNS.test(msg.trim());
}
export function isCancelIntent(msg) {
    return CANCEL_PATTERNS.test(msg.trim());
}
//# sourceMappingURL=store.js.map