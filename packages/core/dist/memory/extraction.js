/**
 * Phase 4 + Phase 6: 从对话中提取关键信息写入长期记忆
 * Phase 6 新增：注入现有记忆、LLM 冲突检测（ADD/UPDATE/SKIP）、tier 自动标注
 */
import { getLLMProvider } from '../agent/config.js';
import { selectModel } from '../agent/model-router.js';
import { invokeToolByName } from '../skills/registry.js';
import { getMemoriesForScope } from '../skills/executor.js';
const MAX_EXTRACT = 6;
const MAX_EXISTING_CONTEXT = 30;
function buildPrompt(existing) {
    const existingBlock = existing.length === 0
        ? '（暂无）'
        : existing
            .slice(0, MAX_EXISTING_CONTEXT)
            .map((m) => `[id=${m.id}]${m.key ? ` ${m.key}` : ''}: ${m.content.slice(0, 120)}`)
            .join('\n');
    return `你是记忆提取助手。请分析对话内容，决定哪些信息值得写入长期记忆。

## 已有记忆
${existingBlock}

## 输出格式（每行一个操作，最多 ${MAX_EXTRACT} 行）
- 新增持久事实：add|fact|key|内容
- 新增短期日志：add|log|key|内容（key 可为空：add|log||内容）
- 更新已有记忆：update|fact|<已有记忆id>|新内容
- 无内容可提取：输出一行 none

## 规则
1. 用户特征、持久偏好、重要约定用 fact；今日动态、临时事件用 log
2. 闲聊、礼貌语、临时操作指令不提取
3. 与已有记忆高度重复的跳过（不输出）
4. 与已有记忆存在矛盾或需要更新时，使用 update 操作
5. key 要简短（≤10 字），如「姓名」「咖啡偏好」「所在城市」
6. 内容要完整具体，不超过 100 字`;
}
function parseOps(text) {
    const ops = [];
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        if (line === 'none' || line.toLowerCase() === '无')
            continue;
        const parts = line.split('|');
        if (parts.length < 3)
            continue;
        const action = parts[0]?.trim();
        const tier = parts[1]?.trim() === 'log' ? 'log' : 'fact';
        if (action === 'add') {
            const key = parts[2]?.trim() || undefined;
            const content = parts.slice(3).join('|').trim();
            if (content.length > 1)
                ops.push({ action: 'add', key, content, tier });
        }
        else if (action === 'update') {
            const id = parts[2]?.trim();
            const content = parts.slice(3).join('|').trim();
            if (id && content.length > 1)
                ops.push({ action: 'update', id, content, tier });
        }
        if (ops.length >= MAX_EXTRACT)
            break;
    }
    return ops;
}
/**
 * 从对话消息中提取记忆并写入 memory（Phase 6：带冲突检测与 tier 自动标注）
 * @param messages 对话消息（user/assistant）
 * @param scope 记忆 scope（user:xxx / group:xxx / sessionId）
 * @returns 写入的条目数
 */
export async function extractAndWriteMemories(messages, scope) {
    if (messages.length === 0)
        return 0;
    const dialogueText = messages
        .map((m) => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role}: ${m.content}`)
        .join('\n');
    if (dialogueText.length < 10)
        return 0;
    // Phase 6: 读取现有记忆供 LLM 做冲突检测
    const existing = await getMemoriesForScope(scope).catch(() => []);
    const model = selectModel(undefined, {
        messageLength: dialogueText.length,
        historyLength: 0,
        hasRagContext: false,
        hasTools: false,
    });
    const llm = getLLMProvider(model);
    const result = await llm.complete([
        { role: 'system', content: buildPrompt(existing) },
        { role: 'user', content: `对话内容：\n${dialogueText}` },
    ], { model, temperature: 0.2 });
    const ops = parseOps(result.content);
    let written = 0;
    for (const op of ops) {
        try {
            if (op.action === 'add') {
                await invokeToolByName('memory#write', { key: op.key, content: op.content, tier: op.tier, scope }, { sessionId: scope });
                written++;
            }
            else if (op.action === 'update') {
                // 找到原条目以保留其 key
                const originalEntry = existing.find((e) => e.id === op.id);
                // 先删除旧条目
                await invokeToolByName('memory#delete', { id: op.id, scope }, { sessionId: scope });
                // 再写入新内容（保留原 key）
                await invokeToolByName('memory#write', { key: originalEntry?.key ?? op.key, content: op.content, tier: op.tier, scope }, { sessionId: scope });
                written++;
            }
        }
        catch {
            // 单条失败不中断，继续写入其他
        }
    }
    return written;
}
//# sourceMappingURL=extraction.js.map