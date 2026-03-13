/**
 * OpenAPI 3.0 文档（内联生成）
 */
import { isAuthRequired } from './auth/api-key.js';
export function getOpenAPISpec() {
    const spec = {
        openapi: '3.0.0',
        info: { title: 'ApexPanda API', version: '0.1.0', description: 'ApexPanda 自托管 AI 智能体平台' },
        servers: [{ url: '/', description: 'Gateway' }],
        paths: {
            '/webhooks/workflow/{workflowId}': {
                post: {
                    summary: 'Webhook 触发工作流',
                    description: '需配置 APEXPANDA_WEBHOOK_SECRET 时，请求头需携带 X-Webhook-Secret',
                    parameters: [{ name: 'workflowId', in: 'path', required: true, schema: { type: 'string' } }],
                    requestBody: { content: { 'application/json': { schema: { type: 'object', description: '工作流输入参数' } } } },
                    responses: { 200: { description: 'runId, status, output' }, 401: {}, 404: {} },
                },
            },
            '/health': {
                get: {
                    summary: '健康检查',
                    responses: { 200: { description: 'OK' } },
                },
            },
            '/s/{code}': {
                get: {
                    summary: '短链重定向',
                    description: '访问短链时 302 跳转到原始 URL，由 shortlink Skill 创建',
                    parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { 302: { description: '重定向到长链接' }, 404: { description: '短链不存在' } },
                },
            },
            '/mcp/sse': {
                get: {
                    summary: 'MCP SSE 连接（Cursor/Claude Code 客户端接入）',
                    description: '建立 SSE 连接，收到 endpoint 后向该 endpoint POST JSON-RPC。支持 initialize、tools/list、tools/call。',
                    responses: { 200: { description: 'SSE stream' } },
                },
            },
            '/api/v1/status': {
                get: {
                    summary: '系统状态',
                    responses: { 200: { description: 'OK' } },
                },
            },
            '/api/v1/llm/test': {
                post: {
                    summary: '测试 LLM 连接',
                    responses: { 200: { description: 'OK 或错误详情' } },
                },
            },
            '/api/v1/config': {
                get: {
                    summary: '配置（脱敏）',
                    responses: { 200: { description: 'OK' } },
                },
            },
            '/api/v1/agents': {
                get: { summary: 'Agent 列表', responses: { 200: { description: 'OK' } } },
                post: {
                    summary: '创建 Agent',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { name: { type: 'string' }, description: {}, model: {}, systemPrompt: {} } },
                            },
                        },
                    },
                    responses: { 201: { description: 'Created' } },
                },
            },
            '/api/v1/agents/{id}': {
                get: { summary: 'Agent 详情', responses: { 200: {}, 404: {} } },
                patch: { summary: '更新 Agent', responses: { 200: {}, 404: {} } },
                delete: { summary: '删除 Agent', responses: { 200: {}, 404: {} } },
            },
            '/api/v1/chat': {
                post: {
                    summary: '对话',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        message: { type: 'string' },
                                        sessionId: { type: 'string' },
                                        agentId: { type: 'string' },
                                        tenantId: { type: 'string', description: '租户 ID，用于会话隔离' },
                                        history: { type: 'array' },
                                    },
                                    required: ['message'],
                                },
                            },
                        },
                    },
                    responses: { 200: { description: 'OK' } },
                },
            },
            '/api/v1/sessions': {
                get: {
                    summary: '会话列表',
                    parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string' } }],
                    responses: { 200: {} },
                },
            },
            '/api/v1/sessions/{id}': {
                get: {
                    summary: '会话详情',
                    parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string' } }],
                    responses: { 200: {}, 404: {} },
                },
                delete: {
                    summary: '清除会话',
                    parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string' } }],
                    responses: { 200: {} },
                },
            },
            '/api/v1/skills': {
                get: { summary: 'Skills 列表', responses: { 200: {} } },
            },
            '/api/v1/skills/import': {
                post: {
                    summary: '从本地路径导入 Skill（APEX_SKILL.yaml 或 SKILL.md）',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { path: { type: 'string', description: '本地目录绝对路径' } }, required: ['path'] },
                            },
                        },
                    },
                    responses: { 201: { description: 'Created' }, 400: {} },
                },
            },
            '/api/v1/skills/reload': {
                post: {
                    summary: '重新加载 Skills（从内置目录与用户目录）',
                    responses: { 200: { description: 'reloaded: number' } },
                },
            },
            '/api/v1/skills/invoke': {
                post: {
                    summary: '调用 Skill 工具',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: { skillName: {}, toolId: {}, params: {} },
                                    required: ['skillName', 'toolId'],
                                },
                            },
                        },
                    },
                    responses: { 200: {}, 400: {} },
                },
            },
            '/api/v1/knowledge': {
                get: { summary: '知识库列表', responses: { 200: {} } },
                post: {
                    summary: '存入知识库',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        chunks: {
                                            type: 'array',
                                            items: { type: 'object', properties: { id: {}, content: {} } },
                                        },
                                        file: { type: 'string', description: 'Base64 编码的文件内容（与 filename 一起使用）' },
                                        filename: { type: 'string', description: '文件名，支持 .pdf、.txt、.md' },
                                    },
                                },
                            },
                        },
                    },
                    responses: { 200: {}, 400: {} },
                },
                delete: { summary: '清空知识库', responses: { 200: {} } },
            },
            '/api/v1/knowledge/search': {
                post: {
                    summary: '知识库检索',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { query: {}, topK: {} } },
                            },
                        },
                    },
                    responses: { 200: {} },
                },
            },
            '/api/v1/channels': {
                get: { summary: '渠道列表', responses: { 200: {} } },
            },
            '/api/v1/channels/{id}': {
                patch: {
                    summary: '更新渠道配置',
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        appId: { type: 'string', description: '飞书 App ID' },
                                        appSecret: { type: 'string', description: '飞书 App Secret' },
                                        botToken: { type: 'string', description: 'Telegram/Slack Bot Token' },
                                        signingSecret: { type: 'string', description: 'Slack Signing Secret' },
                                        verifyToken: { type: 'string', description: 'WhatsApp Verify Token' },
                                        accessToken: { type: 'string', description: 'WhatsApp Access Token' },
                                        phoneNumberId: { type: 'string', description: 'WhatsApp Phone Number ID' },
                                    },
                                },
                            },
                        },
                    },
                    responses: { 200: { description: 'ok' }, 400: {}, 404: {} },
                },
            },
            '/api/v1/usage': {
                get: {
                    summary: 'Token 用量',
                    parameters: [{ name: 'days', in: 'query', schema: { type: 'integer' } }],
                    responses: { 200: {} },
                },
            },
            '/api/v1/compliance/user-data': {
                delete: {
                    summary: '用户数据删除（PIPL 被遗忘权）',
                    parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } }],
                    responses: { 200: { description: 'sessionsDeleted' } },
                },
            },
            '/api/v1/audit': {
                get: {
                    summary: '审计日志',
                    parameters: [
                        { name: 'limit', in: 'query', schema: { type: 'integer' } },
                        { name: 'type', in: 'query', schema: { type: 'string' } },
                        { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'debao'] }, description: 'debao=合规格式' },
                        { name: 'as', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] }, description: 'format=debao 时，导出为 json 或 csv' },
                    ],
                    responses: { 200: {} },
                },
            },
            '/api/v1/workflow-templates': {
                get: { summary: '工作流模板列表', responses: { 200: { description: 'templates: WorkflowTemplate[]' } } },
            },
            '/api/v1/workflows/from-template': {
                post: {
                    summary: '从模板创建工作流',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: { templateId: { type: 'string' }, name: { type: 'string', description: '覆盖模板名称' } },
                                    required: ['templateId'],
                                },
                            },
                        },
                    },
                    responses: { 201: { description: '创建的工作流' }, 400: {}, 404: {} },
                },
            },
            '/api/v1/workflows': {
                get: { summary: '工作流列表', responses: { 200: {} } },
                post: {
                    summary: '创建工作流',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        description: { type: 'string' },
                                        nodes: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: { id: {}, type: {}, config: {} },
                                            },
                                        },
                                        edges: {
                                            type: 'array',
                                            items: { type: 'object', properties: { from: {}, to: {} } },
                                        },
                                        triggers: {
                                            type: 'array',
                                            description: 'message: { type, command, enabled } | cron: { type, expression, enabled }',
                                        },
                                    },
                                    required: ['name', 'nodes'],
                                },
                            },
                        },
                    },
                    responses: { 201: {} },
                },
            },
            '/api/v1/workflows/{id}': {
                get: { summary: '工作流详情', responses: { 200: {}, 404: {} } },
                patch: {
                    summary: '更新工作流',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: { name: {}, description: {}, nodes: {}, edges: {}, triggers: { type: 'array', description: '消息触发、定时触发等' } },
                                },
                            },
                        },
                    },
                    responses: { 200: {}, 404: {} },
                },
                delete: { summary: '删除工作流', responses: { 200: {}, 404: {} } },
            },
            '/api/v1/workflows/{id}/run': {
                post: {
                    summary: '触发工作流执行',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', description: '输入参数' },
                            },
                        },
                    },
                    responses: { 200: { description: 'runId, status, output' } },
                },
            },
            '/api/v1/workflow-runs': {
                get: {
                    summary: '工作流运行记录列表',
                    parameters: [
                        { name: 'workflowId', in: 'query', schema: { type: 'string' }, description: '按工作流 ID 筛选' },
                        { name: 'limit', in: 'query', schema: { type: 'integer' }, description: '返回条数，默认 20' },
                    ],
                    responses: { 200: { description: 'runs: RunCheckpoint[]' } },
                },
            },
            '/api/v1/workflows/{id}/runs/{runId}': {
                get: { summary: '运行状态与断点', responses: { 200: {}, 404: {} } },
            },
            '/api/v1/workflows/{id}/runs/{runId}/resume': {
                post: {
                    summary: 'Human-in-the-loop：人工输入后恢复执行',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { input: {}, value: {} }, description: '人工输入值' },
                            },
                        },
                    },
                    responses: { 200: { description: 'runId, status, output' }, 400: {}, 404: {} },
                },
            },
        },
    };
    if (isAuthRequired()) {
        spec.components = {
            securitySchemes: {
                Bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'API Key', description: 'Authorization: Bearer <key>' },
                ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'X-API-Key 头' },
            },
        };
        spec.security = [{ Bearer: [] }, { ApiKey: [] }];
    }
    return spec;
}
//# sourceMappingURL=openapi.js.map