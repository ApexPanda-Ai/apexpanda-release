/**
 * 多 Agent 协同 — 任务黑板（Task Blackboard）
 *
 * 每次多 Agent 协同创建一个临时黑板，各 Agent 执行完可写入结构化产出，
 * 后续 Agent 可按名称读取任意前步产出，而不依赖文本层层传递。
 *
 * 生命周期：与单次协同请求绑定，请求完成后自动清理（TTL 30 分钟）。
 */
const BLACKBOARD_TTL_MS = 30 * 60 * 1000; // 30 分钟
const blackboards = new Map();
/** 创建并返回黑板 ID */
export function createBlackboard() {
    const id = `bb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    blackboards.set(id, { entries: new Map(), createdAt: Date.now() });
    scheduleCleanup(id);
    return id;
}
function scheduleCleanup(id) {
    setTimeout(() => blackboards.delete(id), BLACKBOARD_TTL_MS);
}
/** 向黑板写入条目（agentName 或自定义 key） */
export function blackboardWrite(bbId, key, value) {
    const bb = blackboards.get(bbId);
    if (!bb)
        return;
    bb.entries.set(key, { value, updatedAt: Date.now() });
}
/** 读取黑板条目，不存在时返回 undefined */
export function blackboardRead(bbId, key) {
    return blackboards.get(bbId)?.entries.get(key)?.value;
}
/** 读取黑板全部条目（按写入顺序排列） */
export function blackboardReadAll(bbId) {
    const bb = blackboards.get(bbId);
    if (!bb)
        return {};
    const result = {};
    for (const [k, v] of bb.entries) {
        result[k] = v.value;
    }
    return result;
}
/** 将黑板当前快照格式化为文本摘要（注入 Agent 上下文时使用） */
export function blackboardSummary(bbId, excludeKeys) {
    const all = blackboardReadAll(bbId);
    const exclude = new Set(excludeKeys ?? []);
    const lines = Object.entries(all)
        .filter(([k]) => !exclude.has(k))
        .map(([k, v]) => {
        const text = typeof v === 'string' ? v : JSON.stringify(v);
        const preview = text.length > 300 ? text.slice(0, 300) + '…（已截取）' : text;
        return `【${k}】${preview}`;
    });
    return lines.length > 0 ? lines.join('\n\n') : '';
}
/** 删除黑板（协同结束后手动清理） */
export function destroyBlackboard(bbId) {
    blackboards.delete(bbId);
}
//# sourceMappingURL=task-blackboard.js.map