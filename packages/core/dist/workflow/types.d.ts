/**
 * 工作流 DAG 类型定义
 */
/** 渠道上下文，与 server.ChannelContext 一致，避免循环依赖 */
export type WorkflowChannelContext = {
    messageId?: string;
    sessionWebhook?: string;
    chatId?: string;
    phoneNumberId?: string;
    /** 聊天类型 p2p=单聊 group=群聊，用于 memory/output scope */
    chatType?: 'p2p' | 'group';
    /** 发送者 ID（如飞书 open_id），用于 user scope */
    userId?: string;
};
export type WorkflowNodeType = 'agent' | 'skill' | 'human' | 'loop' | 'mcp';
export interface WorkflowNode {
    id: string;
    type: WorkflowNodeType;
    /**
     * agent: { agentId?, message?, systemPrompt?, mcpServerIds? }
     *   mcpServerIds: 可选，指定该节点使用的 MCP 服务器 ID 列表，覆盖 Agent 配置
     * skill: { skillName, toolId, params? }
     * mcp: { serverId, toolName, params? }
     *   serverId: MCP 服务器 ID，toolName: 工具名，params: 参数（支持 {{prev}}）
     * loop: {
     *   steps: string[],          // 循环体内的节点 ID 列表（顺序执行）
     *   exitCondition: string,    // 退出条件关键词（output 中含此词则退出）
     *   maxIterations: number,    // 最大迭代次数（默认 5）
     *   onProgress?: string,      // 可选：循环开始/每轮进度提示前缀
     * }
     */
    config: Record<string, unknown>;
}
export interface WorkflowEdge {
    from: string;
    to: string;
}
/** 消息触发：匹配命令如 /workflow 工作流名 或 /工作流 工作流名 */
export interface WorkflowTriggerMessage {
    type: 'message';
    /** 命令前缀，如 /workflow、/工作流，不包含名称部分 */
    command: string;
    /** 限制渠道，空则所有渠道 */
    channels?: string[];
    /** 是否启用 */
    enabled?: boolean;
}
/** 定时触发：cron 表达式 */
export interface WorkflowTriggerCron {
    type: 'cron';
    /** cron 表达式，如 "0 9 * * *" 每天 9 点 */
    expression: string;
    /** 是否启用 */
    enabled?: boolean;
}
export type WorkflowTrigger = WorkflowTriggerMessage | WorkflowTriggerCron;
export interface WorkflowDef {
    id: string;
    name: string;
    description?: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    /** triggers: 消息触发、定时触发等 */
    triggers?: WorkflowTrigger[];
    /** 定时/非渠道触发时的输出目标（渠道创建时自动填充，定时结果发回该群/会话） */
    outputChannelContext?: {
        channel: string;
        ctx: WorkflowChannelContext;
    };
}
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'pending_human';
export interface RunCheckpoint {
    runId: string;
    workflowId: string;
    status: RunStatus;
    stepOutputs: Record<string, unknown>;
    currentStep?: string;
    error?: string;
    startedAt: number;
    completedAt?: number;
    /** Human-in-the-loop: 等待人工输入的节点 ID */
    pendingHumanNode?: string;
    /** Human-in-the-loop: 节点配置的提示文案 */
    pendingHumanPrompt?: string;
    /** 渠道上下文：工作流完成后将结果发回 IM */
    channelContext?: {
        channel: string;
        ctx: WorkflowChannelContext;
    };
}
//# sourceMappingURL=types.d.ts.map