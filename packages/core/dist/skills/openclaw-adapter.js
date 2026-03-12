/**
 * OpenClaw Skill 兼容适配层
 * 解析 SKILL.md（YAML frontmatter + Body），生成 APEX manifest
 */
import yaml from 'js-yaml';
/** 解析 SKILL.md 内容，提取 YAML frontmatter */
export function parseSkillMd(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: content.trim() };
    }
    const [, yamlStr, body] = match;
    let frontmatter = {};
    if (yamlStr?.trim()) {
        try {
            frontmatter = yaml.load(yamlStr) ?? {};
        }
        catch {
            // 解析失败，保持空
        }
    }
    return { frontmatter, body: (body ?? '').trim() };
}
/** 从 OpenClaw metadata.openclaw.requires 推断权限（默认最小，用户可放宽） */
function inferPermissionsFromMetadata(frontmatter) {
    const perms = [];
    let metadata = frontmatter.metadata;
    if (typeof metadata === 'string') {
        try {
            metadata = JSON.parse(metadata);
        }
        catch {
            return perms;
        }
    }
    const openclaw = metadata?.openclaw;
    if (!openclaw)
        return perms;
    // OpenClaw 技能执行 scripts/ 脚本，需 process spawn（有 openclaw 即推断）
    perms.push({
        id: 'process',
        scope: 'spawn',
        description: 'OpenClaw inferred: runs scripts in scripts/ or skill root',
    });
    const requires = openclaw.requires;
    if (!requires)
        return perms;
    // requires.env 通常表示需要 API Key，可能涉及网络
    if (Array.isArray(requires.env) && requires.env.length > 0) {
        perms.push({
            id: 'network',
            scope: 'outbound',
            description: 'OpenClaw inferred: requires external API',
        });
    }
    return perms;
}
/** 从 metadata.openclaw 提取 openclawMeta（用于加载时过滤） */
function extractOpenClawMeta(frontmatter) {
    let metadata = frontmatter.metadata;
    if (typeof metadata === 'string') {
        try {
            metadata = JSON.parse(metadata);
        }
        catch {
            return undefined;
        }
    }
    const openclaw = metadata?.openclaw;
    if (!openclaw)
        return undefined;
    const requires = openclaw.requires;
    const meta = {};
    if (requires && typeof requires === 'object') {
        if (Array.isArray(requires.bins))
            meta.requires = { ...meta.requires, bins: requires.bins };
        if (Array.isArray(requires.anyBins))
            meta.requires = { ...meta.requires, anyBins: requires.anyBins };
        if (Array.isArray(requires.env))
            meta.requires = { ...meta.requires, env: requires.env };
        if (Array.isArray(requires.config))
            meta.requires = { ...meta.requires, config: requires.config };
    }
    if (typeof openclaw.primaryEnv === 'string')
        meta.primaryEnv = openclaw.primaryEnv;
    if (Array.isArray(openclaw.os))
        meta.os = openclaw.os;
    if (typeof openclaw.script === 'string')
        meta.mainScript = openclaw.script;
    if (typeof openclaw.mainScript === 'string')
        meta.mainScript = openclaw.mainScript;
    return Object.keys(meta).length > 0 ? meta : undefined;
}
/** 从 frontmatter 顶层提取 mainScript（script 或 mainScript 字段） */
function extractMainScriptFromFrontmatter(frontmatter) {
    const s = frontmatter.script ?? frontmatter.mainScript;
    return typeof s === 'string' ? s.trim() || undefined : undefined;
}
/** 将 key 转为友好 label，如 API_KEY -> API Key */
function keyToLabel(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
/** 根据 key 名称推断输入类型：含 KEY/SECRET/TOKEN/PASSWORD 的用 password */
function inferFieldType(key) {
    const k = key.toUpperCase();
    if (k.includes('URL') || k.includes('HOST') || k.includes('BASE_URL'))
        return 'url';
    if (k.includes('KEY') || k.includes('SECRET') || k.includes('TOKEN') || k.includes('PASSWORD'))
        return 'password';
    return 'text';
}
/** 从 metadata.openclaw.requires.env 生成 envFields，供 Skills 页表单模式使用 */
function inferEnvFieldsFromMetadata(frontmatter) {
    let metadata = frontmatter.metadata;
    if (typeof metadata === 'string') {
        try {
            metadata = JSON.parse(metadata);
        }
        catch {
            return [];
        }
    }
    const openclaw = metadata?.openclaw;
    if (!openclaw)
        return [];
    const requires = openclaw.requires;
    if (!requires || !Array.isArray(requires.env))
        return [];
    const envKeys = requires.env;
    return envKeys
        .filter((k) => typeof k === 'string' && k.trim().length > 0)
        .map((key) => ({
        key,
        label: keyToLabel(key),
        type: inferFieldType(key),
    }));
}
/** 将 SKILL.md 转为 ApexSkillManifest */
export function skillMdToApexManifest(content, skillName) {
    const { frontmatter } = parseSkillMd(content);
    const name = String(frontmatter.name ?? skillName);
    const description = String(frontmatter.description ?? '');
    const manifest = {
        name,
        version: '1.0.0',
        description,
        compatibility: {
            apexAgent: '>=0.1.0',
            openClaw: true,
        },
    };
    if (typeof frontmatter.author === 'string')
        manifest.author = frontmatter.author;
    if (typeof frontmatter.license === 'string')
        manifest.license = frontmatter.license;
    // SKILL.md 技能均通过 openclaw-legacy 执行脚本，必须具有 process:spawn
    const inferred = inferPermissionsFromMetadata(frontmatter);
    const hasProcess = inferred.some((p) => p.id === 'process' && p.scope === 'spawn');
    manifest.permissions = hasProcess ? inferred : [{ id: 'process', scope: 'spawn', description: 'OpenClaw: runs scripts' }, ...inferred];
    // OpenClaw 扩展元数据（requires.bins、os、primaryEnv、mainScript）
    manifest.openclawMeta = extractOpenClawMeta(frontmatter);
    const topScript = extractMainScriptFromFrontmatter(frontmatter);
    if (topScript && manifest.openclawMeta)
        manifest.openclawMeta.mainScript = topScript;
    else if (topScript)
        manifest.openclawMeta = { mainScript: topScript };
    // 从 requires.env 生成 envFields，供 Skills 页表单模式配置参数
    const envFields = inferEnvFieldsFromMetadata(frontmatter);
    if (envFields.length > 0)
        manifest.envFields = envFields;
    // 单一工具：OpenClaw 多为单工具/命令式
    const commandTool = frontmatter['command-tool'];
    const toolId = commandTool ?? 'invoke';
    manifest.defaultParams = { [toolId]: '{"command":""}' };
    manifest.tools = [
        {
            id: toolId,
            description: description || `OpenClaw legacy skill: ${name}`,
            handler: `openclaw-legacy#${toolId}`,
        },
    ];
    return manifest;
}
//# sourceMappingURL=openclaw-adapter.js.map