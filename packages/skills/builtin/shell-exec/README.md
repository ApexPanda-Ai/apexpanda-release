# shell-exec

在宿主机执行 Shell 命令，支持工作目录切换、环境变量注入、后台长时间任务及状态查询。

## 工具

| 工具 | 说明 |
|------|------|
| `run` | 执行命令。command 必填；cwd 工作目录；env 环境变量；background 为 true 时后台执行 |
| `taskStatus` | 查询后台任务状态 |
| `taskKill` | 终止后台任务 |

## 配置

- `APEXPANDA_SHELL_CWD_ALLOWED`：允许的绝对路径白名单，逗号/分号/换行分隔。未设置时绝对路径会报错。

## 示例

```json
{"skillName": "shell-exec", "toolId": "run", "params": {"command": "dir", "cwd": "D:\\project"}}
{"skillName": "shell-exec", "toolId": "run", "params": {"command": "npm run build", "background": true}}
{"skillName": "shell-exec", "toolId": "taskStatus", "params": {"taskId": "xxx"}}
```
