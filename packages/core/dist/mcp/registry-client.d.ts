/**
 * MCP Registry 客户端：从官方 Registry 拉取 MCP Server 列表与详情
 * API: https://registry.modelcontextprotocol.io/v0/servers
 */
export interface RegistryPackage {
    registryType?: string;
    registryBaseUrl?: string;
    identifier?: string;
    version?: string;
    transport?: {
        type: string;
        url?: string;
    };
    runtimeHint?: string;
    runtimeArguments?: unknown[];
    packageArguments?: Array<{
        type?: string;
        name?: string;
        value?: string;
        valueHint?: string;
        default?: string;
        isRequired?: boolean;
    }>;
    environmentVariables?: Array<{
        name?: string;
        description?: string;
        value?: string;
        isSecret?: boolean;
    }>;
}
/** MCP Registry 中的 remote 条目：SSE/Streamable HTTP 远程服务 */
export interface RegistryRemote {
    type?: string;
    url?: string;
    headers?: Array<{
        name?: string;
        description?: string;
        isRequired?: boolean;
        isSecret?: boolean;
    }>;
}
export interface RegistryServer {
    name?: string;
    title?: string;
    description?: string;
    version?: string;
    repository?: {
        url?: string;
        source?: string;
    };
    websiteUrl?: string;
    packages?: RegistryPackage[];
    /** 远程托管服务（SSE/Streamable HTTP），无 packages 时使用 */
    remotes?: RegistryRemote[];
}
export interface RegistryServerItem {
    server: RegistryServer;
    _meta?: {
        'io.modelcontextprotocol.registry/official'?: {
            status?: string;
            publishedAt?: string;
            updatedAt?: string;
            isLatest?: boolean;
        };
    };
}
export interface RegistryListResponse {
    servers: RegistryServerItem[];
    metadata?: {
        nextCursor?: string;
        count?: number;
    };
}
/** 从 Registry 拉取服务器列表；registryUrl 为空则用默认官方地址；token 用于需认证的仓库（如 ModelScope） */
export declare function fetchRegistryServers(params?: {
    limit?: number;
    cursor?: string;
    search?: string;
    /** 指定 Registry 基地址，不传则用默认官方 */
    registryUrl?: string;
    /** 访问令牌，如 ModelScope SDK TOKEN，用于 Authorization: Bearer */
    token?: string;
}): Promise<RegistryListResponse>;
export type McpClientEntry = {
    id: string;
    transport: 'stdio';
    command: string;
    args: string[];
    env?: Record<string, string>;
} | {
    id: string;
    transport: 'sse';
    url: string;
};
/** 将 Registry 的 remotes（SSE/Streamable HTTP）解析为 mcp.client.servers 的条目 */
export declare function registryRemoteToClientEntry(remote: RegistryRemote, serverId: string): McpClientEntry | null;
/** 从 RegistryServer 解析首个可安装条目：先 packages，再 remotes */
export declare function registryServerToClientEntry(srv: RegistryServer, serverId: string, userArgs?: Record<string, string>): McpClientEntry | null;
/** 将 Registry 的 npm / pypi / docker / nuget / sse 包解析为 mcp.client.servers 的条目 */
export declare function registryPackageToClientEntry(pkg: RegistryPackage, serverId: string, userArgs?: Record<string, string>): McpClientEntry | null;
//# sourceMappingURL=registry-client.d.ts.map