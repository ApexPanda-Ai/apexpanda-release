/**
 * 敏感词过滤：自定义词库，触发时拦截并记录（数据合规）
 */
import { addAudit } from '../audit/store.js';
let wordSet = null;
function loadWordSet() {
    if (wordSet)
        return wordSet;
    const env = process.env.APEXPANDA_SENSITIVE_WORDS?.trim();
    const words = [];
    if (env) {
        for (const w of env.split(/[,;，；\s]+/)) {
            const t = w.trim();
            if (t)
                words.push(t);
        }
    }
    wordSet = new Set(words);
    return wordSet;
}
/** 检查文本是否包含敏感词 */
export function checkSensitive(content) {
    const words = loadWordSet();
    if (words.size === 0)
        return { matched: [], blocked: false };
    const matched = [];
    const lower = content.toLowerCase();
    for (const w of words) {
        if (w && lower.includes(w.toLowerCase())) {
            matched.push(w);
        }
    }
    const blocked = matched.length > 0 && process.env.APEXPANDA_SENSITIVE_BLOCK === 'true';
    return { matched: [...new Set(matched)], blocked };
}
/** 检查并审计，若拦截则抛出 */
export function filterAndAudit(content, opts) {
    const result = checkSensitive(content);
    if (result.matched.length === 0)
        return;
    addAudit({
        type: 'compliance',
        action: 'sensitive_match',
        detail: {
            matched: result.matched,
            blocked: result.blocked,
            source: opts.type,
            sessionId: opts.sessionId,
            tenantId: opts.tenantId,
        },
    });
    if (result.blocked) {
        throw new Error(`内容包含敏感词已拦截: ${result.matched.slice(0, 3).join(', ')}`);
    }
}
export function isSensitiveFilterEnabled() {
    return !!(process.env.APEXPANDA_SENSITIVE_WORDS?.trim());
}
//# sourceMappingURL=sensitive-filter.js.map