export interface VerifyResult {
    pass: boolean;
    issues?: string[];
}
export interface VerifyConfig {
    checkpoint: string;
    validator: 'llm' | 'rule' | 'skill';
    skillName?: string;
    toolId?: string;
    params?: Record<string, unknown>;
    keywords?: string[];
    regex?: string;
}
/** Verify 失败时抛出的错误，携带 issues 供上层使用 */
export declare class VerifyFailedError extends Error {
    readonly issues: string[];
    constructor(message: string, issues?: string[]);
}
/**
 * 执行 Verify 节点校验
 * @param prev 前序节点输出（字符串或对象）
 * @param config 节点配置
 * @returns 通过时返回 prev，失败时抛出 VerifyFailedError
 */
export declare function executeVerify(prev: unknown, config: VerifyConfig): Promise<unknown>;
//# sourceMappingURL=verify-node.d.ts.map