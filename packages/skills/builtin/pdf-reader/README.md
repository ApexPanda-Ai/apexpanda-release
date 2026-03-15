# pdf-reader

PDF 文本提取，支持 Base64 或 URL 输入。无需 API Key。

## 工具

### extractFromBase64

从 Base64 编码的 PDF 提取纯文本。无需网络权限。

**参数：** content（Base64 字符串）、maxChars（可选，最大返回字符数，默认 20000）

### extractFromUrl

从 URL 下载 PDF 并提取纯文本。需要 network 权限。

**参数：** url（PDF 地址）、maxChars（可选）

**返回：** text、totalChars、truncated
