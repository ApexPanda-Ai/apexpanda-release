/**
 * Skill 模版：从 builtin 目录动态生成可安装模版列表，合并 url 模版配置
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadSkillsFromDir } from './loader.js';
import { loadConfig } from '../config/loader.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
function getBuiltinSkillsDir() {
    const env = process.env.APEXPANDA_SKILLS_DIR;
    if (env)
        return env;
    return join(__dirname, '../../../skills/builtin');
}
function getDataDir() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return base;
}
/** URL 白名单域名 */
const URL_ALLOWED_HOSTS = new Set(['github.com', 'gitee.com', 'gitlab.com']);
function isUrlAllowed(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        return URL_ALLOWED_HOSTS.has(host) || host.endsWith('.github.com') || host.endsWith('.gitee.com') || host.endsWith('.gitlab.com');
    }
    catch {
        return false;
    }
}
/** 不在模版列表展示的 Skill（基础工具类等） */
const HIDE_FROM_TEMPLATES = new Set([
    'hash', 'base64', 'random', 'regex', 'calculator', 'text-diff', 'json-path',
    'cron-parse', 'url-tools', 'markdown', 'server-monitor', 'process-monitor',
]);
function getUserSkillsDir() {
    const env = process.env.APEXPANDA_USER_SKILLS_DIR;
    if (env)
        return env;
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'skills');
}
/** 预置 OpenClaw 热门技能（用户未配置时展示，用户配置可覆盖） */
const DEFAULT_OPENCLAW_TEMPLATES = [
    { name: '高德地图', description: 'OpenClaw 高德地图技能：地理编码、逆地理、路径规划等', category: '地图/导航', url: 'https://github.com/openclaw/skills', subpath: 'skills/279458179/gaodemapskill' },
    { name: 'Google Calendar', description: 'OpenClaw 谷歌日历：列出/创建/更新/删除日程', category: '日历', url: 'https://github.com/openclaw/skills', subpath: 'skills/adrianmiller99/google-calendar' },
];
/** 加载 url 模版配置（.apexpanda/skill-templates.json），合并预置 OpenClaw 源 */
async function loadUrlTemplates() {
    const path = join(getDataDir(), 'skill-templates.json');
    let userTemplates = [];
    if (existsSync(path)) {
        try {
            const raw = await readFile(path, 'utf-8');
            const parsed = JSON.parse(raw);
            const list = parsed?.urlTemplates ?? [];
            userTemplates = list
                .filter((t) => t?.url && typeof t.url === 'string' && isUrlAllowed(t.url))
                .map((t) => ({
                name: String(t.name ?? '远程 Skill').trim() || '远程 Skill',
                description: String(t.description ?? '').trim() || '从 Git 仓库安装',
                category: typeof t.category === 'string' ? t.category.trim() : undefined,
                url: String(t.url).trim(),
                subpath: typeof t.subpath === 'string' ? t.subpath.trim() || undefined : undefined,
            }));
        }
        catch { /* ignore */ }
    }
    const userUrls = new Set(userTemplates.map((t) => `${t.url}|${t.subpath ?? ''}`));
    const defaults = DEFAULT_OPENCLAW_TEMPLATES.filter((t) => !userUrls.has(`${t.url}|${t.subpath ?? ''}`));
    return [...defaults, ...userTemplates];
}
export async function getSkillTemplates() {
    const builtinDir = getBuiltinSkillsDir();
    const skills = await loadSkillsFromDir(builtinDir);
    const config = await loadConfig();
    const entries = config.skills?.entries ?? {};
    const templates = [];
    for (const s of skills) {
        if (HIDE_FROM_TEMPLATES.has(s.name))
            continue;
        if (s.manifest.showInTemplates === false)
            continue;
        const requiresConfig = (s.manifest.envFields?.length ?? 0) > 0;
        let installed;
        if (requiresConfig) {
            const entry = entries[s.name];
            installed = !!(entry?.env && Object.keys(entry.env).length > 0);
        }
        else {
            const entry = entries[s.name];
            installed = entry?.enabled === true;
        }
        templates.push({
            id: s.name,
            name: s.manifest.name,
            description: s.manifest.description ?? '',
            category: s.manifest.category,
            source: 'builtin',
            skillName: s.name,
            requiresConfig,
            installed,
            tags: (s.manifest.tags?.length ?? 0) > 0 ? s.manifest.tags : (requiresConfig ? ['需配置Key'] : ['免费', '无需Key']),
            externalServices: s.manifest.externalServices?.length ? s.manifest.externalServices : undefined,
        });
    }
    const urlTemplates = await loadUrlTemplates();
    for (const ut of urlTemplates) {
        const templateId = ut.subpath ? `url:${ut.url}|${ut.subpath}` : `url:${ut.url}`;
        const isOpenClaw = ut.url.includes('openclaw/skills');
        templates.push({
            id: templateId,
            name: ut.name,
            description: ut.description,
            category: ut.category,
            source: 'url',
            skillName: '',
            requiresConfig: true,
            installed: false,
            tags: isOpenClaw ? ['远程', 'Git', 'OpenClaw'] : ['远程', 'Git'],
            url: ut.url,
        });
    }
    return templates;
}
/** 从模版安装 Skill（builtin：写入 config；url：import 后 invalidate） */
export async function installSkillFromTemplate(templateId, force) {
    const templates = await getSkillTemplates();
    const t = templates.find((x) => x.id === templateId);
    if (!t)
        return { ok: false, error: `模版不存在: ${templateId}` };
    if (t.installed && !force)
        return { ok: true, skillName: t.skillName, requiresConfig: t.requiresConfig };
    if (t.source === 'builtin') {
        if (t.requiresConfig) {
            return { ok: true, skillName: t.skillName, requiresConfig: true };
        }
        const { saveConfig, loadConfig } = await import('../config/loader.js');
        const current = await loadConfig();
        const entries = { ...(current.skills?.entries ?? {}) };
        entries[t.skillName] = { ...(entries[t.skillName] ?? {}), enabled: true };
        await saveConfig({ skills: { entries } });
        return { ok: true, skillName: t.skillName };
    }
    if (templateId.startsWith('url:')) {
        const rest = templateId.slice(4);
        const pipeIdx = rest.indexOf('|');
        const url = pipeIdx >= 0 ? rest.slice(0, pipeIdx) : rest;
        const subpath = pipeIdx >= 0 ? rest.slice(pipeIdx + 1) : undefined;
        const { importSkillFromUrl } = await import('./import.js');
        const { invalidateSkillsCache } = await import('./registry.js');
        const { name } = await importSkillFromUrl(url, subpath ? { subpath } : undefined);
        invalidateSkillsCache();
        return { ok: true, skillName: name };
    }
    return { ok: false, error: '不支持的模版类型' };
}
//# sourceMappingURL=templates.js.map