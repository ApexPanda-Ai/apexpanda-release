/**
 * 结束讨论提示语（消息包含任一词即视为结束指令）
 */
const DEFAULT_END_PHRASES = [
    '结束讨论',
    '讨论结束',
    '结束',
    '停止讨论',
    '停止',
    '可以了',
    '好了',
    '行了',
    '出结果吧',
    '给总结吧',
    '结束会议',
    '散会',
];
export function isEndPhrase(msg, phrases = DEFAULT_END_PHRASES) {
    const m = msg.trim().toLowerCase();
    return phrases.some((p) => m.includes(p.toLowerCase()));
}
//# sourceMappingURL=end-phrases.js.map