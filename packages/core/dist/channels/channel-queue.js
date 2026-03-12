/**
 * 渠道事件队列：内存队列
 * 用于飞书媒体消息（语音/图片/文件）的异步处理，统一 HTTP deferred 与 WS 消息
 */
let memoryEnqueue = null;
/** 注册内存队列的入队回调（供 feishu-ws 使用） */
export function registerMemoryEnqueue(cb) {
    memoryEnqueue = cb;
}
/** 入队飞书事件（WS 或 HTTP deferred） */
export async function enqueueFeishuJob(payload) {
    if (memoryEnqueue) {
        memoryEnqueue(payload);
    }
    else {
        console.warn('[ChannelQueue] 内存队列未就绪，消息可能丢失');
    }
}
/** 内存队列由 feishu-ws 自行消费，此函数保留为空实现以兼容调用方 */
export function startChannelQueueWorker(_handler) {
    // no-op：内存队列在 feishu-ws 中通过 registerMemoryEnqueue 注册后由 processQueue 消费
}
//# sourceMappingURL=channel-queue.js.map