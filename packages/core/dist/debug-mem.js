/**
 * 内存调试日志（APEXPANDA_DEBUG_MEM=1 时输出）
 */
export function logMem(tag, extra) {
    if (process.env.APEXPANDA_DEBUG_MEM !== '1')
        return;
    const u = process.memoryUsage();
    const msg = [
        `[mem] ${tag}`,
        `heapUsed=${(u.heapUsed / 1024 / 1024).toFixed(1)}MB`,
        `heapTotal=${(u.heapTotal / 1024 / 1024).toFixed(1)}MB`,
        `rss=${(u.rss / 1024 / 1024).toFixed(1)}MB`,
    ];
    if (extra)
        msg.push(JSON.stringify(extra));
    console.log(msg.join(' '));
}
//# sourceMappingURL=debug-mem.js.map