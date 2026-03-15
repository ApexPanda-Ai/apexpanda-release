/**
 * 工作流 Verify 节点执行逻辑（阶段三：验证层）
 * 支持 LLM / rule / skill 三种校验器
 */
import { getLLMProvider } from '../agent/config.js';
import { recordUsage } from '../usage/store.js';
import { invokeTool } from '../skills/registry.js';
/** Verify 失败时抛出的错误，携带 issues 供上层使用 */
export class VerifyFailedError extends Error {
    issues;
    constructor(message, issues = []) {
        super(message);
        this.issues = issues;
        this.name = 'VerifyFailedError';
    }
}
/**
 * 执行 Verify 节点校验
 * @param prev 前序节点输出（字符串或对象）
 * @param config 节点配置
 * @returns 通过时返回 prev，失败时抛出 VerifyFailedError
 */
export async function executeVerify(prev, config) {
    const content = typeof prev === 'string' ? prev : JSON.stringify(prev ?? '');
    const checkpoint = (config.checkpoint ?? '').trim() || '产出需完整、无逻辑矛盾';
    if (config.validator === 'rule') {
        const pass = runRuleValidator(content, config);
        if (!pass) {
            const issues = ['规则校验未通过'];
            if (config.keywords?.length)
                issues.push(`需包含任一关键词：${config.keywords.join('、')}`);
            if (config.regex)
                issues.push(`需匹配正则：${config.regex}`);
            throw new VerifyFailedError('校验未通过', issues);
        }
        return prev;
    }
    if (config.validator === 'skill') {
        const { skillName, toolId, params: rawParams } = config;
        if (!skillName || !toolId)
            throw new Error('verify validator=skill 时需配置 skillName 和 toolId');
        const params = { ...(rawParams ?? {}), input: content, checkpoint };
        const result = await invokeTool(skillName, toolId, params, { deleteSource: 'agent' });
        const vr = normalizeVerifyResult(result);
        if (!vr.pass)
            throw new VerifyFailedError('Skill 校验未通过', vr.issues ?? []);
        return prev;
    }
    // 默认 LLM 校验
    const vr = await runLLMValidator(content, checkpoint);
    if (!vr.pass)
        throw new VerifyFailedError('LLM 校验未通过', vr.issues ?? []);
    return prev;
}
function runRuleValidator(content, config) {
    if (Array.isArray(config.keywords) && config.keywords.length > 0) {
        return config.keywords.some((k) => content.includes(String(k)));
    }
    if (typeof config.regex === 'string' && config.regex) {
        try {
            return new RegExp(config.regex).test(content);
        }
        catch {
            return false;
        }
    }
    // 无有效规则时默认通过
    return true;
}
async function runLLMValidator(content, checkpoint) {
    const provider = getLLMProvider();
    const prompt = `请对以下产出进行校验。

校验规则：${checkpoint}

产出内容：
---
${content.slice(0, 8000)}
---

必须返回 JSON，且只包含以下结构（无其他文字）：
{"pass": true 或 false, "issues": ["问题1", "问题2"]}
通过时 pass 为 true，issues 可为空数组；不通过时 pass 为 false，issues 列出具体问题。`;
    const result = await provider.complete([{ role: 'user', content: prompt }], { temperature: 0.1, maxTokens: 500 });
    if (result.usage) {
        recordUsage(result.usage.promptTokens, result.usage.completionTokens);
    }
    const text = result.content?.trim() ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
        return { pass: true, issues: [] }; // 解析失败时保守通过
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return normalizeVerifyResult(parsed);
    }
    catch {
        return { pass: true, issues: [] };
    }
}
function normalizeVerifyResult(raw) {
    if (raw && typeof raw === 'object' && 'pass' in raw) {
        const pass = Boolean(raw.pass);
        const issues = Array.isArray(raw.issues)
            ? (raw.issues ?? []).filter((x) => typeof x === 'string')
            : [];
        return { pass, issues };
    }
    return { pass: true, issues: [] };
}
//# sourceMappingURL=verify-node.js.map