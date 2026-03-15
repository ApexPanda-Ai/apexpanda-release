import type { IncomingMessage } from 'node:http';
/** 获取配置的 API Key，优先级：环境变量 > 文件 > 自动生成 */
export declare function getConfiguredApiKey(): string | null;
export declare function isAuthRequired(): boolean;
/** 从请求中提取 API Key（Authorization: Bearer <key> 或 X-API-Key: <key>） */
export declare function extractApiKey(req: IncomingMessage): string | null;
export declare function validateRequest(req: IncomingMessage): boolean;
//# sourceMappingURL=api-key.d.ts.map