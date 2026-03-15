import { type FeishuWsEvent } from './channel-queue.js';
type FeishuMessageEvent = FeishuWsEvent;
export declare function isDuplicateFeishuMessage(messageId: string): boolean;
/** 实际处理逻辑（耗时的 ASR/图片下载），供队列消费者调用
 * @param instanceId 方案 B：渠道实例 ID */
export declare function handleFeishuMessageSync(instanceId: string, event: FeishuMessageEvent): Promise<void>;
/** 方案 B：按 instanceId 启动飞书 WebSocket，使用该实例的凭证 */
export declare function startFeishuWebSocket(instanceId: string): void;
/** 方案 B：按 instanceId 停止指定实例 */
export declare function stopFeishuWebSocket(instanceId: string): void;
/** 方案 B：停止所有飞书实例（配置重载时调用） */
export declare function stopAllFeishuWebSockets(): void;
export {};
//# sourceMappingURL=feishu-ws.d.ts.map