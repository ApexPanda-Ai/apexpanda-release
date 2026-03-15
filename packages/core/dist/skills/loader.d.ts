import type { ApexSkillManifest } from './apex-skill.schema.js';
/** Skill 来源：builtin=内置, managed=OpenClaw/用户托管, extra=用户安装, workspace=工作区 */
export type SkillSource = 'builtin' | 'managed' | 'extra' | 'workspace';
/** OpenClaw _meta.json 结构（用于展示 owner、displayName 等） */
export interface OpenClawRegistryMeta {
    owner?: string;
    slug?: string;
    displayName?: string;
}
export interface LoadedSkill {
    name: string;
    path: string;
    manifest: ApexSkillManifest;
    /** 加载时按所在目录打上的来源，用于前端展示 */
    source?: SkillSource;
    /** OpenClaw _meta.json 解析结果（有则用于展示） */
    registryMeta?: OpenClawRegistryMeta;
}
export declare function loadSkillsFromDir(dir: string): Promise<LoadedSkill[]>;
//# sourceMappingURL=loader.d.ts.map