/**
 * MCP Registry 客户端：从官方 Registry 拉取 MCP Server 列表与详情
 * API: https://registry.modelcontextprotocol.io/v0/servers
 */
const REGISTRY_BASE = process.env.APEXPANDA_MCP_REGISTRY_URL ?? 'https://registry.modelcontextprotocol.io';
/** 从 Registry 拉取服务器列表；registryUrl 为空则用默认官方地址；token 用于需认证的仓库（如 ModelScope） */
export async function fetchRegistryServers(params) {
    const base = (params?.registryUrl?.trim() && params.registryUrl.startsWith('http'))
        ? params.registryUrl.replace(/\/$/, '')
        : REGISTRY_BASE;
    const url = new URL(`${base}/v0/servers`);
    if (params?.limit)
        url.searchParams.set('limit', String(params.limit));
    if (params?.cursor)
        url.searchParams.set('cursor', params.cursor);
    if (params?.search)
        url.searchParams.set('search', params.search);
    const headers = {};
    if (params?.token?.trim())
        headers['Authorization'] = `Bearer ${params.token.trim()}`;
    const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(15000),
        headers: Object.keys(headers).length ? headers : undefined,
    });
    if (!res.ok)
        throw new Error(`Registry API error: ${res.status}`);
    return res.json();
}
/** 收集 packageArguments 与 environmentVariables 到 args/env */
function applyPackageArgs(pkg, userArgs, baseArgs) {
    const args = [...baseArgs];
    for (const arg of pkg.packageArguments ?? []) {
        if (arg.type === 'named' && arg.name) {
            const val = userArgs?.[arg.name] ?? arg.value ?? arg.default;
            if (val != null && val !== '') {
                args.push(`--${arg.name}`, String(val));
            }
        }
        else if (arg.type === 'positional' && (arg.value ?? arg.valueHint)) {
            const vh = arg.valueHint;
            const val = userArgs?.[vh ?? ''] ?? arg.value ?? arg.default;
            if (val != null && val !== '')
                args.push(String(val));
        }
    }
    const env = {};
    for (const ev of pkg.environmentVariables ?? []) {
        if (ev.name && (userArgs?.[ev.name] ?? ev.value)) {
            env[ev.name] = String(userArgs?.[ev.name] ?? ev.value ?? '');
        }
    }
    return { args, env };
}
/** 将 Registry 的 remotes（SSE/Streamable HTTP）解析为 mcp.client.servers 的条目 */
export function registryRemoteToClientEntry(remote, serverId) {
    const t = (remote?.type ?? '').toLowerCase().replace(/-/g, '_');
    const url = remote?.url?.trim();
    if (!url || !url.startsWith('http'))
        return null;
    if (t === 'sse' || t === 'streamable_http') {
        return { id: serverId, transport: 'sse', url };
    }
    return null;
}
/** 从 RegistryServer 解析首个可安装条目：先 packages，再 remotes */
export function registryServerToClientEntry(srv, serverId, userArgs) {
    for (const pkg of srv.packages ?? []) {
        const e = registryPackageToClientEntry(pkg, serverId, userArgs);
        if (e)
            return e;
    }
    for (const remote of srv.remotes ?? []) {
        const e = registryRemoteToClientEntry(remote, serverId);
        if (e)
            return e;
    }
    return null;
}
/** 将 Registry 的 npm / pypi / docker / nuget / sse 包解析为 mcp.client.servers 的条目 */
export function registryPackageToClientEntry(pkg, serverId, userArgs) {
    const rt = (pkg.registryType ?? '').toLowerCase();
    const transportType = (pkg.transport?.type ?? '').toLowerCase();
    // SSE / Streamable HTTP 远程服务：只需 URL，无需本地安装
    if (transportType === 'sse' || transportType === 'streamable_http') {
        const url = pkg.transport?.url?.trim();
        if (!url || !url.startsWith('http'))
            return null;
        return { id: serverId, transport: 'sse', url };
    }
    if (!pkg.identifier || transportType !== 'stdio')
        return null;
    // npm
    if (rt === 'npm') {
        const command = pkg.runtimeHint === 'npx' ? 'npx' : 'npx';
        const version = pkg.version && pkg.version !== 'latest' ? `@${pkg.version}` : '';
        const baseArgs = ['-y', `${pkg.identifier}${version}`];
        const { args, env } = applyPackageArgs(pkg, userArgs, baseArgs);
        return {
            id: serverId,
            transport: 'stdio',
            command,
            args,
            env: Object.keys(env).length ? env : undefined,
        };
    }
    // pypi (Python)
    if (rt === 'pypi') {
        const cmd = pkg.runtimeHint === 'pipx' ? 'pipx' : 'uvx';
        const baseArgs = pkg.runtimeHint === 'pipx'
            ? ['run', pkg.identifier + (pkg.version && pkg.version !== 'latest' ? `==${pkg.version}` : '')]
            : [pkg.identifier + (pkg.version && pkg.version !== 'latest' ? `==${pkg.version}` : '')];
        const { args, env } = applyPackageArgs(pkg, userArgs, baseArgs);
        return {
            id: serverId,
            transport: 'stdio',
            command: cmd,
            args,
            env: Object.keys(env).length ? env : undefined,
        };
    }
    // docker / oci
    if (rt === 'docker' || rt === 'oci') {
        const image = pkg.identifier + (pkg.version && pkg.version !== 'latest' ? `:${pkg.version}` : ':latest');
        const { args: pkgArgs, env } = applyPackageArgs(pkg, userArgs, []);
        const dockerArgs = ['run', '-i', '--rm'];
        for (const [k, v] of Object.entries(env)) {
            if (v)
                dockerArgs.push('-e', `${k}=${v}`);
        }
        dockerArgs.push(image);
        dockerArgs.push(...pkgArgs);
        return {
            id: serverId,
            transport: 'stdio',
            command: 'docker',
            args: dockerArgs,
        };
    }
    // nuget (.NET)：dotnet tool exec 为 .NET 10+ 的 npx 等价，旧版 .NET 可能不支持
    if (rt === 'nuget') {
        const pkgId = pkg.identifier + (pkg.version && pkg.version !== 'latest' ? `@${pkg.version}` : '');
        const baseArgs = ['tool', 'exec', pkgId];
        const { args, env } = applyPackageArgs(pkg, userArgs, baseArgs);
        return {
            id: serverId,
            transport: 'stdio',
            command: 'dotnet',
            args,
            env: Object.keys(env).length ? env : undefined,
        };
    }
    return null;
}
//# sourceMappingURL=registry-client.js.map