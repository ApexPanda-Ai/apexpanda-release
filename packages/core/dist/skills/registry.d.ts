import type { LoadedSkill } from './loader.js';
/** 加载所有可用 Skills（优先级：workspace > extraDirs > managed > bundled，高优先级覆盖低） */
export declare function loadAllSkills(): Promise<LoadedSkill[]>;
/** 清除缓存，下次 loadAllSkills 会重新加载 */
export declare function invalidateSkillsCache(): void;
/** 技能热重载：监听目录变化，自动清除缓存（APEXPANDA_SKILLS_WATCH=true 时启用） */
export declare function startSkillsWatch(): void;
/** 按 name 查找 Skill */
export declare function findSkill(name: string): Promise<LoadedSkill | null>;
/** 执行工具 */
export declare function invokeTool(skillName: string, toolId: string, params: Record<string, unknown>, execContext?: {
    sessionId?: string;
    sessionHistory?: Array<{
        role: string;
        content: string;
    }>;
    memoryScopeHint?: string;
    agentId?: string;
    deleteSource?: 'user' | 'channel' | 'agent';
}): Promise<unknown>;
export interface GetToolsForLLMOptions {
    /** 该 Agent 可用的 MCP Server ID 列表；undefined/null=全部，[]=无 MCP 工具 */
    mcpServerIds?: string[] | null;
    /** 该 Agent 可用的 Skill 名称列表；undefined/null=全部，[]=无 Skill 工具 */
    skillIds?: string[] | null;
    /**
     * 是否注入设备节点工具（node-invoke_*、node-list_list）。
     * undefined/true（默认）= 注入；false = 不注入，适合无需操作设备的角色 Agent。
     */
    nodeToolsEnabled?: boolean;
}
/** 获取供 invoke 使用的原始工具名（LLM 返回的是 sanitized name 时需解析） */
export declare function resolveToolNameForInvocation(nameFromLLM: string): string;
/** 获取供 LLM function calling 使用的工具列表 */
export declare function getToolsForLLM(options?: GetToolsForLLMOptions): Promise<Array<{
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}>>;
/** 按 LLM 返回的 function name 解析并调用（仅按第一个 _ 分割，因 toolId 可能含 _ 如 write_file） */
export declare function invokeToolByName(name: string, args: Record<string, unknown>, execContext?: {
    sessionId?: string;
    sessionHistory?: Array<{
        role: string;
        content: string;
    }>;
    memoryScopeHint?: string;
    agentId?: string;
    deleteSource?: 'user' | 'channel' | 'agent';
}): Promise<string>;
//# sourceMappingURL=registry.d.ts.map