export interface SkillTemplate {
    id: string;
    name: string;
    description: string;
    category?: string;
    source: 'builtin' | 'url';
    skillName: string;
    requiresConfig: boolean;
    installed: boolean;
    tags?: string[];
    externalServices?: string[];
    url?: string;
}
export declare function getSkillTemplates(): Promise<SkillTemplate[]>;
export interface InstallResult {
    ok: boolean;
    skillName?: string;
    requiresConfig?: boolean;
    error?: string;
}
/** 从模版安装 Skill（builtin：写入 config；url：import 后 invalidate） */
export declare function installSkillFromTemplate(templateId: string, force?: boolean): Promise<InstallResult>;
//# sourceMappingURL=templates.d.ts.map