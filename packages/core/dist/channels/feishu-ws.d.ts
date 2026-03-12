import { type FeishuWsEvent } from './channel-queue.js';
type FeishuMessageEvent = FeishuWsEvent;
export declare function isDuplicateFeishuMessage(messageId: string): boolean;
/** 实际处理逻辑（耗时的 ASR/图片下载），供队列消费者调用 */
export declare function handleFeishuMessageSync(event: FeishuMessageEvent): Promise<void>;
export declare function startFeishuWebSocket(): void;
export declare function stopFeishuWebSocket(): void;
export {};
//# sourceMappingURL=feishu-ws.d.ts.map