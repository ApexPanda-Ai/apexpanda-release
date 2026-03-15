export interface SensitiveCheckResult {
    matched: string[];
    blocked: boolean;
}
/** 检查文本是否包含敏感词 */
export declare function checkSensitive(content: string): SensitiveCheckResult;
/** 检查并审计，若拦截则抛出 */
export declare function filterAndAudit(content: string, opts: {
    type: 'user' | 'assistant';
    sessionId?: string;
    tenantId?: string;
}): void;
export declare function isSensitiveFilterEnabled(): boolean;
//# sourceMappingURL=sensitive-filter.d.ts.map