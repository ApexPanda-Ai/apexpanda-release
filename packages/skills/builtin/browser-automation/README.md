# browser-automation

基于 Playwright 的浏览器自动化 Skill，模拟键盘和鼠标操作。支持打开网页、点击、输入、截图、获取页面可交互元素结构。

## 工具说明

| 工具 | 说明 |
|------|------|
| `runSteps` | 执行浏览器操作。支持 navigate / snapshot / click / fill / type / press / scroll / screenshot / waitForSelector。persistent=true 时支持 newTab / switchTab 多标签 |
| `navigateAndSnapshot` | 打开 URL 并返回页面可点击/可输入元素的结构快照 |
| `screenshot` | 打开 URL 并截图，返回 base64 图片 |

## 权限要求

- `network: outbound` - 加载网页
- `process: spawn` - 启动浏览器进程

## 使用示例

### 1. 打开页面并获取结构

```json
{
  "skillName": "browser-automation",
  "toolId": "navigateAndSnapshot",
  "params": { "url": "https://example.com" }
}
```

### 2. 多步骤操作（搜索并点击）

```json
{
  "skillName": "browser-automation",
  "toolId": "runSteps",
  "params": {
    "steps": [
      { "action": "navigate", "url": "https://www.baidu.com" },
      { "action": "fill", "selector": "#kw", "value": "ApexPanda" },
      { "action": "click", "selector": "#su" },
      { "action": "snapshot" }
    ]
  }
}
```

### 3. 截图

```json
{
  "skillName": "browser-automation",
  "toolId": "screenshot",
  "params": { "url": "https://example.com" }
}
```

## 部署说明

首次使用前需安装 Playwright 浏览器：

```bash
cd packages/core && npx playwright install chromium
```

或在项目根目录：

```bash
pnpm exec playwright install chromium
```
