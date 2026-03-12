/**
 * 从对话消息中提取记忆并写入 memory（Phase 6：带冲突检测与 tier 自动标注）
 * @param messages 对话消息（user/assistant）
 * @param scope 记忆 scope（user:xxx / group:xxx / sessionId）
 * @returns 写入的条目数
 */
export declare function extractAndWriteMemories(messages: Array<{
    role: string;
    content: string;
}>, scope: string): Promise<number>;
//# sourceMappingURL=extraction.d.ts.map