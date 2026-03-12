# news-aggregator

多源新闻聚合，从预设科技/财经类 RSS 抓取新闻，无需 API Key。

## 工具

### fetch

聚合多源新闻。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sources | string \| string[] | 否 | 源标识：hn、solidot、techcrunch、hackernews；或自定义 RSS URL。不传则聚合全部预设源 |
| limit | number | 否 | 返回条数，默认 10，最大 20 |

**预设源：**

- hn / hackernews: Hacker News 首页
- solidot: Solidot 科技
- techcrunch: TechCrunch

**返回：**

- items: 新闻列表，每项含 title、link、summary、date、source
- count: 数量

## 权限

- network (outbound)：请求 RSS 源
