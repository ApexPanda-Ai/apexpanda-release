/**
 * 企业微信渠道适配器
 * 支持应用消息（XML 格式回调）
 * @see https://developer.work.weixin.qq.com/document/path/90245
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash, createDecipheriv } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
function unwrap(v) {
    if (!v)
        return '';
    return Array.isArray(v) ? v[0] ?? '' : v;
}
/** 解析企业微信 XML 消息 */
export function parseWeComXml(xmlStr) {
    try {
        const parser = new XMLParser({ ignoreAttributes: true });
        const parsed = parser.parse(xmlStr);
        return parsed.xml ?? null;
    }
    catch {
        return null;
    }
}
/** 从解析结果提取 IncomingMessage */
export function parseWeComMessage(xml, tenantId = 'default') {
    if (!xml)
        return null;
    const text = unwrap(xml.Content).trim();
    if (!text || unwrap(xml.MsgType) !== 'text')
        return null;
    const peerId = unwrap(xml.FromUserName);
    if (!peerId)
        return null;
    return {
        channel: 'wecom',
        channelPeerId: peerId,
        tenantId,
        content: text,
        raw: xml,
    };
}
// ── 回调验证：签名 + AES 解密 ─────────────────────────────────────
/**
 * 计算企业微信签名
 * 规则：对 token + timestamp + nonce + 待签字符串 按字典序排序后拼接，SHA1
 */
export function calcWeComSignature(token, timestamp, nonce, encryptedMsg) {
    const arr = [token, timestamp, nonce, encryptedMsg].sort();
    return createHash('sha1').update(arr.join('')).digest('hex');
}
/**
 * 用 EncodingAESKey 解密企业微信加密消息（echostr 或消息体中的 Encrypt 字段）
 * AES-256-CBC，PKCS7 填充，key = Base64(encodingAESKey + '=')，IV = key 前 16 字节
 */
export function decryptWeComMsg(encodingAESKey, encrypted) {
    const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
    const iv = aesKey.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
    // PKCS7 去填充
    const padLen = decrypted[decrypted.length - 1];
    const unpadded = decrypted.subarray(0, decrypted.length - padLen);
    // 明文格式：16 字节随机串 + 4 字节消息长度（大端） + 消息内容 + receiveid
    const msgLen = unpadded.readUInt32BE(16);
    return unpadded.subarray(20, 20 + msgLen).toString('utf8');
}
/**
 * 处理企业微信 GET 验证请求
 * 验证签名后解密 echostr 返回明文，企业微信以此确认 URL 有效
 */
export function handleWeComVerify(opts) {
    const { token, encodingAESKey, msgSignature, timestamp, nonce, echostr } = opts;
    if (!token || !encodingAESKey || !msgSignature || !timestamp || !nonce || !echostr)
        return null;
    const computed = calcWeComSignature(token, timestamp, nonce, echostr);
    if (computed !== msgSignature)
        return null;
    try {
        return decryptWeComMsg(encodingAESKey, echostr);
    }
    catch {
        return null;
    }
}
/** 处理企业微信 POST 回调（Content-Type: text/xml 或 application/xml） */
export function handleWeComWebhook(xmlStr, tenantId = 'default') {
    const xml = parseWeComXml(xmlStr);
    const msg = parseWeComMessage(xml, tenantId);
    if (!msg)
        return null;
    return { type: 'event', message: msg };
}
/** 主动回复：通过应用消息 API 发送文本给指定用户
 * 需配置 corpId、agentId、secret（环境变量 WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET 或 config）
 * @see https://developer.work.weixin.qq.com/document/path/90236
 */
export async function sendWeComMessage(userId, content, opts) {
    const { corpId, agentId, secret } = opts;
    if (!corpId || !agentId || !secret) {
        throw new Error('WeCom send requires corpId, agentId, secret');
    }
    const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`);
    if (!tokenRes.ok) {
        const txt = await tokenRes.text();
        throw new Error(`WeCom gettoken failed: ${tokenRes.status} ${txt}`);
    }
    const tokenData = (await tokenRes.json());
    if (tokenData.errcode && tokenData.errcode !== 0) {
        throw new Error(`WeCom gettoken error: ${tokenData.errcode} ${tokenData.errmsg ?? ''}`);
    }
    const accessToken = tokenData.access_token;
    if (!accessToken)
        throw new Error('WeCom gettoken: no access_token');
    const sendRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            touser: userId,
            msgtype: 'text',
            agentid: agentId,
            text: { content },
        }),
    });
    if (!sendRes.ok) {
        const txt = await sendRes.text();
        throw new Error(`WeCom send failed: ${sendRes.status} ${txt}`);
    }
    const sendData = (await sendRes.json());
    if (sendData.errcode && sendData.errcode !== 0) {
        throw new Error(`WeCom send error: ${sendData.errcode} ${sendData.errmsg ?? ''}`);
    }
}
/** 发送 Markdown 格式消息（支持部分 Markdown 语法） */
export async function sendWeComMarkdown(userId, content, opts) {
    const { corpId, agentId, secret } = opts;
    if (!corpId || !agentId || !secret) {
        throw new Error('WeCom send requires corpId, agentId, secret');
    }
    const tokenRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`);
    if (!tokenRes.ok)
        throw new Error(`WeCom gettoken failed: ${tokenRes.status}`);
    const tokenData = (await tokenRes.json());
    if (tokenData.errcode && tokenData.errcode !== 0) {
        throw new Error(`WeCom gettoken error: ${tokenData.errcode} ${tokenData.errmsg ?? ''}`);
    }
    const accessToken = tokenData.access_token;
    if (!accessToken)
        throw new Error('WeCom gettoken: no access_token');
    const sendRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            touser: userId,
            msgtype: 'markdown',
            agentid: agentId,
            markdown: { content },
        }),
    });
    if (!sendRes.ok) {
        const txt = await sendRes.text();
        throw new Error(`WeCom markdown send failed: ${sendRes.status} ${txt}`);
    }
    const sendData = (await sendRes.json());
    if (sendData.errcode && sendData.errcode !== 0) {
        throw new Error(`WeCom markdown send error: ${sendData.errcode} ${sendData.errmsg ?? ''}`);
    }
}
const WECOM_API = 'https://qyapi.weixin.qq.com/cgi-bin';
async function getWeComAccessToken(opts) {
    const { corpId, secret } = opts;
    const tokenRes = await fetch(`${WECOM_API}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`);
    if (!tokenRes.ok)
        throw new Error(`WeCom gettoken failed: ${tokenRes.status}`);
    const tokenData = (await tokenRes.json());
    if (tokenData.errcode && tokenData.errcode !== 0) {
        throw new Error(`WeCom gettoken error: ${tokenData.errcode} ${tokenData.errmsg ?? ''}`);
    }
    if (!tokenData.access_token)
        throw new Error('WeCom gettoken: no access_token');
    return tokenData.access_token;
}
/** 上传临时素材，返回 media_id
 * @see https://developer.work.weixin.qq.com/document/path/90253
 */
async function uploadWeComMedia(filePath, type, opts) {
    const token = await getWeComAccessToken(opts);
    const buf = await readFile(filePath);
    const blob = new Blob([buf]);
    const form = new FormData();
    form.append('media', blob, basename(filePath));
    const uploadRes = await fetch(`${WECOM_API}/media/upload?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`, { method: 'POST', body: form });
    if (!uploadRes.ok)
        throw new Error(`WeCom media/upload failed: ${uploadRes.status}`);
    const uploadData = (await uploadRes.json());
    if (uploadData.errcode && uploadData.errcode !== 0) {
        throw new Error(`WeCom media/upload error: ${uploadData.errcode} ${uploadData.errmsg ?? ''}`);
    }
    if (!uploadData.media_id)
        throw new Error('WeCom media/upload: no media_id');
    return uploadData.media_id;
}
/** 文件直通：发送图片给指定用户 */
export async function sendWeComImage(userId, filePath, caption, opts) {
    const mediaId = await uploadWeComMedia(filePath, 'image', opts);
    const token = await getWeComAccessToken(opts);
    const sendRes = await fetch(`${WECOM_API}/message/send?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            touser: userId,
            msgtype: 'image',
            agentid: opts.agentId,
            image: { media_id: mediaId },
        }),
    });
    if (!sendRes.ok)
        throw new Error(`WeCom send image failed: ${sendRes.status}`);
    const sendData = (await sendRes.json());
    if (sendData.errcode && sendData.errcode !== 0) {
        throw new Error(`WeCom send image error: ${sendData.errcode} ${sendData.errmsg ?? ''}`);
    }
    if (caption) {
        await sendWeComMessage(userId, caption, opts);
    }
}
/** 文件直通：发送文件（含 audio 等非图片）给指定用户 */
export async function sendWeComFile(userId, filePath, mimeType, caption, opts) {
    const mediaId = await uploadWeComMedia(filePath, 'file', opts);
    const token = await getWeComAccessToken(opts);
    const sendRes = await fetch(`${WECOM_API}/message/send?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            touser: userId,
            msgtype: 'file',
            agentid: opts.agentId,
            file: { media_id: mediaId },
        }),
    });
    if (!sendRes.ok)
        throw new Error(`WeCom send file failed: ${sendRes.status}`);
    const sendData = (await sendRes.json());
    if (sendData.errcode && sendData.errcode !== 0) {
        throw new Error(`WeCom send file error: ${sendData.errcode} ${sendData.errmsg ?? ''}`);
    }
    if (caption) {
        await sendWeComMessage(userId, caption, opts);
    }
}
//# sourceMappingURL=wecom.js.map