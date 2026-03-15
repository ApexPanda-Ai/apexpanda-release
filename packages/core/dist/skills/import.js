/**
 * Skill 导入：从本地路径或 Git URL 复制到用户 Skills 目录
 * 支持 OpenClaw 整仓结构（递归查找、subpath）
 * GitHub 优先使用 HTTP 拉取 zip（与 MCP 相同），避免 git 子进程网络差异
 * 拉取/安装结果缓存，同一仓库多次安装复用已下载内容
 */
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import yaml from 'js-yaml';
import AdmZip from 'adm-zip';
import { skillMdToApexManifest } from './openclaw-adapter.js';
function getUserSkillsDir() {
    const env = process.env.APEXPANDA_USER_SKILLS_DIR;
    if (env)
        return resolve(env);
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'skills');
}
function getRepoCacheDir() {
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'repo-cache');
}
function getRepoCacheKey(url, branch) {
    const raw = `${url.trim()}#${(branch || 'main').trim()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
async function saveRepoToCache(repoRoot, cacheKey) {
    const cacheDir = getRepoCacheDir();
    await mkdir(cacheDir, { recursive: true }).catch(() => { });
    const dest = join(cacheDir, cacheKey);
    await rm(dest, { recursive: true, force: true }).catch(() => { });
    const entries = await readdir(repoRoot, { withFileTypes: true });
    for (const e of entries) {
        await cp(join(repoRoot, e.name), join(dest, e.name), { recursive: true });
    }
    return dest;
}
async function getCachedRepoRoot(cacheKey) {
    const dest = join(getRepoCacheDir(), cacheKey);
    try {
        const st = await stat(dest);
        if (st.isDirectory())
            return dest;
    }
    catch {
        /* ignore */
    }
    return null;
}
function getSkillName(sourcePath) {
    const name = basename(resolve(sourcePath));
    if (!name || name === '.' || name === '..')
        throw new Error('Invalid skill path');
    return name;
}
/** 检查目录是否包含 Skill 定义 */
async function hasSkillFiles(dir) {
    const files = await readdir(dir).catch(() => []);
    return files.includes('APEX_SKILL.yaml') || files.includes('SKILL.md');
}
/** 递归查找第一个包含 Skill 定义的目录（OpenClaw 兼容：skills/用户名/技能名/） */
async function findSkillRootRecursive(dir, maxDepth = 5, currentDepth = 0) {
    if (currentDepth >= maxDepth)
        return null;
    if (await hasSkillFiles(dir))
        return dir;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
        if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules')
            continue;
        const p = join(dir, e.name);
        const found = await findSkillRootRecursive(p, maxDepth, currentDepth + 1);
        if (found)
            return found;
    }
    return null;
}
/** 递归查找所有包含 Skill 定义的目录 */
async function findAllSkillRootsRecursive(dir, repoRoot, results, maxDepth = 6, currentDepth = 0) {
    if (currentDepth >= maxDepth)
        return;
    if (await hasSkillFiles(dir)) {
        results.push(dir);
        return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
        if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules')
            continue;
        await findAllSkillRootsRecursive(join(dir, e.name), repoRoot, results, maxDepth, currentDepth + 1);
    }
}
/** 读取 skill 目录的 name 与 description */
async function readSkillMeta(skillPath, folderName) {
    const apexPath = join(skillPath, 'APEX_SKILL.yaml');
    const skillMdPath = join(skillPath, 'SKILL.md');
    try {
        const raw = await readFile(apexPath, 'utf-8');
        const parsed = yaml.load(raw);
        return {
            name: String(parsed?.name ?? folderName),
            description: String(parsed?.description ?? ''),
        };
    }
    catch {
        try {
            const md = await readFile(skillMdPath, 'utf-8');
            const manifest = skillMdToApexManifest(md, folderName);
            return { name: manifest.name, description: manifest.description ?? '' };
        }
        catch {
            return { name: folderName, description: '' };
        }
    }
}
/** 扫描 Git 仓库，返回所有 Skill 的 subpath、name、description。支持 tree/blob URL 自动解析、token 鉴权 */
export async function scanRepoForSkills(url, options) {
    let u = url.trim();
    let branchOverride = options?.branch;
    const parsed = parseGitHubSubpathUrl(u);
    if (parsed) {
        u = parsed.baseUrl;
        if (parsed.branch)
            branchOverride = branchOverride ?? parsed.branch;
    }
    if (!u || !isGitUrl(u))
        throw new Error('Valid Git URL is required (GitHub/GitLab/Gitee)');
    const beforeMirror = u;
    u = applyGitHubMirror(u);
    if (options?.token && u === beforeMirror)
        u = injectTokenIntoUrl(u, options.token);
    const branch = branchOverride ?? process.env.APEXPANDA_SKILL_IMPORT_BRANCH ?? 'main';
    const tempDir = await mkdtemp(join(tmpdir(), 'apexpanda-scan-'));
    try {
        let repoRoot = tempDir;
        // GitHub 公开仓优先用 HTTP 拉取 zip（与 MCP 相同，避免 git 子进程网络差异）
        if (isGitHubUrl(u) && !options?.token) {
            try {
                repoRoot = await fetchGitHubAsZip(u, branch, tempDir);
            }
            catch {
                /* fallback to git */
            }
        }
        if (repoRoot === tempDir) {
            const args = ['clone', '--depth', '1', '--single-branch', ...(branch ? ['--branch', branch] : []), u, tempDir];
            let stderr = '';
            const code = await new Promise((resolve, reject) => {
                const p = spawn('git', args, { stdio: 'pipe' });
                p.stderr?.on('data', (d) => { stderr += d.toString(); });
                p.on('close', (c) => resolve(c ?? 1));
                p.on('error', reject);
            });
            if (code !== 0) {
                const errText = stderr.trim();
                const hint = errText ? `\n\nGit 输出: ${errText.slice(0, 400)}` : '';
                const isNetwork = /connection|reset|timeout|unable to access|refused/i.test(errText);
                const mirrorTip = !process.env.APEXPANDA_GITHUB_MIRROR && isNetwork
                    ? '\n\n若直连 GitHub 不稳定，可在 .env 中配置 APEXPANDA_GITHUB_MIRROR=https://mirror.ghproxy.com/'
                    : '';
                throw new Error(`git clone 失败（需安装 git 且可访问 GitHub）${hint}${mirrorTip}`);
            }
        }
        const roots = [];
        await findAllSkillRootsRecursive(repoRoot, repoRoot, roots);
        const items = [];
        for (const p of roots) {
            const subpath = relative(repoRoot, p).replace(/\\/g, '/');
            const folderName = basename(p);
            const { name, description } = await readSkillMeta(p, folderName);
            items.push({ subpath, name, description });
        }
        const cacheKey = getRepoCacheKey(beforeMirror || u, branch);
        await saveRepoToCache(repoRoot, cacheKey).catch(() => { });
        return items.sort((a, b) => a.subpath.localeCompare(b.subpath));
    }
    finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
/** 卸载用户目录中的 Skill（仅 .apexpanda/skills 下的可卸载） */
export async function uninstallSkill(name) {
    if (!name || /[\\/]/.test(name))
        throw new Error('Invalid skill name');
    const userDir = getUserSkillsDir();
    const skillPath = join(userDir, name);
    const resolved = resolve(skillPath);
    const base = resolve(userDir);
    if (resolved !== base && !resolved.startsWith(base + sep))
        throw new Error('Invalid skill path');
    if (!existsSync(skillPath))
        throw new Error('该技能不在用户目录，无法卸载');
    await rm(skillPath, { recursive: true, force: true });
}
/** 从本地路径导入 Skill 到用户目录 */
export async function copySkillFromPath(sourcePath) {
    const abs = resolve(sourcePath);
    const st = await stat(abs);
    if (!st.isDirectory())
        throw new Error('Source must be a directory');
    const name = getSkillName(abs);
    const userDir = getUserSkillsDir();
    const dest = join(userDir, name);
    await cp(abs, dest, { recursive: true });
    const hasApex = await readdir(abs).then((files) => files.includes('APEX_SKILL.yaml')).catch(() => false);
    const hasSkillMd = await readdir(abs).then((files) => files.includes('SKILL.md')).catch(() => false);
    if (!hasApex && !hasSkillMd) {
        throw new Error('Skill directory must contain APEX_SKILL.yaml or SKILL.md');
    }
    return { name, path: dest };
}
function isGitUrl(url) {
    const u = url.trim().toLowerCase();
    return u.startsWith('https://github.com/') || u.startsWith('http://github.com/') ||
        u.startsWith('https://gitlab.com/') || u.startsWith('https://gitee.com/') ||
        u.startsWith('git@github.com:') || u.startsWith('git@gitlab.com:');
}
/**
 * 解析 GitHub blob/tree URL，提取 repo URL 与 subpath
 * 例：https://github.com/openclaw/skills/tree/main/skills/279458179/gaodemapskill
 *  -> { baseUrl, subpath: 'skills/279458179/gaodemapskill', branch: 'main' }
 */
function parseGitHubSubpathUrl(url) {
    const u = url.trim();
    const treeMatch = u.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+)\/tree\/([^/]+)\/(.*)$/);
    const blobMatch = u.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+)\/blob\/([^/]+)\/(.*)$/);
    if (treeMatch) {
        const [, baseUrl, branch, subpath] = treeMatch;
        return { baseUrl, subpath: subpath?.replace(/\/$/, '') || undefined, branch };
    }
    if (blobMatch) {
        const [, baseUrl, branch, subpath] = blobMatch;
        return { baseUrl, subpath: subpath?.replace(/\/$/, '') || undefined, branch };
    }
    return null;
}
function isGitHubUrl(url) {
    const u = url.trim().toLowerCase();
    return u.startsWith('https://github.com/') || u.startsWith('http://github.com/') ||
        /^https?:\/\/[^/]+\/https?:\/\/github\.com\//.test(u); // mirror 格式
}
/** 通过 HTTP 拉取 GitHub 仓库 zip（与 MCP 相同，不依赖 git 子进程） */
async function fetchGitHubAsZip(repoUrl, branch, destDir) {
    const b = branch || 'main';
    const zipUrl = `${repoUrl.replace(/\/$/, '')}/archive/refs/heads/${b}.zip`;
    const res = await fetch(zipUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok)
        throw new Error(`拉取失败 HTTP ${res.status}: ${zipUrl}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    const topDir = entries[0]?.entryName?.split('/')[0] ?? '';
    if (!topDir)
        throw new Error('Zip 格式异常');
    zip.extractAllTo(destDir, true);
    return join(destDir, topDir);
}
/** 当 APEXPANDA_GITHUB_MIRROR 设置时，将 GitHub URL 通过镜像代理（国内访问 GitHub 失败时可配置） */
function applyGitHubMirror(url) {
    const mirror = process.env.APEXPANDA_GITHUB_MIRROR?.trim();
    if (!mirror)
        return url;
    const u = url.trim().toLowerCase();
    if (!u.startsWith('https://github.com/') && !u.startsWith('http://github.com/'))
        return url;
    const base = mirror.endsWith('/') ? mirror : mirror + '/';
    return base + url.trim();
}
/** 将 token 注入 HTTPS URL 用于鉴权（https://host/path -> https://token@host/path） */
function injectTokenIntoUrl(url, token) {
    if (!token.trim())
        return url;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            parsed.username = token.trim();
            parsed.password = '';
            return parsed.toString();
        }
    }
    catch {
        /* ignore */
    }
    return url;
}
/** 从 Git URL 克隆并导入 Skill（支持 OpenClaw 整仓、subpath、token 鉴权） */
export async function importSkillFromUrl(url, options) {
    let u = url.trim();
    if (!u)
        throw new Error('URL is required');
    let subpath = options?.subpath;
    let branchOverride;
    // 尝试解析 GitHub tree/blob URL
    const parsed = parseGitHubSubpathUrl(u);
    if (parsed) {
        u = parsed.baseUrl;
        if (parsed.subpath)
            subpath = subpath ?? parsed.subpath;
        if (parsed.branch)
            branchOverride = parsed.branch;
    }
    if (!isGitUrl(u))
        throw new Error('Unsupported URL. Use GitHub/GitLab/Gitee URL or local path.');
    const beforeMirror = u;
    u = applyGitHubMirror(u);
    if (options?.token && u === beforeMirror)
        u = injectTokenIntoUrl(u, options.token);
    const branch = branchOverride ?? process.env.APEXPANDA_SKILL_IMPORT_BRANCH ?? 'main';
    const canonicalUrl = beforeMirror;
    const cacheKey = getRepoCacheKey(canonicalUrl, branch);
    let repoRoot = await getCachedRepoRoot(cacheKey);
    const tempDir = repoRoot ? '' : await mkdtemp(join(tmpdir(), 'apexpanda-skill-'));
    try {
        if (!repoRoot) {
            repoRoot = tempDir;
            if (isGitHubUrl(u) && !options?.token) {
                try {
                    repoRoot = await fetchGitHubAsZip(u, branch, tempDir);
                }
                catch {
                    /* fallback to git */
                }
            }
            if (repoRoot === tempDir) {
                const args = ['clone', '--depth', '1', '--single-branch', ...(branch ? ['--branch', branch] : []), u, tempDir];
                const code = await new Promise((resolve, reject) => {
                    const p = spawn('git', args, { stdio: 'pipe' });
                    let stderr = '';
                    p.stderr?.on('data', (d) => { stderr += d.toString(); });
                    p.on('close', (c) => resolve(c ?? 1));
                    p.on('error', reject);
                });
                if (code !== 0)
                    throw new Error(`git clone failed. Ensure git is installed and URL is accessible.`);
            }
            await saveRepoToCache(repoRoot, cacheKey).catch(() => { });
        }
        let searchRoot = repoRoot;
        if (subpath) {
            const subpathResolved = join(repoRoot, subpath);
            const st = await stat(subpathResolved).catch(() => null);
            if (st?.isDirectory())
                searchRoot = subpathResolved;
        }
        let skillRoot;
        if (await hasSkillFiles(searchRoot)) {
            skillRoot = searchRoot;
        }
        else {
            const found = await findSkillRootRecursive(searchRoot);
            if (found)
                skillRoot = found;
            else
                throw new Error('No APEX_SKILL.yaml or SKILL.md found in repository' + (subpath ? ` (subpath: ${subpath})` : ''));
        }
        return await copySkillFromPath(skillRoot);
    }
    finally {
        if (tempDir)
            await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
//# sourceMappingURL=import.js.map