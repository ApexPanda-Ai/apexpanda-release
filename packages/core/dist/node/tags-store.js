/**
 * 节点标签持久化：管理员在 Dashboard 设置的节点分组/标签
 * 与 connect 时节点自带的 tags 合并后用于选节点过滤
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const dataBase = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
const TAGS_FILE = join(dataBase, 'node-tags.json');
async function ensureDir() {
    await mkdir(dataBase, { recursive: true });
}
async function loadTags() {
    try {
        const raw = await readFile(TAGS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        return data ?? {};
    }
    catch {
        return {};
    }
}
export async function getNodeTags(nodeId) {
    const data = await loadTags();
    return data[nodeId] ?? [];
}
export async function setNodeTags(nodeId, tags) {
    const data = await loadTags();
    const trimmed = tags.map((t) => String(t).trim()).filter(Boolean);
    if (trimmed.length === 0) {
        delete data[nodeId];
    }
    else {
        data[nodeId] = [...new Set(trimmed)];
    }
    await ensureDir();
    await writeFile(TAGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
//# sourceMappingURL=tags-store.js.map