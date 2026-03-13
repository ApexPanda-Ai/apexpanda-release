/**
 * 渠道命令 LLM 兜底：正则全未命中时，由 LLM 识别用户意图并返回可分发的结果
 * 仅当消息以 / 开头且所有命令正则均未匹配时调用
 */
import { getLLMProvider } from '../agent/config.js';
const SUPPORTED_INTENTS = [
    'help',
    'create_workflow',
    'create_agent',
    'workflow_run',
    'discussion',
    'nodes',
    'chat',
];
const SYSTEM_PROMPT = `你是渠道命令意图识别助手。用户可能误输入了斜杠命令（如 /创建g、/工作流x、/创建智能体，xxx 等），需要你从原始消息中推断其真实意图。

支持意图及 params 字段：
- help: params.topic（可选，如"讨论"、"创建agent"）
- create_workflow: params.description（工作流描述）
- create_agent: params.description（Agent 描述）
- workflow_run: params.name（工作流名）, params.content（输入内容，可选）
- discussion: params.question（讨论问题）, params.rounds（轮数 1-10，可选，默认 3）
- nodes: params 空对象
- chat: params.message（原始消息，无法识别时使用）

规则：
1. 严格输出 JSON，格式 {"intent":"xxx","params":{...}}，无其他文字
2. 无法识别或明显是普通对话时，intent 为 chat
3. 意图模糊时优先选最可能的
4. params 中字符串做 trim，空值可省略

示例：
- "/创建g 数据分析" → {"intent":"create_agent","params":{"description":"数据分析"}}
- "/创建工作流，日报" → {"intent":"create_workflow","params":{"description":"日报"}}
- "/help，讨论" → {"intent":"help","params":{"topic":"讨论"}}
- "/工作流x 日报 今日进展" → {"intent":"workflow_run","params":{"name":"日报","content":"今日进展"}}
- "/nodes" → {"intent":"nodes","params":{}}
- "随便聊聊" → {"intent":"chat","params":{"message":"随便聊聊"}}`;
/**
 * 调用 LLM 解析用户消息的意图
 * @param rawMessage 原始用户消息
 * @returns 解析结果，失败或 intent=chat 时仍返回有效对象
 */
export async function routeCommandIntent(rawMessage) {
    const msg = rawMessage.trim();
    const provider = getLLMProvider();
    try {
        const result = await provider.complete([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: msg }], { temperature: 0.1, maxTokens: 256 });
        const content = result.content?.trim() ?? '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : content;
        const parsed = JSON.parse(jsonStr);
        const intent = String(parsed?.intent ?? 'chat').toLowerCase();
        const validIntent = SUPPORTED_INTENTS.includes(intent) ? intent : 'chat';
        const params = {};
        if (parsed?.params && typeof parsed.params === 'object') {
            for (const [k, v] of Object.entries(parsed.params)) {
                if (v != null && typeof v === 'string')
                    params[k] = v.trim();
            }
        }
        return { intent: validIntent, params };
    }
    catch (e) {
        console.error('[command-llm-router] parse error:', e);
        return { intent: 'chat', params: { message: msg } };
    }
}
//# sourceMappingURL=command-llm-router.js.map