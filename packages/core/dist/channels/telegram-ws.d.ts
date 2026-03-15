/** 方案 B：按 instanceId 启动 Telegram 长轮询 */
export declare function startTelegramPolling(instanceId: string): Promise<void>;
/** 方案 B：停止指定实例；stopAllTelegramPolling 停止所有 */
export declare function stopTelegramPolling(instanceId: string): void;
/** 方案 B：停止所有 Telegram 实例（配置重载时调用） */
export declare function stopAllTelegramPolling(): void;
//# sourceMappingURL=telegram-ws.d.ts.map