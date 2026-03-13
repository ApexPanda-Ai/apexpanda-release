# api-tester

HTTP API 测试工具，类似 Postman。支持 GET、POST、PUT、DELETE、PATCH 等方法，可设置自定义请求头和请求体。

## 工具

### request

发送 HTTP 请求。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 请求 URL，需以 http:// 或 https:// 开头 |
| method | string | 否 | HTTP 方法，默认 GET |
| headers | object | 否 | 请求头键值对 |
| body | string \| object | 否 | 请求体，对象时自动 JSON 序列化 |
| timeout | number | 否 | 超时毫秒数，默认 15000，最大 60000 |

**返回：**

- status: HTTP 状态码
- statusText: 状态文本
- ok: 是否 2xx
- headers: 响应头
- body: 响应体（最多 5000 字符）

**示例：**

```json
{
  "url": "https://api.example.com/users",
  "method": "POST",
  "headers": { "Authorization": "Bearer xxx" },
  "body": { "name": "Alice", "role": "admin" }
}
```

## 权限

- network (outbound)：发送 HTTP 请求
