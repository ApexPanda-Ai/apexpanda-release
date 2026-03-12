export declare function isModelRoutingEnabled(): boolean;
export declare function getSimpleTaskModel(): string;
export declare function getComplexTaskModel(): string;
/** 判断是否为简单任务（可用廉价模型） */
export declare function isSimpleTask(opts: {
    messageLength: number;
    historyLength: number;
    hasRagContext: boolean;
    hasTools: boolean;
}): boolean;
/** 根据任务复杂度选择模型 */
export declare function selectModel(agentModel: string | undefined, opts: {
    messageLength: number;
    historyLength: number;
    hasRagContext: boolean;
    hasTools: boolean;
}): string;
//# sourceMappingURL=model-router.d.ts.map