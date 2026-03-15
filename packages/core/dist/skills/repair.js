/**
 * Skill AI 修复建议
 * 支持 APEXPANDA_AI_SKILL_REPAIR_MAX_TOKENS 限制单次修复 token 用量（默认 4096，最大 8192）
 */
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import yaml from 'js-yaml';
const ALLOWED_EXT = new Set(['.yaml', '.yml', '.js', '.ts', '.py']);
function getRepairMaxTokens() {
    const v = process.env.APEXPANDA_AI_SKILL_REPAIR_MAX_TOKENS;
    if (!v)
        return 4096;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 512)
        return 512;
    return Math.min(n, 8192);
}
function getUserSkillsDir() {
    const env = process.env.APEXPANDA_USER_SKILLS_DIR;
    if (env)
        return resolve(env);
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'skills');
}
/** 获取 Skill 在用户目录的路径，不存在则返回 null */
function getUserSkillDir(skillName) {
    const userDir = getUserSkillsDir();
    const skillDir = join(userDir, skillName);
    if (!existsSync(skillDir))
        return null;
    return skillDir;
}
/** 校验 path 在 skillDir 内且扩展名允许 */
function isPathSafe(baseDir, filePath) {
    const abs = resolve(baseDir, filePath);
    if (!abs.startsWith(resolve(baseDir)))
        return false;
    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
    return ALLOWED_EXT.has(ext.toLowerCase());
}
/** 验证 YAML 语法 */
function validateYaml(content) {
    try {
        yaml.load(content);
        return true;
    }
    catch {
        return false;
    }
}
/** 简单校验 JS 语法（不执行，仅 .js） */
function validateJs(content) {
    try {
        new Function(content);
        return true;
    }
    catch {
        return false;
    }
}
/** 构建修复 Prompt，针对 YAML/JS 提供明确规范 */
function buildRepairPrompt(input, filePath, originalContent, isYaml) {
    const fileType = isYaml ? 'YAML' : 'JavaScript';
    const rules = isYaml
        ? `YAML 规范：
- 缩进必须使用空格，不能用 Tab
- 键值对格式为 key: value，冒号后需有空格
- 字符串含特殊字符时用引号包裹
- 数组项用 - 开头，与父键缩进对齐
- 嵌套对象正确缩进，子键比父键多 2 空格`
        : `JavaScript 规范：
- 确保括号、花括号成对闭合
- 字符串引号成对
- 避免未定义的变量或拼写错误
- CommonJS/ESM 导出语法正确`;
    return `你是 Skill 文件修复助手。仅输出修正后的完整文件，不要解释、不要用 \`\`\` 包裹。

## 错误信息
类型: ${input.errorType ?? 'unknown'}
详情: ${input.errorMessage}

## 需要修复的文件
路径: ${filePath}

## ${fileType} 规范（请严格遵守）
${rules}

## 原文件内容
\`\`\`
${originalContent}
\`\`\`

请直接输出修正后的完整文件内容，第一行即为文件首行，无前缀无后缀。`;
}
export async function suggestRepair(skillName, input) {
    if (process.env.APEXPANDA_AI_SKILL_REPAIR_ENABLED === 'false') {
        return { error: 'AI 修复功能已禁用' };
    }
    const skillDir = getUserSkillDir(skillName);
    if (!skillDir)
        return { error: '只能修复用户目录下的 Skill，该 Skill 未在用户目录' };
    const filePath = input.filePath ?? 'APEX_SKILL.yaml';
    if (!isPathSafe(skillDir, filePath))
        return { error: '文件路径非法或类型不允许' };
    const absPath = resolve(skillDir, filePath);
    let originalContent;
    try {
        originalContent = await readFile(absPath, 'utf-8');
    }
    catch {
        return { error: '读取文件失败' };
    }
    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
    const isYaml = ['.yaml', '.yml'].includes(ext.toLowerCase());
    const prompt = buildRepairPrompt(input, filePath, originalContent, isYaml);
    try {
        const { getLLMProvider } = await import('../agent/config.js');
        const provider = getLLMProvider();
        const result = await provider.complete([{ role: 'user', content: prompt }], { temperature: 0.2, maxTokens: getRepairMaxTokens() });
        const suggested = (result.content ?? '').trim();
        if (!suggested)
            return { error: 'AI 未能生成有效修复' };
        let valid = false;
        if (isYaml) {
            valid = validateYaml(suggested);
        }
        else if (ext === '.js') {
            valid = validateJs(suggested);
        }
        else {
            valid = true;
        }
        if (!valid)
            return { error: 'AI 生成的修复内容未通过语法校验' };
        const diff = originalContent !== suggested
            ? `--- 原文件\n+++ 修复后\n${suggested}`
            : undefined;
        return { suggestedContent: suggested, diff };
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : 'LLM 调用失败' };
    }
}
/** 应用修复：将内容写入 Skill 目录下的指定文件 */
export async function applyRepair(skillName, filePath, content) {
    const skillDir = getUserSkillDir(skillName);
    if (!skillDir)
        return { ok: false, error: 'Skill 不在用户目录' };
    if (!isPathSafe(skillDir, filePath))
        return { ok: false, error: '文件路径非法或类型不允许' };
    const absPath = resolve(skillDir, filePath);
    try {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(absPath, content, 'utf-8');
        const { invalidateSkillsCache } = await import('./registry.js');
        invalidateSkillsCache();
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '写入失败' };
    }
}
//# sourceMappingURL=repair.js.map