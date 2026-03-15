import type { IncomingMessage } from 'node:http';
export type Resource = 'agent' | 'knowledge' | 'skill' | 'channel' | 'usage' | 'audit' | 'config' | 'session' | 'workflow' | 'node';
export type Role = 'super_admin' | 'admin' | 'developer' | 'operator' | 'observer' | 'auditor';
type Action = string;
export declare function hasPermission(role: Role, resource: Resource, action: Action): boolean;
export declare function getDefaultRole(): Role;
/** RBAC 是否启用（需同时设置 APEXPANDA_API_KEY 与 APEXPANDA_RBAC_ENABLED） */
export declare function isRbacEnabled(): boolean;
/** 从请求推断角色：未启用 API Key 或 RBAC 时为 super_admin，否则为 APEXPANDA_DEFAULT_ROLE */
export declare function getRoleFromRequest(_req: IncomingMessage): Role;
export declare function checkPermission(req: IncomingMessage, resource: Resource, action: Action): boolean;
export {};
//# sourceMappingURL=rbac.d.ts.map