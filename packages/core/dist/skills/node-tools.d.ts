/**
 * node-invoke / node-list 工具定义与参数 schema
 * 这两个"虚拟 skill"由 registry 动态注入，无对应 APEX_SKILL.yaml，
 * 因此 schema 集中维护在此文件，由 registry.ts 导入。
 */
/** 平台类型：headless=Linux/Windows 无界面节点，desktop=Electron 桌面，android=Android 手机 */
export type NodePlatformType = 'headless' | 'desktop' | 'android';
/** node-invoke 每个工具的 capability 映射、支持平台与描述 */
export declare const NODE_INVOKE_TOOLS: Array<{
    toolId: string;
    capability: string;
    /** 支持该能力的平台；用于生成平台相关描述 */
    platforms: NodePlatformType[];
    description: string;
}>;
/** node-invoke 各工具的参数 schema */
export declare const NODE_INVOKE_PARAMETERS: Record<string, object>;
/** node-list_list 参数 schema */
export declare const NODE_LIST_PARAMETERS: object;
//# sourceMappingURL=node-tools.d.ts.map