/**
 * 用户自定义工作流模板存储
 * 存于 .apexpanda/workflow-templates.json，启动时与系统预设模板合并
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const CUSTOM_PREFIX = 'custom-';
function getDataDir() {
    return process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
}
function getCustomTemplatesPath() {
    return join(getDataDir(), 'workflow-templates.json');
}
let customTemplates = null;
async function loadCustomTemplates() {
    if (customTemplates !== null)
        return customTemplates;
    try {
        const raw = await readFile(getCustomTemplatesPath(), 'utf-8');
        const arr = JSON.parse(raw);
        customTemplates = Array.isArray(arr) ? arr : [];
    }
    catch {
        customTemplates = [];
    }
    return customTemplates;
}
async function saveCustomTemplates() {
    if (customTemplates === null)
        return;
    try {
        await mkdir(getDataDir(), { recursive: true });
        await writeFile(getCustomTemplatesPath(), JSON.stringify(customTemplates, null, 2));
    }
    catch (e) {
        console.error('[workflow] save custom templates error:', e);
    }
}
/** 校验模板名称：字母数字、中文、-、_、· 等 */
export function sanitizeTemplateName(name) {
    return name.replace(/[,，：:\/\\]/g, '').trim();
}
/** 校验模板 id：用于自定义模板，避免与系统模板冲突 */
export function sanitizeTemplateId(name) {
    const s = name
        .replace(/[,，：:\/\\\s]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .trim();
    return s || `custom-${Date.now()}`;
}
/** 获取所有自定义模板 */
export async function listCustomTemplates() {
    return loadCustomTemplates();
}
/** 保存为自定义模板，返回新模板；若 name 与已有模板重名则失败 */
export async function saveAsTemplate(input) {
    const name = sanitizeTemplateName(input.name);
    if (!name) {
        return { success: false, error: '模板名称不能为空' };
    }
    if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
        return { success: false, error: '至少需要一个节点' };
    }
    const customs = await loadCustomTemplates();
    const existingByName = customs.find((t) => t.name === name);
    if (existingByName) {
        return { success: false, error: `模板名称「${name}」已存在，请使用其他名称` };
    }
    const id = `${CUSTOM_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const template = {
        id,
        name,
        description: input.description.trim() || name,
        nodes: input.nodes,
        edges: input.edges ?? [],
        suggestedCommand: input.suggestedCommand?.trim() || undefined,
        suggestedCron: input.suggestedCron?.trim() || undefined,
    };
    customs.push(template);
    await saveCustomTemplates();
    return { success: true, template };
}
/** 是否为自定义模板 id（仅自定义模板可删改） */
export function isCustomTemplateId(id) {
    return id.startsWith(CUSTOM_PREFIX);
}
/** 删除自定义模板 */
export async function deleteCustomTemplate(id) {
    if (!isCustomTemplateId(id)) {
        return { success: false, error: '仅可删除自定义模板' };
    }
    const customs = await loadCustomTemplates();
    const idx = customs.findIndex((t) => t.id === id);
    if (idx < 0) {
        return { success: false, error: '模板不存在' };
    }
    customs.splice(idx, 1);
    customTemplates = customs;
    await saveCustomTemplates();
    return { success: true };
}
/** 更新自定义模板 */
export async function updateCustomTemplate(id, patch) {
    if (!isCustomTemplateId(id)) {
        return { success: false, error: '仅可更新自定义模板' };
    }
    const customs = await loadCustomTemplates();
    const t = customs.find((x) => x.id === id);
    if (!t) {
        return { success: false, error: '模板不存在' };
    }
    if (patch.name !== undefined) {
        const name = sanitizeTemplateName(patch.name);
        if (!name)
            return { success: false, error: '模板名称不能为空' };
        const existing = customs.find((x) => x.id !== id && x.name === name);
        if (existing)
            return { success: false, error: `模板名称「${name}」已存在` };
        t.name = name;
    }
    if (patch.description !== undefined)
        t.description = patch.description;
    if (patch.suggestedCommand !== undefined)
        t.suggestedCommand = patch.suggestedCommand?.trim() || undefined;
    if (patch.suggestedCron !== undefined)
        t.suggestedCron = patch.suggestedCron?.trim() || undefined;
    await saveCustomTemplates();
    return { success: true, template: t };
}
/** 合并系统 + 自定义模板，供 listWorkflowTemplates 使用 */
export function mergeTemplates(system, customs) {
    const seen = new Set();
    const result = [];
    for (const t of system) {
        if (!seen.has(t.id)) {
            seen.add(t.id);
            result.push(t);
        }
    }
    for (const t of customs) {
        if (!seen.has(t.id)) {
            seen.add(t.id);
            result.push(t);
        }
    }
    return result;
}
//# sourceMappingURL=custom-templates.js.map