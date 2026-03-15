/**
 * API Key 认证
 * - APEXPANDA_API_KEY 设置时使用该 Key
 * - APEXPANDA_DISABLE_AUTO_KEY=true 或 APEXPANDA_API_KEY="" 时不启用认证
 * - 未设置时自动生成并持久化至 .apexpanda/api-key
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getDataBase } from '../install/wizard.js';
const dataBase = getDataBase();
const keyFilePath = process.env.APEXPANDA_API_KEY_FILE ?? join(dataBase, 'api-key');
let _hasLoggedAuthStatus = false;
function isAuthDisabled() {
    if (process.env.APEXPANDA_DISABLE_AUTO_KEY === 'true')
        return true;
    const envVal = process.env.APEXPANDA_API_KEY;
    if (envVal !== undefined && String(envVal).trim() === '')
        return true;
    return false;
}
function getApiKeyFromEnv() {
    const v = process.env.APEXPANDA_API_KEY?.trim();
    if (!v)
        return null;
    return v;
}
function getApiKeyFromFile() {
    try {
        if (existsSync(keyFilePath)) {
            const content = readFileSync(keyFilePath, 'utf-8').trim();
            return content || null;
        }
    }
    catch {
        /* ignore */
    }
    return null;
}
function generateAndPersistKey() {
    _hasLoggedAuthStatus = true;
    const key = 'apex_' + randomBytes(16).toString('hex');
    try {
        mkdirSync(dataBase, { recursive: true });
        writeFileSync(keyFilePath, key, { mode: 0o600 });
        console.log('[ApexPanda] API Key (首次生成，请妥善保存):', key);
    }
    catch (e) {
        console.warn('[ApexPanda] 无法写入 api-key 文件:', e instanceof Error ? e.message : e);
    }
    return key;
}
/** 获取配置的 API Key，优先级：环境变量 > 文件 > 自动生成 */
export function getConfiguredApiKey() {
    if (isAuthDisabled()) {
        if (!_hasLoggedAuthStatus) {
            _hasLoggedAuthStatus = true;
            console.log('[ApexPanda] API Key 认证已关闭 (APEXPANDA_DISABLE_AUTO_KEY 或 APEXPANDA_API_KEY="")');
        }
        return null;
    }
    const fromEnv = getApiKeyFromEnv();
    if (fromEnv) {
        if (!_hasLoggedAuthStatus) {
            _hasLoggedAuthStatus = true;
            console.log('[ApexPanda] API Key 已从环境变量加载');
        }
        return fromEnv;
    }
    const fromFile = getApiKeyFromFile();
    if (fromFile) {
        if (!_hasLoggedAuthStatus) {
            _hasLoggedAuthStatus = true;
            console.log('[ApexPanda] API Key 已从 .apexpanda/api-key 加载，Dashboard 需输入该 Key 登录');
        }
        return fromFile;
    }
    return generateAndPersistKey();
}
export function isAuthRequired() {
    return !!getConfiguredApiKey();
}
/** 从请求中提取 API Key（Authorization: Bearer <key> 或 X-API-Key: <key>） */
export function extractApiKey(req) {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
        return auth.slice(7).trim() || null;
    }
    const xKey = req.headers['x-api-key'];
    if (typeof xKey === 'string')
        return xKey.trim() || null;
    if (Array.isArray(xKey) && xKey[0])
        return String(xKey[0]).trim();
    return null;
}
export function validateRequest(req) {
    const configured = getConfiguredApiKey();
    if (!configured)
        return true;
    const provided = extractApiKey(req);
    return !!provided && configured === provided;
}
//# sourceMappingURL=api-key.js.map