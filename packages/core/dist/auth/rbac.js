/**
 * RBAC 基础：角色与权限矩阵
 * 组织 → 团队 → 成员 → 角色 → 权限集合
 */
import { isAuthRequired } from './api-key.js';
const PERMISSIONS = {
    super_admin: ['*'],
    admin: [
        'agent:*',
        'knowledge:*',
        'skill:*',
        'channel:*',
        'usage:view',
        'usage:export',
        'audit:*',
        'config:*',
        'session:*',
        'workflow:*',
        'node:read',
        'node:approve',
        'node:delete',
        'node:invoke',
    ],
    developer: [
        'agent:create',
        'agent:read',
        'agent:update',
        'agent:invoke',
        'node:read',
        'node:invoke',
        'knowledge:upload',
        'knowledge:read',
        'skill:*',
        'channel:read',
        'channel:update',
        'config:read',
        'config:update',
        'session:read',
        'session:delete',
        'workflow:create',
        'workflow:read',
        'workflow:update',
        'workflow:delete',
        'workflow:run',
    ],
    operator: [
        'agent:read',
        'agent:invoke',
        'knowledge:read',
        'skill:read',
        'channel:read',
        'usage:view',
        'session:*',
        'workflow:read',
        'workflow:update',
        'workflow:run',
        'node:read',
    ],
    observer: [
        'agent:read',
        'knowledge:read',
        'skill:read',
        'channel:read',
        'usage:view',
        'session:read',
        'config:read',
        'workflow:read',
        'node:read',
    ],
    auditor: ['audit:view', 'audit:export'],
};
function matchPermission(permissions, resource, action) {
    if (permissions.includes('*'))
        return true;
    const pattern = `${resource}:${action}`;
    if (permissions.includes(pattern))
        return true;
    if (permissions.includes(`${resource}:*`))
        return true;
    return false;
}
export function hasPermission(role, resource, action) {
    const perms = PERMISSIONS[role];
    if (!perms)
        return false;
    return matchPermission(perms, resource, action);
}
export function getDefaultRole() {
    const env = process.env.APEXPANDA_DEFAULT_ROLE?.toLowerCase();
    const valid = ['super_admin', 'admin', 'developer', 'operator', 'observer', 'auditor'];
    if (env && valid.includes(env))
        return env;
    return 'admin';
}
/** RBAC 是否启用（需同时设置 APEXPANDA_API_KEY 与 APEXPANDA_RBAC_ENABLED） */
export function isRbacEnabled() {
    return process.env.APEXPANDA_RBAC_ENABLED === 'true' && isAuthRequired();
}
/** 从请求推断角色：未启用 API Key 或 RBAC 时为 super_admin，否则为 APEXPANDA_DEFAULT_ROLE */
export function getRoleFromRequest(_req) {
    if (!isRbacEnabled())
        return 'super_admin';
    return getDefaultRole();
}
export function checkPermission(req, resource, action) {
    const role = getRoleFromRequest(req);
    return hasPermission(role, resource, action);
}
//# sourceMappingURL=rbac.js.map