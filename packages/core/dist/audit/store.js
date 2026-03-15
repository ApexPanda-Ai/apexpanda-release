const MAX = 500;
const entries = [];
export function addAudit(entry) {
    entries.unshift({
        ...entry,
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
    });
    if (entries.length > MAX)
        entries.length = MAX;
}
export function listAudit(limit = 50, type) {
    let list = entries;
    if (type)
        list = list.filter((e) => e.type === type);
    return list.slice(0, limit);
}
export function exportDebaoFormat(limit = 500, type) {
    const list = listAudit(limit, type);
    return list.map((e) => ({
        日志编号: e.id,
        操作时间: new Date(e.ts).toISOString(),
        操作类型: e.type,
        操作动作: e.action,
        操作对象: String(e.detail?.['id'] ?? e.detail?.['sessionId'] ?? '-'),
        操作结果: '成功',
        源IP: String(e.ip ?? '-'),
        详情: JSON.stringify(e.detail ?? {}),
    }));
}
//# sourceMappingURL=store.js.map