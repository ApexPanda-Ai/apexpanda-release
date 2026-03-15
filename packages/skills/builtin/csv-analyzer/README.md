# csv-analyzer

CSV 数据分析与统计摘要，可与 chart-gen 联动生成可视化图表。无需 API Key。

## 工具

### describe

解析 CSV 并对每列做统计。

**参数：** data（CSV 字符串）、delimiter（分隔符，默认 `,`）

**返回：** columns、rowCount、stats（数值列：count/mean/min/max/sum；文本列：count/unique）

### summary

解析 CSV 返回前 N 行摘要。

**参数：** data、delimiter、head（预览行数，默认 5）

**返回：** columns、rowCount、preview
