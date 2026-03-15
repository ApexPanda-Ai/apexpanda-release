export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
}
export interface McpClientConnection {
    serverId: string;
    tools: McpTool[];
    callTool(name: string, args: Record<string, unknown>): Promise<string>;
    close(): void;
}
/** 按 config 连接所有 MCP Server，缓存 connections。并行连接 + 单 MCP 超时。 */
export declare function ensureMcpConnections(opts?: {
    fastPathTimeoutMs?: number;
}): Promise<McpClientConnection[]>;
/** 关闭所有 MCP 连接 */
export declare function closeMcpConnections(): void;
/** 获取 MCP 工具列表（供 getToolsForLLM 合并）。启用快速路径时，超时则返回 [] 不阻塞渠道。 */
export declare function getMcpTools(opts?: {
    fastPathTimeoutMs?: number;
}): Promise<Array<{
    serverId: string;
    tools: McpTool[];
}>>;
/** 单独测试某个 MCP Server 连接并返回其 tools（一次性连接，不缓存） */
export declare function testMcpServerConnection(serverId: string): Promise<{
    serverId: string;
    tools: McpTool[];
} | {
    serverId: string;
    error: string;
}>;
/** 调用 MCP 工具，name 格式为 mcp_<serverId>_<toolName> */
export declare function invokeMcpTool(name: string, args: Record<string, unknown>): Promise<string>;
//# sourceMappingURL=client.d.ts.map