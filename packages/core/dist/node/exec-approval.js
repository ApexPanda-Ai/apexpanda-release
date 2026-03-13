const DEFAULT_APPROVAL_TIMEOUT_MS = 30_000;
const pending = new Map();
export function addPendingExecApproval(reqId, nodeId, displayName, command, params, ws, onTimeout, timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS) {
    const effectiveTimeout = Math.max(5_000, Math.min(300_000, timeoutMs));
    const timer = setTimeout(async () => {
        const p = pending.get(reqId);
        if (!p)
            return;
        pending.delete(reqId);
        clearTimeout(p.timer);
        const approved = await Promise.resolve(onTimeout(p));
        try {
            if (p.ws.readyState === 1) {
                p.ws.send(JSON.stringify({ type: 'exec_approval_result', payload: { reqId, approved } }));
            }
        }
        catch (e) {
            console.error('[exec-approval] timeout send result failed:', e);
        }
    }, effectiveTimeout);
    pending.set(reqId, {
        reqId,
        nodeId,
        displayName,
        command,
        params,
        requestedAt: Date.now(),
        ws,
        timer,
    });
}
export function resolveExecApproval(reqId, approved) {
    const p = pending.get(reqId);
    if (!p)
        return false;
    clearTimeout(p.timer);
    pending.delete(reqId);
    try {
        if (p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({
                type: 'exec_approval_result',
                payload: { reqId, approved },
            }));
        }
    }
    catch (e) {
        console.error('[exec-approval] send result failed:', e);
    }
    return true;
}
export function getPendingExecApprovals() {
    return Array.from(pending.values());
}
/** 批准指定节点的全部待审批请求 */
export function resolveAllByNodeId(nodeId, approved) {
    const items = Array.from(pending.values()).filter((p) => p.nodeId === nodeId);
    for (const p of items) {
        resolveExecApproval(p.reqId, approved);
    }
    return items.length;
}
//# sourceMappingURL=exec-approval.js.map