export interface RepoSkillItem {
    subpath: string;
    name: string;
    description: string;
}
/** 扫描 Git 仓库，返回所有 Skill 的 subpath、name、description。支持 tree/blob URL 自动解析、token 鉴权 */
export declare function scanRepoForSkills(url: string, options?: {
    branch?: string;
    token?: string;
}): Promise<RepoSkillItem[]>;
/** 卸载用户目录中的 Skill（仅 .apexpanda/skills 下的可卸载） */
export declare function uninstallSkill(name: string): Promise<void>;
/** 从本地路径导入 Skill 到用户目录 */
export declare function copySkillFromPath(sourcePath: string): Promise<{
    name: string;
    path: string;
}>;
export interface ImportFromUrlOptions {
    /** 子路径（相对 clone 根目录），用于 OpenClaw 等 monorepo 中精准指定单个 skill */
    subpath?: string;
    /** 访问令牌（自建仓库鉴权，注入到 clone URL） */
    token?: string;
}
/** 从 Git URL 克隆并导入 Skill（支持 OpenClaw 整仓、subpath、token 鉴权） */
export declare function importSkillFromUrl(url: string, options?: ImportFromUrlOptions): Promise<{
    name: string;
    path: string;
}>;
//# sourceMappingURL=import.d.ts.map