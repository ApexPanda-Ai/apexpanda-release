export interface AgentDef {
    id: string;
    name: string;
    /** 渠道 @ 时使用的短别名，如 kf → 客服助手 */
    handle?: string;
    description?: string;
    /** 公司/业务分类，如 内容创作、独立开发、咨询顾问 等 */
    category?: string;
    model?: string;
    systemPrompt?: string;
    /** Worker Agent IDs，用于 Supervisor-Worker 模式，可委托子任务 */
    workerIds?: string[];
    /** 该 Agent 可用的 MCP Server ID 列表，空/undefined 表示使用全部 */
    mcpServerIds?: string[];
    /**
     * Phase 7 记忆可见性：
     * - shared（默认）：记忆写入 user/group scope，所有 Agent 共享
     * - agent-only：记忆写入 agent:{id}:user:{uid} 专属 scope，仅本 Agent 可见
     */
    memoryVisibility?: 'shared' | 'agent-only';
    /** 设备节点：优先使用指定 nodeId 执行 node-invoke（方案 §5.5） */
    preferredNodeId?: string;
    /** 该 Agent 可用的 Skill 名称列表；undefined=全部，[]=无 Skill 工具 */
    skillIds?: string[];
    /**
     * 是否允许使用设备节点工具（node-invoke_*、node-list_list）。
     * undefined/true（默认）= 允许；false = 禁止注入 node 工具，适合不需要操作设备的角色（如任务分解 Agent）。
     */
    nodeToolsEnabled?: boolean;
    /** 3D 沙盘形象：modelId 人物预设（character1~8），color 十六进制，position 自由布局时的 [x,z] 或 [x,y,z] */
    avatar3d?: {
        modelId?: string;
        color?: string;
        position?: [number, number] | [number, number, number];
    };
    createdAt: string;
    updatedAt: string;
}
export declare function listAgents(): Promise<AgentDef[]>;
export declare function getAgent(id: string): Promise<AgentDef | null>;
export declare function createAgent(input: {
    name: string;
    handle?: string;
    description?: string;
    category?: string;
    model?: string;
    systemPrompt?: string;
    workerIds?: string[];
    mcpServerIds?: string[];
    preferredNodeId?: string;
    skillIds?: string[];
    nodeToolsEnabled?: boolean;
    avatar3d?: {
        modelId?: string;
        color?: string;
    };
}): Promise<AgentDef>;
export declare function updateAgent(id: string, patch: Partial<Pick<AgentDef, 'name' | 'handle' | 'description' | 'category' | 'model' | 'systemPrompt' | 'workerIds' | 'memoryVisibility' | 'preferredNodeId' | 'mcpServerIds' | 'nodeToolsEnabled' | 'avatar3d'>> & {
    skillIds?: string[] | null;
}): Promise<AgentDef | null>;
export declare function deleteAgent(id: string): Promise<boolean>;
//# sourceMappingURL=store.d.ts.map