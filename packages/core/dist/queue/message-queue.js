function getDefaultConfig() {
    return {
        debounceMs: Number(process.env.APEXPANDA_QUEUE_DEBOUNCE_MS) || 1000,
        cap: Math.min(100, Math.max(5, Number(process.env.APEXPANDA_QUEUE_CAP) || 20)),
        dropStrategy: process.env.APEXPANDA_QUEUE_DROP_STRATEGY || 'summarize',
    };
}
const DEFAULT_CONFIG = getDefaultConfig();
export class MessageQueue {
    queue = [];
    timer = null;
    config;
    onFlush;
    constructor(onFlush, config = {}) {
        this.onFlush = onFlush;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** 入队 */
    enqueue(payload) {
        const now = Date.now();
        this.queue.push({ payload, enqueuedAt: now });
        if (this.queue.length >= this.config.cap) {
            this.flushNow();
            return;
        }
        if (!this.timer) {
            this.timer = setTimeout(() => this.flushNow(), this.config.debounceMs);
        }
    }
    /** 立即 flush */
    async flushNow() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const batch = this.queue.splice(0, this.config.cap);
        if (batch.length === 0)
            return;
        const payloads = batch.map((m) => m.payload);
        await this.onFlush(payloads);
    }
}
//# sourceMappingURL=message-queue.js.map