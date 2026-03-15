/**
 * APEX_SKILL.yaml 规范
 * 权限声明必须显式，默认拒绝
 */
export interface ApexSkillManifest {
    name: string;
    version: string;
    description: string;
    author?: string;
    license?: string;
    /** 权限声明（必须显式声明，否则无权限） */
    permissions?: SkillPermission[];
    /** 工具能力（供 LLM 调用的 tools） */
    tools?: SkillTool[];
    compatibility?: {
        apexAgent: string;
        openClaw?: boolean;
    };
    /** OpenClaw 扩展：加载时过滤用（requires.bins、os 等） */
    openclawMeta?: {
        requires?: {
            bins?: string[];
            anyBins?: string[];
            env?: string[];
            config?: string[];
        };
        primaryEnv?: string;
        os?: string[];
        /** SKILL.md frontmatter 中声明的主脚本路径（相对于 skill 根，如 scripts/xxx.py） */
        mainScript?: string;
    };
    /** Skills 页面展示分类，如"多媒体"、"企业协作" */
    category?: string;
    /** env 变量字段定义，用于 Skills UI 表单模式 */
    envFields?: SkillEnvField[];
    /** 每个工具的默认测试参数（JSON 字符串），toolId → JSON string */
    defaultParams?: Record<string, string>;
    /** 模版列表标签，如 ["免费","无需Key"] */
    tags?: string[];
    /** 依赖的外部服务，如 ["百度 AI 开放平台"] */
    externalServices?: string[];
    /** 是否在模版列表中展示，false 时不在「从模版安装」中显示 */
    showInTemplates?: boolean;
}
/** env 表单字段定义 */
export interface SkillEnvField {
    key: string;
    label: string;
    type?: 'text' | 'password' | 'url';
    placeholder?: string;
    group?: string;
}
export interface SkillPermission {
    id: string;
    scope: 'read' | 'write' | 'outbound' | string;
    path?: string;
    keys?: string[];
    description?: string;
}
export interface SkillTool {
    id: string;
    description: string;
    handler: string;
    /** JSON Schema 格式的工具参数定义，供 LLM function calling 使用。有则优先于 TOOL_PARAMETERS 静态表 */
    parameters?: object;
}
//# sourceMappingURL=apex-skill.schema.d.ts.map