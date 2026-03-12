/**
 * Token 用量统计（内存，按日聚合）
 * 支持按模型分拆、成本估算
 */
export interface UsageRecord {
    date: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
}
export interface UsageByModel {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
    estimatedCostUsd?: number;
}
export declare function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number;
export declare function recordUsage(promptTokens: number, completionTokens: number, model?: string): void;
export declare function getUsage(days?: number): UsageRecord[];
export declare function getUsageByModel(days?: number): UsageByModel[];
export declare function getTotalUsage(): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
    estimatedCostUsd?: number;
};
//# sourceMappingURL=store.d.ts.map