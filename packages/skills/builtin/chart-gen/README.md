# chart-gen

数据可视化，根据标签与数值生成 ECharts 配置 JSON，供前端使用 ECharts 渲染图表。

## 工具

### generate

生成 ECharts 配置。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 否 | 图表类型：bar（柱状）、line（折线）、pie（饼图），默认 bar |
| labels | string[] | 是 | 标签列表（横轴或图例） |
| values | number[] | 是 | 数值列表，与 labels 一一对应 |
| title | string | 否 | 图表标题 |

**返回：**

- echartsOption: ECharts 配置对象，可在前端用 `echarts.setOption(option)` 渲染

**示例：**

```json
{
  "type": "bar",
  "labels": ["1月", "2月", "3月"],
  "values": [120, 200, 150],
  "title": "季度销售额"
}
```
