/**
 * 多 Agent 协同 — 任务黑板（Task Blackboard）
 *
 * 每次多 Agent 协同创建一个临时黑板，各 Agent 执行完可写入结构化产出，
 * 后续 Agent 可按名称读取任意前步产出，而不依赖文本层层传递。
 *
 * 生命周期：与单次协同请求绑定，请求完成后自动清理（TTL 30 分钟）。
 */
/** 创建并返回黑板 ID */
export declare function createBlackboard(): string;
/** 向黑板写入条目（agentName 或自定义 key） */
export declare function blackboardWrite(bbId: string, key: string, value: unknown): void;
/** 读取黑板条目，不存在时返回 undefined */
export declare function blackboardRead(bbId: string, key: string): unknown;
/** 读取黑板全部条目（按写入顺序排列） */
export declare function blackboardReadAll(bbId: string): Record<string, unknown>;
/** 将黑板当前快照格式化为文本摘要（注入 Agent 上下文时使用） */
export declare function blackboardSummary(bbId: string, excludeKeys?: string[]): string;
/** 删除黑板（协同结束后手动清理） */
export declare function destroyBlackboard(bbId: string): void;
//# sourceMappingURL=task-blackboard.d.ts.map