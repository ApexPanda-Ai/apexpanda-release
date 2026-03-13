# process-monitor

系统进程与网络监控，对标 OpenClaw 的 process-watch 能力。

## 工具

| 工具 | 说明 |
|------|------|
| `summary` | 电脑在干嘛：主机名、CPU/内存/运行时间、Top 进程、网络连接摘要 |
| `list` | 列出系统所有运行进程 |
| `net` | 列出网络连接（端口、远程地址、状态） |

## 平台支持

- **Windows**：tasklist、Get-NetTCPConnection
- **Linux/Mac**：ps、ss/netstat

## 使用场景

用户问「电脑在干嘛」「有哪些程序在运行」「网络连接」时，Agent 应优先调用 process-monitor 而非 server-monitor（server-monitor 仅提供 CPU/内存聚合指标，不含进程与网络）。
