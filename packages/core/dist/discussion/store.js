import { getDiscussionConfig } from '../config/loader.js';
const stateMap = new Map();
const endRequestedMap = new Map();
function getTTLMs() {
    const cfg = getDiscussionConfig();
    return (cfg.timeoutMinutes ?? 30) * 60 * 1000;
}
export function getSessionKey(channel, ctx) {
    return `${channel}:${ctx.chatId ?? ctx.sessionWebhook ?? ctx.messageId ?? 'default'}`;
}
export function hasActiveDiscussion(sessionKey) {
    const state = stateMap.get(sessionKey);
    if (!state)
        return false;
    if (Date.now() - state.startedAt > getTTLMs()) {
        stateMap.delete(sessionKey);
        endRequestedMap.delete(sessionKey);
        return false;
    }
    return true;
}
export function getDiscussionState(sessionKey) {
    const state = stateMap.get(sessionKey);
    if (!state)
        return undefined;
    if (Date.now() - state.startedAt > getTTLMs()) {
        stateMap.delete(sessionKey);
        endRequestedMap.delete(sessionKey);
        return undefined;
    }
    return state;
}
export function setDiscussionState(sessionKey, state) {
    stateMap.set(sessionKey, state);
}
export function appendDiscussionEntry(sessionKey, entry) {
    const state = stateMap.get(sessionKey);
    if (state)
        state.history.push(entry);
}
export function incrementRound(sessionKey) {
    const state = stateMap.get(sessionKey);
    if (state)
        state.currentRound += 1;
}
export function setEndRequested(sessionKey) {
    endRequestedMap.set(sessionKey, true);
}
export function getEndRequested(sessionKey) {
    return endRequestedMap.get(sessionKey) ?? false;
}
export function clearDiscussion(sessionKey) {
    stateMap.delete(sessionKey);
    endRequestedMap.delete(sessionKey);
}
/** 定时清理过期讨论状态（供 index 定期调用） */
export function cleanupExpiredDiscussions() {
    const ttl = getTTLMs();
    const now = Date.now();
    for (const [k, v] of stateMap) {
        if (now - v.startedAt > ttl) {
            stateMap.delete(k);
            endRequestedMap.delete(k);
        }
    }
}
//# sourceMappingURL=store.js.map