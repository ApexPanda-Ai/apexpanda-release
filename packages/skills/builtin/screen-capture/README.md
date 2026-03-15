# screen-capture

电脑桌面截屏，支持全屏或指定区域截图。基于 Nut.js，跨平台支持 Windows / macOS / Linux。

## 工具

| 工具 | 说明 |
|------|------|
| `capture` | 截取屏幕，不传参数截全屏；region 为 {x,y,width,height} 时可截指定区域 |

## 注意

- 依赖 `@nut-tree/nut-js`，与 desktop-automation 共用
- Windows 下可能需要应用兼容性设置
- macOS 需授权屏幕录制权限
