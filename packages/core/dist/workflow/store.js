/**
 * 工作流定义与运行状态存储
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const workflows = new Map();
const runs = new Map();
let runsLoaded = false;
function getWorkflowsPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'workflows.json');
}
function getRunsPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'workflow-runs.json');
}
async function loadWorkflows() {
    if (workflows.size > 0)
        return;
    const persist = process.env.APEXPANDA_WORKFLOWS_PERSIST === 'true';
    if (!persist)
        return;
    try {
        const path = getWorkflowsPath();
        const raw = await readFile(path, 'utf-8');
        const arr = JSON.parse(raw);
        workflows.clear();
        for (const w of arr)
            workflows.set(w.id, w);
    }
    catch {
        // 无文件或解析失败
    }
}
async function saveWorkflows() {
    if (process.env.APEXPANDA_WORKFLOWS_PERSIST !== 'true')
        return;
    try {
        const path = getWorkflowsPath();
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, JSON.stringify(Array.from(workflows.values()), null, 2));
    }
    catch {
        // 忽略
    }
}
export async function listWorkflows() {
    await loadWorkflows();
    return Array.from(workflows.values());
}
export async function getWorkflow(id) {
    await loadWorkflows();
    return workflows.get(id) ?? null;
}
export async function createWorkflow(def) {
    await loadWorkflows();
    const id = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const w = { ...def, id };
    workflows.set(id, w);
    await saveWorkflows();
    return w;
}
export async function updateWorkflow(id, patch) {
    await loadWorkflows();
    const existing = workflows.get(id);
    if (!existing)
        return null;
    const updated = { ...existing, ...patch };
    workflows.set(id, updated);
    await saveWorkflows();
    return updated;
}
export async function deleteWorkflow(id) {
    await loadWorkflows();
    const ok = workflows.delete(id);
    if (ok)
        await saveWorkflows();
    return ok;
}
export function saveRunCheckpoint(cp) {
    runs.set(cp.runId, cp);
    if (process.env.APEXPANDA_WORKFLOWS_PERSIST === 'true') {
        const path = getRunsPath();
        mkdir(join(path, '..'), { recursive: true })
            .then(() => writeFile(path, JSON.stringify(Array.from(runs.values()), null, 2)))
            .catch(() => { });
    }
}
async function loadRuns() {
    if (runsLoaded)
        return;
    runsLoaded = true;
    if (process.env.APEXPANDA_WORKFLOWS_PERSIST !== 'true')
        return;
    try {
        const raw = await readFile(getRunsPath(), 'utf-8');
        const arr = JSON.parse(raw);
        for (const r of arr)
            runs.set(r.runId, r);
    }
    catch {
        // 无文件
    }
}
export async function getRunCheckpoint(runId) {
    await loadRuns();
    return runs.get(runId) ?? null;
}
/** 列出运行记录，可选按 workflowId 筛选，按时间倒序 */
export async function listRuns(workflowId, limit = 50) {
    await loadRuns();
    let arr = Array.from(runs.values());
    if (workflowId)
        arr = arr.filter((r) => r.workflowId === workflowId);
    arr.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return arr.slice(0, limit);
}
//# sourceMappingURL=store.js.map