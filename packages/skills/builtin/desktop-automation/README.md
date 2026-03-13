# desktop-automation

操作系统级键盘鼠标模拟，可控制桌面任意应用（IDE、Excel、微信等）。基于 Nut.js。

## 工具

| 工具 | 说明 |
|------|------|
| `type` | 在当前焦点输入文字 |
| `keyTap` | 模拟按键，支持修饰键（如 Control+c） |
| `mouseMove` | 移动鼠标到 (x, y) |
| `mouseClick` | 点击，支持坐标、左/右键、双击 |
| `mouseScroll` | 滚轮滚动 |
| `mouseDrag` | 鼠标拖拽（from/to 或 fromX/fromY/toX/toY） |
| `screenshot` | 截取屏幕或指定区域 |

## 注意

- 需用户授权，风险较高
- Windows 需管理员或应用兼容
- Nut.js 依赖原生模块，首次使用前需正确安装
