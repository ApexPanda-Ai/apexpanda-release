/**
 * Skill 加载器
 * 扫描 skills 目录，解析 APEX_SKILL.yaml 或 SKILL.md（OpenClaw 兼容）
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { skillMdToApexManifest } from './openclaw-adapter.js';
function isOpenClawCompatEnabled() {
    return process.env.APEXPANDA_OPENCLAW_COMPAT_ENABLED !== 'false';
}
/** 检查二进制是否在 PATH 中存在 */
function binExists(bin) {
    try {
        const cmd = platform() === 'win32' ? `where ${bin}` : `which ${bin}`;
        execSync(cmd, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/** 读取 OpenClaw _meta.json（有则解析 owner、slug、displayName） */
async function readMetaJson(skillPath) {
    try {
        const raw = await readFile(join(skillPath, '_meta.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        const meta = {};
        if (typeof parsed.owner === 'string')
            meta.owner = parsed.owner;
        if (typeof parsed.slug === 'string')
            meta.slug = parsed.slug;
        if (typeof parsed.displayName === 'string')
            meta.displayName = parsed.displayName;
        return Object.keys(meta).length > 0 ? meta : undefined;
    }
    catch {
        return undefined;
    }
}
/** OpenClaw 技能加载时过滤：requires.bins、anyBins、os */
function passesOpenClawGates(manifest) {
    const meta = manifest.openclawMeta;
    if (!meta)
        return true;
    const plat = platform();
    if (Array.isArray(meta.os) && meta.os.length > 0) {
        if (!meta.os.includes(plat))
            return false;
    }
    const req = meta.requires;
    if (req?.bins && Array.isArray(req.bins)) {
        for (const b of req.bins) {
            if (!binExists(b))
                return false;
        }
    }
    if (req?.anyBins && Array.isArray(req.anyBins)) {
        if (!req.anyBins.some((b) => binExists(b)))
            return false;
    }
    return true;
}
export async function loadSkillsFromDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const skillPath = join(dir, entry.name);
        const apexPath = join(skillPath, 'APEX_SKILL.yaml');
        const skillMdPath = join(skillPath, 'SKILL.md');
        try {
            const raw = await readFile(apexPath, 'utf-8');
            const parsed = yaml.load(raw);
            const manifest = {
                name: String(parsed?.name ?? entry.name),
                version: String(parsed?.version ?? '1.0.0'),
                description: String(parsed?.description ?? ''),
            };
            if (typeof parsed?.author === 'string')
                manifest.author = parsed.author;
            if (typeof parsed?.license === 'string')
                manifest.license = parsed.license;
            if (Array.isArray(parsed?.permissions))
                manifest.permissions = parsed.permissions;
            if (Array.isArray(parsed?.tools))
                manifest.tools = parsed.tools;
            if (parsed?.compatibility && typeof parsed.compatibility === 'object') {
                manifest.compatibility = parsed.compatibility;
            }
            if (parsed?.openclawMeta && typeof parsed.openclawMeta === 'object') {
                manifest.openclawMeta = parsed.openclawMeta;
            }
            if (typeof parsed?.category === 'string')
                manifest.category = parsed.category;
            if (Array.isArray(parsed?.envFields))
                manifest.envFields = parsed.envFields;
            if (parsed?.defaultParams && typeof parsed.defaultParams === 'object') {
                manifest.defaultParams = parsed.defaultParams;
            }
            if (Array.isArray(parsed?.tags))
                manifest.tags = parsed.tags.filter((x) => typeof x === 'string');
            if (Array.isArray(parsed?.externalServices))
                manifest.externalServices = parsed.externalServices.filter((x) => typeof x === 'string');
            if (parsed?.showInTemplates === false)
                manifest.showInTemplates = false;
            skills.push({ name: entry.name, path: skillPath, manifest, registryMeta: await readMetaJson(skillPath) });
        }
        catch {
            // 无 APEX_SKILL.yaml，尝试 OpenClaw SKILL.md
            if (isOpenClawCompatEnabled()) {
                try {
                    const md = await readFile(skillMdPath, 'utf-8');
                    const manifest = skillMdToApexManifest(md, entry.name);
                    if (!passesOpenClawGates(manifest))
                        continue; // requires.bins/os 等未满足，跳过
                    skills.push({ name: entry.name, path: skillPath, manifest, registryMeta: await readMetaJson(skillPath) });
                }
                catch {
                    // 无 SKILL.md 或解析失败，跳过
                }
            }
        }
    }
    return skills;
}
//# sourceMappingURL=loader.js.map