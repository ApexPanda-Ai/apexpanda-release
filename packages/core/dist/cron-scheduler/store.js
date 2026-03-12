/**
 * 定时任务存储与调度
 * 持久化到 .apexpanda/cron-tasks.json，后台每分钟检查并执行到期任务
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
const { CronExpressionParser } = await import('cron-parser');
let storePath = null;
let runnerStarted = false;
function getStorePath() {
    if (storePath)
        return storePath;
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    storePath = join(base, 'cron-tasks.json');
    return storePath;
}
async function loadStore() {
    try {
        const path = getStorePath();
        const raw = await readFile(path, 'utf-8');
        const data = JSON.parse(raw);
        return { tasks: Array.isArray(data?.tasks) ? data.tasks : [] };
    }
    catch {
        return { tasks: [] };
    }
}
async function saveStore(store) {
    const path = getStorePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(store, null, 2), 'utf-8');
}
export function getCronSchedulerStore() {
    return { tasks: [] };
}
export async function addScheduledTask(store, task) {
    const data = await loadStore();
    const idx = data.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0)
        data.tasks[idx] = task;
    else
        data.tasks.push(task);
    await saveStore(data);
}
export async function listScheduledTasks(store) {
    const data = await loadStore();
    return data.tasks;
}
export async function removeScheduledTask(store, id) {
    const data = await loadStore();
    data.tasks = data.tasks.filter((t) => t.id !== id);
    await saveStore(data);
}
async function runTask(task) {
    const cwd = task.workspaceDir ?? process.cwd();
    const isWin = process.platform === 'win32';
    const [cmd, ...args] = isWin ? ['cmd', '/c', task.command] : ['sh', '-c', task.command];
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { cwd, stdio: 'pipe' });
        proc.on('close', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`Task ${task.id} exited with code ${code}`));
        });
        proc.on('error', reject);
    });
}
function startRunner() {
    if (runnerStarted)
        return;
    runnerStarted = true;
    const INTERVAL_MS = 60_000;
    setInterval(async () => {
        try {
            const data = await loadStore();
            const now = Date.now();
            for (const task of data.tasks) {
                try {
                    const expr = CronExpressionParser.parse(task.cron, { currentDate: new Date() });
                    const prev = expr.prev();
                    const prevTs = prev.getTime();
                    const lastRun = task.lastRunAt ?? 0;
                    if (prevTs >= now - INTERVAL_MS && prevTs > lastRun) {
                        await runTask(task);
                        const updated = await loadStore();
                        const t = updated.tasks.find((x) => x.id === task.id);
                        if (t)
                            t.lastRunAt = now;
                        await saveStore(updated);
                    }
                }
                catch (e) {
                    console.error(`[cron-scheduler] Task ${task.id} error:`, e);
                }
            }
        }
        catch {
            /* ignore */
        }
    }, INTERVAL_MS);
}
export function ensureCronRunnerStarted() {
    startRunner();
}
//# sourceMappingURL=store.js.map