/**
 * 节点注册表与配对持久化
 */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const dataBase = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
const NODES_FILE = join(dataBase, 'nodes.json');
const PENDING_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟
const _nodeConnections = new Map();
export const nodeConnections = _nodeConnections;
export function getNodeConnection(nodeId) {
    return _nodeConnections.get(nodeId);
}
export function addNodeConnection(conn) {
    _nodeConnections.set(conn.nodeId, conn);
}
export function removeNodeConnection(nodeId) {
    _nodeConnections.delete(nodeId);
}
/** 断线宽限期（ms）：此时间内工具保持可见，便于短暂断线重连 */
const GRACE_PERIOD_MS = 30_000;
const _nodeGracePeriod = new Map();
const _graceTimers = new Map();
export function addNodeToGracePeriod(nodeId, capabilities) {
    _nodeGracePeriod.set(nodeId, { capabilities, disconnectedAt: Date.now() });
    const prev = _graceTimers.get(nodeId);
    if (prev)
        clearTimeout(prev);
    const t = setTimeout(() => {
        _graceTimers.delete(nodeId);
        _nodeGracePeriod.delete(nodeId);
    }, GRACE_PERIOD_MS);
    _graceTimers.set(nodeId, t);
}
export function removeNodeFromGracePeriod(nodeId) {
    _nodeGracePeriod.delete(nodeId);
    const t = _graceTimers.get(nodeId);
    if (t) {
        clearTimeout(t);
        _graceTimers.delete(nodeId);
    }
}
/** 宽限期内节点的能力聚合（用于保持工具可见） */
export function getGracePeriodCapabilities() {
    const caps = new Set();
    for (const { capabilities } of _nodeGracePeriod.values()) {
        for (const c of capabilities)
            caps.add(c);
    }
    return caps;
}
const _pendingPairings = new Map();
export const pendingPairings = _pendingPairings;
async function ensureDataDir() {
    await mkdir(dataBase, { recursive: true });
}
async function loadNodesFile() {
    try {
        const raw = await readFile(NODES_FILE, 'utf-8');
        const data = JSON.parse(raw);
        return data ?? { pairings: [] };
    }
    catch {
        return { pairings: [] };
    }
}
async function saveNodesFile(data) {
    await ensureDataDir();
    await writeFile(NODES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
export async function findPairingByDeviceId(deviceId) {
    const data = await loadNodesFile();
    return data.pairings.find((p) => p.deviceId === deviceId && !p.revoked);
}
export async function findPairingByToken(token) {
    const data = await loadNodesFile();
    return data.pairings.find((p) => p.token === token && !p.revoked);
}
export async function findPairingByNodeId(nodeId) {
    const data = await loadNodesFile();
    return data.pairings.find((p) => p.nodeId === nodeId && !p.revoked);
}
export async function savePairing(pairing) {
    const data = await loadNodesFile();
    const idx = data.pairings.findIndex((p) => p.deviceId === pairing.deviceId);
    if (idx >= 0) {
        data.pairings[idx] = pairing;
    }
    else {
        data.pairings.push(pairing);
    }
    await saveNodesFile(data);
}
export async function revokePairing(deviceId) {
    const data = await loadNodesFile();
    const p = data.pairings.find((x) => x.deviceId === deviceId);
    if (p) {
        p.revoked = true;
        await saveNodesFile(data);
    }
}
export function listOnlineNodes() {
    return Array.from(_nodeConnections.values());
}
export function addPendingPairing(p) {
    _pendingPairings.set(p.requestId, p);
}
export function getPendingPairing(requestId) {
    return _pendingPairings.get(requestId);
}
/** 按 deviceId 查找已有 pending（方案 §5.3：同 deviceId 复用 requestId） */
export function findPendingByDeviceId(deviceId) {
    for (const p of _pendingPairings.values()) {
        if (p.deviceId === deviceId)
            return p;
    }
    return undefined;
}
export function removePendingPairing(requestId) {
    _pendingPairings.delete(requestId);
}
export function listPendingPairings() {
    return Array.from(_pendingPairings.values());
}
export function generateNodeId() {
    return `n-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
export function generateRequestId() {
    return `pair-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
/** 审批通过：生成 nodeId+token，保存，向节点推送 paired，移除 pending */
export async function approvePairing(requestId) {
    const pending = _pendingPairings.get(requestId);
    if (!pending)
        return { error: 'pending_not_found' };
    const nodeId = generateNodeId();
    const token = randomUUID();
    const pairing = {
        deviceId: pending.deviceId,
        displayName: pending.displayName,
        token,
        nodeId,
        approvedAt: Date.now(),
    };
    await savePairing(pairing);
    try {
        if (pending.ws.readyState === 1) {
            pending.ws.send(JSON.stringify({ type: 'paired', nodeId, token }));
        }
    }
    catch (e) {
        console.error('[node] approve: send paired failed', e);
    }
    _pendingPairings.delete(requestId);
    return { nodeId, token };
}
/** 拒绝配对 */
export function rejectPairing(requestId) {
    const pending = _pendingPairings.get(requestId);
    if (!pending)
        return false;
    try {
        if (pending.ws.readyState === 1) {
            pending.ws.send(JSON.stringify({ type: 'connect_result', ok: false, error: 'rejected' }));
            pending.ws.close();
        }
    }
    catch {
        /* ignore */
    }
    _pendingPairings.delete(requestId);
    return true;
}
/** 清理超时的 pending 配对 */
export function cleanupExpiredPending() {
    const now = Date.now();
    const toRemove = [];
    for (const [reqId, p] of _pendingPairings) {
        if (now - p.requestedAt > PENDING_TIMEOUT_MS) {
            try {
                if (p.ws.readyState === 1)
                    p.ws.close();
            }
            catch {
                /* ignore */
            }
            toRemove.push(reqId);
        }
    }
    for (const reqId of toRemove)
        _pendingPairings.delete(reqId);
}
//# sourceMappingURL=store.js.map