/**
 * 节点执行历史：记录 node.invoke 调用，供 Dashboard 展示
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const dataBase = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
const HISTORY_FILE = join(dataBase, 'node-exec-history.json');
const MAX_ENTRIES = 5000;
async function ensureDataDir() {
    await mkdir(dataBase, { recursive: true });
}
async function loadHistory() {
    try {
        const raw = await readFile(HISTORY_FILE, 'utf-8');
        const data = JSON.parse(raw);
        return data ?? { entries: [], nextId: 1 };
    }
    catch {
        return { entries: [], nextId: 1 };
    }
}
async function saveHistory(data) {
    await ensureDataDir();
    await writeFile(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
export async function addExecHistory(entry) {
    const data = await loadHistory();
    const id = `exec-${data.nextId++}`;
    data.entries.unshift({ ...entry, id });
    if (data.entries.length > MAX_ENTRIES) {
        data.entries = data.entries.slice(0, MAX_ENTRIES);
    }
    await saveHistory(data);
}
export async function getExecHistory(options) {
    const { nodeId, limit = 100, since } = options ?? {};
    const data = await loadHistory();
    let entries = data.entries;
    if (nodeId)
        entries = entries.filter((e) => e.nodeId === nodeId);
    if (since != null)
        entries = entries.filter((e) => e.timestamp >= since);
    return entries.slice(0, limit);
}
//# sourceMappingURL=exec-history.js.map