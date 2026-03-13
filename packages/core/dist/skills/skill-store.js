/**
 * 过程记忆（Procedural Memory）技能库
 * 结构化存储 .agent-scripts 相关技能：脚本路径、触发词、信任度、成功率等
 */
import { join, dirname, resolve } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { getWorkspaceDir } from '../config/loader.js';
const TRUST_UPGRADE_USE_COUNT = 3;
const TRUST_UPGRADE_SUCCESS_RATE = 0.7;
const SUSPEND_CONSECUTIVE_FAILURES = 3;
const SUSPEND_SUCCESS_RATE = 0.4;
const ARCHIVE_DAYS = 90;
const TRUST_WEIGHTS = {
    trusted: 1,
    testing: 0.7,
    unverified: 0.4,
    suspended: 0,
    archived: 0.2,
};
function getDataDir() {
    return process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
}
function getSkillsPath() {
    return join(getDataDir(), 'skills.json');
}
let skillsCache = null;
async function loadSkills() {
    if (skillsCache)
        return skillsCache;
    try {
        const path = getSkillsPath();
        const raw = await readFile(path, 'utf-8');
        const data = JSON.parse(raw);
        const arr = Array.isArray(data)
            ? data
            : (typeof data === 'object' && data !== null && Array.isArray(data.skills))
                ? data.skills
                : [];
        let filtered = arr.filter((s) => s != null && typeof s.id === 'string');
        const pruned = await pruneSkillsWithMissingScripts(filtered);
        if (pruned.length < filtered.length) {
            filtered = pruned;
            await persistSkills(filtered);
        }
        skillsCache = filtered;
        return filtered;
    }
    catch {
        skillsCache = [];
        return [];
    }
}
/** 移除脚本文件已不存在的技能；同时移除目录路径技能（路径规范化后不再支持）
 *  安全前提：ws 必须是有效的绝对路径，否则跳过清理（防止启动时路径未初始化误删）
 */
async function pruneSkillsWithMissingScripts(skills) {
    const ws = getWorkspaceDir();
    if (!ws || ws === '.' || ws === '.apexpanda/workspace')
        return skills;
    const kept = [];
    for (const s of skills) {
        if (!isScriptFilePath(s.scriptPath)) {
            console.log(`[ProceduralSkill] 移除目录路径技能「${s.name}」: ${s.scriptPath}`);
            continue;
        }
        try {
            const fp = resolve(ws, s.scriptPath);
            await access(fp);
            kept.push(s);
        }
        catch {
            console.log(`[ProceduralSkill] 脚本文件已不存在，移除技能「${s.name}」: ${s.scriptPath}`);
        }
    }
    return kept;
}
async function persistSkills(skills) {
    const path = getSkillsPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ skills, updatedAt: Date.now() }, null, 2), 'utf-8');
    skillsCache = skills;
}
/** 生成技能 ID（基于脚本路径） */
function skillIdFromPath(scriptPath) {
    return scriptPath
        .replace(/^\.agent-scripts[\\/]/, '')
        .replace(/[\\/]/g, '-')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'skill-' + Date.now().toString(36);
}
/** 根据扩展名推断脚本类型 */
function inferScriptType(scriptPath) {
    const ext = scriptPath.slice(scriptPath.lastIndexOf('.')).toLowerCase();
    if (ext === '.py')
        return 'python';
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs')
        return 'javascript';
    if (ext === '.sh' || ext === '.ps1' || ext === '.bat' || ext === '.cmd')
        return 'shell';
    return 'other';
}
/** 从脚本同目录的 requirements.txt 提取依赖（Python） */
async function extractDependenciesFromScriptDir(scriptPath) {
    try {
        const ws = getWorkspaceDir();
        const scriptDir = dirname(scriptPath);
        const reqPath = resolve(ws, scriptDir, 'requirements.txt');
        const raw = await readFile(reqPath, 'utf-8');
        return raw
            .split(/\r?\n/)
            .map((l) => l.replace(/#.*$/, '').trim())
            .filter((l) => l.length > 0 && !l.startsWith('-'));
    }
    catch {
        return [];
    }
}
const SCRIPT_EXTENSIONS = /\.(py|js|mjs|cjs|ts|sh|ps1|bat|cmd)$/i;
/** 路径规范化：统一正斜杠、去除末尾斜杠 */
function normalizePath(p) {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').trim();
}
/** 判定路径是否为脚本文件（非目录），目录或无扩展名不参与沉淀 */
export function isScriptFilePath(path) {
    const n = normalizePath(path);
    return SCRIPT_EXTENSIONS.test(n);
}
/** 判定路径是否属于 .agent-scripts */
export function isAgentScriptPath(path) {
    const n = path.replace(/\\/g, '/').toLowerCase();
    return n.includes('.agent-scripts/');
}
/** 从 shell-exec 的 command 中尝试提取 .agent-scripts 脚本路径（仅脚本文件，目录不参与） */
export function extractScriptPathFromShellCommand(command) {
    if (!command || typeof command !== 'string')
        return null;
    const m = command.match(/(?:python|python3|node|bash|sh)\s+["']?([^"'\s]+\.agent-scripts[^"'\s]*(?:\.[a-z]+)?)["']?/i)
        || command.match(/["']?([^"'\s]*\.agent-scripts[^"'\s]+(?:\.[a-z]+)?)["']?/);
    let p = null;
    if (m)
        p = m[1].replace(/\\/g, '/').trim();
    else {
        const rel = command.match(/\.agent-scripts[\\\/][^\s"'&|;]+/);
        p = rel ? rel[0].replace(/\\/g, '/') : null;
    }
    if (!p || !isAgentScriptPath(p))
        return null;
    return isScriptFilePath(p) ? p : null;
}
/** 从工具调用结果中解析脚本路径与 exitCode */
export function parseScriptExecutionResult(toolName, args, toolResult) {
    let scriptPath = null;
    if (toolName.includes('code-runner') && toolName.includes('runPythonFile')) {
        const p = args.path ?? args.filePath;
        scriptPath = typeof p === 'string' ? p.trim() : null;
    }
    else if (toolName.includes('code-runner') && (toolName.includes('runJs') || toolName.includes('runJsFile'))) {
        const p = args.path ?? args.filePath;
        scriptPath = typeof p === 'string' ? p.trim() : null;
    }
    else if (toolName.includes('shell-exec')) {
        const cmd = typeof args.command === 'string' ? args.command : '';
        scriptPath = extractScriptPathFromShellCommand(cmd);
    }
    if (!scriptPath || !isAgentScriptPath(scriptPath) || !isScriptFilePath(scriptPath))
        return null;
    let exitCode = -1;
    let stdout;
    try {
        const parsed = JSON.parse(toolResult);
        if (typeof parsed.exitCode === 'number')
            exitCode = parsed.exitCode;
        if (typeof parsed.stdout === 'string')
            stdout = parsed.stdout;
    }
    catch {
        /* ignore */
    }
    return { scriptPath, exitCode, stdout };
}
/** 获取脚本所在目录（用于去重：目录路径 vs 该目录下脚本路径） */
function getScriptDir(scriptPath) {
    const n = normalizePath(scriptPath);
    const idx = n.lastIndexOf('/');
    return idx > 0 ? n.slice(0, idx) : n;
}
/** 判定路径是否为目录（无脚本扩展名） */
function isDirectoryPath(path) {
    return !isScriptFilePath(path);
}
/** 添加新技能（双重校验通过后调用）。目录路径不参与沉淀，返回 null */
export async function addSkill(opts) {
    const scriptPath = normalizePath(opts.scriptPath);
    if (!isScriptFilePath(scriptPath))
        return null;
    const skills = await loadSkills();
    const id = skillIdFromPath(scriptPath);
    let existing = skills.find((s) => s.id === id || normalizePath(s.scriptPath) === scriptPath);
    if (!existing) {
        existing = skills.find((s) => {
            const sp = normalizePath(s.scriptPath);
            if (!isDirectoryPath(sp))
                return false;
            const dir = getScriptDir(scriptPath);
            return sp === dir || dir.startsWith(sp + '/');
        });
        if (existing) {
            existing.scriptPath = scriptPath;
            existing.id = skillIdFromPath(scriptPath);
        }
    }
    if (existing) {
        existing.name = opts.name ?? existing.name;
        existing.triggerPhrases = opts.triggerPhrases ?? existing.triggerPhrases;
        existing.description = opts.description;
        if (opts.successCondition != null)
            existing.successCondition = opts.successCondition;
        if (opts.dependencies != null)
            existing.dependencies = opts.dependencies;
        if (opts.tags != null)
            existing.tags = opts.tags;
        await persistSkills(skills);
        return existing;
    }
    const now = Date.now();
    const platform = opts.platform ?? (process.platform === 'win32' ? 'windows' : process.platform);
    const scriptType = opts.scriptType ?? inferScriptType(scriptPath);
    const deps = opts.dependencies ?? (scriptType === 'python' ? await extractDependenciesFromScriptDir(scriptPath) : []);
    const skill = {
        id,
        name: opts.name ?? id,
        triggerPhrases: opts.triggerPhrases ?? [],
        scriptPath,
        scriptType,
        description: opts.description,
        successCondition: opts.successCondition,
        dependencies: deps,
        platform,
        envSnapshot: opts.envSnapshot ?? {
            os: process.platform === 'win32' ? 'Windows' : process.platform,
        },
        trustLevel: 'unverified',
        createdAt: now,
        lastUsedAt: now,
        useCount: 0,
        successCount: 0,
        successRate: 0,
        consecutiveFailures: 0,
        archived: false,
        tags: opts.tags ?? [],
    };
    skills.push(skill);
    await persistSkills(skills);
    return skill;
}
/** 更新技能执行结果（成功/失败） */
export async function recordSkillExecution(scriptPath, success) {
    const skills = await loadSkills();
    const np = normalizePath(scriptPath);
    const skill = skills.find((s) => {
        const sp = normalizePath(s.scriptPath);
        return sp === np || sp.endsWith(np) || np.endsWith(sp);
    }) ?? skills.find((s) => np.includes(normalizePath(s.scriptPath)));
    if (!skill)
        return null;
    const now = Date.now();
    skill.useCount += 1;
    skill.lastUsedAt = now;
    if (success) {
        skill.successCount += 1;
        skill.consecutiveFailures = 0;
    }
    else {
        skill.consecutiveFailures += 1;
    }
    skill.successRate = skill.useCount > 0 ? skill.successCount / skill.useCount : 0;
    // 信任分级：连续失败/低成功率 优先于 升级为 trusted（防止高历史成功率掩盖近期连续失败）
    if (skill.consecutiveFailures >= SUSPEND_CONSECUTIVE_FAILURES || (skill.useCount >= 3 && skill.successRate < SUSPEND_SUCCESS_RATE)) {
        skill.trustLevel = 'suspended';
    }
    else if (skill.successRate >= TRUST_UPGRADE_SUCCESS_RATE && skill.useCount >= TRUST_UPGRADE_USE_COUNT) {
        skill.trustLevel = 'trusted';
    }
    else if (skill.successCount >= 1 && skill.successCount < TRUST_UPGRADE_USE_COUNT) {
        skill.trustLevel = 'testing';
    }
    await persistSkills(skills);
    return skill;
}
/** 标记 90 天未用技能为 archived */
export async function archiveStaleSkills() {
    const skills = await loadSkills();
    const now = Date.now();
    const threshold = now - ARCHIVE_DAYS * 86400000;
    let count = 0;
    for (const s of skills) {
        if (!s.archived && s.lastUsedAt < threshold) {
            s.archived = true;
            s.trustLevel = 'archived';
            count += 1;
        }
    }
    if (count > 0)
        await persistSkills(skills);
    return count;
}
const PLATFORM_MISMATCH_FACTOR = 0.5;
/** 推断当前执行平台 */
function inferCurrentPlatform() {
    if (process.platform === 'win32')
        return 'desktop';
    if (process.platform === 'darwin')
        return 'desktop';
    return 'headless';
}
/** 技能 envSnapshot 与当前环境是否显著不同 */
function isEnvMismatch(skill) {
    const snap = skill.envSnapshot;
    if (!snap?.os)
        return false;
    const currentOs = process.platform === 'win32' ? 'Windows' : process.platform;
    return !snap.os.toLowerCase().includes(currentOs.toLowerCase());
}
/** 检索匹配技能用于 prompt 注入 */
export async function searchSkillsForPreInjection(userMessage, limit = 5, opts) {
    const skills = await loadSkills();
    const filtered = skills.filter((s) => !s.archived && s.trustLevel !== 'suspended');
    if (filtered.length === 0)
        return [];
    const currentPlatform = opts?.platform ?? inferCurrentPlatform();
    const q = (userMessage || '').trim().toLowerCase();
    const queryWords = q.split(/\s+/).filter(Boolean);
    if (queryWords.length === 0)
        queryWords.push(q || '任务');
    const bigramSet = (s) => {
        const str = s.toLowerCase().replace(/\s+/g, '');
        if (str.length < 2)
            return new Set(str ? [str] : []);
        const bg = new Set();
        for (let i = 0; i < str.length - 1; i++)
            bg.add(str.slice(i, i + 2));
        return bg;
    };
    const bigramSim = (a, b) => {
        if (a.size === 0 && b.size === 0)
            return 0;
        const inter = [...a].filter((x) => b.has(x)).length;
        return inter / (a.size + b.size - inter || 1);
    };
    const queryBigram = bigramSet(q);
    const scored = filtered.map((s) => {
        let score = 0;
        const searchText = `${s.name} ${(s.triggerPhrases ?? []).join(' ')} ${s.description} ${(s.tags ?? []).join(' ')}`.toLowerCase();
        for (const w of queryWords) {
            if (searchText.includes(w))
                score += 2;
        }
        const sim = bigramSim(queryBigram, bigramSet(searchText));
        score += sim * 3;
        score *= TRUST_WEIGHTS[s.trustLevel] ?? 0.5;
        score *= 1 + Math.min(s.useCount, 10) * 0.05;
        if (s.platform && s.platform !== currentPlatform)
            score *= PLATFORM_MISMATCH_FACTOR;
        return { skill: s, score };
    });
    const MIN_SCORE_THRESHOLD = 0.2;
    const top = scored
        .filter((x) => x.score >= MIN_SCORE_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ skill }) => {
        let hint;
        if (skill.trustLevel === 'trusted') {
            hint = `已有可信技能「${skill.name}」，建议直接执行: ${skill.scriptPath}（可信技能，首次使用可先向用户确认）`;
        }
        else if (skill.trustLevel === 'testing') {
            hint = `有历史技能「${skill.name}」正在验证中，可尝试使用: ${skill.scriptPath}`;
        }
        else {
            hint = `有参考技能「${skill.name}」，建议先验证: ${skill.scriptPath}`;
        }
        if (isEnvMismatch(skill)) {
            hint += `（注意：技能创建于 ${skill.envSnapshot?.os ?? '未知'}，当前环境可能不同）`;
        }
        return { skill, hint };
    });
    return top;
}
/** 根据 scriptPath 查找技能（用于执行后更新成功率） */
export async function findSkillByScriptPath(scriptPath) {
    const skills = await loadSkills();
    const normalized = scriptPath.replace(/\\/g, '/');
    return skills.find((s) => {
        const sp = s.scriptPath.replace(/\\/g, '/');
        return sp === normalized || sp.endsWith(normalized) || normalized.endsWith(sp);
    }) ?? null;
}
/** 列举所有过程记忆技能（用于管理 API） */
export async function listAllProceduralSkills() {
    return loadSkills();
}
/** 删除技能 */
export async function deleteProceduralSkill(id) {
    const skills = await loadSkills();
    const idx = skills.findIndex((s) => s.id === id);
    if (idx < 0)
        return false;
    skills.splice(idx, 1);
    await persistSkills(skills);
    return true;
}
/** 重置技能（suspended 恢复为 testing，清空连续失败计数） */
export async function resetProceduralSkill(id) {
    const skills = await loadSkills();
    const skill = skills.find((s) => s.id === id);
    if (!skill)
        return null;
    skill.consecutiveFailures = 0;
    if (skill.trustLevel === 'suspended' || skill.trustLevel === 'archived') {
        skill.trustLevel = 'testing';
    }
    if (skill.archived) {
        skill.archived = false;
    }
    await persistSkills(skills);
    return skill;
}
/** 用户主动更新技能：支持修改 trustLevel（如手动暂停低质量技能）和 tags */
export async function updateProceduralSkill(id, patch) {
    const skills = await loadSkills();
    const skill = skills.find((s) => s.id === id);
    if (!skill)
        return null;
    if (patch.trustLevel != null)
        skill.trustLevel = patch.trustLevel;
    if (patch.tags != null)
        skill.tags = patch.tags;
    if (patch.name != null && patch.name.trim())
        skill.name = patch.name.trim();
    if (patch.description != null && patch.description.trim())
        skill.description = patch.description.trim();
    await persistSkills(skills);
    return skill;
}
/** 清除内存缓存（测试或重载用） */
export function clearSkillStoreCache() {
    skillsCache = null;
}
//# sourceMappingURL=skill-store.js.map