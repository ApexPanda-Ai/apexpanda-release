/**
 * 安装向导：首次部署检测与安装锁管理
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
// 优先用环境变量；否则用包目录下的 .apexpanda（dist/install/wizard.js -> packages/core）
const _pkgDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataBase = process.env.APEXPANDA_DATA_DIR ?? join(_pkgDir, '.apexpanda');
export function getDataBase() {
    return dataBase;
}
const installedFilePath = join(dataBase, '.installed');
const apiKeyFilePath = process.env.APEXPANDA_API_KEY_FILE ?? join(dataBase, 'api-key');
export function isInstalled() {
    if (!existsSync(installedFilePath))
        return false;
    if (!existsSync(apiKeyFilePath))
        return false;
    try {
        const key = readFileSync(apiKeyFilePath, 'utf-8').trim();
        return key.length > 0;
    }
    catch {
        return false;
    }
}
export function getInstalledMeta() {
    if (!existsSync(installedFilePath))
        return null;
    try {
        return JSON.parse(readFileSync(installedFilePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function createInstalledLock(version) {
    mkdirSync(dataBase, { recursive: true });
    const meta = { installedAt: new Date().toISOString(), version };
    writeFileSync(installedFilePath, JSON.stringify(meta, null, 2), { mode: 0o600 });
}
export function generateAndWriteApiKey() {
    const key = 'apex_' + randomBytes(16).toString('hex');
    mkdirSync(dataBase, { recursive: true });
    writeFileSync(apiKeyFilePath, key, { mode: 0o600 });
    return key;
}
export function resetInstall() {
    if (existsSync(installedFilePath))
        unlinkSync(installedFilePath);
    if (existsSync(apiKeyFilePath))
        unlinkSync(apiKeyFilePath);
    const configPath = join(dataBase, 'config.json');
    if (existsSync(configPath)) {
        try {
            const raw = readFileSync(configPath, 'utf-8');
            const cfg = JSON.parse(raw);
            if (cfg?.llm)
                delete cfg.llm.apiKey;
            if (cfg?.channels) {
                for (const ch of Object.values(cfg.channels)) {
                    const c = ch;
                    delete c.appSecret;
                    delete c.botToken;
                    delete c.signingSecret;
                    delete c.appToken;
                    delete c.accessToken;
                    delete c.secret;
                }
            }
            writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
        }
        catch { /* ignore */ }
    }
}
//# sourceMappingURL=wizard.js.map