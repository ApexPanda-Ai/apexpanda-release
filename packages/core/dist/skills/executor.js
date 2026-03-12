/**
 * Skill 执行引擎
 * 解析 handler 字符串，调用对应工具
 * 沙箱：按 APEX_SKILL.yaml 权限声明校验，默认拒绝
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { cpus, freemem, totalmem, platform } from 'node:os';
import { dirname, join, relative as pathRelative, resolve, sep } from 'node:path';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { randomUUID, createHmac } from 'node:crypto';
import { WebSocket } from 'ws';
import { getSkillEntryEnv, getSkillEntryConfig, getWorkspaceDir, getOutputBasePath, getDeleteConfirmRequired, getWechatMpAppId, getWechatMpAppSecret, getMemoryConfig } from '../config/loader.js';
import { shortlinkStore, generateShortCode } from '../shortlink/store.js';
/** 工具所需的权限（无则不需校验） */
const HANDLER_PERMISSIONS = {
    'file-tools#readFile': { id: 'filesystem', scope: 'read' },
    'file-tools#listFiles': { id: 'filesystem', scope: 'read' },
    'file-tools#listOutput': { id: 'filesystem', scope: 'read' },
    'file-tools#writeFile': { id: 'filesystem', scope: 'write' },
    'file-tools#deleteFile': { id: 'filesystem', scope: 'write' },
    'webhook-trigger#send': { id: 'network', scope: 'outbound' },
    'healthcheck#check': { id: 'network', scope: 'outbound' },
    'web-fetch#fetchUrl': { id: 'network', scope: 'outbound' },
    'exchange-rate#getRate': { id: 'network', scope: 'outbound' },
    'exchange-rate#listCurrencies': { id: 'network', scope: 'outbound' },
    'api-tester#request': { id: 'network', scope: 'outbound' },
    'arxiv-search#search': { id: 'network', scope: 'outbound' },
    'news-aggregator#fetch': { id: 'network', scope: 'outbound' },
    'pdf-reader#extractFromUrl': { id: 'network', scope: 'outbound' },
    'office-reader#extractDocxFromPath': { id: 'filesystem', scope: 'read' },
    'office-reader#extractXlsxFromPath': { id: 'filesystem', scope: 'read' },
    'office-reader#extractDocxFromUrl': { id: 'network', scope: 'outbound' },
    'office-reader#extractXlsxFromUrl': { id: 'network', scope: 'outbound' },
    'weather#getCurrent': { id: 'network', scope: 'outbound' },
    'web-fetch-clean#fetchClean': { id: 'network', scope: 'outbound' },
    'web-search#search': { id: 'network', scope: 'outbound' },
    'web-search-baidu#search': { id: 'network', scope: 'outbound' },
    'web-search-bing-cn#search': { id: 'network', scope: 'outbound' },
    'wechat-mp-search#search': { id: 'network', scope: 'outbound' },
    'web-search-360#search': { id: 'network', scope: 'outbound' },
    'web-search-quark#search': { id: 'network', scope: 'outbound' },
    'web-search-google#search': { id: 'network', scope: 'outbound' },
    'image-gen-sd#generate': { id: 'network', scope: 'outbound' },
    'sql-query#getSchema': { id: 'filesystem', scope: 'read' },
    'sql-query#execute': { id: 'filesystem', scope: 'read' },
    'sql-query#query': { id: 'filesystem', scope: 'read' },
    'gmail#listMessages': { id: 'network', scope: 'outbound' },
    'gmail#getMessage': { id: 'network', scope: 'outbound' },
    'gmail#sendMessage': { id: 'network', scope: 'outbound' },
    'google-calendar#listEvents': { id: 'network', scope: 'outbound' },
    'google-calendar#createEvent': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#addDraft': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#uploadThumb': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#uploadImage': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#formatArticle': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#selectCover': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#publishDraft': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#massSend': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#listDrafts': { id: 'network', scope: 'outbound' },
    'wechat-mp-publish#listMaterials': { id: 'network', scope: 'outbound' },
    'web-scraper#scrape': { id: 'network', scope: 'outbound' },
    'code-runner#runPython': { id: 'process', scope: 'spawn' },
    'code-runner#runPythonFile': { id: 'process', scope: 'spawn' },
    'docker-manage#listContainers': { id: 'process', scope: 'spawn' },
    'docker-manage#inspect': { id: 'process', scope: 'spawn' },
    'qrcode-gen#decode': { id: 'network', scope: 'outbound' },
    'speech-to-text#recognize': { id: 'network', scope: 'outbound' },
    'translate#translate': { id: 'network', scope: 'outbound' },
    'browser-automation#runSteps': { id: 'process', scope: 'spawn' },
    'browser-automation#navigateAndSnapshot': { id: 'process', scope: 'spawn' },
    'browser-automation#screenshot': { id: 'process', scope: 'spawn' },
    'browser-automation#closeSession': { id: 'process', scope: 'spawn' },
    'shell-exec#run': { id: 'process', scope: 'spawn' },
    'shell-exec#taskStatus': { id: 'process', scope: 'spawn' },
    'shell-exec#taskKill': { id: 'process', scope: 'spawn' },
    'shell-exec#taskList': { id: 'process', scope: 'spawn' },
    'shell-exec#taskLog': { id: 'process', scope: 'spawn' },
    'shell-exec#taskClear': { id: 'process', scope: 'spawn' },
    'desktop-automation#type': { id: 'process', scope: 'spawn' },
    'desktop-automation#keyTap': { id: 'process', scope: 'spawn' },
    'desktop-automation#mouseMove': { id: 'process', scope: 'spawn' },
    'desktop-automation#mouseClick': { id: 'process', scope: 'spawn' },
    'desktop-automation#mouseScroll': { id: 'process', scope: 'spawn' },
    'desktop-automation#mouseDrag': { id: 'process', scope: 'spawn' },
    'desktop-automation#screenshot': { id: 'process', scope: 'spawn' },
    'screen-capture#capture': { id: 'process', scope: 'spawn' },
    'android-emulator#listDevices': { id: 'process', scope: 'spawn' },
    'android-emulator#tap': { id: 'process', scope: 'spawn' },
    'android-emulator#swipe': { id: 'process', scope: 'spawn' },
    'android-emulator#inputText': { id: 'process', scope: 'spawn' },
    'android-emulator#keyEvent': { id: 'process', scope: 'spawn' },
    'android-emulator#screencap': { id: 'process', scope: 'spawn' },
    'android-emulator#installApk': { id: 'process', scope: 'spawn' },
    'android-emulator#launchApp': { id: 'process', scope: 'spawn' },
    'android-emulator#pushFile': { id: 'process', scope: 'spawn' },
    'android-emulator#pullFile': { id: 'process', scope: 'spawn' },
    'android-emulator#shell': { id: 'process', scope: 'spawn' },
    'remote-exec#run': { id: 'network', scope: 'outbound' },
    'remote-exec#runScript': { id: 'network', scope: 'outbound' },
    'remote-exec#runMultiple': { id: 'network', scope: 'outbound' },
    'remote-exec#upload': { id: 'network', scope: 'outbound' },
    'remote-exec#download': { id: 'network', scope: 'outbound' },
    'pentest-runner#installTools': { id: 'network', scope: 'outbound' },
    'pentest-runner#runPlan': { id: 'network', scope: 'outbound' },
    'pentest-runner#fetchResult': { id: 'network', scope: 'outbound' },
    'memory#write': { id: 'filesystem', scope: 'write' },
    'memory#search': { id: 'filesystem', scope: 'read' },
    'memory#read': { id: 'filesystem', scope: 'read' },
    'memory#list': { id: 'filesystem', scope: 'read' },
    'memory#delete': { id: 'filesystem', scope: 'write' },
    'map-amap#search': { id: 'network', scope: 'outbound' },
    'map-amap#around': { id: 'network', scope: 'outbound' },
    'map-amap#driving': { id: 'network', scope: 'outbound' },
    'dingtalk-message#send': { id: 'network', scope: 'outbound' },
    'wecom-message#send': { id: 'network', scope: 'outbound' },
    'feishu-message#send': { id: 'network', scope: 'outbound' },
    'feishu-bitable#listRecords': { id: 'network', scope: 'outbound' },
    'feishu-bitable#createRecord': { id: 'network', scope: 'outbound' },
    'feishu-bitable#searchRecords': { id: 'network', scope: 'outbound' },
    'feishu-doc#read': { id: 'network', scope: 'outbound' },
    'feishu-calendar#getPrimary': { id: 'network', scope: 'outbound' },
    'feishu-calendar#listEvents': { id: 'network', scope: 'outbound' },
    'feishu-calendar#createEvent': { id: 'network', scope: 'outbound' },
    'yuque-doc#read': { id: 'network', scope: 'outbound' },
    'yuque-doc#listRepos': { id: 'network', scope: 'outbound' },
    'yuque-doc#getToc': { id: 'network', scope: 'outbound' },
    'jira#search': { id: 'network', scope: 'outbound' },
    'jira#create': { id: 'network', scope: 'outbound' },
    'jira#get': { id: 'network', scope: 'outbound' },
    'feishu-approval#create': { id: 'network', scope: 'outbound' },
    'feishu-approval#query': { id: 'network', scope: 'outbound' },
    'dingtalk-todo#create': { id: 'network', scope: 'outbound' },
    'dingtalk-attendance#list': { id: 'network', scope: 'outbound' },
    'ocr-tencent#recognize': { id: 'network', scope: 'outbound' },
    'ocr-tencent#recognizeAccurate': { id: 'network', scope: 'outbound' },
    'gitlab#listRepos': { id: 'network', scope: 'outbound' },
    'gitlab#getFile': { id: 'network', scope: 'outbound' },
    'gitlab#createIssue': { id: 'network', scope: 'outbound' },
    'gitlab#listIssues': { id: 'network', scope: 'outbound' },
    'image-gen-wanx#generate': { id: 'network', scope: 'outbound' },
    'tts-azure#synthesize': { id: 'network', scope: 'outbound' },
    'tts-azure#listVoices': { id: 'network', scope: 'outbound' },
    'tts-aliyun#synthesize': { id: 'network', scope: 'outbound' },
    'asr-aliyun#recognize': { id: 'network', scope: 'outbound' },
    'asr-xunfei#recognize': { id: 'network', scope: 'outbound' },
    'email-smtp#send': { id: 'network', scope: 'outbound' },
    'cron-scheduler#schedule': { id: 'process', scope: 'spawn' },
    'cron-scheduler#list': { id: 'filesystem', scope: 'read' },
    'cron-scheduler#cancel': { id: 'filesystem', scope: 'write' },
    'image-gen-dalle#generate': { id: 'network', scope: 'outbound' },
    'web-search-brave#search': { id: 'network', scope: 'outbound' },
    'github#listRepos': { id: 'network', scope: 'outbound' },
    'github#getFile': { id: 'network', scope: 'outbound' },
    'github#createIssue': { id: 'network', scope: 'outbound' },
    'github#listIssues': { id: 'network', scope: 'outbound' },
    'web-search-tavily#search': { id: 'network', scope: 'outbound' },
    'translate-baidu#translate': { id: 'network', scope: 'outbound' },
    'translate-youdao#translate': { id: 'network', scope: 'outbound' },
    'translate-deepl#translate': { id: 'network', scope: 'outbound' },
    'ocr-baidu#recognize': { id: 'network', scope: 'outbound' },
    'ocr-baidu#recognizeAccurate': { id: 'network', scope: 'outbound' },
    'map-baidu#search': { id: 'network', scope: 'outbound' },
    'map-baidu#around': { id: 'network', scope: 'outbound' },
    'openclaw-legacy#invoke': { id: 'process', scope: 'spawn' },
    'process-monitor#summary': { id: 'process', scope: 'spawn' },
    'process-monitor#list': { id: 'process', scope: 'spawn' },
    'process-monitor#net': { id: 'process', scope: 'spawn' },
    'workflow-creator#create_from_template': { id: 'workflow', scope: 'create' },
    'workflow-creator#create_custom': { id: 'workflow', scope: 'create' },
};
/** YAML 上传时，handler 必须在此白名单内（禁止引用未声明的内置 handler） */
export const BUILTIN_HANDLER_KEYS = new Set(Object.keys(HANDLER_PERMISSIONS));
/** 从 audioUrl/dataUrl/base64/audioAddress 解析出音频，用于 ASR */
async function resolveAudioInput(params) {
    const audioAddress = params.audioAddress ? String(params.audioAddress).trim() : '';
    if (audioAddress && (audioAddress.startsWith('http://') || audioAddress.startsWith('https://'))) {
        return { buffer: Buffer.alloc(0), audioAddress };
    }
    const raw = params.audioUrl ?? params.dataUrl ?? params.base64;
    const str = String(raw ?? '');
    if (!str)
        throw new Error('audioUrl、dataUrl、base64 或 audioAddress 至少提供一个');
    if (str.startsWith('http://') || str.startsWith('https://')) {
        const res = await fetch(str);
        if (!res.ok)
            throw new Error(`Fetch audio failed: ${res.status}`);
        const arr = await res.arrayBuffer();
        return { buffer: Buffer.from(arr) };
    }
    if (str.startsWith('data:')) {
        const m = str.match(/^data:audio\/[^;]+;base64,(.+)$/i) ?? str.match(/^data:[^;]+;base64,(.+)$/);
        if (!m)
            throw new Error('Invalid audio data URL format');
        return { buffer: Buffer.from(m[1], 'base64') };
    }
    return { buffer: Buffer.from(str, 'base64') };
}
/** 百度 OCR：从 imageUrl/dataUrl/base64/path 解析出 base64 字符串 */
async function resolveImageInput(params) {
    const pathParam = params.path;
    if (pathParam != null && String(pathParam).trim()) {
        const str = String(pathParam).trim();
        const ws = getWorkspaceDir();
        const full = resolve(ws, str);
        const rel = pathRelative(ws, full);
        if (rel.startsWith('..') || (sep !== '/' && rel.includes('..')))
            throw new Error('Path outside workspace');
        if (!existsSync(full))
            throw new Error(`File not found: ${str}`);
        const buf = await readFile(full);
        return buf.toString('base64');
    }
    const raw = params.imageUrl ?? params.dataUrl ?? params.base64;
    const str = String(raw ?? '').trim();
    if (!str)
        throw new Error('imageUrl、dataUrl、base64 或 path 至少提供一个');
    if (str.startsWith('http://') || str.startsWith('https://')) {
        const res = await fetch(str);
        if (!res.ok)
            throw new Error(`Fetch failed: ${res.status}`);
        const buf = await res.arrayBuffer();
        return Buffer.from(buf).toString('base64');
    }
    if (str.startsWith('data:')) {
        const m = str.match(/^data:image\/[^;]+;base64,(.+)$/);
        if (!m)
            throw new Error('Invalid data URL format');
        return m[1];
    }
    return str;
}
/** 微信公众号 access_token（带缓存，有效期 2 小时） */
let _wechatMpToken = null;
let _wechatMpTokenExp = 0;
let _wechatMpTokenKey = '';
async function getWechatMpAccessToken(appId, appSecret) {
    const cacheKey = `${appId}:${appSecret.slice(0, 4)}`;
    if (_wechatMpToken && _wechatMpTokenKey === cacheKey && Date.now() < _wechatMpTokenExp)
        return _wechatMpToken;
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = (await res.json());
    if (data.errcode)
        throw new Error(`获取 access_token 失败: ${data.errmsg ?? data.errcode}`);
    const token = data.access_token;
    if (!token)
        throw new Error('微信 API 未返回 access_token');
    _wechatMpToken = token;
    _wechatMpTokenKey = cacheKey;
    _wechatMpTokenExp = Date.now() + ((data.expires_in ?? 7200) - 300) * 1000;
    return token;
}
/** 百度 OCR：获取 access_token（带简单内存缓存，按 apiKey:secret 隔离） */
let _baiduOcrToken = null;
let _baiduOcrTokenExp = 0;
let _baiduOcrTokenKey = '';
async function getBaiduOcrToken(ctx) {
    const apiKey = getSkillEnv(ctx, 'BAIDU_OCR_API_KEY');
    const secret = getSkillEnv(ctx, 'BAIDU_OCR_SECRET_KEY');
    if (!apiKey || !secret)
        throw new Error('ocr-baidu 需配置 BAIDU_OCR_API_KEY、BAIDU_OCR_SECRET_KEY');
    const cacheKey = `${apiKey}:${secret}`;
    if (_baiduOcrToken && _baiduOcrTokenKey === cacheKey && Date.now() < _baiduOcrTokenExp)
        return _baiduOcrToken;
    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: apiKey,
        client_secret: secret,
    });
    const res = await fetch(`https://aip.baidubce.com/oauth/2.0/token?${params}`);
    if (!res.ok)
        throw new Error(`百度 OAuth failed: ${res.status}`);
    const data = (await res.json());
    const token = data.access_token;
    if (!token)
        throw new Error('百度 OAuth 未返回 access_token');
    _baiduOcrToken = token;
    _baiduOcrTokenKey = cacheKey;
    _baiduOcrTokenExp = Date.now() + ((data.expires_in ?? 2592000) - 300) * 1000;
    return token;
}
/** 阿里云 NLS CreateToken（POP 签名，符合 Aliyun percentEncode 规则） */
function aliyunPercentEncode(s) {
    return encodeURIComponent(s).replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}
let _aliyunNlsToken = '';
let _aliyunNlsTokenExp = 0;
let _aliyunNlsTokenKey = '';
async function getAliyunNlsToken(accessKeyId, accessKeySecret, regionId) {
    const cacheKey = `${accessKeyId}:${regionId}`;
    if (_aliyunNlsToken && _aliyunNlsTokenKey === cacheKey && Date.now() < _aliyunNlsTokenExp) {
        return _aliyunNlsToken;
    }
    const params = {
        AccessKeyId: accessKeyId,
        Action: 'CreateToken',
        Version: '2019-02-28',
        Format: 'JSON',
        RegionId: regionId,
        SignatureMethod: 'HMAC-SHA1',
        SignatureVersion: '1.0',
        SignatureNonce: randomUUID(),
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const sortedKeys = Object.keys(params).sort();
    const canonicalized = sortedKeys
        .map((k) => `${aliyunPercentEncode(k)}=${aliyunPercentEncode(params[k])}`)
        .join('&');
    const stringToSign = `GET&${aliyunPercentEncode('/')}&${aliyunPercentEncode(canonicalized)}`;
    const sig = createHmac('sha1', accessKeySecret + '&')
        .update(stringToSign)
        .digest('base64');
    params.Signature = aliyunPercentEncode(sig);
    const metaHost = `nls-meta.${regionId}.aliyuncs.com`;
    const url = `https://${metaHost}/?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`阿里云 CreateToken 失败: ${res.status}`);
    const data = (await res.json());
    if (data.Code)
        throw new Error(data.Message ?? `阿里云 CreateToken: ${data.Code}`);
    const tokenId = data.Token?.Id;
    if (!tokenId)
        throw new Error('阿里云 CreateToken 未返回 Token');
    _aliyunNlsToken = tokenId;
    _aliyunNlsTokenKey = cacheKey;
    _aliyunNlsTokenExp = ((data.Token?.ExpireTime ?? 0) - 300) * 1000;
    return tokenId;
}
/** Open-Meteo 地理编码对中文支持差，中文城市名→英文名 fallback */
const CHINESE_CITY_TO_EN = {
    兰州: 'Lanzhou', 北京: 'Beijing', 上海: 'Shanghai', 深圳: 'Shenzhen', 广州: 'Guangzhou',
    杭州: 'Hangzhou', 成都: 'Chengdu', 武汉: 'Wuhan', 西安: 'Xi\'an', 南京: 'Nanjing',
    重庆: 'Chongqing', 天津: 'Tianjin', 苏州: 'Suzhou', 青岛: 'Qingdao', 厦门: 'Xiamen',
    长沙: 'Changsha', 郑州: 'Zhengzhou', 沈阳: 'Shenyang', 哈尔滨: 'Harbin', 大连: 'Dalian',
    济南: 'Jinan', 福州: 'Fuzhou', 合肥: 'Hefei', 昆明: 'Kunming', 贵阳: 'Guiyang',
    太原: 'Taiyuan', 石家庄: 'Shijiazhuang', 乌鲁木齐: 'Urumqi', 银川: 'Yinchuan',
    西宁: 'Xining', 拉萨: 'Lhasa', 呼和浩特: 'Hohhot', 海口: 'Haikou', 南宁: 'Nanning',
    南昌: 'Nanchang', 长春: 'Changchun', 珠海: 'Zhuhai', 佛山: 'Foshan', 东莞: 'Dongguan',
};
function hasSkillPermission(skill, requiredId, requiredScope) {
    const perms = skill.manifest.permissions;
    if (!perms?.length)
        return false;
    return perms.some((p) => p.id === requiredId && (p.scope === requiredScope || p.scope === '*'));
}
function isSandboxEnabled() {
    const v = process.env.APEXPANDA_SKILL_SANDBOX_ENABLED;
    return v !== 'false' && v !== '0';
}
function checkSkillPermission(skill, handlerKey) {
    if (!isSandboxEnabled())
        return;
    const required = HANDLER_PERMISSIONS[handlerKey];
    if (!required)
        return;
    if (!hasSkillPermission(skill, required.id, required.scope)) {
        throw new Error(`Skill ${skill.name} missing permission: ${required.id}:${required.scope}. ` +
            'Declare it in APEX_SKILL.yaml permissions.');
    }
}
/** 获取技能 env：优先 ctx.skillEnv，否则 process.env */
export function getSkillEnv(ctx, key) {
    return ctx?.skillEnv?.[key] ?? process.env[key] ?? '';
}
/** APEXPANDA_FULL_CONTROL=true 时放宽：允许任意路径，不受 workspace 限制 */
const isFullControl = () => process.env.APEXPANDA_FULL_CONTROL === 'true' || process.env.APEXPANDA_FULL_CONTROL === '1';
/** 解析路径，限制在 workspace 内，防路径穿越（FULL_CONTROL 时允许任意路径） */
function resolveWorkspacePath(workspaceDir, rel) {
    const baseResolved = resolve(workspaceDir);
    const normalized = resolve(baseResolved, rel);
    if (isFullControl())
        return normalized;
    // 使用 path.relative 判断是否在 workspace 内（兼容 Windows D:\ 等根路径的 startsWith 问题）
    const relativePath = pathRelative(baseResolved, normalized);
    const isOutside = relativePath.startsWith('..') || (relativePath.length > 0 && resolve(relativePath) === relativePath);
    if (isOutside) {
        throw new Error(`Path outside workspace not allowed. ` +
            `Workspace: ${workspaceDir}. ` +
            `Use a path relative to workspace (e.g. "1.txt"), or set workspace in system config to target dir (e.g. D:\\), or use shell-exec#run to run system commands for out-of-workspace paths. ` +
            `Set APEXPANDA_FULL_CONTROL=true to allow any path.`);
    }
    return normalized;
}
/** 解析 adb 可执行文件路径。优先：APEXPANDA_ADB_PATH > 环境变量 > 常见 SDK 路径 > PATH 中的 adb */
function resolveAdbPath() {
    const platform = process.platform;
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidates = [];
    if (process.env.APEXPANDA_ADB_PATH) {
        candidates.push(resolve(process.env.APEXPANDA_ADB_PATH));
    }
    if (process.env.ANDROID_HOME) {
        candidates.push(join(process.env.ANDROID_HOME, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb'));
    }
    if (process.env.ANDROID_SDK_ROOT) {
        candidates.push(join(process.env.ANDROID_SDK_ROOT, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb'));
    }
    if (platform === 'win32') {
        if (localAppData) {
            candidates.push(join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
        }
        if (home) {
            candidates.push(join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
        }
    }
    else {
        if (home) {
            candidates.push(join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
            candidates.push(join(home, 'Android', 'Sdk', 'platform-tools', 'adb'));
        }
        candidates.push('/opt/android-sdk/platform-tools/adb');
    }
    for (const p of candidates) {
        if (existsSync(p))
            return p;
    }
    return 'adb';
}
/** 执行 ADB 命令。adbArgs 如 ['-s','deviceId']，cmd 如 ['shell','input','tap','100','200'] */
async function runAdb(adbArgs, cmd, opts) {
    const args = [...adbArgs, ...cmd];
    const adbExe = resolveAdbPath();
    const proc = spawn(adbExe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    proc.stdout?.on('data', (d) => {
        if (opts?.binary)
            chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
        else
            chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf-8'));
    });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    const result = await new Promise((res) => {
        proc.on('error', (err) => {
            if (err.code === 'ENOENT') {
                res({
                    exitCode: -1,
                    spawnError: 'adb 未找到。请安装 Android SDK platform-tools，或在环境中设置 ANDROID_HOME/ANDROID_SDK_ROOT，或配置 APEXPANDA_ADB_PATH 指向 adb 路径。',
                });
            }
            else {
                res({ exitCode: -1, spawnError: String(err.message) });
            }
        });
        proc.on('close', (code, signal) => {
            res({ exitCode: code ?? -1 });
        });
    });
    const buf = Buffer.concat(chunks);
    const stdout = opts?.binary ? buf : buf.toString('utf-8');
    const errMsg = result.spawnError ? result.spawnError : stderr;
    return { stdout, stderr: errMsg, exitCode: result.exitCode };
}
/** 发现 OpenClaw Skill 可执行脚本：scripts/ 或 skill 根目录（兼容 OpenClaw 常见命名） */
function findOpenClawScript(skillPath, skillName) {
    const scriptsDir = join(skillPath, 'scripts');
    const snake = skillName.replace(/-/g, '_');
    const candidates = [
        { path: join(scriptsDir, 'main.py'), interpreter: ['python3', 'python'] },
        { path: join(scriptsDir, 'run.py'), interpreter: ['python3', 'python'] },
        { path: join(scriptsDir, 'index.js'), interpreter: ['node'] },
        { path: join(scriptsDir, 'run.sh'), interpreter: ['bash', 'sh'] },
        { path: join(scriptsDir, `${snake}.py`), interpreter: ['python3', 'python'] },
        { path: join(scriptsDir, `${skillName}.py`), interpreter: ['python3', 'python'] },
        { path: join(scriptsDir, `${snake}.js`), interpreter: ['node'] },
        { path: join(scriptsDir, `${snake}.sh`), interpreter: ['bash', 'sh'] },
        { path: join(skillPath, `${snake}.py`), interpreter: ['python3', 'python'] },
        { path: join(skillPath, `${skillName}.py`), interpreter: ['python3', 'python'] },
        { path: join(skillPath, 'main.py'), interpreter: ['python3', 'python'] },
        { path: join(skillPath, 'run.py'), interpreter: ['python3', 'python'] },
        { path: join(skillPath, 'index.js'), interpreter: ['node'] },
        { path: join(skillPath, 'run.sh'), interpreter: ['bash', 'sh'] },
    ];
    for (const c of candidates) {
        if (existsSync(c.path))
            return c;
    }
    const fallback = (dir, exts) => {
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
                if (!e.isFile())
                    continue;
                const ext = exts.find((x) => e.name.endsWith(x));
                if (ext)
                    return join(dir, e.name);
            }
        }
        catch { /* ignore */ }
        return null;
    };
    const py = fallback(scriptsDir, ['.py']);
    if (py)
        return { path: py, interpreter: ['python3', 'python'] };
    const js = fallback(scriptsDir, ['.js']);
    if (js)
        return { path: js, interpreter: ['node'] };
    const sh = fallback(scriptsDir, ['.sh']);
    if (sh)
        return { path: sh, interpreter: ['bash', 'sh'] };
    const rootPy = fallback(skillPath, ['.py']);
    if (rootPy)
        return { path: rootPy, interpreter: ['python3', 'python'] };
    return null;
}
/** 从 manifest.openclawMeta.mainScript 解析脚本路径（SKILL.md 声明时优先） */
function resolveDeclaredMainScript(skill) {
    const mainScript = skill.manifest.openclawMeta?.mainScript;
    if (!mainScript || typeof mainScript !== 'string')
        return null;
    const scriptPath = join(skill.path, mainScript.replace(/^[/\\]/, ''));
    if (!existsSync(scriptPath))
        return null;
    if (scriptPath.endsWith('.py'))
        return { path: scriptPath, interpreter: ['python3', 'python'] };
    if (scriptPath.endsWith('.js'))
        return { path: scriptPath, interpreter: ['node'] };
    if (scriptPath.endsWith('.sh'))
        return { path: scriptPath, interpreter: ['bash', 'sh'] };
    return { path: scriptPath, interpreter: ['python3', 'python'] };
}
/** 无脚本时读取 SKILL.md 正文，返回工作流型技能的说明供 Agent 参考 */
async function getSkillInstructionsAsFallback(skillPath) {
    try {
        const skillMdPath = join(skillPath, 'SKILL.md');
        if (!existsSync(skillMdPath))
            return null;
        const raw = await readFile(skillMdPath, 'utf-8');
        const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const body = match?.[1]?.trim();
        return body && body.length > 0 ? body : raw.trim();
    }
    catch {
        return null;
    }
}
/** 执行 OpenClaw Legacy Skill 的 scripts（Python/Node/Bash） */
async function runOpenClawLegacyScript(skill, _toolId, params, ctx) {
    const skillPath = skill.path;
    const skillName = skill.manifest.name || skill.name;
    const scriptInfo = resolveDeclaredMainScript(skill) ?? findOpenClawScript(skillPath, skillName);
    if (!scriptInfo) {
        const instructions = await getSkillInstructionsAsFallback(skillPath);
        const hint = '本技能为工作流型技能，无独立可执行脚本。请根据 Agent 工具说明，结合 web_fetch、web_search 等工具完成任务。';
        return {
            legacy: true,
            ok: true,
            message: hint,
            instructions: instructions ?? undefined,
            output: instructions ? `${hint}\n\n---\n\n${instructions}` : hint,
            command: params.command ?? null,
        };
    }
    const command = params.command != null ? String(params.command) : '';
    const args = [];
    if (command.trim())
        args.push(command.trim());
    const timeoutMs = getToolTimeoutMs();
    const scriptPath = scriptInfo.path;
    let bin = scriptInfo.interpreter[0];
    if (scriptPath.endsWith('.py')) {
        const { execSync } = await import('node:child_process');
        try {
            execSync('python3 --version', { stdio: 'ignore' });
        }
        catch {
            try {
                execSync('python --version', { stdio: 'ignore' });
                bin = 'python';
            }
            catch { /* keep python3 */ }
        }
    }
    else if (scriptPath.endsWith('.sh')) {
        const { execSync } = await import('node:child_process');
        if (platform() === 'win32') {
            try {
                execSync('bash --version', { stdio: 'ignore' });
                bin = 'bash';
            }
            catch {
                throw new Error('.sh 脚本在 Windows 上需要 bash。请安装 Git for Windows（含 bash）：https://git-scm.com/download/win');
            }
        }
        else {
            try {
                execSync('bash --version', { stdio: 'ignore' });
            }
            catch {
                bin = 'sh';
            }
        }
    }
    const procArgs = scriptPath.endsWith('.py') || scriptPath.endsWith('.js')
        ? [scriptPath, ...args]
        : [scriptPath, ...args];
    const skillEnv = getSkillEntryEnv(skillName, skill.manifest.openclawMeta?.primaryEnv, skill.name);
    const skillConfig = getSkillEntryConfig(skillName, skill.name);
    const env = { ...process.env, ...skillEnv, SKILL_NAME: skillName, SKILL_PATH: skillPath };
    if (Object.keys(skillConfig).length > 0) {
        env.APEX_SKILL_CONFIG = JSON.stringify(skillConfig);
    }
    const proc = spawn(bin, procArgs, {
        cwd: skillPath,
        env,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => resolve({ stdout: stdout.slice(0, 50000), stderr: stderr.slice(0, 5000), exitCode: code }));
        proc.on('error', (e) => reject(e));
    });
    let output = result.stdout?.trim() || result.stderr?.trim() || null;
    if (result.exitCode !== 0 && scriptInfo.path.endsWith('.py')) {
        const stderr = (result.stderr || '').toLowerCase();
        const isImportError = stderr.includes('modulenotfounderror') || stderr.includes('importerror') || stderr.includes('no module named');
        const reqPath = join(skillPath, 'requirements.txt');
        if (isImportError && existsSync(reqPath)) {
            const hint = `\n\n提示：该 Skill 可能需要安装依赖，请在 skill 目录执行：pip install -r requirements.txt`;
            output = (output || result.stderr?.trim() || '') + hint;
        }
    }
    return {
        legacy: true,
        ok: result.exitCode === 0,
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        exitCode: result.exitCode,
        output,
    };
}
const reminderStore = new Map();
/**
 * Phase 7: 推导 memory 操作的最终 scope。
 * 优先级：param.scope(显式) > agentId+visibility(Agent专属) > memoryScopeHint > sessionId > 'default'
 *
 * agent-only 群组场景使用三维 scope（agent:id:group:gid:user:uid）防成员间信息泄露。
 */
function resolveMemoryScope(paramScope, ctx) {
    if (paramScope != null && String(paramScope).trim())
        return String(paramScope).trim();
    if (ctx?.agentId && ctx.agentMemoryVisibility === 'agent-only') {
        const hint = ctx.memoryScopeHint;
        if (hint?.startsWith('group:') && ctx.userId) {
            return `agent:${ctx.agentId}:${hint}:user:${ctx.userId}`;
        }
        if (hint?.startsWith('group:')) {
            // 无 userId 时降级为 group+agent scope（无法三维隔离，但避免误用 user scope）
            return `agent:${ctx.agentId}:${hint}`;
        }
        if (hint?.startsWith('user:')) {
            return `agent:${ctx.agentId}:${hint}`;
        }
        return `agent:${ctx.agentId}:${ctx.sessionId ?? 'default'}`;
    }
    return ctx?.memoryScopeHint ?? ctx?.sessionId ?? 'default';
}
/**
 * Phase 9: agent-only 时的用户级共享 scope（兜底检索用），对应 shared 模式的 scope。
 * 若 agent-only 检索无结果，可扩展到此 scope 补充。
 */
function resolveSharedScope(ctx) {
    if (!ctx?.agentId || ctx.agentMemoryVisibility !== 'agent-only')
        return null;
    return ctx.memoryScopeHint ?? ctx.sessionId ?? null;
}
const memoryStore = new Map();
let memoryLoaded = false;
/** Phase 6: 写入串行化队列，避免并发写同一文件导致 JSON 损坏 */
let saveQueue = Promise.resolve();
function enqueueSave() {
    saveQueue = saveQueue.then(() => saveMemoryToFile()).catch(() => { });
}
/** Phase 6: 供 extraction.ts 读取指定 scope 的全部记忆条目（含内容），用于冲突检测 */
export async function getMemoriesForScope(scope) {
    await ensureMemoryLoaded();
    return [...(memoryStore.get(scope) ?? [])];
}
/** 活起来 P3: 获取所有 scope 列表，供 consolidation 使用 */
export async function getMemoryScopes() {
    await ensureMemoryLoaded();
    return [...memoryStore.keys()];
}
/** 活起来 P3: 标记条目为已归档，consolidation 后降权 */
export async function markMemoriesArchived(scope, ids) {
    await ensureMemoryLoaded();
    const arr = memoryStore.get(scope);
    if (!arr)
        return;
    const idSet = new Set(ids);
    for (let i = 0; i < arr.length; i++) {
        if (idSet.has(arr[i].id)) {
            arr[i] = { ...arr[i], archived: true };
        }
    }
    memoryStore.set(scope, arr);
    enqueueSave();
}
/** 批量获取各 scope 的记忆条目数，供会话页面展示「关联记忆 X 条」 */
export async function getMemoryCountsForScopes(scopes) {
    await ensureMemoryLoaded();
    const out = {};
    const uniq = [...new Set(scopes.filter((s) => typeof s === 'string' && s.trim()))];
    for (const scope of uniq) {
        out[scope] = (memoryStore.get(scope) ?? []).length;
    }
    return out;
}
export async function searchMemoriesForPreInjection(query, ctx, limit) {
    if (limit <= 0)
        return [];
    const q = (query || '用户偏好 历史').trim().toLowerCase();
    const execCtx = ctx ? {
        workspaceDir: getWorkspaceDir(),
        sessionId: ctx.sessionId,
        memoryScopeHint: ctx.memoryScopeHint,
        agentId: ctx.agentId,
        agentMemoryVisibility: ctx.agentMemoryVisibility,
        userId: ctx.userId,
        sessionHistory: ctx.sessionHistory,
    } : undefined;
    const scope = resolveMemoryScope(undefined, execCtx);
    await ensureMemoryLoaded();
    let arr = memoryStore.get(scope) ?? [];
    // agent-only 无结果时扩展共享 scope 兜底
    if (arr.length === 0 && ctx?.agentMemoryVisibility === 'agent-only') {
        const shared = resolveSharedScope(execCtx);
        if (shared)
            arr = memoryStore.get(shared) ?? [];
    }
    if (arr.length === 0)
        return [];
    const memCfg = getMemoryConfig();
    const bigramSet = (s) => {
        const str = s.toLowerCase().replace(/\s+/g, '');
        if (str.length === 0)
            return new Set();
        if (str.length === 1)
            return new Set([str]);
        const bg = new Set();
        for (let i = 0; i < str.length - 1; i++)
            bg.add(str.slice(i, i + 2));
        return bg;
    };
    const bigramSim = (a, b) => {
        if (a.size === 0 && b.size === 0)
            return 0;
        const inter = [...a].filter((x) => b.has(x)).length;
        return inter / (a.size + b.size - inter);
    };
    const queryTokens = q.split(/\s+/).filter(Boolean);
    if (queryTokens.length === 0 && q)
        queryTokens.push(q);
    const N = arr.length;
    const dfMap = {};
    for (const w of queryTokens) {
        let df = 0;
        for (const e of arr) {
            if (`${e.key ?? ''} ${e.content}`.toLowerCase().includes(w))
                df++;
        }
        dfMap[w] = df;
    }
    const idfWeight = (w) => Math.log(1 + (N + 1) / ((dfMap[w] ?? 0) + 1));
    const ACCESS_BOOST_FACTOR = 0.15;
    const SESSION_CONTEXT_BOOST_FACTOR = 0.2;
    const SESSION_CONTEXT_SIM_CAP = 0.5;
    const ARCHIVED_SCORE_FACTOR = 0.3;
    const sessionContext = memCfg.sessionContextBoost && ctx?.sessionHistory?.length
        ? ctx.sessionHistory.slice(-6).map((m) => m.content).join(' ').toLowerCase().replace(/\s+/g, ' ').trim()
        : '';
    const sessionContextBigram = sessionContext ? bigramSet(sessionContext) : new Set();
    const scoreEntry = (rawText, ts, halfLife, accessCount = 0) => {
        const text = rawText.toLowerCase();
        let score = 0;
        for (const w of queryTokens) {
            if (!w)
                continue;
            const idx = text.indexOf(w);
            if (idx >= 0) {
                let count = 0;
                let pos = idx;
                while (pos >= 0) {
                    count++;
                    pos = text.indexOf(w, pos + w.length);
                }
                const tf = 1 + 0.4 * Math.log(1 + count);
                score += tf * idfWeight(w);
            }
        }
        if (score > 0) {
            score *= 0.7 + 0.3 / (1 + 0.001 * rawText.length);
            const ageDays = (Date.now() - ts) / 86400000;
            const decay = halfLife === 0 ? 1 : Math.exp(-0.693 * ageDays / halfLife);
            score *= decay;
            score *= 1 + ACCESS_BOOST_FACTOR * Math.min(accessCount, 5);
        }
        return score;
    };
    const browsePhrases = /^(查看|我的|所有|全部|列出|有什么|我记得).*记忆|记忆.*(列表|全部|有什么)/;
    const isBrowseIntent = arr.length > 0 && browsePhrases.test(q);
    const scored = arr
        .map((e) => {
        const rawText = `${e.key ?? ''} ${e.content}`;
        const halfLife = e.tier === 'log' ? memCfg.logHalfLifeDays : memCfg.decayHalfLifeDays;
        let score = scoreEntry(rawText, e.ts, halfLife, e.accessCount ?? 0);
        if (score === 0 && isBrowseIntent) {
            const ageDays = (Date.now() - e.ts) / 86400000;
            score = 1 / (1 + 0.1 * ageDays);
        }
        if (score > 0 && sessionContextBigram.size > 0) {
            const memBigram = bigramSet(rawText);
            const sim = bigramSim(memBigram, sessionContextBigram);
            if (sim > 0.05)
                score *= 1 + SESSION_CONTEXT_BOOST_FACTOR * Math.min(sim, SESSION_CONTEXT_SIM_CAP);
        }
        if (e.archived)
            score *= ARCHIVED_SCORE_FACTOR;
        return { ...e, score };
    })
        .filter((x) => x.score > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const max = Math.min(limit, scored.length);
    return scored.slice(0, max).map((e) => ({ content: e.content, key: e.key }));
}
async function getMemoryPath() {
    const { join } = await import('node:path');
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    return join(base, 'memory.json');
}
async function ensureMemoryLoaded() {
    if (memoryLoaded || !getMemoryConfig().persist)
        return;
    memoryLoaded = true;
    try {
        const path = await getMemoryPath();
        const raw = await readFile(path, 'utf-8');
        const data = JSON.parse(raw);
        memoryStore.clear();
        for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v))
                memoryStore.set(k, v);
        }
        // Phase 6: 清理衰减至 <1% 的僵尸记忆；活起来 P0: 高 accessCount 记忆需衰减更多才清理
        const cfg = getMemoryConfig();
        const now = Date.now();
        for (const [scope, entries] of memoryStore.entries()) {
            const alive = entries.filter((e) => {
                const hl = e.tier === 'log' ? cfg.logHalfLifeDays : cfg.decayHalfLifeDays;
                if (hl === 0)
                    return true;
                const ageDays = (now - e.ts) / 86400000;
                const decay = Math.exp(-0.693 * ageDays / hl);
                const accessBoost = 1 + 0.1 * Math.min(e.accessCount ?? 0, 5);
                return decay * accessBoost >= 0.01;
            });
            if (alive.length !== entries.length)
                memoryStore.set(scope, alive);
        }
    }
    catch {
        memoryStore.clear();
    }
}
async function saveMemoryToFile() {
    const cfg = getMemoryConfig();
    if (!cfg.persist)
        return;
    try {
        const path = await getMemoryPath();
        const dir = dirname(path);
        await mkdir(dir, { recursive: true });
        const data = Object.fromEntries(memoryStore);
        await writeFile(path, JSON.stringify(data, null, 0), 'utf-8');
        if (cfg.exportMarkdown) {
            const mdLines = ['# 长期记忆', '', `*导出时间: ${new Date().toISOString()}*`, ''];
            for (const [scope, entries] of Object.entries(data).sort()) {
                if (!Array.isArray(entries) || entries.length === 0)
                    continue;
                mdLines.push(`## ${scope}`, '');
                for (const e of entries) {
                    const date = new Date(e.ts).toISOString().slice(0, 19).replace('T', ' ');
                    const tierTag = e.tier ? ` [${e.tier}]` : '';
                    const line = e.key
                        ? `- **${e.key}**${tierTag} (${date}): ${e.content.replace(/\n/g, ' ').slice(0, 200)}${e.content.length > 200 ? '...' : ''}`
                        : `-${tierTag} (${date}) ${e.content.replace(/\n/g, ' ').slice(0, 200)}${e.content.length > 200 ? '...' : ''}`;
                    mdLines.push(line);
                }
                mdLines.push('');
            }
            const mdPath = path.replace(/\.json$/i, '.md');
            await writeFile(mdPath, mdLines.join('\n'), 'utf-8');
        }
    }
    catch {
        /* ignore */
    }
}
const backgroundTasks = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const browserSessions = new Map();
function wrapBrowserError(e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Executable') || msg.includes('browserType.launch') || msg.includes('Playwright')) {
        return new Error(`浏览器启动失败。请先在项目根目录执行: npx playwright install chromium\n原始错误: ${msg}`);
    }
    return e instanceof Error ? e : new Error(String(e));
}
async function getOrCreateBrowserSession(sessionId, useUserDataDir = false) {
    let ses = browserSessions.get(sessionId);
    if (ses)
        return ses;
    const { chromium } = await import('playwright');
    const { join } = await import('node:path');
    const base = process.env.APEXPANDA_DATA_DIR ?? join(process.cwd(), '.apexpanda');
    const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 64);
    const userDataDir = useUserDataDir ? join(base, 'browser-profiles', safeId) : undefined;
    const launchOpts = { headless: true };
    if (userDataDir)
        launchOpts.userDataDir = userDataDir;
    let browser;
    try {
        browser = await chromium.launch(launchOpts);
    }
    catch (e) {
        throw wrapBrowserError(e);
    }
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const pages = [page];
    ses = { browser, context, page, pages, activeIndex: 0 };
    browserSessions.set(sessionId, ses);
    return ses;
}
function getActivePage(ses) {
    const idx = ses.activeIndex;
    if (idx >= 0 && idx < ses.pages.length)
        return ses.pages[idx];
    return ses.page;
}
async function closeBrowserSession(sessionId) {
    const ses = browserSessions.get(sessionId);
    if (!ses)
        return;
    browserSessions.delete(sessionId);
    try {
        await ses.context.close();
    }
    catch {
        /* ignore */
    }
    try {
        await ses.browser.close();
    }
    catch {
        /* ignore */
    }
}
const builtinHandlers = {
    // calculator
    'calculator#calculate': async ({ expr }) => {
        const ex = String(expr ?? '');
        if (!/^[\d\s+\-*/().]+$/.test(ex)) {
            throw new Error('Invalid expression: only numbers and + - * / ( ) allowed');
        }
        return { result: String(eval(ex)), expr: ex };
    },
    'calculator#getTime': async () => {
        const now = new Date();
        return {
            iso: now.toISOString(),
            locale: now.toLocaleString('zh-CN'),
            timestamp: now.getTime(),
        };
    },
    'calculator#generateUuid': async () => ({
        uuid: crypto.randomUUID(),
    }),
    // random
    'random#randomInt': async ({ min = 0, max = 100 }) => {
        const a = Math.floor(Number(min) ?? 0);
        const b = Math.floor(Number(max) ?? 100);
        if (a > b)
            throw new Error('min must be <= max');
        const n = b - a + 1;
        return { value: a + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1) * n) };
    },
    'random#randomFloat': async () => ({
        value: crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1),
    }),
    'random#randomString': async ({ length = 12, charset = 'alphanumeric' }) => {
        const len = Math.min(Math.max(1, Math.floor(Number(length) ?? 12)), 256);
        const sets = {
            alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            hex: '0123456789abcdef',
            lower: 'abcdefghijklmnopqrstuvwxyz',
            numeric: '0123456789',
        };
        const set = sets[String(charset ?? 'alphanumeric')] ?? sets.alphanumeric;
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        let s = '';
        for (let i = 0; i < len; i++)
            s += set[arr[i] % set.length];
        return { value: s };
    },
    'random#uuid': async () => ({ uuid: crypto.randomUUID() }),
    // file-tools
    'file-tools#readFile': async ({ path: p }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fp = resolveWorkspacePath(ws, String(p ?? ''));
        const content = await readFile(fp, 'utf-8');
        return { content };
    },
    'file-tools#writeFile': async ({ path: p, content }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fp = resolveWorkspacePath(ws, String(p ?? ''));
        await mkdir(dirname(fp), { recursive: true });
        await writeFile(fp, String(content ?? ''));
        return { path: fp, written: true };
    },
    'file-tools#listFiles': async ({ path: p }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fp = resolveWorkspacePath(ws, String(p ?? ''));
        const entries = await readdir(fp, { withFileTypes: true });
        return {
            files: entries.map((e) => ({
                name: e.name,
                isFile: e.isFile(),
                isDirectory: e.isDirectory(),
            })),
        };
    },
    /** 列出当前 scope 的产出目录（solutions/reports/checklists），按 scope 隔离。agent-only 无结果时扩展检索 user scope（冷启动兜底） */
    'file-tools#listOutput': async (_params, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const { stat } = await import("node:fs/promises");
        const subdirs = ["solutions", "reports", "checklists", "drafts"];
        const collectFromPath = async (baseRel) => {
            const out = [];
            try {
                const basePath = resolveWorkspacePath(ws, baseRel);
                for (const sub of subdirs) {
                    const subPath = join(basePath, sub);
                    try {
                        const st = await stat(subPath);
                        if (!st.isDirectory())
                            continue;
                    }
                    catch {
                        continue;
                    }
                    const entries = await readdir(subPath, { withFileTypes: true });
                    for (const e of entries) {
                        if (e.isFile()) {
                            const rel = `${baseRel}/${sub}/${e.name}`;
                            try {
                                const st = await stat(join(subPath, e.name));
                                out.push({ path: rel, name: e.name, mtime: st.mtimeMs, type: sub });
                            }
                            catch {
                                out.push({ path: rel, name: e.name, type: sub });
                            }
                        }
                    }
                }
            }
            catch {
                /* dir not exists */
            }
            return out;
        };
        const baseRel = getOutputBasePath({
            agentId: ctx?.agentId,
            agentMemoryVisibility: ctx?.agentMemoryVisibility,
            userId: ctx?.userId,
            memoryScopeHint: ctx?.memoryScopeHint,
        });
        let result = await collectFromPath(baseRel);
        if (result.length === 0 && ctx?.agentMemoryVisibility === "agent-only" && ctx?.memoryScopeHint && ctx?.userId) {
            const sharedRel = getOutputBasePath({
                agentMemoryVisibility: "shared",
                userId: ctx.userId,
                memoryScopeHint: ctx.memoryScopeHint,
            });
            const sharedFiles = await collectFromPath(sharedRel);
            result = sharedFiles.map((f) => ({ ...f, _fromSharedScope: true }));
            if (result.length > 0) {
                return {
                    basePath: baseRel,
                    files: result.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)),
                    _fallbackToSharedScope: true,
                };
            }
        }
        if (result.length === 0) {
            return { basePath: baseRel, files: [], message: "产出目录不存在或为空" };
        }
        return { basePath: baseRel, files: result.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)) };
    },
    'file-tools#deleteFile': async ({ path: p }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const rel = String(p ?? '').trim();
        const source = ctx?.deleteSource ?? 'agent';
        const needConfirm = (source === 'user' || source === 'channel') && getDeleteConfirmRequired();
        if (needConfirm) {
            return {
                _pendingDelete: true,
                path: rel,
                workspaceDir: ws,
                message: `即将删除 ${rel}，需用户确认后执行`,
            };
        }
        const fp = resolveWorkspacePath(ws, rel);
        await unlink(fp);
        return { deleted: fp };
    },
    'file-tools#packZip': async ({ paths, outputPath, }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const { default: AdmZip } = await import('adm-zip');
        const { stat } = await import('node:fs/promises');
        const pathList = Array.isArray(paths) ? paths : paths != null ? [paths] : [];
        const toAdd = pathList.map((x) => resolveWorkspacePath(ws, String(x)));
        if (toAdd.length === 0)
            throw new Error('paths is required (array of file/dir paths)');
        const out = resolveWorkspacePath(ws, String(outputPath ?? 'archive.zip'));
        const zip = new AdmZip();
        for (const p of toAdd) {
            const st = await stat(p);
            if (st.isDirectory()) {
                zip.addLocalFolder(p, p.split(sep).pop() ?? '');
            }
            else {
                zip.addLocalFile(p);
            }
        }
        zip.writeZip(out);
        return { _fileReply: true, fileType: 'file', filePath: out, mimeType: 'application/zip', caption: `压缩包已生成（${zip.getEntries().length} 个文件）` };
    },
    'file-tools#unpackZip': async ({ zipPath, outputDir, }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const { default: AdmZip } = await import('adm-zip');
        const zp = resolveWorkspacePath(ws, String(zipPath ?? ''));
        const od = resolveWorkspacePath(ws, String(outputDir ?? '.'));
        await mkdir(od, { recursive: true });
        const zip = new AdmZip(zp);
        zip.extractAllTo(od, true);
        const entries = zip.getEntries();
        return { outputDir: od, extractedCount: entries.length };
    },
    // password-gen
    'password-gen#generate': async ({ length = 16, includeNumbers = true, includeSymbols = true, }) => {
        const len = Math.min(128, Math.max(8, Number(length) || 16));
        const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        let pool = letters;
        if (includeNumbers !== false)
            pool += numbers;
        if (includeSymbols !== false)
            pool += symbols;
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        const pwd = Array.from(arr, (b) => pool[b % pool.length]).join('');
        return { password: pwd, length: len };
    },
    // qrcode-gen
    'qrcode-gen#generate': async ({ data, size = 200 }) => {
        const content = String(data ?? '');
        if (!content)
            throw new Error('data is required');
        const { default: QRCode } = await import('qrcode');
        const opts = { width: Math.min(512, Math.max(100, Number(size) || 200)), margin: 2 };
        const dataUrl = await QRCode.toDataURL(content, opts);
        return { dataUrl, length: content.length };
    },
    'qrcode-gen#decode': async ({ imageUrl, dataUrl, base64, }) => {
        const { Jimp } = await import('jimp');
        const jsQR = (await import('jsqr')).default;
        let buffer;
        const raw = imageUrl ?? dataUrl ?? base64;
        const str = String(raw ?? '');
        if (!str)
            throw new Error('imageUrl, dataUrl 或 base64 至少提供一个');
        if (str.startsWith('http://') || str.startsWith('https://')) {
            const res = await fetch(str);
            if (!res.ok)
                throw new Error(`Fetch failed: ${res.status}`);
            const ab = await res.arrayBuffer();
            buffer = Buffer.from(ab);
        }
        else if (str.startsWith('data:')) {
            const m = str.match(/^data:image\/[^;]+;base64,(.+)$/);
            if (!m)
                throw new Error('Invalid data URL format');
            buffer = Buffer.from(m[1], 'base64');
        }
        else {
            buffer = Buffer.from(str, 'base64');
        }
        const img = await Jimp.read(buffer);
        const { data, width, height } = img.bitmap;
        const code = jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: 'attemptBoth' });
        if (!code)
            return { error: 'No QR code found in image', text: null };
        return { text: code.data, success: true };
    },
    // exchange-rate
    'exchange-rate#getRate': async ({ from = 'USD', to = 'CNY' }) => {
        const base = String(from ?? 'USD').toUpperCase();
        const target = String(to ?? 'CNY').toUpperCase();
        const url = `https://open.er-api.com/v6/latest/${base}`;
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Exchange rate API failed: ${res.status}`);
        const data = (await res.json());
        const rates = data.rates ?? {};
        const rate = rates[target];
        if (rate == null) {
            return { error: `Currency ${target} not found`, available: Object.keys(rates).slice(0, 20) };
        }
        return { from: base, to: target, rate, rates: { [target]: rate } };
    },
    'exchange-rate#listCurrencies': async () => {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!res.ok)
            throw new Error(`Exchange rate API failed: ${res.status}`);
        const data = (await res.json());
        const codes = Object.keys(data.rates ?? {}).sort();
        return { currencies: codes, count: codes.length };
    },
    // translate (MyMemory API, no key required)
    'translate#translate': async ({ text, from = 'auto', to = 'zh', }) => {
        const t = String(text ?? '').trim();
        const src = String(from ?? 'auto').toLowerCase();
        const tgt = String(to ?? 'zh').toLowerCase();
        if (!t)
            return { translatedText: '', from: src, to: tgt, error: 'text is empty' };
        const langpair = `${src}|${tgt}`;
        const MAX_BYTES = 450; // MyMemory limit 500, leave margin
        const chunks = [];
        let pos = 0;
        while (pos < t.length) {
            let len = Math.min(150, t.length - pos); // ~150 chars safe for 500 bytes (CJK~3/char)
            let s = t.slice(pos, pos + len);
            while (new TextEncoder().encode(s).length > MAX_BYTES && len > 1) {
                len = Math.floor(len / 2);
                s = t.slice(pos, pos + len);
            }
            if (s.length > 0)
                chunks.push(s);
            pos += s.length;
        }
        const results = [];
        for (const chunk of chunks) {
            const q = encodeURIComponent(chunk);
            const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=${encodeURIComponent(langpair)}`;
            const res = await fetch(url);
            if (!res.ok)
                throw new Error(`Translate API failed: ${res.status}`);
            const data = (await res.json());
            if (data.quotaFinished) {
                throw new Error('MyMemory daily quota exceeded. Try again tomorrow.');
            }
            results.push(data.responseData?.translatedText ?? chunk);
        }
        return { translatedText: results.join(''), from: src, to: tgt };
    },
    // webhook-trigger
    'webhook-trigger#send': async ({ url, method = 'POST', body, headers = {}, }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            throw new Error('Invalid URL: must start with http:// or https://');
        }
        const h = headers ?? {};
        if (!h['Content-Type'] && body && typeof body === 'object') {
            h['Content-Type'] = 'application/json';
        }
        const res = await fetch(u, {
            method: String(method ?? 'POST').toUpperCase(),
            headers: h,
            body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        });
        let text = '';
        try {
            text = await res.text();
        }
        catch {
            // ignore
        }
        return {
            status: res.status,
            statusText: res.statusText,
            ok: res.ok,
            body: text.slice(0, 1000),
        };
    },
    // api-tester
    'api-tester#request': async ({ url, method = 'GET', headers = {}, body, timeout, }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            throw new Error('Invalid URL: must start with http:// or https://');
        }
        const m = String(method ?? 'GET').toUpperCase();
        const h = headers ?? {};
        if (!h['Content-Type'] && body != null && typeof body === 'object' && !Array.isArray(body)) {
            h['Content-Type'] = 'application/json';
        }
        const ms = typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60000) : 15000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), ms);
        try {
            const res = await fetch(u, {
                method: m,
                headers: h,
                body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
                signal: controller.signal,
            });
            clearTimeout(id);
            let text = '';
            try {
                text = await res.text();
            }
            catch {
                text = '[read failed]';
            }
            const respHeaders = {};
            res.headers.forEach((v, k) => { respHeaders[k] = v; });
            return {
                status: res.status,
                statusText: res.statusText,
                ok: res.ok,
                headers: respHeaders,
                body: text.slice(0, 5000),
            };
        }
        catch (e) {
            clearTimeout(id);
            throw new Error(e instanceof Error ? e.message : 'Request failed');
        }
    },
    // code-runner
    'code-runner#runPython': async ({ code }, ctx) => {
        const c = String(code ?? '').trim();
        if (!c)
            throw new Error('code is required');
        if (c.length > 8000)
            throw new Error('code too long (max 8000 chars)');
        const timeout = 15000;
        const py = process.platform === 'win32' ? 'python' : 'python3';
        const workDir = ctx?.workspaceDir ?? getWorkspaceDir();
        const tmpPath = resolve(tmpdir(), `apex-code-${randomUUID()}.py`);
        await writeFile(tmpPath, c, 'utf-8');
        try {
            const result = await new Promise((resolve, reject) => {
                const proc = spawn(py, ['-u', tmpPath], {
                    timeout,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    cwd: workDir,
                });
                let stdout = '';
                let stderr = '';
                proc.stdout?.on('data', (d) => { stdout += d.toString(); });
                proc.stderr?.on('data', (d) => { stderr += d.toString(); });
                proc.on('close', (code, sig) => {
                    resolve({ stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 2000), exitCode: code });
                });
                proc.on('error', (e) => reject(e));
            });
            return {
                stdout: result.stdout || null,
                stderr: result.stderr || null,
                exitCode: result.exitCode,
                ok: result.exitCode === 0,
            };
        }
        finally {
            await unlink(tmpPath).catch(() => { });
        }
    },
    'code-runner#runPythonFile': async ({ path: p, args: a }, ctx) => {
        const rel = String(p ?? '').trim();
        if (!rel)
            throw new Error('path is required');
        const workDir = ctx?.workspaceDir ?? getWorkspaceDir();
        const fp = resolveWorkspacePath(workDir, rel);
        const { access } = await import('node:fs/promises');
        await access(fp).catch(() => {
            throw new Error(`File not found: ${rel} (resolved: ${fp})`);
        });
        const argsList = Array.isArray(a) ? a.map(String) : [];
        const py = process.platform === 'win32' ? 'python' : 'python3';
        const timeout = 15000;
        const result = await new Promise((resolve, reject) => {
            const proc = spawn(py, ['-u', fp, ...argsList], {
                timeout,
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: workDir,
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => resolve({ stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 2000), exitCode: code }));
            proc.on('error', (e) => reject(e));
        });
        return {
            stdout: result.stdout || null,
            stderr: result.stderr || null,
            exitCode: result.exitCode,
            ok: result.exitCode === 0,
        };
    },
    'code-runner#runJs': async ({ code }) => {
        const c = String(code ?? '').trim();
        if (!c)
            throw new Error('code is required');
        if (c.length > 2000)
            throw new Error('code too long (max 2000 chars)');
        const allowed = { Math, JSON, Array, Object, String, Number, parseInt, parseFloat, Date, RegExp, Error, Map, Set };
        const sandbox = { ...allowed, result: undefined };
        const timeoutMs = 5000;
        const isExpr = !/[\n;]/.test(c) && !c.trim().startsWith('return');
        const wrapped = isExpr
            ? `"use strict"; result = (function() { return (${c}); })();`
            : `"use strict"; result = (function() { ${c} })();`;
        try {
            runInNewContext(wrapped, sandbox, { timeout: timeoutMs });
            const out = sandbox.result;
            if (out === undefined || out === null) {
                return { result: out, type: String(typeof out) };
            }
            if (typeof out === 'object' && out !== null && !Array.isArray(out) && typeof out.toISOString === 'function') {
                return { result: out.toISOString(), type: 'object' };
            }
            const s = typeof out === 'object' ? JSON.stringify(out) : String(out);
            if (s.length > 2000)
                return { result: s.slice(0, 2000) + '...[truncated]', type: typeof out };
            return { result: out, type: typeof out };
        }
        catch (e) {
            throw new Error(e instanceof Error ? e.message : 'JS execution failed');
        }
    },
    // docker-manage
    'docker-manage#listContainers': async ({ all = true }) => {
        const args = ['ps', ...(all !== false ? ['-a'] : []), '--format', '{{json .}}'];
        const result = await new Promise((resolve, reject) => {
            const proc = spawn('docker', args, { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
            proc.on('error', (e) => reject(e));
        });
        if (result.exitCode !== 0) {
            throw new Error(result.stderr || 'Docker command failed. Ensure Docker is installed and running.');
        }
        const containers = [];
        for (const line of result.stdout.split('\n').filter(Boolean)) {
            try {
                containers.push(JSON.parse(line.trim()));
            }
            catch {
                // skip invalid lines
            }
        }
        return { containers, count: containers.length };
    },
    'docker-manage#inspect': async ({ nameOrId }) => {
        const id = String(nameOrId ?? '').trim();
        if (!id)
            throw new Error('nameOrId is required');
        const result = await new Promise((resolve, reject) => {
            const proc = spawn('docker', ['inspect', id], { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
            proc.on('error', (e) => reject(e));
        });
        if (result.exitCode !== 0) {
            throw new Error(result.stderr || `Container "${id}" not found`);
        }
        let data;
        try {
            data = JSON.parse(result.stdout);
        }
        catch {
            throw new Error('Failed to parse docker inspect output');
        }
        const arr = Array.isArray(data) ? data : [data];
        const c = arr[0];
        if (!c)
            throw new Error('No container data');
        return {
            id: c.Id,
            name: c.Name,
            status: c.State?.Status,
            image: c.Config?.Image,
            raw: arr,
        };
    },
    // healthcheck
    'healthcheck#check': async ({ url, urls }) => {
        const list = Array.isArray(urls) ? urls : url != null ? [url] : [];
        const toCheck = list.map((u) => String(u).trim()).filter((u) => u.startsWith('http'));
        if (toCheck.length === 0)
            throw new Error('At least one valid URL required');
        const results = await Promise.all(toCheck.slice(0, 10).map(async (url) => {
            const start = Date.now();
            try {
                const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
                return {
                    url,
                    status: res.status,
                    ok: res.ok,
                    latencyMs: Date.now() - start,
                };
            }
            catch (e) {
                return {
                    url,
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                    latencyMs: Date.now() - start,
                };
            }
        }));
        return { results };
    },
    // process-monitor：进程+网络监控，回答「电脑在干嘛」
    'process-monitor#summary': async () => {
        const { execSync, spawnSync } = await import('node:child_process');
        const isWin = process.platform === 'win32';
        const res = {};
        try {
            res.hostname = execSync('hostname', { encoding: 'utf-8', timeout: 5000 }).trim();
        }
        catch {
            res.hostname = 'unknown';
        }
        const total = totalmem();
        const free = freemem();
        const used = total - free;
        const c = cpus();
        const loadAvg = c.length > 0
            ? c.reduce((s, x) => s + (x.times.user + x.times.nice + x.times.sys), 0) / c.length / 1000
            : 0;
        res.memory = {
            totalGb: Math.round((total / 1024 / 1024 / 1024) * 100) / 100,
            usedGb: Math.round((used / 1024 / 1024 / 1024) * 100) / 100,
            freeGb: Math.round((free / 1024 / 1024 / 1024) * 100) / 100,
            usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
        };
        res.cpu = { cores: c.length, loadAvg: Math.round(loadAvg * 100) / 100 };
        res.uptimeSeconds = Math.round(process.uptime());
        const procLimit = 20;
        try {
            if (isWin) {
                const out = execSync(`tasklist /fo csv /nh`, { encoding: 'utf-8', timeout: 8000 });
                const byName = {};
                for (const line of out.split(/\r?\n/)) {
                    const m = line.match(/^"([^"]+)"[\s,]/);
                    if (m) {
                        const name = m[1].replace(/\.exe$/i, '');
                        byName[name] = (byName[name] ?? 0) + 1;
                    }
                }
                res.topProcesses = Object.entries(byName)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, procLimit)
                    .map(([n, c]) => ({ name: n, count: c }));
            }
            else {
                const out = execSync(`ps -eo comm= 2>/dev/null | sed 's/.*\\///' | sort | uniq -c | sort -rn | head -${procLimit}`, {
                    encoding: 'utf-8',
                    timeout: 5000,
                });
                res.topProcesses = out.split(/\n/).filter(Boolean).map((l) => {
                    const m = l.trim().match(/^\s*(\d+)\s+(.+)/);
                    return m ? { name: m[2], count: parseInt(m[1], 10) } : null;
                }).filter(Boolean);
            }
        }
        catch {
            res.topProcesses = [];
        }
        try {
            if (isWin) {
                const psCmd = 'Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Select-Object -First 100 LocalAddress,LocalPort,RemoteAddress,RemotePort | ConvertTo-Csv -NoTypeInformation';
                const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
                    encoding: 'utf-8',
                    timeout: 8000,
                });
                const out = r.stdout ?? '';
                const lines = out.split(/\r?\n/).slice(1).filter(Boolean);
                const ports = {};
                const remotes = [];
                for (const line of lines) {
                    const parts = line.split(',');
                    if (parts.length >= 4) {
                        const port = parseInt(parts[1]?.trim() ?? '0', 10);
                        const remote = parts[2]?.trim() ?? '';
                        if (port)
                            ports[port] = (ports[port] ?? 0) + 1;
                        if (remote && remote !== '-' && !remote.startsWith('0.') && !remotes.includes(remote)) {
                            remotes.push(remote);
                            if (remotes.length >= 10)
                                break;
                        }
                    }
                }
                res.networkSummary = {
                    connectionCount: lines.length,
                    portsSample: Object.entries(ports).slice(0, 10).map(([p, c]) => ({ port: parseInt(p, 10), count: c })),
                    remoteAddressesSample: remotes.slice(0, 10),
                };
            }
            else {
                const out = execSync(`ss -tn state established 2>/dev/null || netstat -tn 2>/dev/null | grep ESTABLISHED`, {
                    encoding: 'utf-8',
                    timeout: 5000,
                });
                const lines = out.split(/\n/).filter(Boolean);
                const ports = {};
                const remotes = [];
                for (const line of lines) {
                    const portMatch = line.match(/:(\d+)\s/);
                    const remoteMatch = line.match(/[\d.]+\s+(?:[\d.]+\:)?(\d+)|(\d+\.\d+\.\d+\.\d+)/);
                    if (portMatch) {
                        const p = parseInt(portMatch[1], 10);
                        ports[p] = (ports[p] ?? 0) + 1;
                    }
                    if (remoteMatch && remoteMatch[2]) {
                        const r = remoteMatch[2];
                        if (!remotes.includes(r))
                            remotes.push(r);
                    }
                }
                res.networkSummary = {
                    connectionCount: lines.length,
                    portsSample: Object.entries(ports).slice(0, 10).map(([p, c]) => ({ port: parseInt(p, 10), count: c })),
                    remoteAddressesSample: remotes.slice(0, 10),
                };
            }
        }
        catch {
            res.networkSummary = { connectionCount: 0, portsSample: [], remoteAddressesSample: [] };
        }
        return res;
    },
    'process-monitor#list': async ({ limit = 50 } = {}) => {
        const { execSync } = await import('node:child_process');
        const isWin = process.platform === 'win32';
        const lim = Math.min(Number(limit) || 50, 200);
        try {
            if (isWin) {
                const out = execSync(`tasklist /fo csv /v`, { encoding: 'utf-8', timeout: 10000 });
                const lines = out.split(/\r?\n/).slice(1, lim + 1);
                const processes = lines.map((l) => {
                    const parts = l.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
                    return { name: parts[0] ?? '', pid: parts[1] ?? '', mem: parts[4] ?? '', status: parts[5] ?? '' };
                }).filter((p) => p.name);
                return { processes, count: processes.length };
            }
            else {
                const out = execSync(`ps aux | head -${lim + 1}`, { encoding: 'utf-8', timeout: 5000 });
                const lines = out.split(/\n/).slice(1);
                const processes = lines.map((l) => {
                    const parts = l.trim().split(/\s+/, 11);
                    return { user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3], command: parts.slice(10).join(' ').slice(0, 80) };
                }).filter((p) => p.pid);
                return { processes, count: processes.length };
            }
        }
        catch (e) {
            throw new Error(`process-monitor#list failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
    'process-monitor#net': async ({ establishedOnly = true } = {}) => {
        const { execSync, spawnSync } = await import('node:child_process');
        const isWin = process.platform === 'win32';
        const established = establishedOnly !== false;
        try {
            if (isWin) {
                const filter = established ? '-State Established' : '';
                const psCmd = `Get-NetTCPConnection ${filter} -ErrorAction SilentlyContinue | Select-Object -First 80 LocalAddress,LocalPort,RemoteAddress,RemotePort,State | ConvertTo-Csv -NoTypeInformation`;
                const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
                    encoding: 'utf-8',
                    timeout: 8000,
                });
                const out = r.stdout ?? '';
                const lines = out.split(/\r?\n/).slice(1).filter(Boolean);
                const connections = lines.map((l) => {
                    const p = l.split(',');
                    return { local: `${p[0]?.trim()}:${p[1]?.trim()}`, remote: `${p[2]?.trim()}:${p[3]?.trim()}`, state: p[4]?.trim() ?? 'Established' };
                });
                return { connections, count: connections.length };
            }
            else {
                const cmd = established
                    ? `ss -tn state established 2>/dev/null || netstat -tn 2>/dev/null | grep ESTABLISHED`
                    : `ss -tn 2>/dev/null || netstat -tn 2>/dev/null`;
                const out = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
                const lines = out.split(/\n/).filter(Boolean).slice(0, 80);
                const connections = lines.map((l) => {
                    const m = l.match(/([\d.:]+)\s+([\d.:]+)\s+(\w+)/);
                    return m ? { local: m[1], remote: m[2], state: m[3] } : null;
                }).filter(Boolean);
                return { connections, count: connections.length };
            }
        }
        catch (e) {
            throw new Error(`process-monitor#net failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
    // server-monitor
    'server-monitor#status': async () => {
        const total = totalmem();
        const free = freemem();
        const used = total - free;
        const c = cpus();
        const loadAvg = (c.length > 0
            ? c.reduce((s, x) => s + (x.times.user + x.times.nice + x.times.sys), 0) / c.length
            : 0) / 1000;
        return {
            memory: {
                totalMb: Math.round(total / 1024 / 1024),
                usedMb: Math.round(used / 1024 / 1024),
                freeMb: Math.round(free / 1024 / 1024),
                usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
            },
            cpu: {
                cores: c.length,
                loadAvg: Math.round(loadAvg * 100) / 100,
            },
            uptime: Math.round(process.uptime()),
        };
    },
    // data-transform
    'data-transform#parseJson': async ({ data }) => {
        const s = String(data ?? '');
        try {
            return { parsed: JSON.parse(s) };
        }
        catch (e) {
            throw new Error(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
    'data-transform#stringifyJson': async ({ data, pretty = false }) => {
        const out = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data ?? null);
        return { output: out };
    },
    'data-transform#parseCsv': async ({ data, delimiter = ',' }) => {
        const s = String(data ?? '');
        const delim = String(delimiter ?? ',')[0] ?? ',';
        const lines = s.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0)
            return { rows: [] };
        const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1).map((line) => {
            const vals = line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
            headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
            return obj;
        });
        return { rows, headers };
    },
    'data-transform#toCsv': async ({ rows, headers }) => {
        const arr = Array.isArray(rows) ? rows : [];
        const h = Array.isArray(headers) ? headers : (arr[0] && typeof arr[0] === 'object' ? Object.keys(arr[0]) : []);
        const cols = h.length ? h : [];
        const line = (r) => cols.map((c) => {
            const v = String(r[c] ?? '');
            return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(',');
        const out = [cols.join(','), ...arr.map((r) => line(r))].join('\n');
        return { output: out };
    },
    // arxiv-search
    'arxiv-search#search': async ({ query, maxResults = 5 }) => {
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const n = Math.min(20, Math.max(1, Number(maxResults) || 5));
        const enc = encodeURIComponent(q.replace(/\s+/g, '+'));
        const url = `https://export.arxiv.org/api/query?search_query=all:${enc}&start=0&max_results=${n}`;
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`arXiv API failed: ${res.status}`);
        const xml = await res.text();
        const { XMLParser } = await import('fast-xml-parser');
        const parser = new XMLParser({ ignoreAttributes: false });
        const doc = parser.parse(xml);
        const feed = doc?.feed;
        const rawEntries = feed?.entry;
        const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];
        const papers = entries.map((e) => {
            const id = typeof e.id === 'string' ? e.id : e.id?.['#text'] ?? '';
            const arxivId = id.split('/abs/')[1]?.split('v')[0] ?? id;
            const title = typeof e.title === 'string' ? e.title : e.title?.['#text'] ?? '';
            const summary = typeof e.summary === 'string' ? e.summary : e.summary?.['#text'] ?? '';
            const authors = (() => {
                const a = e.author;
                if (!a)
                    return [];
                const arr = Array.isArray(a) ? a : [a];
                return arr.map((x) => x?.name ?? '').filter(Boolean);
            })();
            const links = (() => {
                const l = e.link;
                if (!l)
                    return {};
                const arr = Array.isArray(l) ? l : [l];
                const out = {};
                for (const x of arr) {
                    const href = x?.['@_href'] ?? '';
                    const rel = x?.['@_rel'] ?? '';
                    if (rel === 'alternate')
                        out.html = href;
                    if (rel === 'related' || x?.['@_title'] === 'pdf')
                        out.pdf = href;
                }
                return out;
            })();
            return {
                id: arxivId,
                title: title.replace(/\s+/g, ' ').trim(),
                summary: summary.slice(0, 500).replace(/\s+/g, ' ').trim(),
                authors: authors.slice(0, 5),
                url: links.html ?? `https://arxiv.org/abs/${arxivId}`,
                pdf: links.pdf ?? (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : undefined),
            };
        });
        return { papers, count: papers.length };
    },
    // news-aggregator
    'news-aggregator#fetch': async ({ sources, limit = 10 }) => {
        const PRESETS = {
            hn: 'https://hnrss.org/frontpage',
            solidot: 'https://www.solidot.org/index.rss',
            techcrunch: 'https://feeds.feedburner.com/TechCrunch',
            hackernews: 'https://hnrss.org/frontpage',
        };
        const src = sources != null
            ? (Array.isArray(sources) ? sources : [sources]).map(String).filter(Boolean)
            : Object.values(PRESETS);
        const urls = src.map((s) => PRESETS[s.toLowerCase()] ?? s).filter((u) => u.startsWith('http'));
        if (urls.length === 0)
            throw new Error('No valid sources');
        const maxPer = Math.min(5, Math.max(1, Math.floor((Number(limit) || 10) / urls.length)));
        const { XMLParser } = await import('fast-xml-parser');
        const parser = new XMLParser({ ignoreAttributes: false });
        const all = [];
        for (const url of urls.slice(0, 5)) {
            try {
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'ApexPanda/1.0' },
                    signal: AbortSignal.timeout(10000),
                });
                if (!res.ok)
                    continue;
                const xml = await res.text();
                const doc = parser.parse(xml);
                const sourceName = url.includes('solidot') ? 'Solidot' : url.includes('hnrss') ? 'Hacker News' : url.includes('techcrunch') ? 'TechCrunch' : new URL(url).hostname;
                const entries = (() => {
                    const ch = doc?.rss?.channel;
                    if (ch) {
                        const items = ch.item;
                        return Array.isArray(items) ? items : items ? [items] : [];
                    }
                    const feed = doc?.feed;
                    if (feed) {
                        const ent = feed.entry;
                        return Array.isArray(ent) ? ent : ent ? [ent] : [];
                    }
                    return [];
                })();
                for (const e of entries.slice(0, maxPer)) {
                    const title = typeof e.title === 'string' ? e.title : e.title?.['#text'] ?? '';
                    let link = '';
                    const l = e.link;
                    if (typeof l === 'string')
                        link = l;
                    else if (l) {
                        const arr = Array.isArray(l) ? l : [l];
                        const href = arr[0]?.['@_href'] ?? arr[0]?.['#text'];
                        if (href)
                            link = href;
                    }
                    const summaryRaw = typeof e.description === 'string' ? e.description : typeof e.summary === 'string' ? e.summary : e.summary?.['#text'] ?? e.description?.['#text'] ?? '';
                    const summary = typeof summaryRaw === 'string' ? summaryRaw.slice(0, 200) : '';
                    const date = typeof e.pubDate === 'string' ? e.pubDate : typeof e.updated === 'string' ? e.updated : e.updated?.['#text'] ?? '';
                    if (title)
                        all.push({ title: title.replace(/\s+/g, ' ').trim(), link: link || '#', summary, date, source: sourceName });
                }
            }
            catch {
                // skip failed source
            }
        }
        all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const top = all.slice(0, Math.min(20, Number(limit) || 10));
        return { items: top, count: top.length };
    },
    // pdf-reader
    'pdf-reader#extractFromBase64': async ({ content, maxChars }) => {
        const b64 = String(content ?? '').trim();
        if (!b64)
            throw new Error('content (base64) is required');
        let buf;
        try {
            buf = Buffer.from(b64, 'base64');
        }
        catch {
            throw new Error('Invalid base64 content');
        }
        if (buf.length === 0)
            throw new Error('Empty PDF');
        if (buf.length > 50 * 1024 * 1024)
            throw new Error(`PDF 超过 50MB 限制 (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buf) });
        try {
            const result = await parser.getText();
            const text = (result?.text ?? '').replace(/\r\n/g, '\n').trim();
            const limit = typeof maxChars === 'number' && maxChars > 0 ? Math.min(maxChars, 50000) : 20000;
            return { text: text.slice(0, limit), totalChars: text.length, truncated: text.length > limit };
        }
        finally {
            await parser.destroy();
        }
    },
    'pdf-reader#extractFromUrl': async ({ url, maxChars }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            throw new Error('Invalid URL: must start with http:// or https://');
        }
        const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
        if (!res.ok)
            throw new Error(`Failed to fetch: ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = Buffer.from(arr);
        if (buf.length === 0)
            throw new Error('Empty PDF');
        if (buf.length > 50 * 1024 * 1024)
            throw new Error(`PDF 超过 50MB 限制 (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buf) });
        try {
            const result = await parser.getText();
            const text = (result?.text ?? '').replace(/\r\n/g, '\n').trim();
            const limit = typeof maxChars === 'number' && maxChars > 0 ? Math.min(maxChars, 50000) : 20000;
            return { text: text.slice(0, limit), totalChars: text.length, truncated: text.length > limit };
        }
        finally {
            await parser.destroy();
        }
    },
    // office-reader
    'office-reader#extractDocxFromBase64': async ({ content, maxChars }) => {
        const b64 = String(content ?? '').trim();
        if (!b64)
            throw new Error('content (base64) is required');
        let buf;
        try {
            buf = Buffer.from(b64, 'base64');
        }
        catch {
            throw new Error('Invalid base64 content');
        }
        if (buf.length === 0)
            throw new Error('Empty docx');
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: buf });
        const text = (result.value ?? '').replace(/\r\n/g, '\n').trim();
        const limit = typeof maxChars === 'number' && maxChars > 0 ? Math.min(maxChars, 50000) : 20000;
        return { text: text.slice(0, limit), totalChars: text.length, truncated: text.length > limit };
    },
    'office-reader#extractDocxFromPath': async ({ path: p, maxChars }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fp = resolveWorkspacePath(ws, String(p ?? '').trim());
        const buf = await readFile(fp);
        if (buf.length === 0)
            throw new Error('Empty docx');
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: buf });
        const text = (result.value ?? '').replace(/\r\n/g, '\n').trim();
        const limit = typeof maxChars === 'number' && maxChars > 0 ? Math.min(maxChars, 50000) : 20000;
        return { text: text.slice(0, limit), totalChars: text.length, truncated: text.length > limit };
    },
    'office-reader#extractDocxFromUrl': async ({ url, maxChars }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://'))
            throw new Error('Invalid URL');
        const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
        if (!res.ok)
            throw new Error(`Failed to fetch: ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = Buffer.from(arr);
        if (buf.length === 0)
            throw new Error('Empty docx');
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: buf });
        const text = (result.value ?? '').replace(/\r\n/g, '\n').trim();
        const limit = typeof maxChars === 'number' && maxChars > 0 ? Math.min(maxChars, 50000) : 20000;
        return { text: text.slice(0, limit), totalChars: text.length, truncated: text.length > limit };
    },
    'office-reader#extractXlsxFromBase64': async ({ content, maxRows }) => {
        const b64 = String(content ?? '').trim();
        if (!b64)
            throw new Error('content (base64) is required');
        let buf;
        try {
            buf = Buffer.from(b64, 'base64');
        }
        catch {
            throw new Error('Invalid base64 content');
        }
        if (buf.length === 0)
            throw new Error('Empty xlsx');
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'buffer', cellText: true });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet)
            return { text: '', sheets: [], totalRows: 0 };
        const ws = wb.Sheets[firstSheet];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const limit = typeof maxRows === 'number' && maxRows > 0 ? Math.min(maxRows, 1000) : 200;
        const limited = rows.slice(0, limit);
        const text = limited.map((r) => (Array.isArray(r) ? r.map(String).join(',') : JSON.stringify(r))).join('\n');
        return { text, sheets: wb.SheetNames, totalRows: rows.length, truncated: rows.length > limit };
    },
    'office-reader#extractXlsxFromPath': async ({ path: p, maxRows }, ctx) => {
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fp = resolveWorkspacePath(ws, String(p ?? '').trim());
        const buf = await readFile(fp);
        if (buf.length === 0)
            throw new Error('Empty xlsx');
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'buffer', cellText: true });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet)
            return { text: '', sheets: [], totalRows: 0 };
        const ws2 = wb.Sheets[firstSheet];
        const rows = XLSX.utils.sheet_to_json(ws2, { header: 1 });
        const limit = typeof maxRows === 'number' && maxRows > 0 ? Math.min(maxRows, 1000) : 200;
        const limited = rows.slice(0, limit);
        const text = limited.map((r) => (Array.isArray(r) ? r.map(String).join(',') : JSON.stringify(r))).join('\n');
        return { text, sheets: wb.SheetNames, totalRows: rows.length, truncated: rows.length > limit };
    },
    'office-reader#extractXlsxFromUrl': async ({ url, maxRows }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://'))
            throw new Error('Invalid URL');
        const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
        if (!res.ok)
            throw new Error(`Failed to fetch: ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = Buffer.from(arr);
        if (buf.length === 0)
            throw new Error('Empty xlsx');
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'buffer', cellText: true });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet)
            return { text: '', sheets: [], totalRows: 0 };
        const ws = wb.Sheets[firstSheet];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const limit = typeof maxRows === 'number' && maxRows > 0 ? Math.min(maxRows, 1000) : 200;
        const limited = rows.slice(0, limit);
        const text = limited.map((r) => (Array.isArray(r) ? r.map(String).join(',') : JSON.stringify(r))).join('\n');
        return { text, sheets: wb.SheetNames, totalRows: rows.length, truncated: rows.length > limit };
    },
    // chart-gen
    'chart-gen#generate': async ({ type = 'bar', labels, values, title, }) => {
        const lbls = Array.isArray(labels) ? labels : [];
        const vals = Array.isArray(values) ? values.map(Number) : [];
        const t = String(type ?? 'bar').toLowerCase();
        if (!['bar', 'line', 'pie'].includes(t)) {
            throw new Error('type must be bar, line, or pie');
        }
        if (lbls.length === 0 || vals.length === 0 || lbls.length !== vals.length) {
            throw new Error('labels and values must be non-empty arrays of same length');
        }
        const seriesData = lbls.map((l, i) => ({ name: l, value: vals[i] }));
        let option;
        if (t === 'pie') {
            option = {
                title: title ? { text: String(title), left: 'center' } : undefined,
                tooltip: { trigger: 'item' },
                series: [{ type: 'pie', radius: '60%', data: seriesData }],
            };
        }
        else {
            option = {
                title: title ? { text: String(title) } : undefined,
                tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: lbls },
                yAxis: { type: 'value' },
                series: [{ type: t === 'line' ? 'line' : 'bar', data: vals }],
            };
        }
        return { echartsOption: option };
    },
    // csv-analyzer
    'csv-analyzer#describe': async ({ data, delimiter = ',' }) => {
        const s = String(data ?? '');
        const delim = String(delimiter ?? ',')[0] ?? ',';
        const lines = s.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2)
            throw new Error('CSV must have header and at least one row');
        const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1).map((line) => {
            const vals = line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
            headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
            return obj;
        });
        const stats = {};
        for (const col of headers) {
            const vals = rows.map((r) => r[col] ?? '').filter((v) => v !== '');
            const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
            const isNumeric = nums.length >= vals.length * 0.8;
            if (isNumeric && nums.length > 0) {
                const sum = nums.reduce((a, b) => a + b, 0);
                stats[col] = {
                    type: 'numeric',
                    count: nums.length,
                    mean: Math.round((sum / nums.length) * 1000) / 1000,
                    min: Math.min(...nums),
                    max: Math.max(...nums),
                    sum: Math.round(sum * 1000) / 1000,
                };
            }
            else {
                stats[col] = { type: 'text', count: vals.length, unique: new Set(vals).size };
            }
        }
        return { columns: headers, rowCount: rows.length, stats };
    },
    'csv-analyzer#summary': async ({ data, delimiter = ',', head = 5 }) => {
        const s = String(data ?? '');
        const delim = String(delimiter ?? ',')[0] ?? ',';
        const n = Math.min(50, Math.max(1, Number(head) || 5));
        const lines = s.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0)
            return { columns: [], rowCount: 0, preview: [] };
        const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1, 1 + n).map((line) => {
            const vals = line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
            headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
            return obj;
        });
        return { columns: headers, rowCount: lines.length - 1, preview: rows };
    },
    // base64
    // hash
    'hash#md5': async ({ text }) => {
        const t = String(text ?? '');
        const digest = createHash('md5').update(t, 'utf8').digest('hex');
        return { hash: digest };
    },
    'hash#sha256': async ({ text }) => {
        const t = String(text ?? '');
        const digest = createHash('sha256').update(t, 'utf8').digest('hex');
        return { hash: digest };
    },
    // json-path
    'json-path#extract': async ({ data, path }) => {
        let obj;
        if (typeof data === 'string') {
            try {
                obj = JSON.parse(data);
            }
            catch {
                throw new Error('Invalid JSON string');
            }
        }
        else if (data != null && typeof data === 'object') {
            obj = data;
        }
        else {
            throw new Error('data is required (JSON string or object)');
        }
        const p = String(path ?? '').trim();
        if (!p)
            throw new Error('path is required');
        const parts = p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
        let cur = obj;
        for (const part of parts) {
            if (cur == null || typeof cur !== 'object') {
                return { value: undefined, found: false };
            }
            const key = /^\d+$/.test(part) ? parseInt(part, 10) : part;
            const next = cur[key];
            if (next === undefined && !(key in cur)) {
                return { value: undefined, found: false };
            }
            cur = next;
        }
        return { value: cur, found: true };
    },
    'base64#encode': async ({ text }) => {
        const t = String(text ?? '');
        const b64 = Buffer.from(t, 'utf-8').toString('base64');
        return { base64: b64 };
    },
    'base64#decode': async ({ base64 }) => {
        const b = String(base64 ?? '').trim();
        if (!b)
            throw new Error('base64 is required');
        try {
            const text = Buffer.from(b, 'base64').toString('utf-8');
            return { text };
        }
        catch {
            throw new Error('Invalid base64 input');
        }
    },
    // url-tools
    // cron-parse (cron-parser v5: Parser.parse -> CronExpression.next -> CronDate)
    'cron-parse#next': async ({ expression, count = 5, timezone }) => {
        const expr = String(expression ?? '').trim();
        if (!expr)
            throw new Error('expression is required');
        const n = Math.min(20, Math.max(1, Number(count) || 5));
        const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : undefined;
        const { default: Parser } = await import('cron-parser');
        const opts = { currentDate: new Date() };
        if (tz)
            opts.tz = tz;
        try {
            const cronExpr = Parser.parse(expr, opts);
            const times = [];
            for (let i = 0; i < n; i++) {
                const d = cronExpr.next();
                const iso = d.toISOString() ?? d.toDate().toISOString();
                times.push(iso);
            }
            return { expression: expr, nextTimes: times, count: times.length };
        }
        catch (e) {
            throw new Error(`Invalid cron: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
    'cron-parse#validate': async ({ expression }) => {
        const expr = String(expression ?? '').trim();
        if (!expr)
            throw new Error('expression is required');
        const { default: Parser } = await import('cron-parser');
        try {
            Parser.parse(expr);
            return { valid: true, expression: expr };
        }
        catch (e) {
            return { valid: false, expression: expr, error: e instanceof Error ? e.message : String(e) };
        }
    },
    // text-diff
    'text-diff#compare': async ({ textA, textB }) => {
        const a = String(textA ?? '').split(/\r?\n/);
        const b = String(textB ?? '').split(/\r?\n/);
        const diff = computeLineDiff(a, b);
        const added = diff.filter((d) => d.type === 'add').map((d) => d.line);
        const removed = diff.filter((d) => d.type === 'remove').map((d) => d.line);
        const unchanged = diff.filter((d) => d.type === 'keep').map((d) => d.line);
        return {
            added,
            removed,
            unchanged,
            addedCount: added.length,
            removedCount: removed.length,
            diff: diff.slice(0, 200).map((d) => ({ type: d.type, line: d.line })),
        };
    },
    'text-diff#compareWithDelimiter': async ({ text, delimiter = '---' }) => {
        const raw = String(text ?? '');
        const sep = String(delimiter ?? '---');
        const parts = raw.split(sep).map((s) => s.trim());
        if (parts.length < 2)
            throw new Error(`Text must contain delimiter "${sep}" to split into two parts`);
        const textA = parts[0];
        const textB = parts[1];
        const a = textA.split(/\r?\n/);
        const b = textB.split(/\r?\n/);
        const diff = computeLineDiff(a, b);
        const added = diff.filter((d) => d.type === 'add').map((d) => d.line);
        const removed = diff.filter((d) => d.type === 'remove').map((d) => d.line);
        const unchanged = diff.filter((d) => d.type === 'keep').map((d) => d.line);
        return {
            added,
            removed,
            unchanged,
            addedCount: added.length,
            removedCount: removed.length,
            diff: diff.slice(0, 200).map((d) => ({ type: d.type, line: d.line })),
        };
    },
    // regex
    'regex#match': async ({ pattern, text, flags = 'g', all = true }) => {
        const p = String(pattern ?? '').trim();
        const t = String(text ?? '');
        if (!p)
            throw new Error('pattern is required');
        const f = String(flags ?? 'g');
        const wantAll = all !== false;
        try {
            const re = new RegExp(p, f);
            if (wantAll) {
                const matches = [...t.matchAll(re)].map((m) => ({
                    full: m[0],
                    groups: m.slice(1),
                    index: m.index,
                }));
                return { matches, count: matches.length };
            }
            else {
                const m = t.match(re);
                return { match: m ? m[0] : null, groups: m ? Array.from(m).slice(1) : [] };
            }
        }
        catch (e) {
            throw new Error(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
    'regex#replace': async ({ pattern, text, replacement, flags = 'g' }) => {
        const p = String(pattern ?? '').trim();
        const t = String(text ?? '');
        const rep = String(replacement ?? '');
        if (!p)
            throw new Error('pattern is required');
        try {
            const re = new RegExp(p, String(flags ?? 'g'));
            const out = t.replace(re, rep);
            return { output: out, replaced: out !== t };
        }
        catch (e) {
            throw new Error(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
    'regex#test': async ({ pattern, text }) => {
        const p = String(pattern ?? '').trim();
        const t = String(text ?? '');
        if (!p)
            throw new Error('pattern is required');
        try {
            const re = new RegExp(p);
            return { matches: re.test(t) };
        }
        catch (e) {
            throw new Error(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
    'url-tools#encode': async ({ text }) => {
        const t = String(text ?? '');
        return { encoded: encodeURIComponent(t) };
    },
    'url-tools#decode': async ({ encoded }) => {
        const e = String(encoded ?? '').trim();
        if (!e)
            throw new Error('encoded is required');
        try {
            return { text: decodeURIComponent(e) };
        }
        catch {
            throw new Error('Invalid URL-encoded input');
        }
    },
    'url-tools#parse': async ({ url }) => {
        const u = String(url ?? '').trim();
        if (!u)
            throw new Error('url is required');
        try {
            const parsed = new URL(u);
            const params = {};
            parsed.searchParams.forEach((v, k) => { params[k] = v; });
            return {
                protocol: parsed.protocol,
                host: parsed.host,
                hostname: parsed.hostname,
                port: parsed.port || undefined,
                pathname: parsed.pathname,
                search: parsed.search || undefined,
                hash: parsed.hash || undefined,
                searchParams: params,
                origin: parsed.origin,
            };
        }
        catch {
            throw new Error('Invalid URL');
        }
    },
    'data-transform#filterKeys': async ({ data, keys }) => {
        const k = Array.isArray(keys) ? keys : [];
        const filter = (o) => {
            if (Array.isArray(o))
                return o.map(filter);
            if (o && typeof o === 'object' && !Array.isArray(o)) {
                const obj = o;
                if (k.length === 0)
                    return obj;
                const out = {};
                for (const key of k) {
                    if (key in obj)
                        out[key] = filter(obj[key]);
                }
                return out;
            }
            return o;
        };
        return { result: filter(data) };
    },
    // reminder
    'reminder#add': async ({ content, at }) => {
        const c = String(content ?? '').trim();
        if (!c)
            throw new Error('content is required');
        const atStr = String(at ?? '5min').trim().toLowerCase();
        let ts;
        if (/^\d+$/.test(atStr)) {
            ts = Date.now() + Number(atStr) * 60_000;
        }
        else if (atStr.endsWith('min')) {
            ts = Date.now() + parseInt(atStr, 10) * 60_000;
        }
        else if (atStr.endsWith('h')) {
            ts = Date.now() + parseInt(atStr, 10) * 3600_000;
        }
        else if (atStr.endsWith('s')) {
            ts = Date.now() + parseInt(atStr, 10) * 1000;
        }
        else if (atStr.endsWith('d')) {
            ts = Date.now() + parseInt(atStr, 10) * 86400_000;
        }
        else {
            ts = new Date(atStr).getTime();
            if (isNaN(ts))
                throw new Error('Invalid time format, use ISO date or 5min/1h/1d');
        }
        const id = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        reminderStore.set(id, { id, content: c, at: ts, createdAt: Date.now() });
        return { id, content: c, at: new Date(ts).toISOString() };
    },
    'reminder#list': async ({ limit = 10 }) => {
        const now = Date.now();
        const items = Array.from(reminderStore.values())
            .filter((r) => r.at >= now)
            .sort((a, b) => a.at - b.at)
            .slice(0, Math.min(20, Number(limit) || 10))
            .map((r) => ({ id: r.id, content: r.content, at: new Date(r.at).toISOString() }));
        return { reminders: items, count: items.length };
    },
    'reminder#clear': async ({ id }) => {
        if (id) {
            reminderStore.delete(String(id));
            return { cleared: 1 };
        }
        reminderStore.clear();
        return { cleared: 'all' };
    },
    // web-fetch
    'web-fetch#fetchUrl': async ({ url }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            throw new Error('Invalid URL: must start with http:// or https://');
        }
        const res = await fetch(u);
        const html = await res.text();
        const text = stripHtml(html);
        return { content: text, url: u, status: res.status };
    },
    // weather (Open-Meteo, no API key)
    'weather#getCurrent': async ({ city, latitude, longitude }) => {
        let lat;
        let lon;
        let locationName = '';
        if (typeof latitude === 'number' && typeof longitude === 'number') {
            lat = latitude;
            lon = longitude;
        }
        else if (city != null && String(city).trim()) {
            const cityStr = String(city).trim();
            const tryGeocode = async (name) => {
                const q = encodeURIComponent(name);
                const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1`, { signal: AbortSignal.timeout(8000) });
                if (!geoRes.ok)
                    throw new Error(`Geocoding failed: ${geoRes.status}`);
                const geo = await geoRes.json();
                return geo?.results ?? [];
            };
            let results = await tryGeocode(cityStr);
            if (results.length === 0 && CHINESE_CITY_TO_EN[cityStr]) {
                results = await tryGeocode(CHINESE_CITY_TO_EN[cityStr]);
            }
            if (results.length === 0)
                throw new Error(`City not found: ${city}`);
            lat = results[0].latitude;
            lon = results[0].longitude;
            locationName = results[0].name ?? cityStr;
        }
        else {
            throw new Error('Provide city name or latitude+longitude');
        }
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok)
            throw new Error(`Weather API failed: ${res.status}`);
        const data = (await res.json());
        const cur = data?.current;
        if (!cur)
            throw new Error('No weather data');
        const wmoCodes = {
            0: '晴', 1: '大部晴朗', 2: '局部多云', 3: '多云', 45: '雾', 48: '雾凇',
            51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
            80: '阵雨', 81: '阵雨', 82: '强阵雨', 95: '雷暴', 96: '雷暴+冰雹',
        };
        const code = Number(cur.weather_code ?? 0);
        return {
            location: locationName || `${lat},${lon}`,
            temperature: cur.temperature_2m,
            humidity: cur.relative_humidity_2m,
            weatherCode: code,
            weatherDesc: wmoCodes[code] ?? (code <= 3 ? '晴到多云' : '有降水'),
            windSpeed: cur.wind_speed_10m,
            windDirection: cur.wind_direction_10m,
            precipitation: cur.precipitation,
        };
    },
    // shortlink
    'shortlink#create': async ({ url, slug }) => {
        const u = String(url ?? '').trim();
        if (!u)
            throw new Error('url is required');
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            throw new Error('url must start with http:// or https://');
        }
        let code;
        if (slug != null && String(slug).trim()) {
            code = String(slug).trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
            if (!code)
                throw new Error('Invalid slug');
            if (shortlinkStore.has(code))
                throw new Error(`Short code "${code}" already exists`);
        }
        else {
            code = generateShortCode();
        }
        shortlinkStore.set(code, { url: u, createdAt: Date.now() });
        const base = process.env.APEXPANDA_BASE_URL ?? `http://localhost:${process.env.APEXPANDA_PORT ?? 18790}`;
        const shortUrl = `${base.replace(/\/$/, '')}/s/${code}`;
        return { shortCode: code, shortUrl, longUrl: u };
    },
    'shortlink#resolve': async ({ shortCode }) => {
        const c = String(shortCode ?? '').trim();
        if (!c)
            throw new Error('shortCode is required');
        const entry = shortlinkStore.get(c);
        if (!entry)
            return { found: false, longUrl: null };
        return { found: true, longUrl: entry.url };
    },
    'shortlink#list': async ({ limit = 20 }) => {
        const n = Math.min(100, Math.max(1, Number(limit) || 20));
        const items = Array.from(shortlinkStore.entries())
            .slice(-n)
            .map(([code, e]) => ({ shortCode: code, longUrl: e.url }));
        return { items, count: items.length };
    },
    // map-amap（高德地图，需 AMAP_WEB_SERVICE_KEY）
    'map-amap#search': async ({ keywords, city, page = 1 }, ctx) => {
        const key = getSkillEnv(ctx, 'AMAP_WEB_SERVICE_KEY') || getSkillEnv(ctx, 'AMAP_KEY');
        if (!key)
            throw new Error('高德地图需配置 AMAP_WEB_SERVICE_KEY');
        const kw = String(keywords ?? '').trim();
        if (!kw)
            throw new Error('keywords is required');
        const params = new URLSearchParams({
            key,
            keywords: kw,
            offset: '20',
            page: String(Math.max(1, Number(page) || 1)),
        });
        if (city != null && String(city).trim())
            params.set('city', String(city).trim());
        const res = await fetch(`https://restapi.amap.com/v3/place/text?${params}`);
        if (!res.ok)
            throw new Error(`Amap API failed: ${res.status}`);
        const data = (await res.json());
        if (data.status !== '1')
            throw new Error(data.info ?? 'Amap search failed');
        const pois = (data.pois ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            address: p.address,
            location: p.location,
            type: p.type,
            tel: p.tel,
        }));
        return { pois, count: pois.length };
    },
    'map-amap#around': async ({ location, keywords, types, radius = 3000 }, ctx) => {
        const key = getSkillEnv(ctx, 'AMAP_WEB_SERVICE_KEY') || getSkillEnv(ctx, 'AMAP_KEY');
        if (!key)
            throw new Error('高德地图需配置 AMAP_WEB_SERVICE_KEY');
        const loc = String(location ?? '').trim();
        if (!loc)
            throw new Error('location is required (format: "lng,lat")');
        const kw = keywords != null ? String(keywords).trim() : '';
        const ty = types != null ? String(types).trim() : '';
        if (!kw && !ty)
            throw new Error('keywords or types is required');
        const params = new URLSearchParams({
            key,
            location: loc,
            radius: String(Math.min(50000, Math.max(0, Number(radius) || 3000))),
        });
        if (kw)
            params.set('keywords', kw);
        if (ty)
            params.set('types', ty);
        const res = await fetch(`https://restapi.amap.com/v3/place/around?${params}`);
        if (!res.ok)
            throw new Error(`Amap API failed: ${res.status}`);
        const data = (await res.json());
        if (data.status !== '1')
            throw new Error(data.info ?? 'Amap around failed');
        const pois = (data.pois ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            address: p.address,
            location: p.location,
            distance: p.distance,
            type: p.type,
        }));
        return { pois, count: pois.length };
    },
    'map-amap#driving': async ({ origin, destination }, ctx) => {
        const key = getSkillEnv(ctx, 'AMAP_WEB_SERVICE_KEY') || getSkillEnv(ctx, 'AMAP_KEY');
        if (!key)
            throw new Error('高德地图需配置 AMAP_WEB_SERVICE_KEY');
        const o = String(origin ?? '').trim();
        const d = String(destination ?? '').trim();
        if (!o || !d)
            throw new Error('origin and destination are required');
        const params = new URLSearchParams({ key, origin: o, destination: d, extensions: 'all' });
        const res = await fetch(`https://restapi.amap.com/v3/direction/driving?${params}`);
        if (!res.ok)
            throw new Error(`Amap API failed: ${res.status}`);
        const data = (await res.json());
        if (data.status !== '1')
            throw new Error(data.info ?? 'Amap driving failed');
        const path = data.route?.paths?.[0];
        if (!path)
            return { distance: 0, duration: '', steps: [], message: 'No route found' };
        const steps = (path.steps ?? []).map((s) => s.instruction ?? '').filter(Boolean);
        return {
            distance: parseFloat(String(path.distance ?? 0)) || 0,
            duration: path.duration ?? '',
            steps,
        };
    },
    // dingtalk-message（钉钉群机器人推送）
    'dingtalk-message#send': async ({ webhookUrl, content }) => {
        const { getDingTalkWebhookUrl } = await import('../config/loader.js');
        const url = String(webhookUrl ?? getDingTalkWebhookUrl() ?? '').trim();
        if (!url)
            throw new Error('钉钉需配置 webhookUrl 或 DINGTALK_WEBHOOK_URL');
        const text = String(content ?? '').trim();
        if (!text)
            throw new Error('content is required');
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`DingTalk send failed: ${res.status} ${err}`);
        }
        return { sent: true };
    },
    // wecom-message（企业微信应用消息推送）
    'wecom-message#send': async ({ userId, content }) => {
        const { getWeComCorpId, getWeComAgentId, getWeComSecret } = await import('../config/loader.js');
        const corpId = getWeComCorpId();
        const agentId = getWeComAgentId();
        const secret = getWeComSecret();
        if (!corpId || !agentId || !secret) {
            throw new Error('企业微信需配置 corpId、agentId、secret');
        }
        const uid = String(userId ?? '').trim();
        if (!uid)
            throw new Error('userId is required');
        const text = String(content ?? '').trim();
        if (!text)
            throw new Error('content is required');
        const { sendWeComMessage } = await import('../channels/wecom.js');
        await sendWeComMessage(uid, text, { corpId, agentId, secret });
        return { sent: true };
    },
    // speech-to-text（语音识别 ASR）
    'speech-to-text#recognize': async ({ fileKey, messageId, audioUrl, audioBase64, }) => {
        const { recognizeFeishuSpeech } = await import('../channels/feishu-client.js');
        const result = await recognizeFeishuSpeech({
            fileKey: fileKey ? String(fileKey) : undefined,
            messageId: messageId ? String(messageId) : undefined,
            audioUrl: audioUrl ? String(audioUrl) : undefined,
            audioBase64: audioBase64 ? String(audioBase64) : undefined,
        });
        if (result.error)
            return { text: '', error: result.error };
        return { text: result.text };
    },
    // feishu-message（飞书消息推送）
    'feishu-message#send': async ({ receiveId, content, receiveIdType = 'open_id' }) => {
        const { sendFeishuMessage } = await import('../channels/feishu-client.js');
        const id = String(receiveId ?? '').trim();
        if (!id)
            throw new Error('receiveId is required');
        const text = String(content ?? '').trim();
        if (!text)
            throw new Error('content is required');
        const type = String(receiveIdType ?? 'open_id');
        if (!['open_id', 'chat_id', 'user_id'].includes(type)) {
            throw new Error('receiveIdType must be open_id, chat_id, or user_id');
        }
        await sendFeishuMessage({ receiveId: id, receiveIdType: type, content: text });
        return { sent: true };
    },
    // feishu-bitable（飞书多维表）
    'feishu-bitable#listRecords': async ({ appToken, tableId, pageSize = 100, pageToken, }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const app = String(appToken ?? '').trim();
        const table = String(tableId ?? '').trim();
        if (!app || !table)
            throw new Error('appToken and tableId are required');
        const size = Math.min(500, Math.max(1, Number(pageSize) || 100));
        const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${app}/tables/${table}/records`);
        url.searchParams.set('page_size', String(size));
        if (pageToken != null && String(pageToken).trim()) {
            url.searchParams.set('page_token', String(pageToken).trim());
        }
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Bitable list failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const items = data.data?.items ?? [];
        return {
            records: items.map((r) => ({ recordId: r.record_id, fields: r.fields })),
            pageToken: data.data?.page_token,
            hasMore: data.data?.has_more ?? false,
            count: items.length,
        };
    },
    'feishu-bitable#createRecord': async ({ appToken, tableId, fields, }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const app = String(appToken ?? '').trim();
        const table = String(tableId ?? '').trim();
        if (!app || !table)
            throw new Error('appToken and tableId are required');
        const f = fields && typeof fields === 'object' ? fields : {};
        const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${app}/tables/${table}/records`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ fields: f }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Bitable create failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const recordId = data.data?.record?.record_id;
        return { recordId, created: true };
    },
    'feishu-bitable#searchRecords': async ({ appToken, tableId, filter, pageSize = 100, pageToken, }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const app = String(appToken ?? '').trim();
        const table = String(tableId ?? '').trim();
        if (!app || !table)
            throw new Error('appToken and tableId are required');
        const size = Math.min(500, Math.max(1, Number(pageSize) || 100));
        const body = { page_size: size };
        if (filter != null && (typeof filter === 'object' || typeof filter === 'string')) {
            body.filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
        }
        if (pageToken != null && String(pageToken).trim()) {
            body.page_token = String(pageToken).trim();
        }
        const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${app}/tables/${table}/records/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Bitable search failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const items = data.data?.items ?? [];
        return {
            records: items.map((r) => ({ recordId: r.record_id, fields: r.fields })),
            pageToken: data.data?.page_token,
            hasMore: data.data?.has_more ?? false,
            count: items.length,
        };
    },
    // feishu-doc（飞书文档读取）
    'feishu-doc#read': async ({ documentId }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const docId = String(documentId ?? '').trim();
        if (!docId)
            throw new Error('documentId is required（从文档 URL 或 document_id 获取）');
        const res = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/raw_content`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Doc read failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const content = data.data?.content ?? '';
        return { content, documentId: docId };
    },
    // feishu-calendar（飞书日历）
    'feishu-calendar#getPrimary': async () => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const res = await fetch('https://open.feishu.cn/open-apis/calendar/v4/calendars/primary', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Calendar getPrimary failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const cal = data.data?.calendars?.[0];
        if (!cal?.calendar_id)
            throw new Error('未获取到主日历');
        return { calendarId: cal.calendar_id };
    },
    'feishu-calendar#listEvents': async ({ calendarId, startTime, endTime, pageToken, }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const calId = String(calendarId ?? '').trim();
        if (!calId)
            throw new Error('calendarId is required');
        const start = String(startTime ?? '').trim();
        const end = String(endTime ?? '').trim();
        if (!start || !end)
            throw new Error('startTime and endTime are required (ISO 8601)');
        const url = new URL(`https://open.feishu.cn/open-apis/calendar/v4/calendars/${calId}/events`);
        url.searchParams.set('start_time', start);
        url.searchParams.set('end_time', end);
        if (pageToken != null && String(pageToken).trim()) {
            url.searchParams.set('page_token', String(pageToken).trim());
        }
        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Calendar listEvents failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const items = data.data?.items ?? [];
        return {
            events: items.map((e) => ({
                eventId: e.event_id,
                summary: e.summary,
                startTime: e.start_time,
                endTime: e.end_time,
            })),
            pageToken: data.data?.page_token,
            hasMore: data.data?.has_more ?? false,
            count: items.length,
        };
    },
    'feishu-calendar#createEvent': async ({ calendarId, summary, description, startTime, endTime, }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const calId = String(calendarId ?? '').trim();
        const sum = String(summary ?? '').trim();
        const start = String(startTime ?? '').trim();
        const end = String(endTime ?? '').trim();
        if (!calId || !sum || !start || !end) {
            throw new Error('calendarId, summary, startTime, endTime are required');
        }
        const res = await fetch(`https://open.feishu.cn/open-apis/calendar/v4/calendars/${calId}/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                summary: sum,
                description: description != null ? String(description) : undefined,
                start_time: { date_time: start, timezone: 'Asia/Shanghai' },
                end_time: { date_time: end, timezone: 'Asia/Shanghai' },
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Calendar createEvent failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const eventId = data.data?.event?.event_id;
        return { eventId, created: true };
    },
    // yuque-doc（语雀文档）
    'yuque-doc#read': async ({ namespace, slug, raw = true, }, ctx) => {
        const tok = getSkillEnv(ctx, 'YUQUE_TOKEN');
        if (!tok)
            throw new Error('yuque-doc 需配置 YUQUE_TOKEN');
        const ns = String(namespace ?? '').trim();
        const sl = String(slug ?? '').trim();
        if (!ns || !sl)
            throw new Error('namespace and slug are required');
        const url = `https://www.yuque.com/api/v2/repos/${encodeURIComponent(ns)}/docs/${encodeURIComponent(sl)}${raw ? '?raw=1' : ''}`;
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': tok,
                'User-Agent': 'ApexPanda/1.0',
            },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`语雀 API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        return {
            content: data.data?.body ?? '',
            title: data.data?.title,
            bodyHtml: raw ? undefined : data.data?.body_html,
        };
    },
    'yuque-doc#listRepos': async (_params, ctx) => {
        const tok = getSkillEnv(ctx, 'YUQUE_TOKEN');
        if (!tok)
            throw new Error('yuque-doc 需配置 YUQUE_TOKEN');
        const res = await fetch('https://www.yuque.com/api/v2/user/repos', {
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': tok,
                'User-Agent': 'ApexPanda/1.0',
            },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`语雀 API failed: ${res.status} ${err}`);
        }
        const arr = (await res.json());
        return {
            repos: arr.map((r) => ({ id: r.id, name: r.name, namespace: r.namespace, description: r.description })),
            count: arr.length,
        };
    },
    'yuque-doc#getToc': async ({ namespace }, ctx) => {
        const tok = getSkillEnv(ctx, 'YUQUE_TOKEN');
        if (!tok)
            throw new Error('yuque-doc 需配置 YUQUE_TOKEN');
        const ns = String(namespace ?? '').trim();
        if (!ns)
            throw new Error('namespace is required');
        const res = await fetch(`https://www.yuque.com/api/v2/repos/${encodeURIComponent(ns)}/toc`, {
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': tok,
                'User-Agent': 'ApexPanda/1.0',
            },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`语雀 API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        return { toc: data.data ?? [] };
    },
    // jira（Jira 任务）
    'jira#search': async ({ jql, maxResults = 50 }, ctx) => {
        const base = getSkillEnv(ctx, 'JIRA_BASE_URL').replace(/\/$/, '');
        const email = getSkillEnv(ctx, 'JIRA_EMAIL');
        const token = getSkillEnv(ctx, 'JIRA_API_TOKEN');
        if (!base || !email || !token)
            throw new Error('jira 需配置 JIRA_BASE_URL、JIRA_EMAIL、JIRA_API_TOKEN');
        const q = String(jql ?? '').trim();
        if (!q)
            throw new Error('jql is required');
        const m = Math.min(100, Math.max(1, Number(maxResults) || 50));
        const url = `${base}/rest/api/2/search?jql=${encodeURIComponent(q)}&maxResults=${m}`;
        const auth = Buffer.from(`${email}:${token}`).toString('base64');
        const res = await fetch(url, {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Jira API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const issues = (data.issues ?? []).map((i) => ({
            key: i.key,
            summary: i.fields?.summary,
            status: i.fields?.status?.name,
            type: i.fields?.issuetype?.name,
        }));
        return { issues, count: issues.length };
    },
    'jira#create': async ({ projectKey, summary, description, issueType = 'Task', }, ctx) => {
        const base = getSkillEnv(ctx, 'JIRA_BASE_URL').replace(/\/$/, '');
        const email = getSkillEnv(ctx, 'JIRA_EMAIL');
        const token = getSkillEnv(ctx, 'JIRA_API_TOKEN');
        if (!base || !email || !token)
            throw new Error('jira 需配置 JIRA_BASE_URL、JIRA_EMAIL、JIRA_API_TOKEN');
        const proj = String(projectKey ?? '').trim();
        const sum = String(summary ?? '').trim();
        if (!proj || !sum)
            throw new Error('projectKey and summary are required');
        const auth = Buffer.from(`${email}:${token}`).toString('base64');
        const res = await fetch(`${base}/rest/api/2/issue`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fields: {
                    project: { key: proj },
                    summary: sum,
                    issuetype: { name: String(issueType ?? 'Task') },
                    description: description != null ? String(description) : undefined,
                },
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Jira API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        return { key: data.key, created: true };
    },
    'jira#get': async ({ issueKey }, ctx) => {
        const base = getSkillEnv(ctx, 'JIRA_BASE_URL').replace(/\/$/, '');
        const email = getSkillEnv(ctx, 'JIRA_EMAIL');
        const token = getSkillEnv(ctx, 'JIRA_API_TOKEN');
        if (!base || !email || !token)
            throw new Error('jira 需配置 JIRA_BASE_URL、JIRA_EMAIL、JIRA_API_TOKEN');
        const key = String(issueKey ?? '').trim();
        if (!key)
            throw new Error('issueKey is required');
        const auth = Buffer.from(`${email}:${token}`).toString('base64');
        const res = await fetch(`${base}/rest/api/2/issue/${encodeURIComponent(key)}`, {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Jira API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        return {
            key: data.key,
            summary: data.fields?.summary,
            description: data.fields?.description,
            status: data.fields?.status?.name,
            type: data.fields?.issuetype?.name,
            assignee: data.fields?.assignee?.displayName,
        };
    },
    // feishu-approval（飞书审批）
    'feishu-approval#create': async ({ approvalCode, form, userId, }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const code = String(approvalCode ?? '').trim();
        const uid = String(userId ?? '').trim();
        if (!code || !uid)
            throw new Error('approvalCode and userId (open_id) are required');
        const formData = form && typeof form === 'object' ? form : {};
        const res = await fetch('https://open.feishu.cn/open-apis/approval/v4/instances', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                approval_code: code,
                open_id: uid,
                form: JSON.stringify(formData),
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Approval create failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        return { instanceCode: data.data?.instance_code, created: true };
    },
    'feishu-approval#query': async ({ approvalCode, startTime, endTime, }) => {
        const { getFeishuTenantAccessToken } = await import('../channels/feishu-client.js');
        const token = await getFeishuTenantAccessToken();
        const start = startTime != null ? Number(startTime) : Date.now() - 7 * 24 * 3600 * 1000;
        const end = endTime != null ? Number(endTime) : Date.now();
        const url = new URL('https://open.feishu.cn/open-apis/approval/v4/instances/query');
        const body = {
            start_time: String(start),
            end_time: String(end),
        };
        if (approvalCode != null && String(approvalCode).trim()) {
            body.approval_codes = [String(approvalCode).trim()];
        }
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Feishu Approval query failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        return { instanceCodes: data.data?.instance_code_list ?? [], count: (data.data?.instance_code_list ?? []).length };
    },
    // dingtalk-todo（钉钉待办）
    'dingtalk-todo#create': async ({ userId, subject, dueTime, }, ctx) => {
        const appKey = getSkillEnv(ctx, 'DINGTALK_APP_KEY');
        const appSecret = getSkillEnv(ctx, 'DINGTALK_APP_SECRET');
        if (!appKey || !appSecret)
            throw new Error('dingtalk-todo 需配置 DINGTALK_APP_KEY、DINGTALK_APP_SECRET');
        const uid = String(userId ?? '').trim();
        const subj = String(subject ?? '').trim();
        if (!uid || !subj)
            throw new Error('userId and subject are required');
        let accessToken;
        const tokenRes = await fetch(`https://api.dingtalk.com/v1.0/oauth2/accessToken`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appKey,
                appSecret,
                grantType: 'client_credentials',
            }),
        });
        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            throw new Error(`钉钉获取token失败: ${tokenRes.status} ${err}`);
        }
        const tokenData = (await tokenRes.json());
        accessToken = tokenData.accessToken ?? '';
        if (!accessToken)
            throw new Error('钉钉未返回 accessToken');
        const todoRes = await fetch(`https://api.dingtalk.com/v1.0/todo/users/${encodeURIComponent(uid)}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-acs-dingtalk-access-token': accessToken,
            },
            body: JSON.stringify({
                subject: subj,
                dueDate: dueTime != null ? Number(dueTime) : undefined,
            }),
        });
        if (!todoRes.ok) {
            const err = await todoRes.text();
            throw new Error(`钉钉创建待办失败: ${todoRes.status} ${err}`);
        }
        const todoData = (await todoRes.json());
        return { taskId: todoData.id, created: true };
    },
    // dingtalk-attendance（钉钉考勤打卡记录，使用 oapi 旧版网关）
    'dingtalk-attendance#list': async ({ workDateFrom, workDateTo, userIdList, offset = 0, limit = 50, }, ctx) => {
        const appKey = getSkillEnv(ctx, 'DINGTALK_APP_KEY');
        const appSecret = getSkillEnv(ctx, 'DINGTALK_APP_SECRET');
        if (!appKey || !appSecret)
            throw new Error('dingtalk-attendance 需配置 DINGTALK_APP_KEY、DINGTALK_APP_SECRET');
        const fromStr = String(workDateFrom ?? '').trim();
        const toStr = String(workDateTo ?? '').trim();
        if (!fromStr || !toStr)
            throw new Error('workDateFrom 和 workDateTo 必填（格式 YYYY-MM-DD）');
        let users;
        if (Array.isArray(userIdList)) {
            users = userIdList.map(String).filter(Boolean);
        }
        else if (userIdList != null) {
            users = String(userIdList)
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
        }
        else {
            throw new Error('userIdList 必填（员工 ID 列表，逗号分隔或数组）');
        }
        if (users.length === 0)
            throw new Error('userIdList 不能为空');
        const off = Math.max(0, Number(offset) || 0);
        const lim = Math.min(50, Math.max(1, Number(limit) || 50));
        const tokenRes = await fetch(`https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(appKey)}&appsecret=${encodeURIComponent(appSecret)}`);
        if (!tokenRes.ok)
            throw new Error(`钉钉 gettoken 失败: ${tokenRes.status}`);
        const tokenData = (await tokenRes.json());
        if (tokenData.errcode !== 0 || !tokenData.access_token) {
            throw new Error(tokenData.errmsg ?? `钉钉 gettoken 失败: errcode=${tokenData.errcode}`);
        }
        const accessToken = tokenData.access_token;
        const listRes = await fetch(`https://oapi.dingtalk.com/topapi/attendance/list?access_token=${encodeURIComponent(accessToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workDateFrom: fromStr,
                workDateTo: toStr,
                userIdList: users,
                offset: off,
                limit: lim,
            }),
        });
        if (!listRes.ok)
            throw new Error(`钉钉考勤 list 失败: ${listRes.status}`);
        const listData = (await listRes.json());
        if (listData.errcode !== 0)
            throw new Error(listData.errmsg ?? `钉钉考勤错误: errcode=${listData.errcode}`);
        const records = listData.result?.recordResult ?? [];
        return {
            records: records.map((r) => ({
                userId: r.userId,
                checkType: r.checkType,
                locationResult: r.locationResult,
                baseCheckTime: r.baseCheckTime,
                userCheckTime: r.userCheckTime,
                timeResult: r.timeResult,
                workDate: r.workDate,
            })),
            count: records.length,
        };
    },
    // ocr-tencent（腾讯云 OCR）
    'ocr-tencent#recognize': async (params, ctx) => {
        const imageData = await resolveImageInput(params);
        const secretId = getSkillEnv(ctx, 'TENCENT_SECRET_ID');
        const secretKey = getSkillEnv(ctx, 'TENCENT_SECRET_KEY');
        if (!secretId || !secretKey)
            throw new Error('ocr-tencent 需配置 TENCENT_SECRET_ID、TENCENT_SECRET_KEY');
        const { Client } = await import('tencentcloud-sdk-nodejs/tencentcloud/services/ocr/v20181119/ocr_client.js');
        const { BasicCredential } = await import('tencentcloud-sdk-nodejs/tencentcloud/common/credential.js');
        const cred = new BasicCredential(secretId, secretKey);
        const client = new Client({ credential: cred, region: 'ap-guangzhou' });
        const res = await client.GeneralBasicOCR({ ImageBase64: imageData });
        const items = res.TextDetections ?? [];
        const words = items.map((i) => i.DetectedText ?? '').filter(Boolean);
        return { text: words.join('\n'), lines: words, count: words.length };
    },
    'ocr-tencent#recognizeAccurate': async (params, ctx) => {
        const imageData = await resolveImageInput(params);
        const secretId = getSkillEnv(ctx, 'TENCENT_SECRET_ID');
        const secretKey = getSkillEnv(ctx, 'TENCENT_SECRET_KEY');
        if (!secretId || !secretKey)
            throw new Error('ocr-tencent 需配置 TENCENT_SECRET_ID、TENCENT_SECRET_KEY');
        const { Client } = await import('tencentcloud-sdk-nodejs/tencentcloud/services/ocr/v20181119/ocr_client.js');
        const { BasicCredential } = await import('tencentcloud-sdk-nodejs/tencentcloud/common/credential.js');
        const cred = new BasicCredential(secretId, secretKey);
        const client = new Client({ credential: cred, region: 'ap-guangzhou' });
        const res = await client.GeneralAccurateOCR({ ImageBase64: imageData });
        const items = res.TextDetections ?? [];
        const words = items.map((i) => i.DetectedText ?? '').filter(Boolean);
        return { text: words.join('\n'), lines: words, count: words.length };
    },
    // email-smtp（通用邮件发送）
    'email-smtp#send': async ({ to, subject, text, html, from, host, port, secure, user, pass, }, ctx) => {
        const toAddr = to != null ? (Array.isArray(to) ? to : [to]).map(String) : [];
        if (toAddr.length === 0)
            throw new Error('to is required');
        const subj = String(subject ?? '').trim();
        const bodyText = text != null ? String(text) : '';
        const bodyHtml = html != null ? String(html) : '';
        if (!bodyText && !bodyHtml)
            throw new Error('text or html is required');
        const smtpHost = getSkillEnv(ctx, 'SMTP_HOST') || String(host ?? '').trim();
        const smtpPort = Number(port ?? (getSkillEnv(ctx, 'SMTP_PORT') || 587));
        const smtpSecure = secure ?? (getSkillEnv(ctx, 'SMTP_SECURE') === 'true');
        const smtpUser = getSkillEnv(ctx, 'SMTP_USER') || String(user ?? '').trim();
        const smtpPass = getSkillEnv(ctx, 'SMTP_PASS') || String(pass ?? '').trim();
        const fromVal = from != null ? from : getSkillEnv(ctx, 'SMTP_FROM');
        const fromAddr = String(fromVal || smtpUser || 'noreply@localhost').trim();
        if (!smtpHost)
            throw new Error('SMTP 需配置 host 或 SMTP_HOST');
        const nodemailer = await import('nodemailer');
        const opts = {
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
        };
        if (smtpUser)
            opts.auth = { user: smtpUser, pass: smtpPass };
        const transporter = nodemailer.default.createTransport(opts);
        const result = await transporter.sendMail({
            from: fromAddr,
            to: toAddr,
            subject: subj || '(无主题)',
            text: bodyText || undefined,
            html: bodyHtml || undefined,
        });
        return { sent: true, messageId: result.messageId };
    },
    // cron-scheduler（定时任务管理）
    'cron-scheduler#schedule': async ({ id, cron, command, description, }, ctx) => {
        const taskId = String(id ?? '').trim() || randomUUID().slice(0, 8);
        const expr = String(cron ?? '').trim();
        const cmd = String(command ?? '').trim();
        if (!expr)
            throw new Error('cron expression is required');
        if (!cmd)
            throw new Error('command is required');
        const { getCronSchedulerStore, addScheduledTask } = await import('../cron-scheduler/store.js');
        const store = getCronSchedulerStore();
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        await addScheduledTask(store, {
            id: taskId,
            cron: expr,
            command: cmd,
            description: description != null ? String(description) : undefined,
            workspaceDir: ws,
            createdAt: Date.now(),
        });
        return { id: taskId, cron: expr, scheduled: true };
    },
    'cron-scheduler#list': async () => {
        const { getCronSchedulerStore, listScheduledTasks } = await import('../cron-scheduler/store.js');
        const store = getCronSchedulerStore();
        const tasks = await listScheduledTasks(store);
        return { tasks, count: tasks.length };
    },
    'cron-scheduler#cancel': async ({ id }) => {
        const taskId = String(id ?? '').trim();
        if (!taskId)
            throw new Error('id is required');
        const { getCronSchedulerStore, removeScheduledTask } = await import('../cron-scheduler/store.js');
        const store = getCronSchedulerStore();
        await removeScheduledTask(store, taskId);
        return { id: taskId, cancelled: true };
    },
    // image-gen-dalle（DALL-E 图片生成）
    'image-gen-dalle#generate': async ({ prompt, size = '1024x1024', model = 'dall-e-2', n = 1, }) => {
        const { getLLMBaseUrl, getLLMApiKey } = await import('../config/loader.js');
        const baseUrl = getLLMBaseUrl().replace(/\/$/, '');
        const apiKey = getLLMApiKey();
        if (!apiKey)
            throw new Error('image-gen-dalle 需配置 LLM API Key（OpenAI 或兼容 Images API）');
        const p = String(prompt ?? '').trim();
        if (!p)
            throw new Error('prompt is required');
        const s = String(size ?? '1024x1024');
        const validSizes = ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'];
        const sizeVal = validSizes.includes(s) ? s : '1024x1024';
        const res = await fetch(`${baseUrl}/images/generations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: String(model ?? 'dall-e-2'),
                prompt: p,
                n: Math.min(10, Math.max(1, Number(n) || 1)),
                size: sizeVal,
                response_format: 'url',
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`DALL-E API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const urls = (data.data ?? []).map((d) => d.url).filter(Boolean);
        if (urls.length === 0)
            return { urls, count: 0 };
        const dalleDir = join(getWorkspaceDir(), 'generated-images');
        await mkdir(dalleDir, { recursive: true });
        const dalleImgRes = await fetch(urls[0]);
        if (!dalleImgRes.ok)
            return { urls, count: urls.length };
        const dalleImgBuf = await dalleImgRes.arrayBuffer();
        const dallePath = join(dalleDir, `dalle-${Date.now()}.png`);
        await writeFile(dallePath, Buffer.from(dalleImgBuf));
        const pathRel = pathRelative(getWorkspaceDir(), dallePath).replace(/\\/g, '/');
        return { _fileReply: true, fileType: 'image', filePath: dallePath, path: pathRel, urls, mimeType: 'image/png', caption: `AI 生成图片完成（共 ${urls.length} 张）。path 供 uploadThumb/uploadImage 使用` };
    },
    // image-gen-wanx（通义万相）
    'image-gen-wanx#generate': async ({ prompt, size = '1280*1280', n = 1, negativePrompt, promptExtend = true, watermark = false, }, ctx) => {
        const apiKey = getSkillEnv(ctx, 'DASHSCOPE_API_KEY');
        if (!apiKey)
            throw new Error('image-gen-wanx 需配置 DASHSCOPE_API_KEY（阿里云百炼）');
        const p = String(prompt ?? '').trim();
        if (!p)
            throw new Error('prompt is required');
        const base = (getSkillEnv(ctx, 'DASHSCOPE_BASE_URL') || 'https://dashscope.aliyuncs.com').replace(/\/$/, '');
        const num = Math.min(4, Math.max(1, Number(n) || 1));
        const res = await fetch(`${base}/api/v1/services/aigc/multimodal-generation/generation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'wan2.6-t2i',
                input: {
                    messages: [{ role: 'user', content: [{ text: p }] }],
                },
                parameters: {
                    size: String(size ?? '1280*1280'),
                    n: num,
                    prompt_extend: !!promptExtend,
                    watermark: !!watermark,
                    negative_prompt: negativePrompt != null ? String(negativePrompt) : '',
                },
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`通义万相 API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        if (data.code)
            throw new Error(data.message ?? `通义万相错误: ${data.code}`);
        const contents = data.output?.choices?.[0]?.message?.content ?? [];
        const urls = contents.map((c) => c.image).filter(Boolean);
        if (urls.length === 0)
            return { urls, count: 0 };
        const wanxDir = join(getWorkspaceDir(), 'generated-images');
        await mkdir(wanxDir, { recursive: true });
        const wanxImgRes = await fetch(urls[0]);
        if (!wanxImgRes.ok)
            return { urls, count: urls.length };
        const wanxImgBuf = await wanxImgRes.arrayBuffer();
        const wanxPath = join(wanxDir, `wanx-${Date.now()}.png`);
        await writeFile(wanxPath, Buffer.from(wanxImgBuf));
        const pathRel = pathRelative(getWorkspaceDir(), wanxPath).replace(/\\/g, '/');
        return { _fileReply: true, fileType: 'image', filePath: wanxPath, path: pathRel, urls, mimeType: 'image/png', caption: `AI 生成图片完成（共 ${urls.length} 张）。path 供 uploadThumb/uploadImage 使用` };
    },
    // tts-azure（Azure 语音合成）
    'tts-azure#synthesize': async ({ text, voice = 'zh-CN-XiaoxiaoNeural', outputFormat = 'audio-24khz-48kbitrate-mono-mp3', }, ctx) => {
        const key = getSkillEnv(ctx, 'AZURE_SPEECH_KEY');
        const region = getSkillEnv(ctx, 'AZURE_SPEECH_REGION');
        if (!key || !region)
            throw new Error('tts-azure 需配置 AZURE_SPEECH_KEY、AZURE_SPEECH_REGION');
        const t = String(text ?? '').trim();
        if (!t)
            throw new Error('text is required');
        const v = String(voice ?? 'zh-CN-XiaoxiaoNeural').trim();
        const fmt = String(outputFormat ?? 'audio-24khz-48kbitrate-mono-mp3').trim();
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${esc(v)}">${esc(t)}</voice></speak>`;
        const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': key,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': fmt,
            },
            body: ssml,
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Azure TTS failed: ${res.status} ${err}`);
        }
        const audioBuf = await res.arrayBuffer();
        const ttsAzureDir = join(getWorkspaceDir(), 'tts');
        await mkdir(ttsAzureDir, { recursive: true });
        const ttsAzurePath = join(ttsAzureDir, `tts-azure-${Date.now()}.mp3`);
        await writeFile(ttsAzurePath, Buffer.from(audioBuf));
        return { _fileReply: true, fileType: 'audio', filePath: ttsAzurePath, mimeType: 'audio/mpeg', caption: `语音合成完成（${v}）` };
    },
    'tts-aliyun#synthesize': async ({ text, voice = 'xiaoyun', format = 'mp3', sampleRate = 16000, volume = 50, speechRate = 0, }, ctx) => {
        const keyId = getSkillEnv(ctx, 'ALIYUN_ACCESS_KEY_ID');
        const keySecret = getSkillEnv(ctx, 'ALIYUN_ACCESS_KEY_SECRET');
        const appkey = getSkillEnv(ctx, 'ALIYUN_NLS_APPKEY');
        const regionId = getSkillEnv(ctx, 'ALIYUN_NLS_REGION') || 'cn-shanghai';
        if (!keyId || !keySecret || !appkey)
            throw new Error('tts-aliyun 需配置 ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET、ALIYUN_NLS_APPKEY');
        const t = String(text ?? '').trim().slice(0, 300);
        if (!t)
            throw new Error('text is required');
        const token = await getAliyunNlsToken(keyId, keySecret, regionId);
        const gatewayHost = `nls-gateway.${regionId}.aliyuncs.com`;
        const params = new URLSearchParams({
            appkey,
            text: t,
            token,
            format: String(format ?? 'mp3'),
            sample_rate: String(Number(sampleRate) || 16000),
            voice: String(voice ?? 'xiaoyun'),
            volume: String(Math.max(0, Math.min(100, Number(volume) ?? 50))),
        });
        if (speechRate && Number(speechRate) !== 0)
            params.set('speech_rate', String(speechRate));
        const res = await fetch(`https://${gatewayHost}/stream/v1/tts?${params}`);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`阿里云 TTS 失败: ${res.status} ${err}`);
        }
        const audioBuf = await res.arrayBuffer();
        const ttsAliyunDir = join(getWorkspaceDir(), 'tts');
        await mkdir(ttsAliyunDir, { recursive: true });
        const ttsExt = format === 'wav' ? 'wav' : 'mp3';
        const ttsAliyunPath = join(ttsAliyunDir, `tts-aliyun-${Date.now()}.${ttsExt}`);
        await writeFile(ttsAliyunPath, Buffer.from(audioBuf));
        return { _fileReply: true, fileType: 'audio', filePath: ttsAliyunPath, mimeType: format === 'wav' ? 'audio/wav' : 'audio/mpeg', caption: `语音合成完成（${String(voice)}）` };
    },
    'asr-aliyun#recognize': async (params, ctx) => {
        const keyId = getSkillEnv(ctx, 'ALIYUN_ACCESS_KEY_ID');
        const keySecret = getSkillEnv(ctx, 'ALIYUN_ACCESS_KEY_SECRET');
        const appkey = getSkillEnv(ctx, 'ALIYUN_NLS_APPKEY');
        const regionId = getSkillEnv(ctx, 'ALIYUN_NLS_REGION') || 'cn-shanghai';
        if (!keyId || !keySecret || !appkey)
            throw new Error('asr-aliyun 需配置 ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET、ALIYUN_NLS_APPKEY');
        const { buffer, audioAddress } = await resolveAudioInput(params);
        const token = await getAliyunNlsToken(keyId, keySecret, regionId);
        const gatewayHost = `nls-gateway.${regionId}.aliyuncs.com`;
        const searchParams = new URLSearchParams({
            appkey,
            format: String(params.format ?? 'wav'),
            sample_rate: String(Number(params.sampleRate) || 16000),
            enable_punctuation_prediction: (params.enablePunctuation !== false).toString(),
            enable_inverse_text_normalization: (params.enableInverseText === true).toString(),
        });
        if (audioAddress)
            searchParams.set('audio_address', audioAddress);
        const url = `https://${gatewayHost}/stream/v1/asr?${searchParams}`;
        const init = {
            method: 'POST',
            headers: {
                'X-NLS-Token': token,
                'Content-Type': 'application/octet-stream',
            },
        };
        if (buffer.length > 0)
            init.body = new Uint8Array(buffer);
        const res = await fetch(url, init);
        const text = await res.text();
        if (!res.ok)
            throw new Error(`阿里云 ASR 失败: ${res.status} ${text}`);
        let data;
        try {
            data = JSON.parse(text || '{}');
        }
        catch {
            throw new Error(`阿里云 ASR 响应无效: ${text.slice(0, 200)}`);
        }
        if (data.status !== 20000000) {
            throw new Error(data.message ?? `阿里云 ASR 错误: status=${data.status}`);
        }
        return {
            text: data.result ?? '',
            taskId: data.task_id,
        };
    },
    'asr-xunfei#recognize': async (params, ctx) => {
        const appId = getSkillEnv(ctx, 'XFYUN_APP_ID');
        const apiKey = getSkillEnv(ctx, 'XFYUN_API_KEY');
        const apiSecret = getSkillEnv(ctx, 'XFYUN_API_SECRET');
        if (!appId || !apiKey || !apiSecret)
            throw new Error('asr-xunfei 需配置 XFYUN_APP_ID、XFYUN_API_KEY、XFYUN_API_SECRET');
        const { buffer } = await resolveAudioInput(params);
        if (buffer.length === 0)
            throw new Error('请提供 audioUrl、dataUrl 或 base64');
        const format = String(params.format ?? 'pcm');
        const sampleRate = Number(params.sampleRate) || 16000;
        const engineType = sampleRate === 8000 ? 'sms8k' : 'sms16k';
        const host = 'iat-api.xfyun.cn';
        const date = new Date().toUTCString();
        const requestLine = 'GET /v2/iat HTTP/1.1';
        const signOrig = `host: ${host}\ndate: ${date}\n${requestLine}`;
        const signB64 = createHmac('sha256', apiSecret).update(signOrig).digest('base64');
        const authOrig = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signB64}"`;
        const authB64 = Buffer.from(authOrig, 'utf-8').toString('base64');
        const wsUrl = `wss://${host}/v2/iat?authorization=${encodeURIComponent(authB64)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;
        const results = [];
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            ws.on('open', () => {
                const formatStr = format === 'mp3' ? 'audio/L16;rate=16000' : `audio/L16;rate=${sampleRate}`;
                const encoding = format === 'mp3' ? 'lame' : 'raw';
                const chunkSize = 1280;
                let offset = 0;
                const sendNext = () => {
                    const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
                    const isFirst = offset === 0;
                    const isLast = offset + chunk.length >= buffer.length;
                    const status = isFirst ? 0 : isLast ? 2 : 1;
                    offset += chunk.length;
                    const frame = JSON.stringify({
                        common: { app_id: appId },
                        business: { aue: encoding, rate: String(sampleRate), language: 'zh_cn', domain: 'iat', engine_type: engineType },
                        data: { status, format: formatStr, encoding, data: chunk.toString('base64') },
                    });
                    ws.send(frame);
                    if (status !== 2 && offset < buffer.length)
                        setImmediate(sendNext);
                };
                sendNext();
            });
            ws.on('message', (data) => {
                const str = typeof data === 'string' ? data : data.toString('utf-8');
                try {
                    const obj = JSON.parse(str);
                    let text = obj.data?.result;
                    if (!text && obj.data?.cn) {
                        const cn = obj.data.cn;
                        const stList = cn.st ?? [];
                        text = stList
                            .map((st) => (st.rt?.ws ?? []).map((w) => w.cw?.[0]?.w ?? '').join(''))
                            .join('');
                    }
                    if (text)
                        results.push(text);
                    if (obj.data?.status === 2) {
                        ws.close();
                        resolve();
                    }
                }
                catch {
                    /* ignore */
                }
            });
            ws.on('error', reject);
            ws.on('close', () => resolve());
            setTimeout(() => {
                if (ws.readyState !== ws.CLOSED) {
                    ws.close();
                    resolve();
                }
            }, 30000);
        });
        return { text: results.join(''), parts: results };
    },
    'tts-azure#listVoices': async (_params, ctx) => {
        const key = getSkillEnv(ctx, 'AZURE_SPEECH_KEY');
        const region = getSkillEnv(ctx, 'AZURE_SPEECH_REGION');
        if (!key || !region)
            throw new Error('tts-azure 需配置 AZURE_SPEECH_KEY、AZURE_SPEECH_REGION');
        const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
            headers: { 'Ocp-Apim-Subscription-Key': key },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Azure TTS listVoices failed: ${res.status} ${err}`);
        }
        const arr = (await res.json());
        const voices = arr.map((v) => ({
            name: v.Name,
            shortName: v.ShortName,
            displayName: v.DisplayName,
            localName: v.LocalName,
            gender: v.Gender,
            locale: v.Locale,
        }));
        return { voices, count: voices.length };
    },
    // web-search-brave（Brave 搜索）
    'web-search-brave#search': async ({ query, count = 5 }, ctx) => {
        const key = getSkillEnv(ctx, 'BRAVE_API_KEY');
        if (!key)
            throw new Error('web-search-brave 需配置 BRAVE_API_KEY');
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const c = Math.min(20, Math.max(1, Number(count) || 5));
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${c}`;
        const res = await fetch(url, {
            headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Brave Search API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const results = (data.web?.results ?? []).map((r) => ({
            title: r.title ?? '',
            url: r.url ?? '',
            description: r.description ?? '',
        }));
        return { results, count: results.length };
    },
    // github（GitHub API）
    'github#listRepos': async ({ limit = 20 }, ctx) => {
        const token = getSkillEnv(ctx, 'GITHUB_TOKEN');
        if (!token)
            throw new Error('github 需配置 GITHUB_TOKEN');
        const l = Math.min(100, Math.max(1, Number(limit) || 20));
        const res = await fetch(`https://api.github.com/user/repos?per_page=${l}&sort=updated`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
        });
        if (!res.ok)
            throw new Error(`GitHub API failed: ${res.status} ${await res.text()}`);
        const arr = (await res.json());
        return {
            repos: arr.map((r) => ({
                name: r.name,
                fullName: r.full_name,
                url: r.html_url,
                description: r.description ?? '',
            })),
            count: arr.length,
        };
    },
    'github#getFile': async ({ owner, repo, path: filePath }, ctx) => {
        const token = getSkillEnv(ctx, 'GITHUB_TOKEN');
        if (!token)
            throw new Error('github 需配置 GITHUB_TOKEN');
        const o = String(owner ?? '').trim();
        const r = String(repo ?? '').trim();
        const p = String(filePath ?? '').trim();
        if (!o || !r || !p)
            throw new Error('owner, repo, path are required');
        const url = `https://api.github.com/repos/${o}/${r}/contents/${encodeURIComponent(p)}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3.raw' },
        });
        if (!res.ok)
            throw new Error(`GitHub API failed: ${res.status} ${await res.text()}`);
        const text = await res.text();
        return { content: text, path: p };
    },
    'github#createIssue': async ({ owner, repo, title, body }, ctx) => {
        const token = getSkillEnv(ctx, 'GITHUB_TOKEN');
        if (!token)
            throw new Error('github 需配置 GITHUB_TOKEN');
        const o = String(owner ?? '').trim();
        const r = String(repo ?? '').trim();
        const t = String(title ?? '').trim();
        if (!o || !r || !t)
            throw new Error('owner, repo, title are required');
        const res = await fetch(`https://api.github.com/repos/${o}/${r}/issues`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: t, body: String(body ?? '') }),
        });
        if (!res.ok)
            throw new Error(`GitHub API failed: ${res.status} ${await res.text()}`);
        const issue = (await res.json());
        return { number: issue.number, url: issue.html_url, created: true };
    },
    'github#listIssues': async ({ owner, repo, state = 'open', limit = 20, }, ctx) => {
        const token = getSkillEnv(ctx, 'GITHUB_TOKEN');
        if (!token)
            throw new Error('github 需配置 GITHUB_TOKEN');
        const o = String(owner ?? '').trim();
        const r = String(repo ?? '').trim();
        if (!o || !r)
            throw new Error('owner, repo are required');
        const l = Math.min(100, Math.max(1, Number(limit) || 20));
        const s = state === 'closed' ? 'closed' : 'open';
        const url = `https://api.github.com/repos/${o}/${r}/issues?state=${s}&per_page=${l}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
        });
        if (!res.ok)
            throw new Error(`GitHub API failed: ${res.status} ${await res.text()}`);
        const arr = (await res.json());
        return {
            issues: arr.map((i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url })),
            count: arr.length,
        };
    },
    // gitlab（GitLab API）
    'gitlab#listRepos': async ({ limit = 20 }, ctx) => {
        const token = getSkillEnv(ctx, 'GITLAB_TOKEN');
        if (!token)
            throw new Error('gitlab 需配置 GITLAB_TOKEN');
        const base = (getSkillEnv(ctx, 'GITLAB_BASE_URL') || 'https://gitlab.com').replace(/\/$/, '');
        const l = Math.min(100, Math.max(1, Number(limit) || 20));
        const res = await fetch(`${base}/api/v4/projects?per_page=${l}&order_by=updated_at`, {
            headers: { 'PRIVATE-TOKEN': token },
        });
        if (!res.ok)
            throw new Error(`GitLab API failed: ${res.status} ${await res.text()}`);
        const arr = (await res.json());
        return {
            repos: arr.map((r) => ({
                id: r.id,
                name: r.name,
                pathWithNamespace: r.path_with_namespace,
                url: r.web_url,
            })),
            count: arr.length,
        };
    },
    'gitlab#getFile': async ({ projectId, filePath }, ctx) => {
        const token = getSkillEnv(ctx, 'GITLAB_TOKEN');
        if (!token)
            throw new Error('gitlab 需配置 GITLAB_TOKEN');
        const base = (getSkillEnv(ctx, 'GITLAB_BASE_URL') || 'https://gitlab.com').replace(/\/$/, '');
        const proj = encodeURIComponent(String(projectId ?? '').trim());
        const path = encodeURIComponent(String(filePath ?? '').trim());
        if (!proj || !path)
            throw new Error('projectId and filePath are required');
        const res = await fetch(`${base}/api/v4/projects/${proj}/repository/files/${path}/raw?ref=HEAD`, {
            headers: { 'PRIVATE-TOKEN': token },
        });
        if (!res.ok)
            throw new Error(`GitLab API failed: ${res.status} ${await res.text()}`);
        const text = await res.text();
        return { content: text, path: filePath };
    },
    'gitlab#createIssue': async ({ projectId, title, description }, ctx) => {
        const token = getSkillEnv(ctx, 'GITLAB_TOKEN');
        if (!token)
            throw new Error('gitlab 需配置 GITLAB_TOKEN');
        const base = (getSkillEnv(ctx, 'GITLAB_BASE_URL') || 'https://gitlab.com').replace(/\/$/, '');
        const proj = encodeURIComponent(String(projectId ?? '').trim());
        const t = String(title ?? '').trim();
        if (!proj || !t)
            throw new Error('projectId and title are required');
        const res = await fetch(`${base}/api/v4/projects/${proj}/issues`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': token },
            body: JSON.stringify({ title: t, description: description != null ? String(description) : '' }),
        });
        if (!res.ok)
            throw new Error(`GitLab API failed: ${res.status} ${await res.text()}`);
        const data = (await res.json());
        return { iid: data.iid, url: data.web_url, created: true };
    },
    'gitlab#listIssues': async ({ projectId, state = 'opened', limit = 20, }, ctx) => {
        const token = getSkillEnv(ctx, 'GITLAB_TOKEN');
        if (!token)
            throw new Error('gitlab 需配置 GITLAB_TOKEN');
        const base = (getSkillEnv(ctx, 'GITLAB_BASE_URL') || 'https://gitlab.com').replace(/\/$/, '');
        const proj = encodeURIComponent(String(projectId ?? '').trim());
        if (!proj)
            throw new Error('projectId is required');
        const s = state === 'closed' ? 'closed' : 'opened';
        const l = Math.min(100, Math.max(1, Number(limit) || 20));
        const res = await fetch(`${base}/api/v4/projects/${proj}/issues?state=${s}&per_page=${l}`, {
            headers: { 'PRIVATE-TOKEN': token },
        });
        if (!res.ok)
            throw new Error(`GitLab API failed: ${res.status} ${await res.text()}`);
        const arr = (await res.json());
        return {
            issues: arr.map((i) => ({ iid: i.iid, title: i.title, state: i.state, url: i.web_url })),
            count: arr.length,
        };
    },
    // web-search-tavily（Tavily AI 搜索）
    'web-search-tavily#search': async ({ query, maxResults = 5, searchDepth = 'basic' }, ctx) => {
        const key = getSkillEnv(ctx, 'TAVILY_API_KEY');
        if (!key)
            throw new Error('web-search-tavily 需配置 TAVILY_API_KEY');
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const max = Math.min(20, Math.max(1, Number(maxResults) || 5));
        const depth = ['basic', 'advanced', 'fast', 'ultra-fast'].includes(String(searchDepth))
            ? searchDepth
            : 'basic';
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: key,
                query: q,
                max_results: max,
                search_depth: depth,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Tavily API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const results = (data.results ?? []).map((r) => ({
            title: r.title ?? '',
            url: r.url ?? '',
            content: (r.content ?? '').slice(0, 500),
        }));
        return { results, count: results.length, answer: data.answer };
    },
    // translate-baidu（百度翻译）
    'translate-baidu#translate': async ({ text, from = 'auto', to = 'zh', }, ctx) => {
        const appId = getSkillEnv(ctx, 'BAIDU_TRANSLATE_APPID');
        const secret = getSkillEnv(ctx, 'BAIDU_TRANSLATE_SECRET');
        if (!appId || !secret)
            throw new Error('translate-baidu 需配置 BAIDU_TRANSLATE_APPID、BAIDU_TRANSLATE_SECRET');
        const q = String(text ?? '').trim();
        if (!q)
            throw new Error('text is required');
        const src = String(from ?? 'auto').toLowerCase();
        const tgt = String(to ?? 'zh').toLowerCase();
        if (tgt === 'auto')
            throw new Error('to 不能为 auto');
        const salt = String(Date.now());
        const signStr = appId + q + salt + secret;
        const { createHash } = await import('node:crypto');
        const sign = createHash('md5').update(signStr).digest('hex');
        const params = new URLSearchParams({
            q,
            from: src,
            to: tgt,
            appid: appId,
            salt,
            sign,
        });
        const res = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`);
        if (!res.ok)
            throw new Error(`百度翻译 API failed: ${res.status}`);
        const data = (await res.json());
        if (data.error_code && data.error_code !== '52000') {
            throw new Error(`百度翻译错误: ${data.error_code}`);
        }
        const translated = (data.trans_result ?? []).map((t) => t.dst ?? '').join('');
        return { translatedText: translated, from: src, to: tgt };
    },
    // translate-youdao（有道翻译）
    'translate-youdao#translate': async ({ text, from = 'auto', to = 'zh', domain = 'general', }, ctx) => {
        const appKey = getSkillEnv(ctx, 'YOUDAO_APP_KEY');
        const appSecret = getSkillEnv(ctx, 'YOUDAO_APP_SECRET');
        if (!appKey || !appSecret)
            throw new Error('translate-youdao 需配置 YOUDAO_APP_KEY、YOUDAO_APP_SECRET');
        const q = String(text ?? '').trim();
        if (!q)
            throw new Error('text is required');
        const src = String(from ?? 'auto').toLowerCase();
        const tgt = String(to ?? 'zh').toLowerCase();
        if (tgt === 'auto')
            throw new Error('to 不能为 auto');
        const salt = crypto.randomUUID().replace(/-/g, '');
        const curtime = Math.floor(Date.now() / 1000);
        const input = q.length <= 20 ? q : q.slice(0, 10) + q.length + q.slice(-10);
        const signStr = appKey + input + salt + curtime + appSecret;
        const sign = createHash('sha256').update(signStr).digest('hex');
        const params = new URLSearchParams({
            q,
            from: src,
            to: tgt,
            appKey,
            salt,
            sign,
            signType: 'v3',
            curtime: String(curtime),
            domain: String(domain ?? 'general'),
        });
        const res = await fetch('https://openapi.youdao.com/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        if (!res.ok)
            throw new Error(`有道翻译 API failed: ${res.status}`);
        const data = (await res.json());
        if (data.errorCode && data.errorCode !== '0') {
            throw new Error(`有道翻译错误: ${data.errorCode}`);
        }
        const translated = (data.translation ?? []).join('');
        return { translatedText: translated, from: src, to: tgt };
    },
    // translate-deepl（DeepL 翻译）
    'translate-deepl#translate': async ({ text, from, to = 'ZH', }, ctx) => {
        const key = getSkillEnv(ctx, 'DEEPL_AUTH_KEY');
        if (!key)
            throw new Error('translate-deepl 需配置 DEEPL_AUTH_KEY');
        const q = String(text ?? '').trim();
        if (!q)
            throw new Error('text is required');
        const tgt = String(to ?? 'ZH').toUpperCase();
        const body = {
            text: [q],
            target_lang: tgt,
        };
        if (from != null && String(from).trim()) {
            body.source_lang = String(from).trim().toUpperCase();
        }
        const base = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
        const res = await fetch(`${base}/v2/translate`, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`DeepL API failed: ${res.status} ${err}`);
        }
        const data = (await res.json());
        const t = data.translations?.[0];
        if (!t)
            throw new Error('DeepL 未返回翻译结果');
        return {
            translatedText: t.text ?? '',
            from: t.detected_source_language ?? from,
            to: tgt,
        };
    },
    // ocr-baidu（百度 OCR）
    'ocr-baidu#recognize': async (params, ctx) => {
        const imageData = await resolveImageInput(params);
        const token = await getBaiduOcrToken(ctx);
        const form = new URLSearchParams({
            image: imageData,
            access_token: token,
        });
        const res = await fetch('https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
        if (!res.ok)
            throw new Error(`百度 OCR API failed: ${res.status}`);
        const data = (await res.json());
        if (data.error_code)
            throw new Error(data.error_msg ?? `百度 OCR 错误: ${data.error_code}`);
        const words = (data.words_result ?? []).map((r) => r.words ?? '').filter(Boolean);
        return { text: words.join('\n'), lines: words, count: words.length };
    },
    'ocr-baidu#recognizeAccurate': async (params, ctx) => {
        const imageData = await resolveImageInput(params);
        const token = await getBaiduOcrToken(ctx);
        const form = new URLSearchParams({
            image: imageData,
            access_token: token,
        });
        const res = await fetch('https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
        if (!res.ok)
            throw new Error(`百度 OCR API failed: ${res.status}`);
        const data = (await res.json());
        if (data.error_code)
            throw new Error(data.error_msg ?? `百度 OCR 错误: ${data.error_code}`);
        const words = (data.words_result ?? []).map((r) => r.words ?? '').filter(Boolean);
        return { text: words.join('\n'), lines: words, count: words.length };
    },
    // map-baidu（百度地图 Place API）
    'map-baidu#search': async ({ query, region }, ctx) => {
        const ak = getSkillEnv(ctx, 'BAIDU_MAP_AK');
        if (!ak)
            throw new Error('map-baidu 需配置 BAIDU_MAP_AK');
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const reg = region != null ? String(region).trim() : '全国';
        const params = new URLSearchParams({
            query: q,
            region: reg || '全国',
            output: 'json',
            ak,
        });
        const res = await fetch(`https://api.map.baidu.com/place/v2/search?${params}`);
        if (!res.ok)
            throw new Error(`百度地图 API failed: ${res.status}`);
        const data = (await res.json());
        if (data.status !== 0)
            throw new Error(data.message ?? '百度地图 search failed');
        const pois = (data.results ?? []).map((p) => ({
            name: p.name,
            address: p.address,
            location: p.location,
            tel: p.telephone,
            uid: p.uid,
        }));
        return { pois, count: pois.length };
    },
    'map-baidu#around': async ({ location, keyword, radius = 1000 }, ctx) => {
        const ak = getSkillEnv(ctx, 'BAIDU_MAP_AK');
        if (!ak)
            throw new Error('map-baidu 需配置 BAIDU_MAP_AK');
        const loc = String(location ?? '').trim();
        if (!loc)
            throw new Error('location is required (format: "lng,lat" 或 "lat,lng"，百度用纬度,经度)');
        const kw = String(keyword ?? '').trim();
        if (!kw)
            throw new Error('keyword is required');
        const r = Math.min(5000, Math.max(0, Number(radius) || 1000));
        const [a, b] = loc.split(/[,\s]+/).map((x) => x.trim());
        const locBaidu = a && b ? `${b},${a}` : loc;
        const params = new URLSearchParams({
            query: kw,
            location: locBaidu,
            radius: String(r),
            output: 'json',
            ak,
        });
        const res = await fetch(`https://api.map.baidu.com/place/v2/search?${params}`);
        if (!res.ok)
            throw new Error(`百度地图 API failed: ${res.status}`);
        const data = (await res.json());
        if (data.status !== 0)
            throw new Error(data.message ?? '百度地图 around failed');
        const pois = (data.results ?? []).map((p) => {
            const detail = p.detail_info;
            return {
                name: p.name,
                address: p.address,
                location: p.location,
                distance: detail?.distance ?? p.distance,
                tel: p.telephone,
            };
        });
        return { pois, count: pois.length };
    },
    // memory（长期记忆，Phase 5/7 scope：param.scope > agentId+visibility > memoryScopeHint > sessionId）
    'memory#write': async ({ key, content, scope: scopeParam, tier: tierParam }, ctx) => {
        const c = String(content ?? '').trim();
        if (!c)
            throw new Error('content is required');
        const scope = resolveMemoryScope(scopeParam != null ? String(scopeParam) : undefined, ctx);
        const tier = tierParam === 'log' || tierParam === 'fact' ? tierParam : undefined;
        await ensureMemoryLoaded();
        const arr = memoryStore.get(scope) ?? [];
        const k = key != null ? String(key).trim() || undefined : undefined;
        const now = Date.now();
        const idx = k ? arr.findIndex((e) => e.key === k) : -1;
        if (idx >= 0) {
            arr[idx] = { ...arr[idx], content: c, ts: now, ...(tier !== undefined && { tier }) };
            memoryStore.set(scope, arr);
            enqueueSave();
            return { id: arr[idx].id, key: arr[idx].key, content: arr[idx].content, saved: true, updated: true };
        }
        const entry = {
            id: randomUUID(),
            key: k,
            content: c,
            ts: now,
            ...(tier !== undefined && { tier }),
            ...(ctx?.agentId && { sourceAgentId: ctx.agentId }),
        };
        arr.push(entry);
        // Phase 6: 超出 maxEntriesPerScope 时按衰减分数 prune
        const memCfgForPrune = getMemoryConfig();
        const maxEntries = memCfgForPrune.maxEntriesPerScope;
        if (maxEntries > 0 && arr.length > maxEntries) {
            const now2 = Date.now();
            const pruneScore = (e) => {
                const hl = e.tier === 'log' ? memCfgForPrune.logHalfLifeDays : memCfgForPrune.decayHalfLifeDays;
                const decay = hl === 0 ? 1 : Math.exp(-0.693 * (now2 - e.ts) / (hl * 86400000));
                // 活起来 P0: 高 accessCount 记忆不易被 prune
                const accessBoost = 1 + 0.1 * Math.min(e.accessCount ?? 0, 5);
                return decay * accessBoost;
            };
            arr.sort((a, b) => pruneScore(b) - pruneScore(a));
            arr.splice(maxEntries);
        }
        memoryStore.set(scope, arr);
        enqueueSave();
        return { id: entry.id, key: entry.key, content: entry.content, saved: true };
    },
    'memory#search': async ({ query, limit = 5, scope: scopeParam, scopes: scopesParam }, ctx) => {
        const q = String(query ?? '').trim().toLowerCase();
        if (!q)
            return { items: [], count: 0 };
        const scopeList = [];
        if (scopesParam && Array.isArray(scopesParam) && scopesParam.length > 0) {
            scopeList.push(...scopesParam.filter((s) => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()));
        }
        if (scopeList.length === 0) {
            // Phase 7: 使用统一 scope 推导（agent-only 优先使用专属 scope）
            scopeList.push(resolveMemoryScope(scopeParam != null ? String(scopeParam) : undefined, ctx));
        }
        await ensureMemoryLoaded();
        const arr = scopeList.length === 1
            ? (memoryStore.get(scopeList[0]) ?? [])
            : scopeList.flatMap((sc) => memoryStore.get(sc) ?? []);
        const max = Math.min(20, Math.max(1, Number(limit) || 5));
        const queryTokens = q.split(/\s+/).filter(Boolean);
        if (queryTokens.length === 0 && q)
            queryTokens.push(q);
        // Phase 6: 字符 bigram 相似度，中英文均有效（替换原来的 space-split Jaccard）
        const bigramSet = (s) => {
            const str = s.toLowerCase().replace(/\s+/g, '');
            if (str.length === 0)
                return new Set();
            if (str.length === 1)
                return new Set([str]);
            const bg = new Set();
            for (let i = 0; i < str.length - 1; i++)
                bg.add(str.slice(i, i + 2));
            return bg;
        };
        const bigramSim = (a, b) => {
            if (a.size === 0 && b.size === 0)
                return 0;
            const inter = [...a].filter((x) => b.has(x)).length;
            return inter / (a.size + b.size - inter);
        };
        // Phase 6: BM25-style IDF — 预计算各 query token 在 arr 中的文档频率
        const N = arr.length;
        const dfMap = {};
        if (N > 0) {
            for (const w of queryTokens) {
                if (!w)
                    continue;
                let df = 0;
                for (const e of arr) {
                    if (`${e.key ?? ''} ${e.content}`.toLowerCase().includes(w))
                        df++;
                }
                dfMap[w] = df;
            }
        }
        // idfWeight(w): 词越稀有权重越高；对 session 条目不应用 IDF（传 noIdf=true）
        const idfWeight = (w) => Math.log(1 + (N + 1) / ((dfMap[w] ?? 0) + 1));
        // 活起来 P0: accessCount 访问强化，被多次命中的记忆权重更高（再巩固）
        const ACCESS_BOOST_FACTOR = 0.15;
        const ACCESS_BOOST_CAP = 5;
        const scoreEntry = (rawText, ts, halfLife, noIdf = false, accessCount = 0) => {
            const text = rawText.toLowerCase();
            let score = 0;
            for (const w of queryTokens) {
                if (!w)
                    continue;
                const idx = text.indexOf(w);
                if (idx >= 0) {
                    let count = 0;
                    let pos = idx;
                    while (pos >= 0) {
                        count++;
                        pos = text.indexOf(w, pos + w.length);
                    }
                    const tf = 1 + 0.4 * Math.log(1 + count);
                    score += noIdf ? tf : tf * idfWeight(w);
                }
            }
            if (score > 0) {
                const lenNorm = 1 / (1 + 0.001 * rawText.length);
                score *= 0.7 + 0.3 * lenNorm;
                const ageDays = (Date.now() - ts) / (24 * 60 * 60 * 1000);
                // Phase 6: halfLife=0 表示永不衰减
                const decay = halfLife === 0 ? 1 : Math.exp(-0.693 * ageDays / halfLife);
                score *= decay;
                // 活起来 P0: 访问强化，常用记忆权重提升
                const accessBoost = 1 + ACCESS_BOOST_FACTOR * Math.min(accessCount, ACCESS_BOOST_CAP);
                score *= accessBoost;
            }
            return score;
        };
        // 活起来 P3: archived 记忆降权（已 consolidation 压缩的源记忆）
        const ARCHIVED_SCORE_FACTOR = 0.3;
        const memCfg = getMemoryConfig();
        // 活起来 P1: 会话上下文，取最近 3 轮拼接，用于情境匹配 boost
        const sessionContext = memCfg.sessionContextBoost && ctx?.sessionHistory?.length
            ? ctx.sessionHistory
                .slice(-6)
                .map((m) => m.content)
                .join(' ')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim()
            : '';
        const sessionContextBigram = sessionContext ? bigramSet(sessionContext) : new Set();
        const SESSION_CONTEXT_BOOST_FACTOR = 0.2; // 与当前对话主题相关的记忆最高 +20% 权重
        const SESSION_CONTEXT_SIM_CAP = 0.5;
        // 用户说「查看记忆」「我的记忆」等浏览意图时，query 不含内容关键词会得 0 分；用近期优先兜底
        const browsePhrases = /^(查看|我的|所有|全部|列出|有什么|我记得).*记忆|记忆.*(列表|全部|有什么)/;
        const isBrowseIntent = arr.length > 0 && browsePhrases.test(q);
        const scored = arr
            .map((e) => {
            const rawText = `${e.key ?? ''} ${e.content}`;
            const halfLife = e.tier === 'log' ? memCfg.logHalfLifeDays : memCfg.decayHalfLifeDays;
            let score = scoreEntry(rawText, e.ts, halfLife, false, e.accessCount ?? 0);
            if (score === 0 && isBrowseIntent) {
                const ageDays = (Date.now() - e.ts) / 86400000;
                score = 1 / (1 + 0.1 * ageDays);
            }
            // 活起来 P1: 与当前会话主题相关的记忆加分（情境门控）
            if (score > 0 && sessionContextBigram.size > 0) {
                const memBigram = bigramSet(rawText);
                const sim = bigramSim(memBigram, sessionContextBigram);
                if (sim > 0.05) {
                    score *= 1 + SESSION_CONTEXT_BOOST_FACTOR * Math.min(sim, SESSION_CONTEXT_SIM_CAP);
                }
            }
            // 活起来 P3: archived 记忆降权
            if (e.archived)
                score *= ARCHIVED_SCORE_FACTOR;
            return { ...e, score };
        })
            .filter((x) => x.score > 0)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        // 活起来 P2: 图扩展（1 跳联想）— 从高相关记忆扩散到内容相似的记忆
        const GRAPH_EXPAND_SEEDS = 3;
        const GRAPH_EXPAND_SIM_THRESHOLD = 0.15;
        const GRAPH_EXPAND_DECAY = 0.5;
        if (memCfg.graphExpand && scored.length > 0 && arr.length > 1) {
            const seedIds = new Set(scored.slice(0, GRAPH_EXPAND_SEEDS).map((s) => s.id));
            const expandScores = new Map();
            for (const seed of scored.slice(0, GRAPH_EXPAND_SEEDS)) {
                const seedText = `${seed.key ?? ''} ${seed.content}`;
                const seedBigram = bigramSet(seedText);
                for (const e of arr) {
                    if (seedIds.has(e.id) || e.id === seed.id)
                        continue;
                    const eText = `${e.key ?? ''} ${e.content}`;
                    const sim = bigramSim(seedBigram, bigramSet(eText));
                    if (sim > GRAPH_EXPAND_SIM_THRESHOLD) {
                        const s = (seed.score ?? 0) * GRAPH_EXPAND_DECAY * sim;
                        expandScores.set(e.id, Math.max(expandScores.get(e.id) ?? 0, s));
                    }
                }
            }
            const scoredIds = new Set(scored.map((s) => s.id));
            for (const e of arr) {
                const s = expandScores.get(e.id);
                if (s != null && !scoredIds.has(e.id)) {
                    scored.push({ ...e, score: s });
                    scoredIds.add(e.id);
                }
            }
            scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        }
        // Phase 4: 会话索引 - 将近期 session 纳入检索（不应用 IDF，session 无法建立语料统计）
        const sessionItems = [];
        if (ctx?.sessionHistory?.length) {
            for (let i = 0; i < ctx.sessionHistory.length; i++) {
                const m = ctx.sessionHistory[i];
                const rawText = `${m.role}: ${m.content}`;
                const ts = Date.now(); // 会话内容视为最新，无衰减
                const score = scoreEntry(rawText, ts, memCfg.decayHalfLifeDays, true, 0);
                if (score > 0) {
                    sessionItems.push({
                        id: `session:${i}`,
                        key: undefined,
                        content: rawText,
                        ts,
                        score,
                        _fromSession: true,
                    });
                }
            }
        }
        const allCandidates = [...scored, ...sessionItems].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const candidateCount = Math.min(allCandidates.length, max * 3);
        const candidates = allCandidates.slice(0, candidateCount);
        const mmrLambda = 0.7;
        const maxScore = Math.max(...candidates.map((c) => c.score ?? 0), 1);
        const selected = [];
        for (let i = 0; i < max && selected.length < candidates.length; i++) {
            let bestIdx = -1;
            let bestMrr = -Infinity;
            for (let j = 0; j < candidates.length; j++) {
                if (selected.some((s) => s.id === candidates[j].id))
                    continue;
                const rel = (candidates[j].score ?? 0) / maxScore;
                const cText = `${candidates[j].key ?? ''} ${candidates[j].content ?? ''}`;
                const maxSim = selected.length === 0 ? 0 : Math.max(...selected.map((s) => bigramSim(bigramSet(`${s.key ?? ''} ${s.content ?? ''}`), bigramSet(cText))));
                const mrr = mmrLambda * rel - (1 - mmrLambda) * maxSim;
                if (mrr > bestMrr) {
                    bestMrr = mrr;
                    bestIdx = j;
                }
            }
            if (bestIdx < 0)
                break;
            selected.push(candidates[bestIdx]);
        }
        let results = selected.length > 0 ? selected : candidates.slice(0, max);
        // Phase 9: agent-only 时无结果则自动扩展检索 user/group scope 兜底，防止信息断档
        if (results.length === 0 && ctx?.agentMemoryVisibility === 'agent-only') {
            const sharedScope = resolveSharedScope(ctx);
            if (sharedScope && sharedScope !== scopeList[0]) {
                const fallbackArr = memoryStore.get(sharedScope) ?? [];
                const fallbackScored = fallbackArr
                    .map((e) => {
                    const rawText = `${e.key ?? ''} ${e.content}`;
                    const halfLife = e.tier === 'log' ? memCfg.logHalfLifeDays : memCfg.decayHalfLifeDays;
                    let score = scoreEntry(rawText, e.ts, halfLife, false, e.accessCount ?? 0);
                    if (score > 0 && sessionContextBigram.size > 0) {
                        const sim = bigramSim(bigramSet(rawText), sessionContextBigram);
                        if (sim > 0.05)
                            score *= 1 + SESSION_CONTEXT_BOOST_FACTOR * Math.min(sim, SESSION_CONTEXT_SIM_CAP);
                    }
                    return { ...e, score, _fromSharedScope: true };
                })
                    .filter((x) => x.score > 0)
                    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                    .slice(0, max);
                results = fallbackScored;
            }
        }
        const primaryScope = scopeList[0] ?? 'default';
        // 活起来 P0: 检索命中时更新 lastAccessedAt 与 accessCount（再巩固）
        const now = Date.now();
        const scopesToUpdate = [...scopeList];
        if (ctx?.agentMemoryVisibility === 'agent-only') {
            const shared = resolveSharedScope(ctx);
            if (shared && !scopeList.includes(shared))
                scopesToUpdate.push(shared);
        }
        for (const r of results) {
            const entry = r;
            if (entry._fromSession)
                continue;
            const id = entry.id;
            if (!id)
                continue;
            for (const sc of scopesToUpdate) {
                const arr = memoryStore.get(sc) ?? [];
                const idx = arr.findIndex((e) => e.id === id);
                if (idx >= 0) {
                    const e = arr[idx];
                    arr[idx] = {
                        ...e,
                        lastAccessedAt: now,
                        accessCount: (e.accessCount ?? 0) + 1,
                    };
                    memoryStore.set(sc, arr);
                    enqueueSave();
                    break;
                }
            }
        }
        return {
            items: results.map((r) => {
                const entry = r;
                return {
                    id: entry.id,
                    key: entry.key ?? undefined,
                    content: entry.content ?? '',
                    ts: entry.ts ?? Date.now(),
                    // Phase 9: 标注记忆来源 scope，便于 LLM 判断是专属记忆还是共享记忆
                    scope: entry._fromSharedScope ? (resolveSharedScope(ctx) ?? primaryScope) : primaryScope,
                    ...(entry._fromSession && { source: 'session' }),
                    ...(entry.sourceAgentId && { sourceAgentId: entry.sourceAgentId }),
                };
            }),
            count: results.length,
        };
    },
    'memory#read': async ({ key, id: idParam, scope: scopeParam }, ctx) => {
        const k = String(key ?? '').trim();
        const id = String(idParam ?? '').trim();
        if (!k && !id)
            throw new Error('key 或 id 必填其一');
        const scope = resolveMemoryScope(scopeParam != null ? String(scopeParam) : undefined, ctx);
        await ensureMemoryLoaded();
        const arr = memoryStore.get(scope) ?? [];
        const found = arr.find((e) => (id && e.id === id) || (k && (e.key === k || e.id === k)));
        if (!found)
            return { found: false, content: null };
        return { found: true, content: found.content, key: found.key, ts: found.ts };
    },
    'memory#list': async ({ scope: scopeParam }, ctx) => {
        const scope = resolveMemoryScope(scopeParam != null ? String(scopeParam) : undefined, ctx);
        await ensureMemoryLoaded();
        const arr = memoryStore.get(scope) ?? [];
        const items = arr.map((e) => ({ id: e.id, key: e.key ?? null, ts: e.ts, ...(e.sourceAgentId && { sourceAgentId: e.sourceAgentId }) }));
        return { items, count: items.length };
    },
    'memory#delete': async ({ id: idArg, key: keyArg, scope: scopeParam }, ctx) => {
        const id = idArg != null ? String(idArg).trim() : '';
        const key = keyArg != null ? String(keyArg).trim() : '';
        if (!id && !key)
            throw new Error('id 或 key 必填其一');
        const scope = resolveMemoryScope(scopeParam != null ? String(scopeParam) : undefined, ctx);
        await ensureMemoryLoaded();
        const arr = memoryStore.get(scope) ?? [];
        const idx = arr.findIndex((e) => e.id === id || (key && e.key === key));
        if (idx < 0)
            return { deleted: false, message: '未找到匹配的记忆' };
        arr.splice(idx, 1);
        memoryStore.set(scope, arr);
        enqueueSave();
        return { deleted: true, removedIndex: idx };
    },
    // web-search（DuckDuckGo HTML 版，可返回真实搜索结果；国内可能超时，建议优先用 web-search-baidu）
    'web-search#search': async ({ query, maxResults = 5 }) => {
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        try {
            const res = await fetch(ddgUrl, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return { query: q, searchUrl: ddgUrl, results: [], count: 0, note: `请求失败: ${res.status}` };
            const html = await res.text();
            const results = parseDuckDuckGoHtmlResults(html, Math.min(Number(maxResults) || 5, 15));
            return { query: q, searchUrl: ddgUrl, results, count: results.length };
        }
        catch (e) {
            throw new Error(`DuckDuckGo 搜索失败: ${e instanceof Error ? e.message : 'unknown'}。` +
                '【建议】可尝试 web-search-baidu_search 或 web-search-bing-cn_search（国内更稳定）。');
        }
    },
    // web-search-baidu（百度搜索，解析 HTML，失败时返回搜索链接）
    'web-search-baidu#search': async ({ query, maxResults = 5 }) => {
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`;
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        try {
            const res = await fetch(searchUrl, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return { query: q, searchUrl, results: [], count: 0, note: `请求失败: ${res.status}` };
            const html = await res.text();
            const results = parseBaiduSearchResults(html, Math.min(Number(maxResults) || 5, 15));
            return { query: q, searchUrl, results, count: results.length };
        }
        catch (e) {
            return { query: q, searchUrl, results: [], count: 0, note: `解析失败: ${e instanceof Error ? e.message : 'unknown'}` };
        }
    },
    // web-search-bing-cn（必应中文搜索；若被拦截则用 DuckDuckGo HTML 中文模式）
    'web-search-bing-cn#search': async ({ query, maxResults = 5 }) => {
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(q)}`;
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        try {
            const res = await fetch(searchUrl, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
                const html = await res.text();
                const results = parseBingSearchResults(html, Math.min(Number(maxResults) || 5, 15));
                if (results.length > 0)
                    return { query: q, searchUrl, results, count: results.length };
            }
        }
        catch { /* fallback */ }
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=cn-zh`;
        try {
            const res = await fetch(ddgUrl, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return { query: q, searchUrl, results: [], count: 0, note: '请手动访问搜索链接' };
            const html = await res.text();
            const results = parseDuckDuckGoHtmlResults(html, Math.min(Number(maxResults) || 5, 15));
            return { query: q, searchUrl, results, count: results.length, source: 'duckduckgo' };
        }
        catch (e) {
            return { query: q, searchUrl, results: [], count: 0, note: `解析失败: ${e instanceof Error ? e.message : 'unknown'}` };
        }
    },
    // wechat-mp-search（搜狗微信搜索，解析 HTML）
    'wechat-mp-search#search': async ({ query, maxResults = 5 }) => {
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const searchUrl = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(q)}`;
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        try {
            const res = await fetch(searchUrl, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return { query: q, searchUrl, results: [], count: 0, note: `请求失败: ${res.status}` };
            const html = await res.text();
            const results = parseSogouWeixinResults(html, Math.min(Number(maxResults) || 5, 15));
            return { query: q, searchUrl, results, count: results.length };
        }
        catch (e) {
            return { query: q, searchUrl, results: [], count: 0, note: `解析失败: ${e instanceof Error ? e.message : 'unknown'}` };
        }
    },
    // web-search-google（Google Custom Search API，需 API Key + Search Engine ID）
    'web-search-google#search': async ({ query, maxResults = 5 }, ctx) => {
        const apiKey = getSkillEnv(ctx, 'GOOGLE_CSE_API_KEY');
        const cx = getSkillEnv(ctx, 'GOOGLE_CSE_CX');
        if (!apiKey || !cx) {
            throw new Error('web-search-google 需配置 GOOGLE_CSE_API_KEY、GOOGLE_CSE_CX（在 programmablesearchengine.google.com 创建并选「搜索整个网页」）');
        }
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const num = Math.min(10, Math.max(1, Number(maxResults) || 5));
        const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=${num}`;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) {
                const err = await res.text();
                return { query: q, results: [], count: 0, note: `Google API 失败: ${res.status} ${err}` };
            }
            const data = (await res.json());
            const results = (data.items ?? []).map((r) => ({
                title: r.title ?? '',
                url: r.link ?? '',
                snippet: r.snippet ?? '',
            }));
            return { query: q, results, count: results.length };
        }
        catch (e) {
            throw new Error(`Google 搜索失败: ${e instanceof Error ? e.message : 'unknown'}。` +
                '【建议】可尝试 web-search-baidu_search 或 web-search-bing-cn_search。');
        }
    },
    // web-search-360（360 搜索）
    'web-search-360#search': async ({ query, maxResults = 5 }) => {
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const searchUrl = `https://www.so.com/s?q=${encodeURIComponent(q)}`;
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        try {
            const res = await fetch(searchUrl, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return { query: q, searchUrl, results: [], count: 0, note: `请求失败: ${res.status}` };
            const html = await res.text();
            const results = parseGenericSearchResults(html, Math.min(Number(maxResults) || 5, 15));
            return { query: q, searchUrl, results, count: results.length };
        }
        catch (e) {
            return { query: q, searchUrl, results: [], count: 0, note: `解析失败: ${e instanceof Error ? e.message : 'unknown'}` };
        }
    },
    // web-search-quark（夸克搜索）
    'web-search-quark#search': async ({ query, maxResults = 5 }) => {
        const q = String(query ?? '').trim();
        if (!q)
            throw new Error('query is required');
        const searchUrl = `https://quark.sm.cn/s?q=${encodeURIComponent(q)}`;
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        try {
            const res = await fetch(searchUrl, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return { query: q, searchUrl, results: [], count: 0, note: `请求失败: ${res.status}` };
            const html = await res.text();
            const results = parseGenericSearchResults(html, Math.min(Number(maxResults) || 5, 15));
            return { query: q, searchUrl, results, count: results.length };
        }
        catch (e) {
            return { query: q, searchUrl, results: [], count: 0, note: `解析失败: ${e instanceof Error ? e.message : 'unknown'}` };
        }
    },
    // image-gen-sd（Stable Diffusion 本地）
    'image-gen-sd#generate': async ({ prompt, negativePrompt, steps = 20, width = 512, height = 512, seed = -1, savePath }, ctx) => {
        const p = String(prompt ?? '').trim();
        if (!p)
            throw new Error('prompt is required');
        const baseUrl = (process.env.STABLE_DIFFUSION_API_URL ?? 'http://127.0.0.1:7860').replace(/\/$/, '');
        const res = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: p,
                negative_prompt: String(negativePrompt ?? '').trim() || undefined,
                steps: Math.min(50, Math.max(1, Number(steps) || 20)),
                width: Math.min(1024, Math.max(64, Number(width) || 512)),
                height: Math.min(1024, Math.max(64, Number(height) || 512)),
                seed: Number(seed) === -1 ? -1 : Math.floor(Number(seed) || -1),
            }),
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok)
            throw new Error(`Stable Diffusion API 失败: ${res.status} ${await res.text()}`);
        const data = (await res.json());
        const b64 = data.images?.[0];
        if (!b64)
            throw new Error('未返回图片');
        const buf = Buffer.from(b64, 'base64');
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const outDir = join(ws, '.agent-scripts', 'sd-output');
        await mkdir(outDir, { recursive: true });
        const fname = `sd-${Date.now()}.png`;
        const outPath = join(outDir, fname);
        await writeFile(outPath, buf);
        if (savePath && typeof savePath === 'string' && savePath.trim()) {
            const dest = resolveWorkspacePath(ws, savePath.trim());
            await mkdir(dirname(dest), { recursive: true });
            await writeFile(dest, buf);
            return { path: savePath.trim(), base64: b64.slice(0, 100) + '...', note: '已保存到指定路径' };
        }
        return { path: `.agent-scripts/sd-output/${fname}`, base64: b64.slice(0, 100) + '...' };
    },
    // sql-query（SQLite 自然语言查询）
    'sql-query#getSchema': async ({ dbPath }, ctx) => {
        const p = String(dbPath ?? '').trim();
        if (!p)
            throw new Error('dbPath is required');
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fullPath = resolveWorkspacePath(ws, p);
        if (!existsSync(fullPath))
            throw new Error(`数据库文件不存在: ${p}`);
        const buf = await readFile(fullPath);
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();
        const db = new SQL.Database(new Uint8Array(buf));
        const schemaRows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        const tables = [];
        for (const row of schemaRows[0]?.values ?? []) {
            const tableName = String(row[0]);
            const colRows = db.exec(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);
            const columns = (colRows[0]?.values ?? []).map((r) => ({
                name: String(r[1]),
                type: String(r[2] ?? ''),
            }));
            tables.push({ table: tableName, columns });
        }
        db.close();
        return { tables };
    },
    'sql-query#execute': async ({ dbPath, sql }, ctx) => {
        const p = String(dbPath ?? '').trim();
        const s = String(sql ?? '').trim();
        if (!p || !s)
            throw new Error('dbPath and sql are required');
        const upper = s.toUpperCase();
        if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') || upper.startsWith('DROP') || upper.startsWith('CREATE') || upper.startsWith('ALTER')) {
            throw new Error('仅允许 SELECT 等只读查询');
        }
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fullPath = resolveWorkspacePath(ws, p);
        if (!existsSync(fullPath))
            throw new Error(`数据库文件不存在: ${p}`);
        const buf = await readFile(fullPath);
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();
        const db = new SQL.Database(new Uint8Array(buf));
        try {
            const stmt = db.prepare(s);
            const cols = stmt.getColumnNames();
            const rows = [];
            while (stmt.step())
                rows.push(stmt.getValues());
            stmt.free();
            return { columns: cols, rows };
        }
        finally {
            db.close();
        }
    },
    'sql-query#query': async ({ dbPath, question }, ctx) => {
        const p = String(dbPath ?? '').trim();
        const q = String(question ?? '').trim();
        if (!p || !q)
            throw new Error('dbPath and question are required');
        const { invokeTool } = await import('./registry.js');
        const schemaResult = await invokeTool('sql-query', 'getSchema', { dbPath: p }, { sessionId: ctx?.sessionId });
        const schemas = schemaResult;
        const tables = schemas.tables ?? [];
        const schemaStr = JSON.stringify(tables, null, 2);
        const { getLLMProvider } = await import('../agent/config.js');
        const provider = getLLMProvider();
        const sysPrompt = `你是 SQL 专家。根据以下 SQLite 表结构，将用户的自然语言问题转换为一条 SELECT SQL。只返回 SQL，不要其他解释。表结构：\n${schemaStr}`;
        const result = await provider.complete([{ role: 'system', content: sysPrompt }, { role: 'user', content: q }], { temperature: 0.1, maxTokens: 500 });
        let sql = (result.content ?? '').trim().replace(/^```sql\s*/i, '').replace(/\s*```$/g, '').trim();
        if (!sql)
            throw new Error('LLM 未生成有效 SQL');
        const execResult = await invokeTool('sql-query', 'execute', { dbPath: p, sql }, { sessionId: ctx?.sessionId });
        return execResult;
    },
    // gmail（占位，需 OAuth）
    'gmail#listMessages': async () => {
        const id = process.env.GOOGLE_CLIENT_ID;
        const secret = process.env.GOOGLE_CLIENT_SECRET;
        const token = process.env.GOOGLE_REFRESH_TOKEN;
        if (!id || !secret || !token)
            throw new Error('Gmail 需配置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、GOOGLE_REFRESH_TOKEN。请参阅 Google OAuth 文档完成配置。');
        throw new Error('Gmail OAuth 集成开发中，敬请期待。请先配置环境变量后联系维护者。');
    },
    'gmail#getMessage': async () => {
        throw new Error('Gmail OAuth 集成开发中，敬请期待。');
    },
    'gmail#sendMessage': async () => {
        throw new Error('Gmail OAuth 集成开发中，敬请期待。');
    },
    // google-calendar（占位，需 OAuth）
    'google-calendar#listEvents': async () => {
        throw new Error('Google Calendar 需配置 OAuth。请配置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、GOOGLE_REFRESH_TOKEN 后使用。');
    },
    'google-calendar#createEvent': async () => {
        throw new Error('Google Calendar OAuth 集成开发中，敬请期待。');
    },
    // wechat-mp-publish（微信公众号草稿与发布）
    'wechat-mp-publish#uploadThumb': async ({ imageUrl, base64, path: pathParam }, ctx) => {
        const appId = getWechatMpAppId();
        const appSecret = getWechatMpAppSecret();
        if (!appId || !appSecret)
            throw new Error('公众号需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET（环境变量或 .apexpanda/config.json skills.entries）');
        let buf;
        if (pathParam && typeof pathParam === 'string') {
            const ws = ctx?.workspaceDir ?? getWorkspaceDir();
            const fullPath = resolveWorkspacePath(ws, pathParam.trim());
            if (!existsSync(fullPath))
                throw new Error(`本地图片不存在: ${pathParam}`);
            buf = await readFile(fullPath);
        }
        else if (base64 && typeof base64 === 'string') {
            const raw = String(base64).replace(/^data:image\/[^;]+;base64,/, '').trim();
            if (!raw)
                throw new Error('base64 图片为空，请传入完整 data:image/xxx;base64,xxx 或纯 base64 字符串');
            buf = Buffer.from(raw, 'base64');
            if (buf.length === 0)
                throw new Error('base64 解码后为空');
        }
        else {
            const url = String(imageUrl ?? '').trim();
            if (!url.startsWith('http://') && !url.startsWith('https://'))
                throw new Error('path、imageUrl、base64 三选一必填。推荐 path 指向工作区内图片文件');
            const res = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: { 'User-Agent': 'ApexPanda/1.0' },
            });
            if (!res.ok)
                throw new Error(`获取图片失败: HTTP ${res.status} ${res.statusText}`);
            buf = Buffer.from(await res.arrayBuffer());
        }
        if (buf.length === 0)
            throw new Error('图片内容为空');
        if (buf.length > 2 * 1024 * 1024)
            throw new Error('封面图不超过 2MB，当前约 ' + Math.round(buf.length / 1024) + 'KB');
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        const mime = isPng ? 'image/png' : 'image/jpeg';
        const filename = isPng ? 'cover.png' : 'cover.jpg';
        const token = await getWechatMpAccessToken(appId, appSecret);
        const form = new FormData();
        form.append('media', new Blob([new Uint8Array(buf)], { type: mime }), filename);
        const addRes = await fetch(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(20000),
        });
        const bodyText = await addRes.text();
        let addData;
        try {
            addData = JSON.parse(bodyText);
        }
        catch {
            throw new Error(`微信 API 返回异常: ${bodyText.slice(0, 200)}`);
        }
        if (addData.errcode !== 0 && addData.errcode !== undefined)
            throw new Error(`上传封面失败 [${addData.errcode}] ${addData.errmsg ?? '未知'}. 提示：可尝试 path 传本地图片如 packages/skills/builtin/wechat-mp-publish/assets/cover.jpg`);
        if (!addData.media_id)
            throw new Error('上传成功但未返回 media_id');
        return { mediaId: addData.media_id };
    },
    'wechat-mp-publish#uploadImage': async ({ imageUrl, base64, path: pathParam }, ctx) => {
        const appId = getWechatMpAppId();
        const appSecret = getWechatMpAppSecret();
        if (!appId || !appSecret)
            throw new Error('公众号需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET（环境变量或 .apexpanda/config.json skills.entries）');
        let buf;
        if (pathParam && typeof pathParam === 'string') {
            const ws = ctx?.workspaceDir ?? getWorkspaceDir();
            const fullPath = resolveWorkspacePath(ws, pathParam.trim());
            if (!existsSync(fullPath))
                throw new Error(`本地图片不存在: ${pathParam}`);
            buf = await readFile(fullPath);
        }
        else if (base64 && typeof base64 === 'string') {
            const raw = String(base64).replace(/^data:image\/[^;]+;base64,/, '').trim();
            if (!raw)
                throw new Error('base64 图片为空');
            buf = Buffer.from(raw, 'base64');
            if (buf.length === 0)
                throw new Error('base64 解码后为空');
        }
        else {
            const url = String(imageUrl ?? '').trim();
            if (!url.startsWith('http://') && !url.startsWith('https://'))
                throw new Error('path、imageUrl、base64 三选一必填');
            const res = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: { 'User-Agent': 'ApexPanda/1.0' },
            });
            if (!res.ok)
                throw new Error(`获取图片失败: HTTP ${res.status}`);
            buf = Buffer.from(await res.arrayBuffer());
        }
        if (buf.length === 0)
            throw new Error('图片内容为空');
        if (buf.length > 5 * 1024 * 1024)
            throw new Error('正文图片不超过 5MB');
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        const mime = isPng ? 'image/png' : 'image/jpeg';
        const ext = isPng ? 'png' : 'jpg';
        const token = await getWechatMpAccessToken(appId, appSecret);
        const form = new FormData();
        form.append('media', new Blob([new Uint8Array(buf)], { type: mime }), `image.${ext}`);
        const uploadRes = await fetch(`https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(20000),
        });
        const bodyText = await uploadRes.text();
        let uploadData;
        try {
            uploadData = JSON.parse(bodyText);
        }
        catch {
            throw new Error(`微信 API 返回异常: ${bodyText.slice(0, 200)}`);
        }
        if (uploadData.errcode !== 0 && uploadData.errcode !== undefined)
            throw new Error(`上传正文图片失败 [${uploadData.errcode}] ${uploadData.errmsg ?? '未知'}`);
        if (!uploadData.url)
            throw new Error('上传成功但未返回 url');
        return { url: uploadData.url };
    },
    'wechat-mp-publish#formatArticle': async ({ title, content }) => {
        const t = String(title ?? '').trim();
        let c = String(content ?? '').trim();
        if (!c)
            c = t;
        const pStyle = 'margin:0.8em 0;line-height:1.9;text-indent:2em;font-size:16px;color:#333';
        const h3Style = 'margin:1.2em 0 0.6em;font-size:18px;font-weight:bold;color:#1a1a1a';
        const blockStyle = 'margin:1em 0;padding:0.8em;background:#f8f9fa;border-left:4px solid #4a90e2;font-size:15px';
        const rawBlocks = c.replace(/<[^>]+>/g, '\n').split(/\n+/).map((s) => s.trim()).filter(Boolean);
        const parts = [];
        let imgIdx = 0;
        const imgPlaceholders = [];
        for (let i = 0; i < rawBlocks.length; i++) {
            const block = rawBlocks[i];
            const isHeading = block.length <= 25 && (block.endsWith('：') || block.endsWith(':') || /^#{1,3}\s/.test(block) || !block.includes('。'));
            if (isHeading && block.length > 0) {
                parts.push(`<h3 style="${h3Style}">${block.replace(/^#{1,3}\s*/, '')}</h3>`);
            }
            else {
                parts.push(`<p style="${pStyle}">${block}</p>`);
                if ((i + 1) % 2 === 0 && imgIdx < 4) {
                    imgIdx++;
                    const ph = `{{IMG_${imgIdx}}}`;
                    imgPlaceholders.push(ph);
                    parts.push(`<p style="margin:1.2em 0;text-align:center">${ph}</p>`);
                }
            }
        }
        const formatted = parts.join('\n');
        const instr = imgPlaceholders.length > 0
            ? `必须依次用 image-gen-dalle 或 image-gen-wanx 根据前后段落主题生成 ${imgPlaceholders.length} 张配图，uploadImage 后将该 ${imgPlaceholders.join('、')} 替换为 <img src="url" style="max-width:100%;margin:0.5em 0;border-radius:6px" />`
            : '正文已有图则无需插入';
        return { formattedContent: formatted, imagePlaceholders: imgPlaceholders, instruction: instr };
    },
    'wechat-mp-publish#selectCover': async ({ title, itemsJson }) => {
        const t = String(title ?? '').trim();
        let items = [];
        try {
            items = JSON.parse(String(itemsJson ?? '[]'));
        }
        catch {
            return { needImageGen: true, reason: 'itemsJson 解析失败，请用 image-gen 生成封面' };
        }
        if (items.length === 0)
            return { needImageGen: true, reason: '素材库无图，请用 image-gen 生成封面' };
        const keywords = t.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
        let best = items[0];
        let bestScore = -1;
        for (const it of items) {
            const name = (it.name ?? '').toLowerCase();
            if (/^img_\d+|^\d+\.|\.(jpg|png|jpeg)$/i.test(name)) {
                if (bestScore < 0)
                    bestScore = 0;
                continue;
            }
            let score = 0;
            for (const kw of keywords) {
                if (name.includes(kw.toLowerCase()))
                    score += 2;
            }
            if (score > bestScore) {
                bestScore = score;
                best = it;
            }
        }
        if (bestScore <= 0 && keywords.length > 0)
            return { needImageGen: true, reason: '素材库图片名称与标题无匹配，请用 image-gen 按标题生成封面' };
        return { mediaId: best.mediaId, name: best.name };
    },
    'wechat-mp-publish#addDraft': async ({ title, content, author, digest, thumbMediaId, contentSourceUrl, picCrop2351, picCrop11, }) => {
        const appId = getWechatMpAppId();
        const appSecret = getWechatMpAppSecret();
        if (!appId || !appSecret)
            throw new Error('公众号需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET');
        const t = String(title ?? '').trim();
        const c = String(content ?? '').trim();
        if (!t)
            throw new Error('title 必填');
        if (!c)
            throw new Error('content 必填');
        const thumb = String(thumbMediaId ?? '').trim();
        if (!thumb)
            throw new Error('thumbMediaId 必填（图文消息封面。可先调用 listMaterials 从素材库选取，或 uploadThumb 上传新图）');
        const token = await getWechatMpAccessToken(appId, appSecret);
        const article = {
            article_type: 'news',
            title: t.slice(0, 32),
            author: author ? String(author).slice(0, 16) : undefined,
            digest: digest ? String(digest).slice(0, 128) : undefined,
            content: c.length > 20000 ? c.slice(0, 20000) : c,
            thumb_media_id: thumb,
            need_open_comment: 0,
            only_fans_can_comment: 0,
        };
        if (contentSourceUrl && String(contentSourceUrl).trim())
            article.content_source_url = String(contentSourceUrl).trim().slice(0, 1024);
        if (picCrop2351 && typeof picCrop2351 === 'string')
            article.pic_crop_235_1 = String(picCrop2351).trim();
        if (picCrop11 && typeof picCrop11 === 'string')
            article.pic_crop_1_1 = String(picCrop11).trim();
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articles: [article] }),
            signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json());
        if (data.errcode != null && data.errcode !== 0)
            throw new Error(`新增草稿失败: ${data.errmsg ?? res.status}`);
        if (!data.media_id)
            throw new Error('新增成功但未返回 media_id');
        return { mediaId: data.media_id };
    },
    'wechat-mp-publish#publishDraft': async ({ mediaId }) => {
        const appId = getWechatMpAppId();
        const appSecret = getWechatMpAppSecret();
        if (!appId || !appSecret)
            throw new Error('公众号需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET');
        const mid = String(mediaId ?? '').trim();
        if (!mid)
            throw new Error('mediaId 必填（addDraft 返回的 media_id）');
        const token = await getWechatMpAccessToken(appId, appSecret);
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_id: mid }),
            signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json());
        if (data.errcode != null && data.errcode !== 0)
            throw new Error(`提交发布失败: ${data.errmsg ?? res.status}`);
        return { success: true, publishId: data.publish_id, note: '发布已提交，结果通过公众号回调推送。注意：发布接口不会推送给粉丝，手机微信看不到；要让粉丝看到需用 massSend 群发' };
    },
    'wechat-mp-publish#massSend': async ({ mediaId, tagId }) => {
        const appId = getWechatMpAppId();
        const appSecret = getWechatMpAppSecret();
        if (!appId || !appSecret)
            throw new Error('公众号需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET');
        const mid = String(mediaId ?? '').trim();
        if (!mid)
            throw new Error('mediaId 必填（addDraft 返回的 media_id）');
        const token = await getWechatMpAccessToken(appId, appSecret);
        const filter = tagId != null && tagId !== '' ? { is_to_all: false, tag_id: Number(tagId) } : { is_to_all: true };
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/message/mass/sendall?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filter,
                mpnews: { media_id: mid },
                msgtype: 'mpnews',
                send_ignore_reprint: 0,
            }),
            signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json());
        if (data.errcode != null && data.errcode !== 0)
            throw new Error(`群发失败: [${data.errcode}] ${data.errmsg ?? res.status}。提示：订阅号每天限1次、服务号每月限4次；若开启API群发保护需管理员确认`);
        return { success: true, msgId: data.msg_id, msgDataId: data.msg_data_id, note: '群发已提交，粉丝将在手机微信收到推送并可在公众号历史消息中看到' };
    },
    'wechat-mp-publish#listDrafts': async ({ offset = 0, count = 20 }) => {
        const appId = getWechatMpAppId();
        const appSecret = getWechatMpAppSecret();
        if (!appId || !appSecret)
            throw new Error('公众号需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET');
        const token = await getWechatMpAccessToken(appId, appSecret);
        const off = Math.max(0, Number(offset) || 0);
        const cnt = Math.min(20, Math.max(1, Number(count) || 20));
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/batchget?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offset: off, count: cnt }),
            signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json());
        if (data.errcode != null && data.errcode !== 0)
            throw new Error(`获取草稿列表失败: ${data.errmsg ?? res.status}`);
        const items = (data.item ?? []).map((i) => ({
            mediaId: i.media_id,
            title: i.content?.news_item?.[0]?.title,
            updateTime: i.update_time,
        }));
        return { totalCount: data.total_count ?? 0, itemCount: items.length, items };
    },
    'wechat-mp-publish#listMaterials': async ({ type = 'image', offset = 0, count = 20 }) => {
        const appId = getWechatMpAppId();
        const appSecret = getWechatMpAppSecret();
        if (!appId || !appSecret)
            throw new Error('公众号需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET');
        const token = await getWechatMpAccessToken(appId, appSecret);
        const materialType = ['image', 'voice', 'video', 'news'].includes(String(type ?? '')) ? String(type) : 'image';
        const off = Math.max(0, Number(offset) || 0);
        const cnt = Math.min(20, Math.max(1, Number(count) || 20));
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/material/batchget_material?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: materialType, offset: off, count: cnt }),
            signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json());
        if (data.errcode != null && data.errcode !== 0)
            throw new Error(`获取素材列表失败 [${data.errcode}] ${data.errmsg ?? res.status}`);
        const items = (data.item ?? []).map((i) => ({
            mediaId: i.media_id,
            name: i.name,
            updateTime: i.update_time,
            url: i.url,
            title: i.content?.news_item?.[0]?.title,
        }));
        return {
            type: materialType,
            totalCount: data.total_count ?? 0,
            itemCount: items.length,
            items,
            note: materialType === 'image' ? '返回的 mediaId 可直接作为 addDraft 的 thumbMediaId 使用' : undefined,
        };
    },
    // web-scraper（结构化网页采集）
    'web-scraper#scrape': async ({ url, selectors, extractTables, maxChars, }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            throw new Error('Invalid URL: must start with http:// or https://');
        }
        const res = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok)
            throw new Error(`Fetch failed: ${res.status}`);
        const html = await res.text();
        const $ = (await import('cheerio')).load(html);
        const limit = typeof maxChars === 'number' && maxChars > 0 ? Math.min(maxChars, 100000) : 50000;
        const out = { url: u, status: res.status };
        const sel = selectors;
        if (sel && typeof sel === 'object') {
            const extracted = {};
            for (const [key, selector] of Object.entries(sel)) {
                const els = $(selector);
                if (els.length === 0) {
                    extracted[key] = null;
                }
                else if (els.length === 1) {
                    const el = els.first();
                    const tag = el.prop('tagName')?.toLowerCase();
                    extracted[key] = tag === 'a' ? (el.attr('href') ?? el.text().trim()) : el.text().trim();
                }
                else {
                    extracted[key] = els.map((_, el) => {
                        const e = $(el);
                        return e.prop('tagName')?.toLowerCase() === 'a' ? (e.attr('href') ?? e.text().trim()) : e.text().trim();
                    }).get().slice(0, 100);
                }
            }
            out.extracted = extracted;
        }
        if (extractTables === true) {
            const tables = [];
            $('table').each((_, table) => {
                const rows = [];
                $(table).find('tr').each((__, tr) => {
                    const cells = $(tr).find('th, td').map((___, td) => $(td).text().trim()).get();
                    if (cells.length)
                        rows.push(cells.join(' | '));
                });
                if (rows.length)
                    tables.push(rows);
            });
            out.tables = tables.slice(0, 20);
        }
        if (!out.extracted && !out.tables) {
            const content = extractMainContent(html);
            out.content = content.slice(0, limit);
            out.totalChars = content.length;
        }
        return out;
    },
    // web-fetch-clean
    'web-fetch-clean#fetchClean': async ({ url, maxChars }) => {
        const u = String(url ?? '');
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            throw new Error('Invalid URL: must start with http:// or https://');
        }
        const res = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ApexPanda/1.0)' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok)
            throw new Error(`Fetch failed: ${res.status}`);
        const html = await res.text();
        const content = extractMainContent(html);
        const limit = typeof maxChars === 'number' && maxChars > 0 ? Math.min(maxChars, 100000) : 50000;
        const truncated = content.length > limit;
        return {
            content: content.slice(0, limit),
            totalChars: content.length,
            truncated,
            url: u,
            status: res.status,
        };
    },
    // public-opinion-monitoring（舆情监测：关键词/敏感词检测）
    'public-opinion-monitoring#detect': async ({ text, keywords, sensitive, source, }) => {
        const content = String(text ?? '');
        const parseList = (v) => {
            if (Array.isArray(v))
                return v.map((x) => String(x).trim()).filter(Boolean);
            if (typeof v === 'string')
                return v.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
            return [];
        };
        const kw = parseList(keywords);
        const sen = parseList(sensitive);
        const src = typeof source === 'string' ? source : '粘贴';
        const countMatches = (t, w) => {
            if (!t || !w)
                return [];
            const lower = /[a-zA-Z]/.test(w);
            const tt = lower ? t.toLowerCase() : t;
            const ww = lower ? w.toLowerCase() : w;
            const indices = [];
            let i = 0;
            while ((i = tt.indexOf(ww, i)) !== -1) {
                indices.push(i);
                i += ww.length;
            }
            return indices;
        };
        const extractContext = (t, idx, len, r = 20) => t.slice(Math.max(0, idx - r), Math.min(t.length, idx + len + r)).replace(/\n/g, ' ');
        const keywordHits = kw.map((w) => {
            const indices = countMatches(content, w);
            return {
                word: w,
                count: indices.length,
                firstContext: indices.length ? extractContext(content, indices[0], w.length) : '-',
            };
        });
        const sensitiveHits = sen.map((w) => {
            const indices = countMatches(content, w);
            return {
                word: w,
                count: indices.length,
                firstContext: indices.length ? extractContext(content, indices[0], w.length) : '-',
            };
        });
        const totalKeyword = keywordHits.reduce((s, h) => s + h.count, 0);
        const totalSensitive = sensitiveHits.reduce((s, h) => s + h.count, 0);
        const summary = content.length > 100 ? content.slice(0, 100) + '...' : content;
        const lines = [
            '# 舆情监测报告',
            '',
            '## 监测源',
            `- 来源: ${src}`,
            `- 内容摘要: ${summary}`,
            '',
            '## 监测词表',
            `- 关键词: ${kw.join('、') || '(无)'}`,
            `- 敏感词: ${sen.join('、') || '(无)'}`,
            '',
            '## 检测结果',
            '| 类型 | 词汇 | 命中次数 | 首现位置 |',
            '|------|------|----------|----------|',
        ];
        for (const h of keywordHits)
            lines.push(`| 关键词 | ${h.word} | ${h.count} | ${h.firstContext} |`);
        for (const h of sensitiveHits)
            lines.push(`| 敏感词 | ${h.word} | ${h.count} | ${h.firstContext} |`);
        lines.push('', '## 敏感预警');
        if (totalSensitive > 0) {
            for (const h of sensitiveHits.filter((h) => h.count > 0)) {
                lines.push(`- **${h.word}** 命中 ${h.count} 次，上下文：\`${h.firstContext}\``);
            }
        }
        else {
            lines.push('无敏感词命中。');
        }
        lines.push('', '## 摘要', `- 总字符数: ${content.length}`, `- 关键词命中: ${totalKeyword} 次`, `- 敏感词命中: ${totalSensitive} 次`);
        return { report: lines.join('\n'), totalChars: content.length, keywordHits: totalKeyword, sensitiveHits: totalSensitive };
    },
    // report-daily
    'report-daily#generateDaily': async ({ items, title, date, }) => {
        let arr;
        if (Array.isArray(items)) {
            arr = items;
        }
        else if (typeof items === 'string') {
            try {
                const parsed = JSON.parse(items);
                arr = Array.isArray(parsed) ? parsed : [parsed];
            }
            catch {
                arr = [{ content: items }];
            }
        }
        else {
            arr = items != null ? [items] : [];
        }
        const d = date != null ? new Date(String(date)) : new Date();
        const dateStr = d.toISOString().slice(0, 10);
        const lines = [`# 日报 ${dateStr}`, ''];
        if (title)
            lines.push(`**${String(title)}**`, '');
        lines.push('## 今日工作', '');
        for (const it of arr) {
            if (typeof it === 'string') {
                lines.push(`- ${it}`);
            }
            else if (it && typeof it === 'object') {
                const o = it;
                const task = o.task ?? o.content ?? o.title;
                const status = o.status;
                const notes = o.notes ?? o.note;
                let line = `- ${String(task ?? '')}`;
                if (status)
                    line += ` [${String(status)}]`;
                if (notes)
                    line += `：${String(notes)}`;
                lines.push(line);
            }
        }
        lines.push('', '## 明日计划', '', '- 待补充', '');
        return { report: lines.join('\n'), date: dateStr, itemCount: arr.length };
    },
    'report-daily#generateWeekly': async ({ items, title, period, }) => {
        let arr;
        if (Array.isArray(items)) {
            arr = items;
        }
        else if (typeof items === 'string') {
            try {
                const parsed = JSON.parse(items);
                arr = Array.isArray(parsed) ? parsed : [parsed];
            }
            catch {
                arr = [{ content: items }];
            }
        }
        else {
            arr = items != null ? [items] : [];
        }
        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay() + 1);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const periodStr = period && typeof period === 'string'
            ? period
            : `${weekStart.toISOString().slice(0, 10)} ~ ${weekEnd.toISOString().slice(0, 10)}`;
        const lines = [`# 周报 ${periodStr}`, ''];
        if (title)
            lines.push(`**${String(title)}**`, '');
        lines.push('## 本周完成', '');
        for (const it of arr) {
            if (typeof it === 'string') {
                lines.push(`- ${it}`);
            }
            else if (it && typeof it === 'object') {
                const o = it;
                const task = o.task ?? o.content ?? o.title;
                const day = o.date ?? o.day;
                const status = o.status;
                let line = `- ${String(task ?? '')}`;
                if (day)
                    line += ` (${String(day)})`;
                if (status)
                    line += ` [${String(status)}]`;
                lines.push(line);
            }
        }
        lines.push('', '## 下周计划', '', '- 待补充', '');
        return { report: lines.join('\n'), period: periodStr, itemCount: arr.length };
    },
    // meeting-minutes
    'meeting-minutes#extract': async ({ content }) => {
        const text = String(content ?? '').trim();
        if (!text)
            throw new Error('content is required');
        const conclusions = [];
        const todos = [];
        const nextTopics = [];
        let section = '';
        for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (!t)
                continue;
            if (/^#{1,3}\s*(结论|决定|决议|共识)/i.test(t) || /^(结论|决定)[：:]/i.test(t)) {
                section = 'conclusions';
            }
            else if (/^#{1,3}\s*(待办|TODO|行动项|任务)/i.test(t) || /^(待办|TODO|行动项)[：:]/i.test(t)) {
                section = 'todos';
            }
            else if (/^#{1,3}\s*(下次|下期|遗留|后续)/i.test(t) || /^(下次|下期)[：:]/i.test(t)) {
                section = 'next';
            }
            else if (/^[-*•]\s/.test(t) && section) {
                const item = t.replace(/^[-*•]\s*/, '').trim();
                if (item) {
                    if (section === 'conclusions')
                        conclusions.push(item);
                    else if (section === 'todos')
                        todos.push({ task: item });
                    else
                        nextTopics.push(item);
                }
            }
        }
        if (conclusions.length === 0 && todos.length === 0 && nextTopics.length === 0) {
            const paras = text.split(/\n\n+/).filter((p) => p.length > 15);
            conclusions.push(...paras.slice(0, 5));
        }
        return { conclusions, todos, nextTopics };
    },
    'meeting-minutes#format': async ({ conclusions, todos, nextTopics, title, }) => {
        const conc = Array.isArray(conclusions) ? conclusions : conclusions != null ? [String(conclusions)] : [];
        const todoArr = Array.isArray(todos) ? todos : todos != null ? [typeof todos === 'object' ? todos : { task: String(todos) }] : [];
        const next = Array.isArray(nextTopics) ? nextTopics : nextTopics != null ? [String(nextTopics)] : [];
        const lines = ['# 会议纪要', ''];
        if (title)
            lines.push(`**${String(title)}**`, '');
        lines.push('## 核心结论与决策', '');
        for (const c of conc)
            lines.push(`- ${typeof c === 'string' ? c : String(c)}`);
        lines.push('', '## 待办事项', '');
        for (const t of todoArr) {
            const o = typeof t === 'object' && t ? t : { task: String(t) };
            let item = `- ${String(o.task ?? o.content ?? '')}`;
            if (o.owner)
                item += ` (@${o.owner})`;
            if (o.due)
                item += ` 截止：${o.due}`;
            lines.push(item);
        }
        lines.push('', '## 下次会议议题', '');
        for (const n of next)
            lines.push(`- ${typeof n === 'string' ? n : String(n)}`);
        return { minutes: lines.join('\n'), conclusions: conc.length, todos: todoArr.length, nextTopics: next.length };
    },
    // workflow-creator (Phase 3: Agent 调用创建工作流)
    'workflow-creator#create_from_template': async ({ templateId, name, cron, }) => {
        const { getWorkflowTemplateMerged } = await import('../workflow/templates.js');
        const { createWorkflow } = await import('../workflow/store.js');
        const { refreshWorkflowCronScheduler } = await import('../workflow/scheduler.js');
        const id = String(templateId ?? '').trim();
        if (!id)
            throw new Error('templateId 必填');
        const tpl = await getWorkflowTemplateMerged(id);
        if (!tpl)
            throw new Error(`模板 ${id} 不存在`);
        const triggers = [];
        triggers.push({ type: 'message', command: '/workflow', enabled: true });
        if (cron && String(cron).trim()) {
            try {
                const cronMod = await import('node-cron');
                if (cronMod.validate(String(cron).trim())) {
                    triggers.push({ type: 'cron', expression: String(cron).trim(), enabled: true });
                }
            }
            catch {
                /* invalid cron */
            }
        }
        const w = await createWorkflow({
            name: (name != null && String(name).trim()) ? String(name).trim() : tpl.name,
            description: tpl.description,
            nodes: tpl.nodes,
            edges: tpl.edges,
            triggers,
        });
        await refreshWorkflowCronScheduler();
        return { ok: true, workflowId: w.id, name: w.name };
    },
    'workflow-creator#create_custom': async ({ name, description, nodes: nodesRaw, edges: edgesRaw, triggers: triggersRaw, }) => {
        const { createWorkflow } = await import('../workflow/store.js');
        const { refreshWorkflowCronScheduler } = await import('../workflow/scheduler.js');
        const { loadAllSkills } = await import('./registry.js');
        const { listAgents } = await import('../agent/store.js');
        const n = String(name ?? '').trim();
        if (!n)
            throw new Error('name 必填');
        let nodes;
        let edges;
        try {
            nodes = Array.isArray(nodesRaw) ? nodesRaw : typeof nodesRaw === 'string' ? JSON.parse(nodesRaw) : [];
            edges = Array.isArray(edgesRaw) ? edgesRaw : typeof edgesRaw === 'string' ? JSON.parse(edgesRaw) : [];
        }
        catch (e) {
            throw new Error(`nodes/edges 格式错误：${e instanceof Error ? e.message : String(e)}`);
        }
        if (!nodes.length)
            throw new Error('nodes 至少需要 1 个节点');
        const skills = await loadAllSkills();
        const agents = await listAgents();
        const nodeIds = new Set();
        for (const node of nodes) {
            const id = node?.id;
            if (!id || typeof id !== 'string')
                throw new Error(`节点缺少 id`);
            if (nodeIds.has(id))
                throw new Error(`重复节点 id: ${id}`);
            nodeIds.add(id);
            const type = node?.type;
            if (!['agent', 'skill', 'human'].includes(type))
                throw new Error(`节点 ${id} type 需为 agent/skill/human`);
            const cfg = node?.config ?? {};
            if (type === 'skill') {
                const sn = cfg.skillName;
                const tid = cfg.toolId;
                if (!sn || !tid)
                    throw new Error(`skill 节点 ${id} 需 config.skillName 和 config.toolId`);
                const sk = skills.find((s) => s.name === sn);
                if (!sk)
                    throw new Error(`Skill ${sn} 不存在`);
                const tool = sk.manifest.tools?.find((t) => t.id === tid);
                if (!tool)
                    throw new Error(`Skill ${sn} 无工具 ${tid}`);
            }
            if (type === 'agent' && cfg.agentId) {
                const aid = cfg.agentId;
                if (!agents.some((a) => a.id === aid))
                    throw new Error(`Agent ${aid} 不存在`);
            }
        }
        for (const e of edges) {
            if (!nodeIds.has(e.from))
                throw new Error(`边 from "${e.from}" 无对应节点`);
            if (!nodeIds.has(e.to))
                throw new Error(`边 to "${e.to}" 无对应节点`);
        }
        const validatedNodes = nodes.map((node) => ({
            id: node.id,
            type: (['agent', 'skill', 'human'].includes(node.type) ? node.type : 'agent'),
            config: node.config ?? {},
        }));
        let triggers;
        if (Array.isArray(triggersRaw) && triggersRaw.length > 0) {
            triggers = triggersRaw
                .filter((t) => t && typeof t === 'object' && t.type)
                .map((t) => t);
        }
        const w = await createWorkflow({
            name: n,
            description: typeof description === 'string' ? description : undefined,
            nodes: validatedNodes,
            edges,
            triggers,
        });
        await refreshWorkflowCronScheduler();
        return { ok: true, workflowId: w.id, name: w.name };
    },
    // markdown
    'markdown#toHtml': async ({ content }) => {
        const md = String(content ?? '');
        const { marked } = await import('marked');
        const html = await marked.parse(md);
        return { html: typeof html === 'string' ? html : String(html ?? '') };
    },
    'markdown#toPlain': async ({ content }) => {
        const md = String(content ?? '');
        const { marked } = await import('marked');
        const html = await marked.parse(md);
        const htmlStr = typeof html === 'string' ? html : String(html ?? '');
        const plain = stripHtml(htmlStr);
        return { plain };
    },
    // shell-exec：增强版命令行，工作目录、环境变量、后台任务
    'shell-exec#run': async ({ command, cwd, env, background }, ctx) => {
        const cmd = String(command ?? '').trim();
        if (!cmd)
            throw new Error('command is required');
        const workDir = ctx?.workspaceDir ?? getWorkspaceDir();
        let resolvedCwd;
        if (cwd) {
            const cwdStr = String(cwd).trim();
            const isAbsolute = cwdStr.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwdStr);
            if (isAbsolute) {
                resolvedCwd = resolve(cwdStr);
                if (!isFullControl()) {
                    const allowed = process.env.APEXPANDA_SHELL_CWD_ALLOWED;
                    if (allowed) {
                        const prefixes = allowed.split(/[,;\n]/).map((p) => resolve(p.trim())).filter(Boolean);
                        const ok = prefixes.some((p) => resolvedCwd === p || resolvedCwd.startsWith(p + sep));
                        if (!ok)
                            throw new Error(`cwd ${resolvedCwd} is not in APEXPANDA_SHELL_CWD_ALLOWED. Set APEXPANDA_FULL_CONTROL=true to allow any cwd.`);
                    }
                }
            }
            else {
                resolvedCwd = resolve(workDir, cwdStr);
            }
        }
        else {
            resolvedCwd = workDir;
        }
        const envVars = env && typeof env === 'object' ? env : undefined;
        const mergeEnv = envVars ? { ...process.env, ...envVars } : process.env;
        // 删除二次确认：拦截 rm/del/Remove-Item/rd/rmdir 等删除命令，仅 user/channel 来源需确认
        const isDeleteCommand = /\b(Remove-Item|del\b|rd\b|rmdir\b|rm\b)/i.test(cmd);
        const source = ctx?.deleteSource ?? 'agent';
        const needConfirm = (source === 'user' || source === 'channel') && getDeleteConfirmRequired() && isDeleteCommand && !background;
        if (needConfirm) {
            return {
                _pendingDelete: true,
                type: 'shell',
                command: cmd,
                cwd: resolvedCwd,
                env: envVars,
                message: `即将执行删除命令，需用户确认后执行`,
            };
        }
        const timeout = 60000;
        const shellArgs = process.platform === 'win32'
            ? ['-NoProfile', '-NonInteractive', '-Command', cmd]
            : ['-c', cmd];
        const shellBin = process.platform === 'win32' ? 'powershell' : 'sh';
        if (background) {
            const taskId = randomUUID();
            const proc = spawn(shellBin, shellArgs, {
                cwd: resolvedCwd,
                env: mergeEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const bgData = { proc, stdout: '', stderr: '', startTime: Date.now(), command: cmd };
            proc.stdout?.on('data', (d) => { bgData.stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { bgData.stderr += d.toString(); });
            proc.on('close', (code) => {
                bgData.proc = null;
                bgData.exitCode = code ?? undefined;
            });
            proc.on('error', () => { });
            backgroundTasks.set(taskId, bgData);
            return { taskId, started: true, message: 'Task running in background. Use shell-exec#taskStatus to check.' };
        }
        const result = await new Promise((resolve, reject) => {
            const proc = spawn(shellBin, shellArgs, {
                cwd: resolvedCwd,
                env: mergeEnv,
                timeout,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code, sig) => resolve({ stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 3000), exitCode: code }));
            proc.on('error', (e) => reject(e));
        });
        return { stdout: result.stdout || null, stderr: result.stderr || null, exitCode: result.exitCode, ok: result.exitCode === 0 };
    },
    'shell-exec#taskStatus': async ({ taskId }) => {
        const id = String(taskId ?? '');
        if (!id)
            throw new Error('taskId is required');
        const bg = backgroundTasks.get(id);
        if (!bg)
            return { taskId: id, status: 'unknown', error: 'Task not found or already finished' };
        const proc = bg.proc;
        const running = proc != null && proc.exitCode == null;
        const exitCode = bg.exitCode;
        return {
            taskId: id,
            status: running ? 'running' : 'finished',
            exitCode: exitCode ?? null,
            stdout: bg.stdout.slice(-3000),
            stderr: bg.stderr.slice(-1000),
            durationMs: Date.now() - bg.startTime,
        };
    },
    'shell-exec#taskKill': async ({ taskId }) => {
        const id = String(taskId ?? '');
        if (!id)
            throw new Error('taskId is required');
        const bg = backgroundTasks.get(id);
        if (!bg)
            return { taskId: id, killed: false, error: 'Task not found or already finished' };
        const proc = bg.proc;
        if (proc && proc.exitCode == null) {
            proc.kill('SIGTERM');
            return { taskId: id, killed: true };
        }
        backgroundTasks.delete(id);
        return { taskId: id, killed: false };
    },
    'shell-exec#taskList': async () => {
        const list = [];
        for (const [id, bg] of backgroundTasks) {
            const running = bg.proc != null && bg.proc.exitCode == null;
            list.push({
                taskId: id,
                status: running ? 'running' : 'finished',
                command: bg.command.slice(0, 200),
                durationMs: Date.now() - bg.startTime,
                exitCode: bg.exitCode,
            });
        }
        return { tasks: list, count: list.length };
    },
    'shell-exec#taskLog': async ({ taskId, offset, limit }) => {
        const id = String(taskId ?? '');
        if (!id)
            throw new Error('taskId is required');
        const bg = backgroundTasks.get(id);
        if (!bg)
            return { taskId: id, error: 'Task not found or already finished' };
        const off = Number(offset) || 0;
        const lim = Math.min(Number(limit) || 100, 2000);
        const lines = (bg.stdout + '\n' + bg.stderr).split('\n');
        const start = Math.max(0, off);
        const slice = lines.slice(start, start + lim);
        return {
            taskId: id,
            lines: slice,
            totalLines: lines.length,
            offset: start,
            limit: slice.length,
        };
    },
    'shell-exec#taskClear': async ({ taskId }) => {
        const id = String(taskId ?? '');
        if (!id)
            throw new Error('taskId is required');
        const bg = backgroundTasks.get(id);
        if (!bg)
            return { taskId: id, cleared: false, error: 'Task not found' };
        const running = bg.proc != null && bg.proc.exitCode == null;
        if (running)
            return { taskId: id, cleared: false, error: 'Cannot clear running task, kill it first' };
        backgroundTasks.delete(id);
        return { taskId: id, cleared: true };
    },
    // browser-automation：基于 Playwright 的浏览器自动化，模拟键盘鼠标
    'browser-automation#runSteps': async ({ steps, persistent }, ctx) => {
        const stepList = Array.isArray(steps) ? steps : [];
        if (stepList.length === 0)
            throw new Error('steps is required (array of action objects)');
        const usePersistent = persistent === true && ctx?.sessionId;
        let browser;
        let context;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let page;
        if (usePersistent) {
            const ses = await getOrCreateBrowserSession(ctx.sessionId, true);
            browser = ses.browser;
            context = ses.context;
            page = getActivePage(ses);
        }
        else {
            const { chromium } = await import('playwright');
            try {
                const b = await chromium.launch({ headless: true });
                const c = await b.newContext({ ignoreHTTPSErrors: true });
                page = await c.newPage();
                browser = b;
                context = c;
            }
            catch (e) {
                throw wrapBrowserError(e);
            }
        }
        const results = [];
        try {
            for (let i = 0; i < stepList.length; i++) {
                if (usePersistent) {
                    const ses = browserSessions.get(ctx.sessionId);
                    if (ses)
                        page = getActivePage(ses);
                }
                const step = stepList[i];
                const action = String(step?.action ?? '');
                const timeout = typeof step.timeout === 'number' ? Math.min(step.timeout, 30000) : 10000;
                switch (action) {
                    case 'navigate': {
                        const url = String(step.url ?? '');
                        if (!url.startsWith('http'))
                            throw new Error(`Step ${i + 1}: navigate requires valid url`);
                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
                        results.push({ action: 'navigate', url, success: true });
                        break;
                    }
                    case 'snapshot': {
                        const snapshot = await page.evaluate(() => {
                            const items = [];
                            for (const el of document.querySelectorAll('a, button, input, select, textarea, [role="button"]')) {
                                const e = el;
                                const tag = e.tagName.toLowerCase();
                                const sel = e.id ? `#${e.id}` : (e.getAttribute('data-testid') ? `[data-testid="${e.getAttribute('data-testid')}"]` : tag);
                                const text = (e.textContent || e.value || e.placeholder || '').trim().slice(0, 80);
                                items.push({ tag, selector: sel, text: text || undefined, type: e.type || undefined });
                            }
                            return JSON.stringify(items.slice(0, 100));
                        });
                        results.push({ action: 'snapshot', content: String(snapshot).slice(0, 8000) });
                        break;
                    }
                    case 'click': {
                        const sel = String(step.selector ?? '');
                        if (!sel)
                            throw new Error(`Step ${i + 1}: click requires selector`);
                        await page.click(sel, { timeout });
                        results.push({ action: 'click', selector: sel, success: true });
                        break;
                    }
                    case 'fill': {
                        const sel = String(step.selector ?? '');
                        const value = String(step.value ?? '');
                        if (!sel)
                            throw new Error(`Step ${i + 1}: fill requires selector`);
                        await page.fill(sel, value, { timeout });
                        results.push({ action: 'fill', selector: sel, success: true });
                        break;
                    }
                    case 'type': {
                        const sel = String(step.selector ?? '');
                        const value = String(step.value ?? '');
                        if (!sel)
                            throw new Error(`Step ${i + 1}: type requires selector`);
                        await page.locator(sel).pressSequentially(value, { delay: 50 });
                        results.push({ action: 'type', selector: sel, success: true });
                        break;
                    }
                    case 'press': {
                        const key = String(step.key ?? '');
                        if (!key)
                            throw new Error(`Step ${i + 1}: press requires key`);
                        await page.keyboard.press(key);
                        results.push({ action: 'press', key, success: true });
                        break;
                    }
                    case 'scroll': {
                        const direction = String(step.direction ?? 'down');
                        const amount = typeof step.amount === 'number' ? step.amount : 300;
                        if (direction === 'up')
                            await page.mouse.wheel(0, -amount);
                        else if (direction === 'down')
                            await page.mouse.wheel(0, amount);
                        else if (direction === 'left')
                            await page.mouse.wheel(-amount, 0);
                        else
                            await page.mouse.wheel(amount, 0);
                        results.push({ action: 'scroll', direction, success: true });
                        break;
                    }
                    case 'screenshot': {
                        const buf = await page.screenshot({ type: 'png' });
                        const base64 = buf.toString('base64');
                        results.push({ action: 'screenshot', imageBase64: base64, mimeType: 'image/png' });
                        break;
                    }
                    case 'waitForSelector': {
                        const sel = String(step.selector ?? '');
                        if (!sel)
                            throw new Error(`Step ${i + 1}: waitForSelector requires selector`);
                        await page.waitForSelector(sel, { timeout });
                        results.push({ action: 'waitForSelector', selector: sel, success: true });
                        break;
                    }
                    case 'newTab': {
                        if (!usePersistent)
                            throw new Error('newTab requires persistent=true');
                        const ses = await getOrCreateBrowserSession(ctx.sessionId, true);
                        const newPage = await ses.context.newPage();
                        ses.pages.push(newPage);
                        ses.activeIndex = ses.pages.length - 1;
                        ses.page = newPage;
                        results.push({ action: 'newTab', tabIndex: ses.pages.length - 1, tabCount: ses.pages.length, success: true });
                        break;
                    }
                    case 'switchTab': {
                        if (!usePersistent)
                            throw new Error('switchTab requires persistent=true');
                        const tabIdx = Math.floor(Number(step.tabIndex ?? step.index ?? 0));
                        const ses = await getOrCreateBrowserSession(ctx.sessionId, true);
                        if (tabIdx < 0 || tabIdx >= ses.pages.length) {
                            results.push({ action: 'switchTab', error: `tabIndex ${tabIdx} out of range (0-${ses.pages.length - 1})` });
                        }
                        else {
                            ses.activeIndex = tabIdx;
                            ses.page = ses.pages[tabIdx];
                            results.push({ action: 'switchTab', tabIndex: tabIdx, success: true });
                        }
                        break;
                    }
                    default:
                        results.push({ action, error: `Unknown action: ${action}` });
                }
            }
            if (!usePersistent)
                await context.close();
        }
        finally {
            if (!usePersistent)
                await browser.close();
        }
        return { steps: results, persistent: usePersistent };
    },
    'browser-automation#navigateAndSnapshot': async ({ url, persistent }, ctx) => {
        const u = String(url ?? '');
        if (!u.startsWith('http'))
            throw new Error('url must start with http:// or https://');
        const usePersistent = persistent === true && ctx?.sessionId;
        let browser;
        let page;
        if (usePersistent) {
            const ses = await getOrCreateBrowserSession(ctx.sessionId, true);
            browser = ses.browser;
            page = getActivePage(ses);
        }
        else {
            const { chromium } = await import('playwright');
            try {
                const b = await chromium.launch({ headless: true });
                page = await b.newPage();
                browser = b;
            }
            catch (e) {
                throw wrapBrowserError(e);
            }
        }
        try {
            await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const snapshot = await page.evaluate(() => {
                const items = [];
                for (const el of document.querySelectorAll('a, button, input, select, textarea, [role="button"]')) {
                    const e = el;
                    const tag = e.tagName.toLowerCase();
                    const id = e.id ? `#${e.id}` : '';
                    const name = (e.getAttribute('name') && !id) ? `[name="${e.getAttribute('name')}"]` : '';
                    const selector = tag + id + name || `[data-testid="${e.getAttribute('data-testid')}"]`;
                    const text = (e.textContent || e.value || e.placeholder || '').trim().slice(0, 80);
                    items.push({ tag, id: e.id || undefined, text: text || undefined, selector });
                }
                return JSON.stringify(items.slice(0, 150), null, 0);
            });
            if (!usePersistent)
                await browser.close();
            return { url: u, snapshot: String(snapshot).slice(0, 15000), persistent: usePersistent };
        }
        catch (e) {
            if (!usePersistent)
                await browser.close();
            throw e;
        }
    },
    'browser-automation#screenshot': async ({ url, persistent }, ctx) => {
        const u = String(url ?? '');
        if (!u.startsWith('http'))
            throw new Error('url must start with http:// or https://');
        const usePersistent = persistent === true && ctx?.sessionId;
        let browser;
        let page;
        if (usePersistent) {
            const ses = await getOrCreateBrowserSession(ctx.sessionId, true);
            browser = ses.browser;
            page = getActivePage(ses);
        }
        else {
            const { chromium } = await import('playwright');
            try {
                const b = await chromium.launch({ headless: true });
                page = await b.newPage();
                browser = b;
            }
            catch (e) {
                throw wrapBrowserError(e);
            }
        }
        try {
            await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const buf = await page.screenshot({ type: 'png', fullPage: false });
            if (!usePersistent)
                await browser.close();
            const bwSsDir = join(getWorkspaceDir(), 'screenshots');
            await mkdir(bwSsDir, { recursive: true });
            const bwSsPath = join(bwSsDir, `screenshot-browser-${Date.now()}.png`);
            await writeFile(bwSsPath, buf);
            return { _fileReply: true, fileType: 'image', filePath: bwSsPath, mimeType: 'image/png', caption: `${u} 页面截图` };
        }
        catch (e) {
            if (!usePersistent)
                await browser.close();
            throw e;
        }
    },
    'browser-automation#closeSession': async (_params, ctx) => {
        const sid = ctx?.sessionId;
        if (!sid)
            throw new Error('closeSession requires session context (chat session)');
        await closeBrowserSession(sid);
        return { sessionId: sid, closed: true };
    },
    // desktop-automation：OS 级键盘鼠标，控制任意桌面应用
    'desktop-automation#type': async ({ text }) => {
        const { keyboard } = await import('@nut-tree-fork/nut-js');
        const t = String(text ?? '');
        if (!t)
            throw new Error('text is required');
        await keyboard.type(t);
        return { typed: t.length, success: true };
    },
    'desktop-automation#keyTap': async ({ key, modifiers }) => {
        const { keyboard } = await import('@nut-tree-fork/nut-js');
        const { Key } = await import('@nut-tree-fork/shared');
        const keyMap = {
            Enter: Key.Return, Return: Key.Return, Tab: Key.Tab, Space: Key.Space,
            Escape: Key.Escape, Backspace: Key.Backspace, Delete: Key.Delete,
            Up: Key.Up, Down: Key.Down, Left: Key.Left, Right: Key.Right,
            Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
            Control: Key.LeftControl, Ctrl: Key.LeftControl, Alt: Key.LeftAlt,
            Shift: Key.LeftShift, Meta: Key.LeftSuper, Win: Key.LeftWin, Cmd: Key.LeftCmd,
            a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E, f: Key.F, g: Key.G, h: Key.H,
            i: Key.I, j: Key.J, k: Key.K, l: Key.L, m: Key.M, n: Key.N, o: Key.O, p: Key.P,
            q: Key.Q, r: Key.R, s: Key.S, t: Key.T, u: Key.U, v: Key.V, w: Key.W, x: Key.X,
            y: Key.Y, z: Key.Z,
        };
        const modArr = Array.isArray(modifiers) ? modifiers.map(String) : modifiers ? [String(modifiers)] : [];
        const mainKey = String(key ?? '').trim();
        if (!mainKey)
            throw new Error('key is required (e.g. Enter, Tab, c)');
        const keyCodes = [];
        for (const m of modArr) {
            const k = keyMap[String(m).toLowerCase()] ?? keyMap[String(m)] ?? 0;
            if (k)
                keyCodes.push(k);
        }
        const mainCode = keyMap[mainKey.toLowerCase()] ?? keyMap[mainKey] ?? 0;
        keyCodes.push(mainCode || mainKey.charCodeAt(0));
        if (keyCodes.length === 1 && mainCode) {
            await keyboard.pressKey(keyCodes[0]);
            await keyboard.releaseKey(keyCodes[0]);
        }
        else if (keyCodes.length > 1) {
            await keyboard.pressKey(...keyCodes);
            await keyboard.releaseKey(...keyCodes);
        }
        else {
            await keyboard.type(mainKey);
        }
        return { success: true };
    },
    'desktop-automation#mouseMove': async ({ x, y }) => {
        const { mouse } = await import('@nut-tree-fork/nut-js');
        const px = Math.floor(Number(x) ?? 0);
        const py = Math.floor(Number(y) ?? 0);
        await mouse.setPosition({ x: px, y: py });
        return { x: px, y: py, success: true };
    },
    'desktop-automation#mouseClick': async ({ x, y, button = 'left', clicks = 1 }) => {
        const { mouse } = await import('@nut-tree-fork/nut-js');
        const { Button } = await import('@nut-tree-fork/shared');
        const btn = String(button).toLowerCase() === 'right' ? Button.RIGHT : Button.LEFT;
        if (x != null && y != null) {
            await mouse.setPosition({ x: Number(x), y: Number(y) });
        }
        for (let i = 0; i < Math.min(Number(clicks) || 1, 3); i++) {
            await mouse.click(btn);
        }
        return { success: true };
    },
    'desktop-automation#mouseScroll': async ({ direction = 'down', amount = 3 }) => {
        const { mouse } = await import('@nut-tree-fork/nut-js');
        const amt = Math.min(Math.max(1, Math.floor(Number(amount) ?? 3)), 50);
        if (String(direction).toLowerCase() === 'up') {
            await mouse.scrollUp(amt);
        }
        else {
            await mouse.scrollDown(amt);
        }
        return { direction, amount: amt, success: true };
    },
    'desktop-automation#mouseDrag': async ({ from, to, fromX, fromY, toX, toY }) => {
        const { mouse } = await import('@nut-tree-fork/nut-js');
        const f = from;
        const t = to;
        const x1 = f?.x ?? Number(fromX ?? 0);
        const y1 = f?.y ?? Number(fromY ?? 0);
        const x2 = t?.x ?? Number(toX ?? 0);
        const y2 = t?.y ?? Number(toY ?? 0);
        const path = [{ x: Math.floor(x1), y: Math.floor(y1) }, { x: Math.floor(x2), y: Math.floor(y2) }];
        await mouse.drag(path);
        return { from: path[0], to: path[1], success: true };
    },
    // remote-exec：SSH 远程执行
    'remote-exec#run': async ({ host, command, username = 'root', password, privateKey, port = 22, timeout, outputFile, }) => {
        const { Client } = await import('ssh2');
        const h = String(host ?? process.env.APEXPANDA_REMOTE_DEFAULT_HOST ?? '');
        let cmd = String(command ?? '');
        if (!h || !cmd)
            throw new Error('host and command are required');
        const outPath = typeof outputFile === 'string' && outputFile.trim() ? outputFile.trim() : '';
        if (outPath)
            cmd = `( ${cmd} ) > ${outPath} 2>&1`;
        const user = String(username ?? process.env.APEXPANDA_REMOTE_DEFAULT_USER ?? 'root');
        const pass = password != null ? String(password) : process.env.APEXPANDA_REMOTE_DEFAULT_PASSWORD;
        const pk = privateKey != null ? String(privateKey) : process.env.APEXPANDA_REMOTE_DEFAULT_PRIVATEKEY;
        const timeoutMs = typeof timeout === 'number' && timeout > 0 ? timeout : 120_000;
        const conn = new Client();
        const execPromise = new Promise((resolve, reject) => {
            conn
                .on('ready', () => {
                conn.exec(cmd, (err, stream) => {
                    if (err || !stream) {
                        conn.end();
                        return reject(err ?? new Error('No stream'));
                    }
                    let stdout = '';
                    let stderr = '';
                    stream.on('close', (code) => {
                        conn.end();
                        resolve({ stdout, stderr, exitCode: code });
                    }).on('data', (d) => { stdout += d.toString(); }).stderr.on('data', (d) => { stderr += d.toString(); });
                });
            })
                .on('error', reject)
                .connect({
                host: h,
                port: Number(port) || 22,
                username: user,
                password: pass || undefined,
                privateKey: pk || undefined,
            });
        });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => {
            conn.end();
            reject(new Error(`Remote exec timeout after ${timeoutMs}ms`));
        }, timeoutMs));
        const result = await Promise.race([execPromise, timeoutPromise]);
        const outLimit = 50_000;
        const errLimit = 10_000;
        if (outPath) {
            return { exitCode: result.exitCode, ok: result.exitCode === 0, outputFile: outPath, message: `Output written to ${outPath}, use remote-exec#download to fetch` };
        }
        return { stdout: result.stdout.slice(0, outLimit), stderr: result.stderr.slice(0, errLimit), exitCode: result.exitCode, ok: result.exitCode === 0 };
    },
    'remote-exec#runScript': async ({ host, script, username = 'root', password, privateKey, port = 22, timeout, }) => {
        const { Client } = await import('ssh2');
        const h = String(host ?? process.env.APEXPANDA_REMOTE_DEFAULT_HOST ?? '');
        const scr = String(script ?? '');
        if (!h || !scr)
            throw new Error('host and script are required');
        const user = String(username ?? process.env.APEXPANDA_REMOTE_DEFAULT_USER ?? 'root');
        const pass = password != null ? String(password) : process.env.APEXPANDA_REMOTE_DEFAULT_PASSWORD;
        const pk = privateKey != null ? String(privateKey) : process.env.APEXPANDA_REMOTE_DEFAULT_PRIVATEKEY;
        const timeoutMs = typeof timeout === 'number' && timeout > 0 ? timeout : 300_000;
        const remotePath = `/tmp/apexpanda-${randomUUID()}.sh`;
        const conn = new Client();
        const runPromise = new Promise((resolve, reject) => {
            conn
                .on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }
                    const ws = sftp.createWriteStream(remotePath, { mode: 0o700 });
                    ws.on('close', () => {
                        conn.exec(`bash ${remotePath}`, (e, stream) => {
                            if (e || !stream) {
                                conn.end();
                                return reject(e ?? new Error('No stream'));
                            }
                            let stdout = '';
                            let stderr = '';
                            stream.on('close', (code) => {
                                conn.end();
                                resolve({ stdout, stderr, exitCode: code });
                            }).on('data', (d) => { stdout += d.toString(); }).stderr.on('data', (d) => { stderr += d.toString(); });
                        });
                    }).on('error', reject);
                    ws.write(scr, 'utf-8');
                    ws.end();
                });
            })
                .on('error', reject)
                .connect({
                host: h,
                port: Number(port) || 22,
                username: user,
                password: pass || undefined,
                privateKey: pk || undefined,
            });
        });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => {
            conn.end();
            reject(new Error(`Remote runScript timeout after ${timeoutMs}ms`));
        }, timeoutMs));
        const result = await Promise.race([runPromise, timeoutPromise]);
        const outLimit = 50_000;
        const errLimit = 10_000;
        return { stdout: result.stdout.slice(0, outLimit), stderr: result.stderr.slice(0, errLimit), exitCode: result.exitCode, ok: result.exitCode === 0 };
    },
    'remote-exec#runMultiple': async ({ hosts, command }) => {
        const hostList = Array.isArray(hosts) ? hosts : [];
        const cmd = String(command ?? '');
        if (hostList.length === 0 || !cmd)
            throw new Error('hosts (array) and command are required');
        const { Client } = await import('ssh2');
        const runOne = (cfg) => new Promise((resolve, reject) => {
            const conn = new Client();
            const h = String(cfg.host ?? '');
            conn
                .on('ready', () => {
                conn.exec(cmd, (err, stream) => {
                    if (err || !stream) {
                        conn.end();
                        return resolve({ host: h, stdout: '', stderr: err?.message ?? 'No stream', exitCode: -1 });
                    }
                    let stdout = '';
                    let stderr = '';
                    stream.on('close', (code) => {
                        conn.end();
                        resolve({ host: h, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 1000), exitCode: code });
                    }).on('data', (d) => { stdout += d.toString(); }).stderr.on('data', (d) => { stderr += d.toString(); });
                });
            })
                .on('error', (e) => resolve({ host: h, stdout: '', stderr: e.message, exitCode: -1 }))
                .connect({
                host: h,
                port: Number(cfg.port) || 22,
                username: String(cfg.username ?? 'root'),
                password: cfg.password ? String(cfg.password) : undefined,
                privateKey: cfg.privateKey ? String(cfg.privateKey) : undefined,
            });
        });
        const results = await Promise.all(hostList.map((c) => runOne(typeof c === 'string' ? { host: c } : c)));
        return { results };
    },
    'remote-exec#upload': async ({ host, localPath, remotePath, username = 'root', password, privateKey, port = 22, }, ctx) => {
        const { Client } = await import('ssh2');
        const h = String(host ?? '');
        const lp = String(localPath ?? '');
        const rp = String(remotePath ?? '');
        if (!h || !lp || !rp)
            throw new Error('host, localPath, and remotePath are required');
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const localFull = resolveWorkspacePath(ws, lp);
        const conn = new Client();
        await new Promise((resolve, reject) => {
            conn
                .on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }
                    sftp.fastPut(localFull, rp, (e) => {
                        conn.end();
                        if (e)
                            reject(e);
                        else
                            resolve();
                    });
                });
            })
                .on('error', reject)
                .connect({
                host: h,
                port: Number(port) || 22,
                username: String(username ?? 'root'),
                password: password ? String(password) : undefined,
                privateKey: privateKey ? String(privateKey) : undefined,
            });
        });
        return { localPath: lp, remotePath: rp, success: true };
    },
    'remote-exec#download': async ({ host, remotePath, localPath, username = 'root', password, privateKey, port = 22, }, ctx) => {
        const { Client } = await import('ssh2');
        const h = String(host ?? '');
        const rp = String(remotePath ?? '');
        const lp = String(localPath ?? '');
        if (!h || !rp || !lp)
            throw new Error('host, remotePath, and localPath are required');
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const localFull = resolveWorkspacePath(ws, lp);
        await mkdir(dirname(localFull), { recursive: true });
        const conn = new Client();
        await new Promise((resolve, reject) => {
            conn
                .on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }
                    sftp.fastGet(rp, localFull, (e) => {
                        conn.end();
                        if (e)
                            reject(e);
                        else
                            resolve();
                    });
                });
            })
                .on('error', reject)
                .connect({
                host: h,
                port: Number(port) || 22,
                username: String(username ?? 'root'),
                password: password ? String(password) : undefined,
                privateKey: privateKey ? String(privateKey) : undefined,
            });
        });
        return { remotePath: rp, localPath: lp, success: true };
    },
    // pentest-runner：渗透测试执行封装
    'pentest-runner#installTools': async ({ host, tools, username = 'root', password, privateKey, port = 22, timeout = 300_000 }, ctx) => {
        const toolList = Array.isArray(tools) ? tools.filter(Boolean) : [];
        if (!host || toolList.length === 0)
            throw new Error('host and tools (array) are required');
        const TOOL_INSTALL = {
            nmap: 'apt-get update -qq && apt-get install -y nmap',
            nikto: 'apt-get update -qq && apt-get install -y nikto',
            gobuster: 'apt-get update -qq && apt-get install -y gobuster',
            sqlmap: 'apt-get update -qq && (apt-get install -y sqlmap 2>/dev/null || pip3 install -q sqlmap)',
            dirb: 'apt-get update -qq && apt-get install -y dirb',
            hydra: 'apt-get update -qq && apt-get install -y hydra',
            whatweb: 'apt-get update -qq && apt-get install -y whatweb',
            wpscan: 'apt-get update -qq && apt-get install -y wpscan',
            masscan: 'apt-get update -qq && apt-get install -y masscan',
        };
        const lines = toolList.map((t) => {
            const cmd = TOOL_INSTALL[t.toLowerCase()] ?? `apt-get update -qq && apt-get install -y ${t}`;
            return `if ! command -v ${t} &>/dev/null; then ${cmd}; fi`;
        });
        const script = ['#!/bin/bash', 'set -e', 'export DEBIAN_FRONTEND=noninteractive', ...lines, 'echo "Install check done"'].join('\n');
        const { invokeTool } = await import('./registry.js');
        const r = await invokeTool('remote-exec', 'runScript', {
            host,
            script,
            username,
            password,
            privateKey,
            port,
            timeout,
        }, { sessionId: ctx?.sessionId, memoryScopeHint: ctx?.memoryScopeHint, agentId: ctx?.agentId });
        return r;
    },
    'pentest-runner#runPlan': async ({ host, steps, username = 'root', password, privateKey, port = 22 }, ctx) => {
        const stepList = Array.isArray(steps) ? steps : [];
        if (!host || stepList.length === 0)
            throw new Error('host and steps (array) are required');
        const { invokeTool } = await import('./registry.js');
        const results = [];
        const conn = { host, username, password, privateKey, port };
        for (let i = 0; i < stepList.length; i++) {
            const step = stepList[i];
            const cmd = typeof step === 'object' && step?.command ? String(step.command) : String(step);
            const stepTimeout = typeof step === 'object' && typeof step?.timeout === 'number' ? step.timeout : 120_000;
            const r = await invokeTool('remote-exec', 'run', { ...conn, command: cmd, timeout: stepTimeout }, {
                sessionId: ctx?.sessionId,
                memoryScopeHint: ctx?.memoryScopeHint,
                agentId: ctx?.agentId,
            });
            results.push({ index: i + 1, command: cmd, stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? null, ok: r.ok ?? false });
        }
        return { steps: results };
    },
    'pentest-runner#fetchResult': async ({ host, remotePath, localPath, username = 'root', password, privateKey, port = 22 }, ctx) => {
        const h = String(host ?? '');
        const rp = String(remotePath ?? '');
        if (!h || !rp)
            throw new Error('host and remotePath are required');
        const lp = String(localPath ?? `pentest-results/${Date.now()}-${rp.replace(/[/\\]/g, '_')}`);
        const { invokeTool } = await import('./registry.js');
        await invokeTool('remote-exec', 'download', { host: h, remotePath: rp, localPath: lp, username, password, privateKey, port }, {
            sessionId: ctx?.sessionId,
            memoryScopeHint: ctx?.memoryScopeHint,
            agentId: ctx?.agentId,
        });
        const ws = ctx?.workspaceDir ?? getWorkspaceDir();
        const fullPath = resolveWorkspacePath(ws, lp);
        const content = await readFile(fullPath, 'utf-8');
        return { remotePath: rp, localPath: lp, content };
    },
    'desktop-automation#screenshot': async ({ region }) => {
        const { screen } = await import('@nut-tree-fork/nut-js');
        const { FileType } = await import('@nut-tree-fork/shared');
        const fname = `apex-desktop-${randomUUID()}`;
        const outDir = tmpdir();
        let outPath;
        if (region && typeof region === 'object' && 'x' in region && 'y' in region && 'width' in region && 'height' in region) {
            const r = region;
            const { Region } = await import('@nut-tree-fork/shared');
            const reg = new Region(r.x, r.y, r.width, r.height);
            outPath = await screen.captureRegion(fname, reg, FileType.PNG, outDir);
        }
        else {
            outPath = await screen.capture(fname, FileType.PNG, outDir);
        }
        const buf = await readFile(outPath);
        await unlink(outPath).catch(() => { });
        const ssDir1 = join(getWorkspaceDir(), 'screenshots');
        await mkdir(ssDir1, { recursive: true });
        const ssPath1 = join(ssDir1, `screenshot-desktop-${Date.now()}.png`);
        await writeFile(ssPath1, buf);
        return { _fileReply: true, fileType: 'image', filePath: ssPath1, mimeType: 'image/png', caption: '桌面截图已完成' };
    },
    // screen-capture：电脑桌面截屏（独立 skill，便于“截屏”场景发现）
    'screen-capture#capture': async ({ region }) => {
        const { screen } = await import('@nut-tree-fork/nut-js');
        const { FileType } = await import('@nut-tree-fork/shared');
        const fname = `apex-screen-${randomUUID()}`;
        const outDir = tmpdir();
        let outPath;
        if (region && typeof region === 'object' && 'x' in region && 'y' in region && 'width' in region && 'height' in region) {
            const r = region;
            const { Region } = await import('@nut-tree-fork/shared');
            const reg = new Region(r.x, r.y, r.width, r.height);
            outPath = await screen.captureRegion(fname, reg, FileType.PNG, outDir);
        }
        else {
            outPath = await screen.capture(fname, FileType.PNG, outDir);
        }
        const buf = await readFile(outPath);
        await unlink(outPath).catch(() => { });
        const ssDir2 = join(getWorkspaceDir(), 'screenshots');
        await mkdir(ssDir2, { recursive: true });
        const ssPath2 = join(ssDir2, `screenshot-screen-${Date.now()}.png`);
        await writeFile(ssPath2, buf);
        return { _fileReply: true, fileType: 'image', filePath: ssPath2, mimeType: 'image/png', caption: '桌面截图已完成' };
    },
    // android-emulator：通过 ADB 控制 Android 设备/模拟器
    'android-emulator#listDevices': async ({ deviceId: _ }) => {
        const { stdout, stderr, exitCode } = await runAdb([], ['devices']);
        if (exitCode !== 0)
            return { devices: [], error: stderr || 'adb devices failed' };
        const out = typeof stdout === 'string' ? stdout : stdout.toString('utf-8');
        const lines = out.split('\n').slice(1).filter(Boolean);
        const devices = lines
            .map((line) => {
            const m = line.trim().match(/^([\w.-]+)\s+(device|emulator)/);
            return m ? m[1] : null;
        })
            .filter((id) => !!id);
        return { devices };
    },
    'android-emulator#tap': async ({ x, y, deviceId }) => {
        const px = Math.floor(Number(x ?? 0));
        const py = Math.floor(Number(y ?? 0));
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stdout, stderr, exitCode } = await runAdb(args, ['shell', 'input', 'tap', String(px), String(py)]);
        return { x: px, y: py, success: exitCode === 0, stderr: exitCode !== 0 ? stderr : undefined };
    },
    'android-emulator#swipe': async ({ x1, y1, x2, y2, duration, deviceId }) => {
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const dur = Math.max(0, Math.floor(Number(duration ?? 300)));
        const cmd = ['shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2)];
        if (dur > 0)
            cmd.push(String(dur));
        const { stderr, exitCode } = await runAdb(args, cmd);
        return { success: exitCode === 0, stderr: exitCode !== 0 ? stderr : undefined };
    },
    'android-emulator#inputText': async ({ text, deviceId }) => {
        const t = String(text ?? '');
        if (!t)
            throw new Error('text is required');
        const escaped = t.replace(/%/g, '%%').replace(/\s/g, '%s');
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stderr, exitCode } = await runAdb(args, ['shell', 'input', 'text', escaped]);
        return { typed: t.length, success: exitCode === 0, stderr: exitCode !== 0 ? stderr : undefined };
    },
    'android-emulator#keyEvent': async ({ keycode, deviceId }) => {
        const KEYCODE_ALIASES = {
            BACK: 4, HOME: 3, MENU: 82, ENTER: 66, POWER: 26, VOLUME_UP: 24, VOLUME_DOWN: 25,
            DEL: 67, TAB: 61, CAPS_LOCK: 115, ESC: 111, APP_SWITCH: 187,
        };
        const raw = keycode ?? '';
        let code = typeof raw === 'number' ? raw : KEYCODE_ALIASES[String(raw).toUpperCase()] ?? Math.floor(Number(raw));
        if (Number.isNaN(code) || code < 0)
            throw new Error('keycode is required (BACK,HOME,ENTER 或数字)');
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stderr, exitCode } = await runAdb(args, ['shell', 'input', 'keyevent', String(code)]);
        return { keycode: code, success: exitCode === 0, stderr: exitCode !== 0 ? stderr : undefined };
    },
    'android-emulator#screencap': async ({ deviceId }) => {
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stdout, stderr, exitCode } = await runAdb(args, ['exec-out', 'screencap', '-p'], { binary: true });
        if (exitCode !== 0)
            return { error: stderr || 'screencap failed' };
        const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'binary');
        const ssDir = join(getWorkspaceDir(), 'screenshots');
        await mkdir(ssDir, { recursive: true });
        const ssPath = join(ssDir, `screenshot-android-${Date.now()}.png`);
        await writeFile(ssPath, buf);
        return { _fileReply: true, fileType: 'image', filePath: ssPath, mimeType: 'image/png', caption: '模拟器截图已完成' };
    },
    'android-emulator#pushFile': async ({ localPath, remotePath, deviceId }, ctx) => {
        const lp = String(localPath ?? '').trim();
        const rp = String(remotePath ?? '').trim();
        if (!lp || !rp)
            throw new Error('localPath and remotePath are required');
        const workDir = ctx?.workspaceDir ?? getWorkspaceDir();
        const resolved = lp.startsWith('/') || /^[A-Za-z]:[\\/]/.test(lp) ? resolve(lp) : resolve(workDir, lp);
        if (!existsSync(resolved))
            throw new Error(`Local file not found: ${resolved}`);
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stderr, exitCode } = await runAdb(args, ['push', resolved, rp]);
        return { success: exitCode === 0, localPath: lp, remotePath: rp, stderr: exitCode !== 0 ? stderr : undefined };
    },
    'android-emulator#pullFile': async ({ remotePath, localPath, deviceId }, ctx) => {
        const rp = String(remotePath ?? '').trim();
        if (!rp)
            throw new Error('remotePath is required');
        const workDir = ctx?.workspaceDir ?? getWorkspaceDir();
        const downloadsDir = join(workDir, 'downloads');
        await mkdir(downloadsDir, { recursive: true });
        const baseName = rp.split(/[/\\]/).pop() || `pull-${Date.now()}`;
        const lp = String(localPath ?? '').trim();
        const destPath = lp
            ? (lp.startsWith('/') || /^[A-Za-z]:[\\/]/.test(lp) ? resolve(lp) : resolve(workDir, lp))
            : join(downloadsDir, baseName);
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stderr, exitCode } = await runAdb(args, ['pull', rp, destPath]);
        if (exitCode !== 0)
            return { success: false, remotePath: rp, stderr, error: stderr || 'pull failed' };
        const ext = baseName.split('.').pop()?.toLowerCase();
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext ?? '');
        const mimeType = isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/octet-stream';
        return {
            _fileReply: true,
            fileType: isImage ? 'image' : 'file',
            filePath: destPath,
            mimeType,
            caption: '已从设备下载文件',
            success: true,
            remotePath: rp,
        };
    },
    'android-emulator#launchApp': async ({ package: pkg, activity, deviceId }) => {
        const p = String(pkg ?? '').trim();
        if (!p)
            throw new Error('package is required');
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const act = String(activity ?? '').trim();
        const component = act
            ? (act.startsWith('.') ? `${p}${act}` : act.includes('.') ? act : `${p}.${act}`)
            : null;
        const cmd = component
            ? ['shell', 'am', 'start', '-n', `${p}/${component}`]
            : ['shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', p];
        const { stdout, stderr, exitCode } = await runAdb(args, cmd);
        return {
            success: exitCode === 0,
            package: p,
            stdout: exitCode === 0 ? (typeof stdout === 'string' ? stdout : stdout?.toString?.()) : undefined,
            stderr: exitCode !== 0 ? stderr : undefined,
        };
    },
    'android-emulator#installApk': async ({ apkPath, deviceId }, ctx) => {
        const p = String(apkPath ?? '').trim();
        if (!p)
            throw new Error('apkPath is required');
        const workDir = ctx?.workspaceDir ?? getWorkspaceDir();
        const resolved = p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)
            ? resolve(p)
            : resolve(workDir, p);
        if (!existsSync(resolved))
            throw new Error(`APK not found: ${resolved}`);
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stdout, stderr, exitCode } = await runAdb(args, ['install', '-r', resolved]);
        return {
            success: exitCode === 0,
            stdout: stdout || undefined,
            stderr: exitCode !== 0 ? stderr : undefined,
        };
    },
    'android-emulator#shell': async ({ command, deviceId }) => {
        const cmd = String(command ?? '').trim();
        if (!cmd)
            throw new Error('command is required');
        const args = deviceId ? ['-s', String(deviceId)] : [];
        const { stdout, stderr, exitCode } = await runAdb(args, ['shell', cmd]);
        const out = typeof stdout === 'string' ? stdout : stdout.toString('utf-8');
        return { stdout: out || null, stderr: stderr || null, exitCode, ok: exitCode === 0 };
    },
    // OpenClaw 兼容：由 runOpenClawLegacyScript 统一处理，此处仅作兜底（无 scripts 时）
    'openclaw-legacy#invoke': async ({ command }) => {
        return {
            legacy: true,
            message: 'OpenClaw legacy skill: no executable script found in skill folder. Add scripts/main.py, run.sh, or <name>.py.',
            command: command ?? null,
        };
    },
};
/** 行级 LCS diff：输出 add/remove/keep 序列 */
/** (m+1)*(n+1) 不得超过此值，避免 Invalid array length */
const MAX_DIFF_MATRIX = 25_000_000;
function computeLineDiff(a, b) {
    const m = a.length;
    const n = b.length;
    const product = (m + 1) * (n + 1);
    if (product > MAX_DIFF_MATRIX || !Number.isSafeInteger(product) || m < 0 || n < 0) {
        throw new Error(`文本过长无法进行 diff（当前 ${m}×${n} 行，需 ${product} 格，上限 ${MAX_DIFF_MATRIX}）。请缩小输入或分段比较。`);
    }
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    const out = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            out.unshift({ type: 'keep', line: a[i - 1] });
            i--;
            j--;
        }
        else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            out.unshift({ type: 'add', line: b[j - 1] });
            j--;
        }
        else {
            out.unshift({ type: 'remove', line: a[i - 1] });
            i--;
        }
    }
    return out;
}
function stripHtml(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function parseBaiduSearchResults(html, max) {
    const results = [];
    const clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    const blocks = clean.match(/<div[^>]*data-log[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi) || [];
    for (const block of blocks) {
        if (results.length >= max)
            break;
        const titleM = block.match(/<a[^>]*class="[^"]*c-font-medium[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
            || block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snipM = block.match(/<span[^>]*class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        if (titleM) {
            let url = titleM[1].replace(/&amp;/g, '&');
            if (url.startsWith('/'))
                url = `https://www.baidu.com${url}`;
            else if (!url.startsWith('http'))
                continue;
            const title = stripHtml(titleM[2]).slice(0, 200);
            const snippet = snipM ? stripHtml(snipM[1]).slice(0, 300) : undefined;
            results.push({ title, url, snippet });
        }
    }
    if (results.length === 0) {
        const h3Links = clean.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi) || [];
        for (const m of h3Links) {
            if (results.length >= max)
                break;
            const mat = m.match(/href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (mat && !mat[1].includes('baidu.com')) {
                results.push({ title: stripHtml(mat[2]).slice(0, 200), url: mat[1].replace(/&amp;/g, '&') });
            }
        }
    }
    return results;
}
function parseBingSearchResults(html, max) {
    const results = [];
    const items = html.match(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi) || [];
    for (const item of items) {
        if (results.length >= max)
            break;
        const a = item.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const p = item.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (a && a[1].startsWith('http')) {
            results.push({
                title: stripHtml(a[2]).slice(0, 200),
                url: a[1].replace(/&amp;/g, '&'),
                snippet: p ? stripHtml(p[1]).slice(0, 300) : undefined,
            });
        }
    }
    return results;
}
function parseDuckDuckGoHtmlResults(html, max) {
    const results = [];
    const items = html.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi) || [];
    for (const item of items) {
        if (results.length >= max)
            break;
        const m = item.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (m) {
            let url = m[1];
            if (url.startsWith('//duckduckgo.com/l/')) {
                const uddg = url.match(/uddg=([^&]+)/);
                if (uddg)
                    url = decodeURIComponent(uddg[1]);
            }
            if (url.startsWith('http')) {
                results.push({ title: stripHtml(m[2]).slice(0, 200), url });
            }
        }
    }
    const snippets = html.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi) || [];
    for (let i = 0; i < Math.min(results.length, snippets.length); i++) {
        const s = snippets[i].match(/>([\s\S]*?)<\/a>/);
        if (s)
            results[i].snippet = stripHtml(s[1]).slice(0, 300);
    }
    return results;
}
function parseGenericSearchResults(html, max) {
    const results = [];
    const clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    const links = clean.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi) || [];
    const seen = new Set();
    for (const link of links) {
        if (results.length >= max)
            break;
        const m = link.match(/href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!m)
            continue;
        let url = m[1].replace(/&amp;/g, '&');
        if (/^(https?:\/\/)(www\.)?(so\.com|quark\.sm\.cn|s\.quark\.cn|baidu\.com|bing\.com)/i.test(url))
            continue;
        if (seen.has(url))
            continue;
        seen.add(url);
        const title = stripHtml(m[2]).slice(0, 200).trim();
        if (title.length < 3)
            continue;
        results.push({ title, url });
    }
    return results;
}
function parseSogouWeixinResults(html, max) {
    const results = [];
    const blocks = html.match(/<div[^>]*class="[^"]*news-box[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) || [];
    for (const block of blocks) {
        if (results.length >= max)
            break;
        const a = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
            || block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const meta = block.match(/<p[^>]*class="[^"]*info[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
        if (a) {
            const title = stripHtml(a[2]).slice(0, 200);
            const snippet = meta ? stripHtml(meta[1]).slice(0, 200) : undefined;
            results.push({ title, url: a[1].replace(/&amp;/g, '&'), snippet });
        }
    }
    if (results.length === 0) {
        const links = html.match(/<a[^>]*href="(https?:\/\/weixin\.sogou\.com\/link[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi) || [];
        for (const link of links) {
            if (results.length >= max)
                break;
            const m = link.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (m)
                results.push({ title: stripHtml(m[2]).slice(0, 200), url: m[1].replace(/&amp;/g, '&') });
        }
    }
    return results;
}
/** 提取网页主内容，去除导航/侧边栏/广告，输出清洗后的 Markdown 风格文本 */
function extractMainContent(html) {
    let body = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    let extracted = '';
    const articleMatch = body.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch && articleMatch[1].length > 200) {
        extracted = articleMatch[1];
    }
    else {
        const mainMatch = body.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        if (mainMatch && mainMatch[1].length > 200) {
            extracted = mainMatch[1];
        }
    }
    const content = extracted || body;
    const asText = content
        .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lv, t) => `\n${'#'.repeat(Number(lv))} ${stripHtml(t)}\n`)
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${stripHtml(t)}\n`)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripHtml(t)}\n`)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    return asText;
}
function getToolTimeoutMs(handlerPart) {
    const v = process.env.APEXPANDA_TOOL_TIMEOUT_MS;
    let base;
    if (v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1000)
            base = Math.min(n, 600_000);
        else
            base = 300_000;
    }
    else {
        base = 300_000; // 默认 5 分钟，适配长任务（搭建环境、公众号发文、远程安装等）
    }
    if (handlerPart && (handlerPart.startsWith('remote-exec#') || handlerPart.startsWith('pentest-runner#'))) {
        return Math.max(base, 600_000); // 远程执行、渗透测试至少 10 分钟
    }
    return base;
}
export async function executeTool(skill, toolId, params, execContext) {
    const tool = skill.manifest.tools?.find((t) => t.id === toolId);
    if (!tool)
        throw new Error(`Tool ${toolId} not found in skill ${skill.name}`);
    const handlerPart = tool.handler?.includes('#') ? tool.handler : `${skill.name}#${toolId}`;
    const ctx = {
        workspaceDir: getWorkspaceDir(),
        ...execContext,
        // skillEnv 必须来自当前技能配置，不被 execContext 覆盖
        skillEnv: getSkillEntryEnv(skill.name, skill.manifest.openclawMeta?.primaryEnv, skill.name),
    };
    // OpenClaw legacy：执行 scripts/ 脚本，不走 builtin handler
    if (handlerPart.startsWith('openclaw-legacy#')) {
        checkSkillPermission(skill, 'openclaw-legacy#invoke');
        const result = await runOpenClawLegacyScript(skill, toolId, params, ctx);
        return result;
    }
    let handler = builtinHandlers[handlerPart] ?? builtinHandlers[`${skill.name}#${toolId}`];
    if (!handler) {
        throw new Error(`Handler not implemented: ${handlerPart}`);
    }
    // 沙箱：校验权限声明
    checkSkillPermission(skill, handlerPart);
    // 审计：remote-exec 高危操作强制记录
    if (handlerPart.startsWith('remote-exec#')) {
        const audit = {
            action: 'remote-exec',
            ts: new Date().toISOString(),
            handler: handlerPart,
            host: params.host ?? null,
            sessionId: ctx.sessionId ?? null,
            agentId: ctx.agentId ?? null,
        };
        if (params.command != null)
            audit.commandPreview = String(params.command).slice(0, 200);
        if (params.script != null)
            audit.scriptPreview = String(params.script).slice(0, 200);
        if (Array.isArray(params.hosts))
            audit.hostsCount = params.hosts.length;
        console.log(`[audit:remote-exec] ${JSON.stringify(audit)}`);
    }
    const timeoutMs = getToolTimeoutMs(handlerPart);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool timeout after ${timeoutMs}ms`)), timeoutMs));
    const logEnabled = process.env.APEXPANDA_TOOL_LOG_ENABLED === 'true';
    const start = logEnabled ? Date.now() : 0;
    try {
        const result = await Promise.race([handler(params, ctx), timeout]);
        if (logEnabled) {
            const durationMs = Date.now() - start;
            const entry = JSON.stringify({
                ts: new Date().toISOString(),
                handler: handlerPart,
                sessionId: ctx.sessionId ?? null,
                durationMs,
                ok: true,
            });
            console.log(`[tool-call] ${entry}`);
        }
        return result;
    }
    catch (e) {
        if (logEnabled) {
            const durationMs = Date.now() - start;
            const errMsg = e instanceof Error ? e.message : String(e);
            const entry = JSON.stringify({
                ts: new Date().toISOString(),
                handler: handlerPart,
                sessionId: ctx.sessionId ?? null,
                durationMs,
                ok: false,
                error: errMsg.slice(0, 200),
            });
            console.log(`[tool-call] ${entry}`);
        }
        throw e;
    }
}
//# sourceMappingURL=executor.js.map