/**
 * 内置默认意图映射（常用站点、搜索、节点操控等）
 * 用户可通过 apexpanda.yaml 的 intentMappings 覆盖同 phrase 的映射
 */
export interface IntentMapping {
    phrase: string;
    tool: string;
    params: Record<string, string>;
}
export declare const DEFAULT_INTENT_MAPPINGS: IntentMapping[];
//# sourceMappingURL=default-intent-mappings.d.ts.map