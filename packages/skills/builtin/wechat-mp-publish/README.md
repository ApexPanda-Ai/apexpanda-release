# wechat-mp-publish

微信公众号草稿创建与发布，支持将图文内容添加为草稿并提交发布。

## 前置条件

- 已认证的微信公众号或服务号
- 在 [微信公众平台](https://mp.weixin.qq.com) 获取 AppID 和 AppSecret

## 配置

在 `.apexpanda/config.json` 的 `skills.entries` 中配置，或设置环境变量：

| 变量 | 说明 |
|------|------|
| WECHAT_MP_APP_ID | 公众号 AppID |
| WECHAT_MP_APP_SECRET | 公众号 AppSecret |

## 工具说明

| 工具 | 说明 |
|------|------|
| **listMaterials** | 获取素材库列表（type 默认 image）。返回的 mediaId 可直接作封面，**优先使用**，无需上传 |
| **uploadThumb** | 上传封面图，获取永久 media_id。素材库无图时使用 |
| **uploadImage** | 上传正文内图片，返回 url 供 content 中 \<img src="url"> 使用，外部 URL 会被微信过滤 |
| **addDraft** | 创建图文草稿，thumbMediaId 来自 listMaterials 或 uploadThumb |
| **publishDraft** | 将草稿提交发布（生成永久链接）。**不会推送给粉丝**，手机微信打开公众号看不到 |
| **massSend** | 群发图文给粉丝，**粉丝才能在手机微信收到并看到**。订阅号每天1次、服务号每月4次 |
| **listDrafts** | 获取草稿箱列表 |

## 封面图获取（重要）

**优先从素材库选取**：若公众号后台已上传过图片，先调用 `listMaterials` 获取列表，取任一 `mediaId` 作为封面，无需再上传。

**素材库无图时**，用 `uploadThumb` 上传，支持三种方式（**推荐 path 传本地文件**）：

| 参数 | 说明 |
|------|------|
| **path** | 工作区内图片路径，如 `packages/skills/builtin/wechat-mp-publish/assets/cover.jpg` |
| imageUrl | 图片公网 URL，部分图床可能禁止外链导致失败 |
| base64 | base64 字符串，注意不要截断，正文图片不宜过长 |

**官方推荐尺寸**：900×500 像素，手机端显示更清晰。

**封面裁剪参数**（遇「封面裁剪失败」时使用）：`addDraft` 支持可选参数 `picCrop2351`、`picCrop11`，指定 2.35:1 与 1:1 裁剪区域。格式为 `X1_Y1_X2_Y2`（左上、右下归一化坐标 0~1），例如 `0_0_1_1` 表示使用全图作为 2.35:1 封面。详见[微信 draft/add 文档](https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_add.html)。

**快速测试**：运行 `node packages/skills/builtin/wechat-mp-publish/scripts/gen-cover.js` 生成封面图，然后 `uploadThumb` 传 `{"path":"packages/skills/builtin/wechat-mp-publish/assets/cover.jpg"}`。

## 典型流程

1. `listMaterials`：先查素材库（type=image）→ 若有图，取任一 `mediaId` 作封面；无则 `uploadThumb` 上传
2. （可选）`uploadImage`：正文有图片时，上传后得到 `url`，在 content 中用 `<img src="url">` 引用
3. `addDraft`：填入标题、正文、`thumbMediaId` 等 → 得到草稿 `mediaId`
4. **`massSend`**：传入草稿 `mediaId` 群发 → **粉丝才能在手机微信看到**。若用 `publishDraft` 仅发布到后台，用户看不到

## 注意事项

- 正文中的图片需先调用 `uploadImage` 上传获取 URL，再在 content 中使用 `<img src="url">`，外部 URL 会被微信过滤
- **发布 vs 群发**：`publishDraft` 仅生成永久链接，不推送给粉丝（手机微信看不到）；`massSend` 群发后粉丝才能收到并在公众号历史消息中看到。订阅号每天可群发 1 次，服务号每月 4 次
- 若开启 API 群发保护，群发全部用户时需管理员在公众号后台确认

## 关于 mp_editor_change_cover（客户端接口）

微信提供的 `mp_editor_change_cover` 属于**公众平台编辑器 JS 扩展接口**，仅在用户于公众号网页编辑器中编辑图文时、在浏览器端调用，用于在编辑过程中动态更换封面。本 skill 使用**服务端 API**（draft/add、material/add_material 等），无法调用该前端接口。封面需通过 `uploadThumb` 或 `listMaterials` + `addDraft` 的 thumbMediaId 指定。
