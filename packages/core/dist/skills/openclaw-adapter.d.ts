import type { ApexSkillManifest } from './apex-skill.schema.js';
export interface ParsedSkillMd {
    frontmatter: Record<string, unknown>;
    body: string;
}
/** 解析 SKILL.md 内容，提取 YAML frontmatter */
export declare function parseSkillMd(content: string): ParsedSkillMd;
/** 将 SKILL.md 转为 ApexSkillManifest */
export declare function skillMdToApexManifest(content: string, skillName: string): ApexSkillManifest;
//# sourceMappingURL=openclaw-adapter.d.ts.map