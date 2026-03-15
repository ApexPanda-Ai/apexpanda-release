import type { LoadedSkill } from './loader.js';
/** YAML 上传时，handler 必须在此白名单内（禁止引用未声明的内置 handler） */
export declare const BUILTIN_HANDLER_KEYS: Set<string>;
export type ToolHandler = (params: Record<string, unknown>, ctx?: ExecContext) => Promise<unknown>;
export interface ExecContext {
    workspaceDir: string;
    sessionId?: string;
    /** Skills UI 配置的 per-skill 环境变量，优先于 process.env */
    skillEnv?: Record<string, string>;
    /** Phase 4: 近期会话内容，memory#search 可纳入检索（sessionIndexInSearch 开启时） */
    sessionHistory?: Array<{
        role: string;
        content: string;
    }>;
    /** Phase 5: 细粒度 scope 提示，如 user:xxx、group:yyy，memory 工具优先于 sessionId */
    memoryScopeHint?: string;
    /** Phase 7: 当前 Agent ID，用于按 Agent 隔离记忆 scope */
    agentId?: string;
    /** Phase 7: 当前 Agent 记忆可见性，agent-only 时写入/检索 Agent 专属 scope */
    agentMemoryVisibility?: 'shared' | 'agent-only';
    /** Phase 7: 当前用户 ID，群组 agent-only 场景需要三维 scope 隔离防成员信息泄露 */
    userId?: string;
    /** 删除操作来源：user/channel=需二次确认（当 deleteConfirmRequired 时），agent=不弹确认 */
    deleteSource?: 'user' | 'channel' | 'agent';
}
/** 获取技能 env：优先 ctx.skillEnv，否则 process.env */
export declare function getSkillEnv(ctx: ExecContext | undefined, key: string): string;
/** 长期记忆存储：scope -> [{ id, key?, content, ts, tier?, sourceAgentId?, lastAccessedAt?, accessCount? }] */
type MemoryEntry = {
    id: string;
    key?: string;
    content: string;
    ts: number;
    tier?: 'log' | 'fact';
    /** Phase 8: 来源 Agent ID，便于排查与未来过滤 */
    sourceAgentId?: string;
    /** 活起来 P0: 上次被检索命中的时间，用于访问强化 */
    lastAccessedAt?: number;
    /** 活起来 P0: 被检索命中的累计次数，越高权重越强 */
    accessCount?: number;
    /** 活起来 P3: 已 consolidation 压缩到语义层，降低检索权重 */
    archived?: boolean;
};
/** Phase 6: 供 extraction.ts 读取指定 scope 的全部记忆条目（含内容），用于冲突检测 */
export declare function getMemoriesForScope(scope: string): Promise<MemoryEntry[]>;
/** 活起来 P3: 获取所有 scope 列表，供 consolidation 使用 */
export declare function getMemoryScopes(): Promise<string[]>;
/** 活起来 P3: 标记条目为已归档，consolidation 后降权 */
export declare function markMemoriesArchived(scope: string, ids: string[]): Promise<void>;
/** 批量获取各 scope 的记忆条目数，供会话页面展示「关联记忆 X 条」 */
export declare function getMemoryCountsForScopes(scopes: string[]): Promise<Record<string, number>>;
/** 对话前预注入：根据当前消息检索最相关的记忆，供 runner 注入 system prompt；不更新 accessCount */
export type PreInjectMemoryCtx = {
    sessionId?: string;
    memoryScopeHint?: string;
    agentId?: string;
    agentMemoryVisibility?: 'shared' | 'agent-only';
    userId?: string;
    /** 可选：近期会话用于 context boost */
    sessionHistory?: Array<{
        role: string;
        content: string;
    }>;
};
export declare function searchMemoriesForPreInjection(query: string, ctx: PreInjectMemoryCtx | undefined, limit: number): Promise<Array<{
    content: string;
    key?: string;
}>>;
export declare function executeTool(skill: LoadedSkill, toolId: string, params: Record<string, unknown>, execContext?: Partial<ExecContext>): Promise<unknown>;
export {};
//# sourceMappingURL=executor.d.ts.map