/**
 * 节点 exec 配置：Gateway 侧存储（支持 full/blacklist/remote-approve）
 * 节点连接时上报，或通过 PUT API 下发后推送
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getNodeConnection } from './store.js';
const dataBase = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
const APPROVALS_DIR = join(dataBase, 'node-approvals');
async function getNodeApprovalsPath(nodeId) {
    await mkdir(APPROVALS_DIR, { recursive: true });
    const safe = nodeId.replace(/[/\\?*:]/g, '_');
    return join(APPROVALS_DIR, `${safe}.json`);
}
export async function getNodeApprovals(nodeId) {
    try {
        const path = await getNodeApprovalsPath(nodeId);
        const raw = await readFile(path, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function saveNodeApprovals(nodeId, data) {
    const path = await getNodeApprovalsPath(nodeId);
    const toSave = { ...data, updatedAt: Date.now() };
    await writeFile(path, JSON.stringify(toSave, null, 2), 'utf-8');
}
/** 向在线节点推送配置更新，节点收到后写入本地 exec-approvals.json */
export function pushNodeApprovals(nodeId, data) {
    const conn = getNodeConnection(nodeId);
    if (!conn || conn.ws.readyState !== 1)
        return false;
    try {
        conn.ws.send(JSON.stringify({ type: 'exec_approvals_update', payload: data }));
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=approvals-store.js.map