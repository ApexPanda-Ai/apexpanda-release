import type { IncomingMessage } from './types.js';
interface WeComXml {
    xml?: {
        MsgType?: string | string[];
        Content?: string | string[];
        FromUserName?: string | string[];
        ToUserName?: string | string[];
        MsgId?: string | string[];
    };
}
/** 解析企业微信 XML 消息 */
export declare function parseWeComXml(xmlStr: string): WeComXml['xml'] | null;
/** 从解析结果提取 IncomingMessage */
export declare function parseWeComMessage(xml: WeComXml['xml'] | null, tenantId?: string): IncomingMessage | null;
export interface WeComWebhookResult {
    type: 'event';
    message: IncomingMessage;
}
/**
 * 计算企业微信签名
 * 规则：对 token + timestamp + nonce + 待签字符串 按字典序排序后拼接，SHA1
 */
export declare function calcWeComSignature(token: string, timestamp: string, nonce: string, encryptedMsg: string): string;
/**
 * 用 EncodingAESKey 解密企业微信加密消息（echostr 或消息体中的 Encrypt 字段）
 * AES-256-CBC，PKCS7 填充，key = Base64(encodingAESKey + '=')，IV = key 前 16 字节
 */
export declare function decryptWeComMsg(encodingAESKey: string, encrypted: string): string;
/**
 * 处理企业微信 GET 验证请求
 * 验证签名后解密 echostr 返回明文，企业微信以此确认 URL 有效
 */
export declare function handleWeComVerify(opts: {
    token: string;
    encodingAESKey: string;
    msgSignature: string;
    timestamp: string;
    nonce: string;
    echostr: string;
}): string | null;
/** 处理企业微信 POST 回调（Content-Type: text/xml 或 application/xml） */
export declare function handleWeComWebhook(xmlStr: string, tenantId?: string): WeComWebhookResult | null;
/** 主动回复：通过应用消息 API 发送文本给指定用户
 * 需配置 corpId、agentId、secret（环境变量 WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET 或 config）
 * @see https://developer.work.weixin.qq.com/document/path/90236
 */
export declare function sendWeComMessage(userId: string, content: string, opts: {
    corpId: string;
    agentId: string;
    secret: string;
}): Promise<void>;
/** 发送 Markdown 格式消息（支持部分 Markdown 语法） */
export declare function sendWeComMarkdown(userId: string, content: string, opts: {
    corpId: string;
    agentId: string;
    secret: string;
}): Promise<void>;
export interface WeComFileOpts {
    corpId: string;
    agentId: string;
    secret: string;
}
/** 文件直通：发送图片给指定用户 */
export declare function sendWeComImage(userId: string, filePath: string, caption: string | undefined, opts: WeComFileOpts): Promise<void>;
/** 文件直通：发送文件（含 audio 等非图片）给指定用户 */
export declare function sendWeComFile(userId: string, filePath: string, mimeType: string, caption: string | undefined, opts: WeComFileOpts): Promise<void>;
export {};
//# sourceMappingURL=wecom.d.ts.map