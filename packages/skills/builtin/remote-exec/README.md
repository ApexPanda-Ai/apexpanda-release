# remote-exec

通过 SSH 在远程服务器执行命令，支持多主机并发。

## 工具

| 工具 | 说明 |
|------|------|
| `run` | 单机执行。host、command 必填；username、password/privateKey、port |
| `runMultiple` | 多机并发。hosts 为数组，每项 {host, username?, password?, privateKey?}；command 为命令 |
| `upload` | SFTP 上传。host、localPath（相对 workspace）、remotePath 必填 |
| `download` | SFTP 下载。host、remotePath、localPath 必填 |

## 示例

```json
{"skillName": "remote-exec", "toolId": "run", "params": {"host": "192.168.1.10", "command": "uptime", "username": "root", "password": "xxx"}}
{"skillName": "remote-exec", "toolId": "runMultiple", "params": {"hosts": ["host1", "host2"], "command": "df -h"}}
```
