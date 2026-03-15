/**
 * 消息队列：collect + debounce
 * 防止快速连发消息丢失，多任务共享上下文污染
 */
export interface QueueConfig {
    debounceMs: number;
    cap: number;
    dropStrategy: 'oldest' | 'summarize';
}
export declare class MessageQueue<T> {
    private queue;
    private timer;
    private config;
    private onFlush;
    constructor(onFlush: (batch: T[]) => void | Promise<void>, config?: Partial<QueueConfig>);
    /** 入队 */
    enqueue(payload: T): void;
    /** 立即 flush */
    flushNow(): Promise<void>;
}
//# sourceMappingURL=message-queue.d.ts.map