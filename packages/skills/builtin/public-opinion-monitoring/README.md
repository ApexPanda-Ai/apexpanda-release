# 舆情监测 public-opinion-monitoring

对文本进行关键词与敏感词检测，输出标准监测报告。

## 平台工具

- **public-opinion-monitoring_detect**：Agent / Workflow 通过此工具调用
  - `text`（必填）：待检测文本
  - `keywords`：关键词数组，如 `["品牌A","产品B"]`
  - `sensitive`：敏感词数组，如 `["违禁词"]`
  - `source`：来源说明，如 `粘贴` / `文件` / `URL` / `搜索引擎检索`

## 使用场景

- 舆情监测、关键词监测、敏感词检测、品牌监控
- 监测源：用户粘贴、文件、URL、搜索引擎检索、公众号文章等（由 Agent 先通过 file-tools、web-fetch、web-search 等获取文本后传入）

## CLI 脚本

独立使用时可执行 `scripts/detect.js`：

```bash
node scripts/detect.js --file content.txt --keywords="品牌A,产品B" --sensitive="违禁词" --source="file"
```
