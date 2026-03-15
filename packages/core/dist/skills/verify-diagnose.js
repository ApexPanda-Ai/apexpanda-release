/**
 * Skill 验证与诊断
 */
import { loadAllSkills, invokeTool } from './registry.js';
import { loadConfig } from '../config/loader.js';
/** 诊断时跳过调用的 tool：高危（发请求等）或强依赖环境（需特定文件存在、易触碰系统目录） */
const DIAGNOSE_SKIP_TOOLS = new Set([
    'webhook-trigger#send',
    'email-smtp#send',
    'dingtalk-message#send',
    'wecom-message#send',
    'feishu-message#send',
    'dingtalk-todo#create',
    'feishu-approval#create',
    'jira#create',
    'wechat-mp-publish#publishDraft',
    'file-tools#unpackZip', // 需 archive.zip 存在，工作区无则报错
    'file-tools#packZip', // paths:["."] 在盘根等工作区易触碰 System Volume Information
]);
function isDiagnoseSkipTool(t, skillName) {
    if (typeof t === 'string')
        return DIAGNOSE_SKIP_TOOLS.has(`${skillName}#${t}`);
    const handler = t.handler;
    if (handler)
        return DIAGNOSE_SKIP_TOOLS.has(handler);
    return DIAGNOSE_SKIP_TOOLS.has(`${skillName}#${t.id}`);
}
export async function verifySkill(skillName) {
    const skills = await loadAllSkills();
    const skill = skills.find((s) => s.name === skillName);
    if (!skill)
        return { ok: false, error: 'skill_not_found' };
    const tools = skill.manifest.tools ?? [];
    if (tools.length === 0)
        return { ok: false, error: 'skill_has_no_tools' };
    let target;
    for (const t of tools) {
        if (!isDiagnoseSkipTool(t, skillName)) {
            target = t;
            break;
        }
    }
    if (!target)
        return { ok: false, error: 'skill 仅有诊断跳过的 tool，验证已跳过' };
    const toolId = typeof target === 'object' ? target.id : String(target);
    const defaultParams = (skill.manifest.defaultParams ?? {})[toolId];
    let params = {};
    try {
        if (defaultParams && typeof defaultParams === 'string') {
            params = JSON.parse(defaultParams);
        }
    }
    catch {
        /* use {} */
    }
    try {
        await invokeTool(skillName, toolId, params ?? {});
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
export async function diagnoseSkill(skillName) {
    const skills = await loadAllSkills();
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
        return { loadable: false, tools: [], error: 'skill_not_found' };
    }
    const tools = skill.manifest.tools ?? [];
    const hasEnvFields = (skill.manifest.envFields?.length ?? 0) > 0;
    let envConfigured = true;
    if (hasEnvFields) {
        const config = await loadConfig();
        const entry = config.skills?.entries?.[skillName];
        const env = entry?.env ?? {};
        envConfigured = Object.keys(env).length > 0;
    }
    const toolResults = [];
    for (const t of tools) {
        const toolId = typeof t === 'object' ? t.id : String(t);
        if (isDiagnoseSkipTool(t, skillName)) {
            toolResults.push({
                id: toolId,
                invokable: false,
                error: '已跳过（依赖外部环境或为高危 tool）',
            });
            continue;
        }
        const defaultParams = (skill.manifest.defaultParams ?? {})[toolId];
        let params = {};
        try {
            if (defaultParams && typeof defaultParams === 'string') {
                params = JSON.parse(defaultParams);
            }
        }
        catch {
            /* use {} */
        }
        try {
            await invokeTool(skillName, toolId, params ?? {});
            toolResults.push({ id: toolId, invokable: true });
        }
        catch (e) {
            toolResults.push({
                id: toolId,
                invokable: false,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return {
        loadable: true,
        envConfigured,
        tools: toolResults,
    };
}
//# sourceMappingURL=verify-diagnose.js.map