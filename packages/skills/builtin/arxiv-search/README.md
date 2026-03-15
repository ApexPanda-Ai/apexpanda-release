# arxiv-search

学术论文搜索（arXiv），无需 API Key。

## 工具

### search

按关键词搜索 arXiv 论文。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词 |
| maxResults | number | 否 | 返回数量，默认 5，最大 20 |

**返回：**

- papers: 论文列表，每项含 id、title、summary、authors、url、pdf
- count: 数量

**示例：**

```json
{
  "query": "large language model",
  "maxResults": 5
}
```

## 权限

- network (outbound)：请求 arXiv API
