/**
 * 多 Agent 动态规划 — 待确认计划存储
 * 当 planConfirmRequired=true 时，planWithLLM 生成计划后先缓存，
 * 等用户回复「确认」才执行。
 */
const TTL_MS = 10 * 60 * 1000; // 10 分钟
const pendingPlans = new Map();
/** 以 channelSessionId 为 key 存储待确认计划 */
export function setPendingPlan(sessionId, plan) {
    pendingPlans.set(sessionId, plan);
    setTimeout(() => pendingPlans.delete(sessionId), TTL_MS);
}
/** 取出待确认计划（取出后自动删除） */
export function getAndClearPendingPlan(sessionId) {
    const p = pendingPlans.get(sessionId);
    if (p)
        pendingPlans.delete(sessionId);
    return p;
}
/** 是否有待确认计划 */
export function hasPendingPlan(sessionId) {
    return pendingPlans.has(sessionId);
}
/** 判断消息是否为「确认」指令 */
export function isPlanConfirmMessage(msg) {
    return /^(确认|confirm|ok|好的|执行|开始执行|是的|yes)\s*$/i.test(msg.trim());
}
/** 判断消息是否为「取消」指令 */
export function isPlanCancelMessage(msg) {
    return /^(取消|cancel|算了|不了|no|放弃)\s*$/i.test(msg.trim());
}
//# sourceMappingURL=pending-plan-store.js.map