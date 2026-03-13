/**
 * 多 Agent 协同运行日志（持久化存储）
 * 每次多 Agent 协同完成后写入，供 Dashboard 历史页查看。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const MAX_LOGS = 200;
let cached = null;
function getPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'multi-agent-runs.json');
}
async function load() {
    if (cached)
        return cached;
    try {
        const raw = await readFile(getPath(), 'utf-8');
        cached = JSON.parse(raw);
    }
    catch {
        cached = [];
    }
    return cached;
}
async function save() {
    if (!cached)
        return;
    const path = getPath();
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(cached.slice(0, MAX_LOGS), null, 2), 'utf-8');
}
export async function listMultiAgentRuns(limit = 50) {
    const logs = await load();
    return logs.slice(0, limit);
}
export async function appendMultiAgentRun(log) {
    const logs = await load();
    logs.unshift(log);
    if (logs.length > MAX_LOGS)
        logs.splice(MAX_LOGS);
    await save();
}
export function makeRunId() {
    return `ma-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
//# sourceMappingURL=multi-agent-run-store.js.map