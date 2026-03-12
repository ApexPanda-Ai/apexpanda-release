/**
 * 配置加载：支持 .apexpanda/config.json + 环境变量覆盖
 * 支持 config 文件热加载：文件变更时自动重新读取，修改默认模型等无需重启
 */
import { EventEmitter } from 'node:events';
/** 配置重载时触发，用于启动新配置的渠道（如 Docker 下安装向导创建 config 后） */
export declare const configReloadEmitter: EventEmitter<[never]>;
import type { WorkflowChannelContext } from '../workflow/types.js';
import type { IntentMapping } from './default-intent-mappings.js';
import { DEFAULT_INTENT_MAPPINGS } from './default-intent-mappings.js';
export interface ChannelChannelConfig {
    /** 渠道绑定的默认 ApexPanda Agent ID（@ 未匹配时使用） */
    defaultAgentId?: string;
    /** 是否解析 @Agent 格式，false 时仅用 defaultAgentId，默认 true */
    mentionEnabled?: boolean;
    /** 飞书/Lark: FEISHU_APP_ID / appId */
    appId?: string;
    /** 飞书/Lark: FEISHU_APP_SECRET / appSecret */
    appSecret?: string;
    /** Telegram / Slack: Bot Token */
    botToken?: string;
    /** Slack: Signing Secret（Webhook 模式验证请求） */
    signingSecret?: string;
    /** Slack: App-Level Token（Socket 模式，xapp- 开头，需 connections:write） */
    appToken?: string;
    /** WhatsApp Cloud API: Verify Token（Webhook 校验） */
    verifyToken?: string;
    /** WhatsApp Cloud API: Access Token */
    accessToken?: string;
    /** WhatsApp Cloud API: Phone Number ID（发送消息用） */
    phoneNumberId?: string;
    /** 钉钉群机器人 Webhook URL（主动推送用，Outgoing 机器人用 sessionWebhook） */
    webhookUrl?: string;
    /** 企业微信: CorpID */
    corpId?: string;
    /** 企业微信: 应用 AgentId */
    agentId?: string;
    /** 企业微信: 应用 Secret（用于获取 access_token 主动回复） */
    secret?: string;
    /** 企业微信: 回调验证 Token（接收消息配置页填写） */
    token?: string;
    /** 企业微信: 消息加密 EncodingAESKey（接收消息配置页填写，43位Base64） */
    encodingAESKey?: string;
    /** 是否启用，false 时停用渠道（配置保留），默认 true */
    enabled?: boolean;
    /** 是否允许通过渠道消息创建 Agent，false 时禁用，默认 true */
    agentCreateEnabled?: boolean;
}
export interface ModelPreset {
    label: string;
    model: string;
}
/** 按模型存储的独立 endpoint（baseUrl + apiKey），互不覆盖 */
export interface ModelEndpoint {
    baseUrl: string;
    apiKey?: string;
}
export type { IntentMapping };
export { DEFAULT_INTENT_MAPPINGS };
/** Per-skill 配置（OpenClaw 兼容：skills.entries.<name>） */
export interface SkillEntryConfig {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
    config?: Record<string, unknown>;
}
export interface ApexConfig {
    /** 全局默认 Agent ID（渠道未配置 defaultAgentId 时兜底） */
    defaultAgentId?: string;
    /** OpenClaw 兼容：按技能名覆盖 env/apiKey/config */
    skills?: {
        entries?: Record<string, SkillEntryConfig>;
    };
    llm?: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        /** 输出 token 上限，默认 32768。环境变量 APEXPANDA_MAX_OUTPUT_TOKENS 可覆盖 */
        maxOutputTokens?: number;
        /** 主模型不可用时自动切换的备用模型（故障转移） */
        fallbackModel?: string;
        /** Agent 可选模型列表（系统配置中配置） */
        modelPresets?: ModelPreset[];
        /** 按模型存储 baseUrl+apiKey，各模型独立，互不覆盖 */
        endpoints?: Record<string, ModelEndpoint>;
    };
    workspace?: string;
    port?: number;
    /** 渠道配置（环境变量优先） */
    channels?: Record<string, ChannelChannelConfig>;
    /** 自定义意图映射（如「打开内网」→ 特定 URL） */
    intentMappings?: IntentMapping[];
    /** 创新模式：多 Agent 讨论配置（可选） */
    discussion?: {
        defaultRounds?: number;
        maxRounds?: number;
        maxAgents?: number;
        endPhrases?: string[];
        timeoutMinutes?: number;
    };
    /** 多 Agent 协同配置（@ 多个 Agent 时） */
    multiAgent?: {
        /** 主控选择策略：workerIds=有 workerIds 且含其他 @ 者优先；first=第一个 @ 为主控；capability=按 skillIds/category 与任务匹配打分 */
        leaderSelection?: 'workerIds' | 'first' | 'capability';
        /** 协同模式：supervisor=主从式；pipeline=流水线；parallel=并行；plan=动态规划（LLM 生成 DAG，工作流执行） */
        collabMode?: 'supervisor' | 'pipeline' | 'parallel' | 'plan';
        /** plan 模式是否要求人工确认后再执行，默认 false */
        planConfirmRequired?: boolean;
        /** 规则不命中时是否启用 LLM 推理兜底选择模式，默认 true */
        llmModeSelectionFallback?: boolean;
    };
    /** 删除操作是否需二次确认，默认 true；环境变量 APEXPANDA_DELETE_CONFIRM_REQUIRED 可覆盖 */
    deleteConfirmRequired?: boolean;
    /** 工作流相关配置 */
    workflows?: {
        /** 定时任务结果推送目标：channel + chatId(飞书/企微/Telegram) 或 sessionWebhook(钉钉) */
        cronOutput?: {
            channel: string;
            chatId?: string;
            sessionWebhook?: string;
        };
    };
    /** MCP 客户端配置（连接外部 MCP Server，注入 Agent 工具） */
    mcp?: {
        client?: {
            servers?: Array<{
                id: string;
                transport: 'stdio';
                command: string;
                args: string[];
                env?: Record<string, string>;
            }>;
            /** tools/call 超时（毫秒），默认 60000 */
            callTimeoutMs?: number;
            /** 单 MCP 连接阶段超时（毫秒），默认 15000；可设 APEXPANDA_MCP_CONNECT_TIMEOUT_MS */
            connectTimeoutMs?: number;
            /** 可执行命令白名单，如 ["npx","node","python"]；空/不配置则不做限制 */
            allowedCommands?: string[];
        };
        /** 额外 Registry 列表，与默认官方 Registry 并列可选；需认证的（如 ModelScope）可配 token */
        registries?: Array<{
            url: string;
            token?: string;
        } | string>;
    };
    /** 知识库 RAG 配置（可选） */
    knowledge?: {
        /** 混合检索（BM25+本地向量），true=启用；环境变量 APEXPANDA_HYBRID_SEARCH_ENABLED 可覆盖 */
        hybridSearch?: {
            enabled?: boolean;
        };
        /** Embedding 语义检索开关（仅回退模式生效）；环境变量 APEXPANDA_EMBEDDING_ENABLED 优先 */
        embedding?: {
            enabled?: boolean;
        };
        rerank?: {
            enabled?: boolean;
            provider?: 'local' | 'cohere' | 'jina';
            model?: string;
            topK?: number;
            apiKey?: string;
        };
    };
    /** 长期记忆配置（可选） */
    memory?: {
        persist?: boolean;
        /** fact 记忆半衰期（天），0 表示永不衰减，默认 30 */
        decayHalfLifeDays?: number;
        /** Phase 2: log 分层半衰期（天），log 记忆衰减更快，默认 7 */
        logHalfLifeDays?: number;
        /** Phase 2: 持久化时同步导出 Markdown 便于人工查看 */
        exportMarkdown?: boolean;
        /** Phase 4: 每 N 轮对话后 LLM 提取关键信息写入 memory，0 表示关闭 */
        postDialogueFlushRounds?: number;
        /** Phase 4: 会话截断前提取即将丢失的消息中的记忆 */
        preCompactionFlush?: boolean;
        /** Phase 4: memory_search 是否包含近期 session 内容 */
        sessionIndexInSearch?: boolean;
        /** Phase 6: 每个 scope 最多保留的记忆条目数，超出时自动清理衰减最重的条目，0 表示不限制，默认 500 */
        maxEntriesPerScope?: number;
        /** 活起来 P1: 检索时是否融入会话上下文 boost，与当前对话主题相关的记忆加分，默认 true */
        sessionContextBoost?: boolean;
        /** 活起来 P2: 是否启用图扩展（1 跳联想），从高相关记忆扩散到内容相似的记忆，默认 true */
        graphExpand?: boolean;
        /** 活起来 P3: 是否启用周期性 consolidation（聚类+LLM 摘要+归档），默认 false（需 LLM） */
        consolidationEnabled?: boolean;
        /** 活起来 P3: consolidation 定时 cron，如 "0 2 * * *" 每天 2 点，空则禁用 */
        consolidationCron?: string;
        /** 每次对话前自动预注入的相关记忆条数，0 表示关闭，默认 5；memory_search 仍可用于深度检索 */
        preInjectTopK?: number;
    };
}
/** 获取有效意图映射：内置默认 + 用户自定义，同 phrase 时用户覆盖默认 */
export declare function getEffectiveIntentMappings(): IntentMapping[];
export declare function getConfigPath(): string;
export declare function loadConfig(): Promise<ApexConfig>;
export declare function getConfigSync(): ApexConfig;
/** 获取 OpenClaw 兼容的 per-skill 环境变量（用于脚本执行时注入） */
export declare function getSkillEntryEnv(skillName: string, primaryEnv?: string, altKey?: string): Record<string, string>;
/** 获取 per-skill 的 config（供 OpenClaw 脚本通过 APEX_SKILL_CONFIG 环境变量读取） */
export declare function getSkillEntryConfig(skillName: string, altKey?: string): Record<string, unknown>;
/** 清除缓存，下次 loadConfig 会重新读取 */
export declare function invalidateConfigCache(): void;
/** 启动 config 文件监视，变更时自动热加载（无需重启网关） */
/** 若启动时文件不存在（如 Docker 首次运行），则轮询等待文件创建后再注册 watch */
export declare function startConfigWatch(): void;
/** 保存配置到 config.json（合并现有配置），保存后立即更新内存缓存 */
export declare function saveConfig(patch: Partial<ApexConfig> & {
    llm?: Partial<ApexConfig['llm']> & {
        endpoints?: Record<string, ModelEndpoint>;
        endpointsToRemove?: string[];
    };
}): Promise<void>;
export declare function getFeishuAppId(): string;
export declare function getFeishuAppSecret(): string;
export declare function getTelegramBotToken(): string;
export declare function getSlackBotToken(): string;
export declare function getSlackSigningSecret(): string;
export declare function getSlackAppToken(): string;
export declare function getDiscordBotToken(): string;
export declare function getWhatsAppVerifyToken(): string;
export declare function getWhatsAppAccessToken(): string;
export declare function getWhatsAppPhoneNumberId(): string;
export declare function getDingTalkWebhookUrl(): string;
export declare function getWeComCorpId(): string;
export declare function getWeComAgentId(): string;
export declare function getWeComSecret(): string;
export declare function getWeComToken(): string;
export declare function getWeComEncodingAESKey(): string;
/** 获取微信公众号 AppID（用于 wechat-mp-publish skill，来源：环境变量或 skills.entries） */
export declare function getWechatMpAppId(): string;
/** 获取微信公众号 AppSecret */
export declare function getWechatMpAppSecret(): string;
/** 获取全局默认 Agent ID（Chat 页面未选 Agent、渠道未配置 defaultAgentId 时使用） */
export declare function getDefaultAgentId(): string | undefined;
/** 获取渠道绑定的默认 ApexPanda Agent ID（@ 未匹配时使用），渠道未配置时回退到全局 defaultAgentId */
export declare function getChannelDefaultAgentId(channelId: string): string | undefined;
/** 渠道是否启用 @Agent 解析，默认 true */
export declare function getChannelMentionEnabled(channelId: string): boolean;
/** 定时工作流结果推送目标，配置 workflows.cronOutput 后返回 { channel, ctx } */
export declare function getWorkflowCronOutputConfig(): {
    channel: string;
    ctx: WorkflowChannelContext;
} | null;
/** 判断渠道是否已配置并启用（有凭证且未手动停用） */
export declare function isChannelConfigured(channelId: string): boolean;
/** 渠道是否有有效凭证（用于 UI 显示停用/启用按钮） */
export declare function hasChannelCredentialsForUi(channelId: string): boolean;
/** 渠道是否允许通过消息创建 Agent（channels.<id>.agentCreateEnabled，默认 true） */
export declare function isChannelAgentCreateEnabled(channelId: string): boolean;
export interface MemoryConfigResolved {
    persist: boolean;
    /** fact 记忆半衰期（天），0 表示永不衰减 */
    decayHalfLifeDays: number;
    logHalfLifeDays: number;
    exportMarkdown: boolean;
    postDialogueFlushRounds: number;
    preCompactionFlush: boolean;
    sessionIndexInSearch: boolean;
    /** Phase 6: 每 scope 最多条目数，0 = 不限制 */
    maxEntriesPerScope: number;
    /** 活起来 P1: 会话上下文 boost 开关 */
    sessionContextBoost: boolean;
    /** 活起来 P2: 图扩展开关 */
    graphExpand: boolean;
    /** 活起来 P3: consolidation 开关 */
    consolidationEnabled: boolean;
    /** 活起来 P3: consolidation cron 表达式 */
    consolidationCron: string;
    /** 每次对话前自动预注入的相关记忆条数，0 = 关闭 */
    preInjectTopK: number;
}
/** 获取长期记忆配置，未配置时使用默认值 */
export declare function getMemoryConfig(): MemoryConfigResolved;
/** 获取多 Agent 协同配置 */
export declare function getMultiAgentConfig(): {
    leaderSelection: 'workerIds' | 'first' | 'capability';
    collabMode: 'supervisor' | 'pipeline' | 'parallel' | 'plan';
    planConfirmRequired: boolean;
    llmModeSelectionFallback: boolean;
};
/** 获取讨论配置（创新模式），未配置时使用默认值 */
export declare function getDiscussionConfig(): {
    defaultRounds: number;
    maxRounds: number;
    maxAgents: number;
    endPhrases: string[];
    timeoutMinutes: number;
};
/** 混合检索是否启用（config 优先，env APEXPANDA_HYBRID_SEARCH_ENABLED 可覆盖） */
export declare function getHybridSearchEnabled(): boolean;
/** 知识库 Rerank 配置（环境变量 APEXPANDA_RERANK_ENABLED 可覆盖 enabled） */
export declare function getKnowledgeRerankConfig(): {
    enabled: boolean;
    provider: 'local' | 'cohere' | 'jina';
    model?: string;
    topK?: number;
    apiKey?: string;
} | null;
/** 获取 LLM baseUrl（config 优先，env 覆盖） */
export declare function getLLMBaseUrl(): string;
/** 是否仅从环境变量读取密钥（禁用 config.json 中的明文） */
export declare function isSecretsFromEnvOnly(): boolean;
/** 获取 LLM API Key（APEXPANDA_SECRETS_FROM_ENV_ONLY=true 时不读 config.json） */
export declare function getLLMApiKey(): string;
/** 获取 LLM 模型（config 优先级：当 config 有 endpoints 时，使用 config.model，便于 Settings 选择生效） */
export declare function getLLMModel(): string;
/** 获取 LLM 备用模型（主模型失败时自动切换） */
export declare function getLLMFallbackModel(): string | undefined;
/** 获取 LLM 输出 token 上限，默认 8192（兼容大部分 API；环境变量 APEXPANDA_MAX_OUTPUT_TOKENS 可覆盖） */
export declare function getMaxOutputTokens(): number;
/** 根据 model 获取对应 baseUrl + apiKey；无 endpoint 时用全局 baseUrl/apiKey */
export declare function getLLMConfigForModel(model: string): {
    baseUrl: string;
    apiKey: string;
};
/** 获取工作区目录 */
export declare function getWorkspaceDir(): string;
/** 获取 Agent 产出根目录（相对工作区），默认 .apexpanda/output */
export declare function getOutputDir(): string;
/** 删除操作是否需二次确认，默认 true；环境变量优先，其次 config */
export declare function getDeleteConfirmRequired(): boolean;
/**
 * 根据 Agent 可见性与会话信息，推导产出基础路径（相对工作区）
 * 与记忆 scope 设计一致：shared→user/group；agent-only→agent/{id}/user|group/...
 */
export declare function getOutputBasePath(opts: {
    agentId?: string;
    agentMemoryVisibility?: "shared" | "agent-only";
    userId?: string;
    memoryScopeHint?: string;
}): string;
//# sourceMappingURL=loader.d.ts.map