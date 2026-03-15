/**
 * Skill 上传：ZIP 或 YAML 文件解析并安装到用户目录
 * force=true 时覆盖同名 Skill；否则同名已存在则抛出 SKILL_EXISTS
 */
import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import yaml from 'js-yaml';
import { BUILTIN_HANDLER_KEYS } from './executor.js';
import { copySkillFromPath } from './import.js';
import { invalidateSkillsCache } from './registry.js';
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXT = new Set(['.yaml', '.yml', '.json', '.md', '.ts', '.js', '.mjs', '.cjs', '.txt', '.html', '.css']);
function getUserSkillsDir() {
    const env = process.env.APEXPANDA_USER_SKILLS_DIR;
    if (env)
        return resolve(env);
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'skills');
}
/** 校验 manifest 基本结构 */
function validateManifest(parsed) {
    if (!parsed || typeof parsed !== 'object')
        return false;
    const p = parsed;
    if (typeof p.name !== 'string' || !p.name.trim())
        return false;
    if (typeof p.version !== 'string')
        return false;
    if (typeof p.description !== 'string')
        return false;
    return true;
}
/** 校验 handler：禁止 scripts/；YAML 上传时 handler 须在 builtin 白名单内 */
function validateHandlers(manifest, requireBuiltinWhitelist) {
    const tools = manifest.tools ?? [];
    for (const t of tools) {
        const h = String(t.handler ?? '').trim();
        if (h.includes('scripts/'))
            return false;
        if (requireBuiltinWhitelist && h && !BUILTIN_HANDLER_KEYS.has(h))
            return false;
    }
    return true;
}
/** 同名已存在且未 force 时抛出，供调用方返回 409 */
export class SkillExistsError extends Error {
    skillName;
    constructor(skillName) {
        super(`SKILL_EXISTS:${skillName}`);
        this.skillName = skillName;
        this.name = 'SkillExistsError';
    }
}
/** 处理 ZIP 上传 */
export async function handleZipUpload(buffer, force) {
    if (buffer.length > MAX_SIZE)
        throw new Error('ZIP 文件超过 10MB 限制');
    const zip = new AdmZip(buffer);
    const tempDir = await mkdtemp(join(tmpdir(), 'apexpanda-skill-zip-'));
    try {
        const extractPath = resolve(tempDir);
        for (const e of zip.getEntries()) {
            if (e.isDirectory)
                continue;
            const name = e.entryName.replace(/\\/g, '/');
            if (name.includes('..') || name.startsWith('/'))
                throw new Error('ZIP 路径非法（Zip Slip）');
            const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
            if (!ALLOWED_EXT.has(ext.toLowerCase()))
                continue; // 白名单外跳过
            const dest = join(extractPath, name);
            await import('node:fs/promises').then((fs) => fs.mkdir(dirname(dest), { recursive: true }));
            const data = e.getData();
            if (Buffer.isBuffer(data)) {
                await writeFile(dest, data);
            }
            else {
                await writeFile(dest, Buffer.from(data));
            }
        }
        const rootFiles = await readdir(extractPath).catch(() => []);
        const hasApexRoot = rootFiles.includes('APEX_SKILL.yaml');
        let skillRoot = extractPath;
        if (hasApexRoot) {
            const apexRaw = await readFile(join(extractPath, 'APEX_SKILL.yaml'), 'utf-8');
            const apexParsed = yaml.load(apexRaw);
            const skillName = apexParsed?.name ?? 'skill';
            skillRoot = join(extractPath, skillName);
            await import('node:fs/promises').then((fs) => fs.mkdir(skillRoot, { recursive: true }));
            await import('node:fs/promises').then((fs) => fs.rename(join(extractPath, 'APEX_SKILL.yaml'), join(skillRoot, 'APEX_SKILL.yaml')));
            for (const f of rootFiles) {
                if (f !== 'APEX_SKILL.yaml' && f !== skillName) {
                    const src = join(extractPath, f);
                    const st = await import('node:fs/promises').then((fs) => fs.stat(src).catch(() => null));
                    if (st?.isDirectory()) {
                        await import('node:fs/promises').then((fs) => fs.rename(src, join(skillRoot, f)));
                    }
                    else if (st?.isFile()) {
                        await import('node:fs/promises').then((fs) => fs.copyFile(src, join(skillRoot, f)));
                    }
                }
            }
        }
        else {
            const entries = await readdir(extractPath, { withFileTypes: true });
            for (const e of entries) {
                if (!e.isDirectory())
                    continue;
                const sub = join(extractPath, e.name);
                const subFiles = await readdir(sub);
                if (subFiles.includes('APEX_SKILL.yaml')) {
                    skillRoot = sub;
                    break;
                }
            }
            if (skillRoot === extractPath)
                throw new Error('ZIP 内未找到 APEX_SKILL.yaml');
        }
        const apexRaw = await readFile(join(skillRoot, 'APEX_SKILL.yaml'), 'utf-8');
        const apexParsed = yaml.load(apexRaw);
        const existingName = (apexParsed?.name ?? 'skill').trim();
        if (/^[a-zA-Z0-9_-]+$/.test(existingName)) {
            const userDir = getUserSkillsDir();
            const targetDir = join(userDir, existingName);
            if (existsSync(targetDir) && !force)
                throw new SkillExistsError(existingName);
        }
        let { name } = await copySkillFromPath(skillRoot);
        const userDir = getUserSkillsDir();
        const skillDir = join(userDir, name);
        const raw = await readFile(join(skillDir, 'APEX_SKILL.yaml'), 'utf-8');
        const parsed = yaml.load(raw);
        const manifestName = parsed?.name?.trim();
        if (manifestName && manifestName !== name && /^[a-zA-Z0-9_-]+$/.test(manifestName)) {
            const targetDir = join(userDir, manifestName);
            try {
                await rename(skillDir, targetDir);
                name = manifestName;
            }
            catch {
                /* 目标已存在则保留原目录名 */
            }
        }
        const requiresConfig = (parsed?.envFields?.length ?? 0) > 0;
        invalidateSkillsCache();
        return { name, requiresConfig, source: 'zip' };
    }
    finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
/** 处理 YAML 上传（单文件 APEX_SKILL） */
export async function handleYamlUpload(buffer, force) {
    const raw = buffer.toString('utf-8');
    const parsed = yaml.load(raw);
    if (!validateManifest(parsed))
        throw new Error('YAML 格式无效：需包含 name、version、description');
    const manifest = parsed;
    if (!validateHandlers(manifest, true)) {
        throw new Error('YAML 上传的 handler 必须指向内置工具白名单，且不能包含 scripts/');
    }
    const skillName = manifest.name.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(skillName))
        throw new Error('Skill 名称只能包含字母、数字、下划线、连字符');
    const userDir = getUserSkillsDir();
    const destDir = join(userDir, skillName);
    if (existsSync(destDir) && !force)
        throw new SkillExistsError(skillName);
    await import('node:fs/promises').then((fs) => fs.mkdir(destDir, { recursive: true }));
    await writeFile(join(destDir, 'APEX_SKILL.yaml'), raw, 'utf-8');
    const requiresConfig = (manifest.envFields?.length ?? 0) > 0;
    invalidateSkillsCache();
    return { name: skillName, requiresConfig, source: 'yaml' };
}
//# sourceMappingURL=upload.js.map