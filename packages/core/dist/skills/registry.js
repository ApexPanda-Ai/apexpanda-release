/**
 * Skill 注册表
 * 加载内置 + 用户 Skills，提供查询与调用
 */
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadSkillsFromDir } from './loader.js';
import { executeTool } from './executor.js';
import { getAvailableNodeCapabilities, executeNodeTool, executeBatchNodeTool } from '../node/invoke.js';
import { listOnlineNodes } from '../node/store.js';
import { NODE_INVOKE_TOOLS, NODE_INVOKE_PARAMETERS, NODE_LIST_PARAMETERS } from './node-tools.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
let cached = null;
/** 获取内置 Skills 目录 */
function getBuiltinSkillsDir() {
    const env = process.env.APEXPANDA_SKILLS_DIR;
    if (env)
        return env;
    return join(__dirname, '../../../skills/builtin');
}
/** 获取用户/托管 Skills 目录（.apexpanda/skills，OpenClaw managed 等效） */
function getUserSkillsDir() {
    const env = process.env.APEXPANDA_USER_SKILLS_DIR;
    if (env)
        return env;
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'skills');
}
/** 获取工作区 Skills 目录（workspace/skills，最高优先级，OpenClaw /skills 等效） */
function getWorkspaceSkillsDir() {
    const env = process.env.APEXPANDA_WORKSPACE_SKILLS_DIR;
    if (env)
        return env;
    const workspace = process.env.APEXPANDA_WORKSPACE ?? '.apexpanda/workspace';
    const base = workspace.startsWith('/') || /^[A-Za-z]:[\\/]/.test(workspace) ? workspace : join(process.cwd(), workspace);
    return join(base, 'skills');
}
/** 获取额外 Skills 目录（extraDirs，OpenClaw 兼容，优先级低于 workspace） */
function getExtraSkillsDirs() {
    const env = process.env.APEXPANDA_SKILLS_EXTRA_DIRS;
    if (!env)
        return [];
    return env.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
}
/** 加载所有可用 Skills（优先级：workspace > extraDirs > managed > bundled，高优先级覆盖低） */
export async function loadAllSkills() {
    if (cached)
        return cached;
    const byName = new Map();
    const loadDir = async (dir, source) => {
        try {
            const { stat } = await import('node:fs/promises');
            const st = await stat(dir);
            if (st.isDirectory()) {
                for (const s of await loadSkillsFromDir(dir)) {
                    byName.set(s.name, { ...s, path: s.path, source });
                }
            }
        }
        catch {
            /* dir not exists or not accessible */
        }
    };
    // 1. bundled（最低）
    await loadDir(getBuiltinSkillsDir(), 'builtin');
    // 2. managed（.apexpanda/skills）
    await loadDir(getUserSkillsDir(), 'managed');
    // 3. extraDirs
    for (const dir of getExtraSkillsDirs()) {
        await loadDir(dir, 'extra');
    }
    // 4. workspace（最高）
    await loadDir(getWorkspaceSkillsDir(), 'workspace');
    cached = Array.from(byName.values());
    return cached;
}
/** 清除缓存，下次 loadAllSkills 会重新加载 */
export function invalidateSkillsCache() {
    cached = null;
}
/** 技能热重载：监听目录变化，自动清除缓存（APEXPANDA_SKILLS_WATCH=true 时启用） */
export function startSkillsWatch() {
    if (process.env.APEXPANDA_SKILLS_WATCH !== 'true')
        return;
    const debounceMs = Number(process.env.APEXPANDA_SKILLS_WATCH_DEBOUNCE_MS) || 250;
    let debounceTimer = null;
    const scheduleInvalidate = () => {
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            invalidateSkillsCache();
        }, debounceMs);
    };
    const dirs = [
        getBuiltinSkillsDir(),
        getUserSkillsDir(),
        getWorkspaceSkillsDir(),
        ...getExtraSkillsDirs(),
    ];
    for (const dir of dirs) {
        if (!existsSync(dir))
            continue;
        try {
            watch(dir, { recursive: true }, () => scheduleInvalidate());
        }
        catch {
            /* ignore watch errors */
        }
    }
}
/** 按 name 查找 Skill */
export async function findSkill(name) {
    const skills = await loadAllSkills();
    return skills.find((s) => s.name === name) ?? null;
}
/** 执行工具 */
export async function invokeTool(skillName, toolId, params, execContext) {
    if (skillName === 'node-invoke') {
        if (toolId === 'batchSysRun')
            return executeBatchNodeTool(params, execContext);
        return executeNodeTool(toolId, params, execContext);
    }
    if (skillName === 'node-list' && toolId === 'list') {
        const nodes = listOnlineNodes();
        if (nodes.length === 0) {
            return { count: 0, nodes: [], summary: '暂无在线节点。' };
        }
        return {
            count: nodes.length,
            nodes: nodes.map((n) => ({
                nodeId: n.nodeId,
                displayName: n.displayName,
                platform: n.platform,
                capabilities: n.capabilities,
                connectedAt: n.connectedAt,
            })),
            summary: `共 ${nodes.length} 个在线节点：${nodes.map((n) => n.displayName).join('、')}`,
        };
    }
    const skill = await findSkill(skillName);
    if (!skill)
        throw new Error(`Skill not found: ${skillName}`);
    return executeTool(skill, toolId, params, execContext);
}
const LLM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
/** OpenAI 要求 tool name 仅含 [a-zA-Z0-9_-]，将非法字符替换为 _ */
function sanitizeToolNameForLLM(name) {
    if (LLM_TOOL_NAME_PATTERN.test(name))
        return name;
    return name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tool';
}
/** 供 invokeToolByName 解析：sanitized name -> original name */
let toolNameMapForInvocation = new Map();
/** 获取供 invoke 使用的原始工具名（LLM 返回的是 sanitized name 时需解析） */
export function resolveToolNameForInvocation(nameFromLLM) {
    return toolNameMapForInvocation.get(nameFromLLM) ?? nameFromLLM;
}
const OPENAI_TOOL_NAME_MAX_LEN = 64;
/** 为 getToolsForLLM 确保唯一名，避免 sanitize 后重名 */
function ensureUniqueToolName(base, used) {
    let name = base;
    for (let i = 2; used.has(name); i++)
        name = `${base}_${i}`;
    used.add(name);
    return name;
}
/** 截断至 OpenAI 限制的 64 字符，并维护唯一性 */
function truncateToolNameForOpenAI(name, used) {
    if (name.length <= OPENAI_TOOL_NAME_MAX_LEN)
        return name;
    let candidate = name.slice(0, OPENAI_TOOL_NAME_MAX_LEN);
    let suffix = 0;
    while (used.has(candidate)) {
        suffix++;
        const suf = `_${suffix}`;
        candidate = name.slice(0, OPENAI_TOOL_NAME_MAX_LEN - suf.length) + suf;
    }
    used.add(candidate);
    return candidate;
}
/** 获取供 LLM function calling 使用的工具列表 */
export async function getToolsForLLM(options) {
    toolNameMapForInvocation = new Map();
    const usedNames = new Set();
    let skills = await loadAllSkills();
    const allowedSkillIds = options?.skillIds;
    if (allowedSkillIds !== undefined && allowedSkillIds !== null) {
        const idSet = new Set(allowedSkillIds);
        skills = skills.filter((s) => idSet.has(s.name));
    }
    const tools = [];
    for (const skill of skills) {
        for (const t of skill.manifest.tools ?? []) {
            const name = `${skill.name}_${t.id}`;
            let nameForLLM = sanitizeToolNameForLLM(name);
            nameForLLM = ensureUniqueToolName(nameForLLM, usedNames);
            nameForLLM = truncateToolNameForOpenAI(nameForLLM, usedNames);
            if (nameForLLM !== name)
                toolNameMapForInvocation.set(nameForLLM, name);
            // 优先使用 YAML 中的 parameters；openclaw-legacy handler 使用通用 schema 兜底
            let params = t.parameters && typeof t.parameters === 'object' ? t.parameters : undefined;
            if (!params && t.handler?.startsWith('openclaw-legacy#')) {
                params = { type: 'object', properties: { command: { type: 'string', description: 'Raw args passed to the skill script, e.g. URL or query string' } }, required: [] };
            }
            params ??= { type: 'object', properties: {}, required: [] };
            tools.push({
                type: 'function',
                function: {
                    name: nameForLLM,
                    description: t.description ?? `Call ${skill.name} ${t.id}`,
                    parameters: params,
                },
            });
        }
    }
    const nodeEnabled = options?.nodeToolsEnabled !== false; // 默认 true
    if (nodeEnabled) {
        const nodeCaps = getAvailableNodeCapabilities();
        for (const { toolId, capability, description } of NODE_INVOKE_TOOLS) {
            if (!nodeCaps.has(capability))
                continue;
            usedNames.add(`node-invoke_${toolId}`);
            tools.push({
                type: 'function',
                function: {
                    name: `node-invoke_${toolId}`,
                    description,
                    parameters: NODE_INVOKE_PARAMETERS[toolId] ?? { type: 'object', properties: {}, required: [] },
                },
            });
        }
        usedNames.add('node-list_list');
        tools.push({
            type: 'function',
            function: {
                name: 'node-list_list',
                description: '列出当前在线的设备节点（Headless/桌面/移动端）。用户问「有哪些节点」「在线节点」「查看节点」时调用',
                parameters: NODE_LIST_PARAMETERS,
            },
        });
    }
    try {
        const { getMcpTools } = await import('../mcp/client.js');
        const mcpGroups = await getMcpTools();
        const allowedMcpIds = options?.mcpServerIds;
        for (const { serverId, tools: mcpTools } of mcpGroups) {
            if (Array.isArray(allowedMcpIds) && !allowedMcpIds.includes(serverId))
                continue;
            for (const t of mcpTools) {
                const name = `mcp_${serverId}_${t.name}`;
                let nameForLLM = sanitizeToolNameForLLM(name);
                nameForLLM = ensureUniqueToolName(nameForLLM, usedNames);
                nameForLLM = truncateToolNameForOpenAI(nameForLLM, usedNames);
                if (nameForLLM !== name)
                    toolNameMapForInvocation.set(nameForLLM, name);
                const schema = t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : {};
                const params = {
                    type: schema.type ?? 'object',
                    properties: schema.properties ?? {},
                    required: schema.required ?? [],
                };
                tools.push({
                    type: 'function',
                    function: {
                        name: nameForLLM,
                        description: t.description ?? `MCP tool ${t.name}`,
                        parameters: params,
                    },
                });
            }
        }
    }
    catch (e) {
        console.warn('[Registry] MCP tools load failed:', e instanceof Error ? e.message : e);
    }
    return tools;
}
/** 按 LLM 返回的 function name 解析并调用（仅按第一个 _ 分割，因 toolId 可能含 _ 如 write_file） */
export async function invokeToolByName(name, args, execContext) {
    if (name.startsWith('mcp_')) {
        const { invokeMcpTool } = await import('../mcp/client.js');
        return invokeMcpTool(name, args);
    }
    const idx = name.indexOf('_');
    if (idx <= 0 || idx === name.length - 1)
        throw new Error(`Invalid tool name: ${name}`);
    const skillName = name.slice(0, idx);
    const toolId = name.slice(idx + 1);
    const result = await invokeTool(skillName, toolId, args, execContext);
    return JSON.stringify(result);
}
//# sourceMappingURL=registry.js.map