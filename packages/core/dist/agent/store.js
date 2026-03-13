/**
 * Agent 定义存储（内存 + 文件持久化）
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const agents = new Map();
let loaded = false;
let lastLoadedMtime = 0;
function getAgentsPath() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'agents.json');
}
async function loadFromFile() {
    const path = getAgentsPath();
    let mtime = 0;
    try {
        const st = await stat(path);
        mtime = st.mtimeMs;
    }
    catch {
        // 文件不存在，mtime 保持 0
    }
    if (loaded && mtime <= lastLoadedMtime)
        return;
    lastLoadedMtime = mtime;
    loaded = true;
    try {
        const raw = await readFile(path, 'utf-8');
        const arr = JSON.parse(raw);
        agents.clear();
        for (const a of Array.isArray(arr) ? arr : []) {
            if (a?.id && a?.name)
                agents.set(a.id, a);
        }
    }
    catch {
        agents.clear();
        // 文件不存在或格式错误，使用空存储
    }
}
async function saveToFile() {
    const path = getAgentsPath();
    const arr = Array.from(agents.values());
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(arr, null, 2), 'utf-8');
}
function now() {
    return new Date().toISOString();
}
export async function listAgents() {
    await loadFromFile();
    return Array.from(agents.values());
}
export async function getAgent(id) {
    await loadFromFile();
    return agents.get(id) ?? null;
}
export async function createAgent(input) {
    await loadFromFile();
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const t = now();
    const skillIds = Array.isArray(input.skillIds) ? [...new Set(input.skillIds.filter(Boolean))] : undefined;
    const def = {
        id,
        name: input.name,
        handle: input.handle?.trim() || undefined,
        description: input.description,
        category: input.category,
        model: input.model,
        systemPrompt: input.systemPrompt,
        workerIds: input.workerIds,
        mcpServerIds: input.mcpServerIds,
        preferredNodeId: input.preferredNodeId,
        skillIds,
        nodeToolsEnabled: input.nodeToolsEnabled,
        avatar3d: input.avatar3d,
        createdAt: t,
        updatedAt: t,
    };
    agents.set(id, def);
    await saveToFile();
    return def;
}
export async function updateAgent(id, patch) {
    await loadFromFile();
    const existing = agents.get(id);
    if (!existing)
        return null;
    const skillIds = patch.skillIds !== undefined
        ? (patch.skillIds === null ? undefined : Array.isArray(patch.skillIds) ? [...new Set(patch.skillIds.filter(Boolean))] : existing.skillIds)
        : existing.skillIds;
    const updates = {};
    if (patch.name !== undefined)
        updates.name = patch.name;
    if (patch.handle !== undefined)
        updates.handle = patch.handle?.trim() || undefined;
    if (patch.description !== undefined)
        updates.description = patch.description;
    if (patch.category !== undefined)
        updates.category = patch.category;
    if (patch.model !== undefined)
        updates.model = patch.model;
    if (patch.systemPrompt !== undefined)
        updates.systemPrompt = patch.systemPrompt;
    if (patch.workerIds !== undefined)
        updates.workerIds = patch.workerIds;
    if (patch.memoryVisibility !== undefined)
        updates.memoryVisibility = patch.memoryVisibility;
    if (patch.preferredNodeId !== undefined)
        updates.preferredNodeId = patch.preferredNodeId;
    if (patch.mcpServerIds !== undefined)
        updates.mcpServerIds = patch.mcpServerIds;
    if (patch.nodeToolsEnabled !== undefined)
        updates.nodeToolsEnabled = patch.nodeToolsEnabled;
    if (patch.avatar3d !== undefined)
        updates.avatar3d = patch.avatar3d;
    const updated = {
        ...existing,
        ...updates,
        skillIds,
        updatedAt: now(),
    };
    agents.set(id, updated);
    await saveToFile();
    return updated;
}
export async function deleteAgent(id) {
    await loadFromFile();
    const ok = agents.delete(id);
    if (ok)
        await saveToFile();
    return ok;
}
//# sourceMappingURL=store.js.map