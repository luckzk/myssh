# 08 协议接入与 guacd

复制版的协议接入分两条线：**SSH/SFTP/DB/K8s 自研**（便于精细审计），**RDP/VNC/Telnet 复用 guacd**（省力且成熟）。

## 8.1 guacd 是什么、为什么复用

Apache Guacamole 的 `guacd` 是一个**协议转换守护进程**：它把 RDP/VNC/Telnet 等协议转换成统一的 **guacamole 协议**（文本指令流），浏览器端用 `guacamole-common-js` 直接渲染，无需任何客户端插件。

复用 guacd 的理由：
- RDP/VNC 协议复杂、坑多，自研成本极高（已在 [13 风险](/plan/13-risks) 标注）。
- 原版 Next Terminal 正是基于 Apache Guacamole 实现图形协议，复用最贴近原版。
- 我们只需实现一个 **guacamole 协议客户端**（Go），把浏览器 ↔ guacd 的指令流来回转发即可。

## 8.2 图形会话数据流（RDP/VNC/Telnet）

```
浏览器                后端 GuacGateway            guacd            目标主机
  │  WebSocket(guac指令)   │                        │                 │
  ├───────────────────────►│  TCP(guac协议)         │                 │
  │                        ├───────────────────────►│   RDP/VNC/Telnet │
  │                        │  handshake: select/    ├────────────────►│
  │                        │  size/audio/connect    │                 │
  │  ◄─────── 屏幕指令(img/sync) ◄──────────────────┤                 │
  │                        │                        │                 │
  │      ┌─ 旁路录制 ──────┴─ guacd recording ─→ storage              │
```

要点：
- **握手参数**由后端按资产配置注入：主机、端口、凭证（解密后）、分辨率、色深、是否启用音频/剪贴板/驱动器重定向。
- **录像**：guacd 原生支持 `recording-path`/`recording-name`，让 guacd 直接录制；后端登记 `recording_path` 到 session。
- **剪贴板/文件传输**：受授权策略 `strategy` 开关控制（禁用复制/上传等）。

## 8.3 SSH / SFTP（Go 原生自研）

```go
client, _ := ssh.Dial("tcp", addr, sshConfig) // 凭证解密后构造
session, _ := client.NewSession()
session.RequestPty("xterm", h, w, modes)
stdin, _ := session.StdinPipe()
stdout, _ := session.StdoutPipe()
// 桥接: ws→stdin, stdout→ws，旁路审计
```
- **终端审计**：stdout 流写录像帧；stdin 行缓冲解析命令 → `exec_command_log`；命中 `command_filter` 则阻断。
- **SFTP**：`pkg/sftp` 实现文件浏览/上传/下载，每个操作写 `filesystem_log` 并落 `storage`，受策略开关控制。
- **为什么不交给 guacd**：自研能拿到结构化的命令与文件事件，审计粒度远高于图形流，这是堡垒机核心价值。

## 8.4 数据库协议（自研代理 + SQL 审计）

- 后端用对应数据库驱动建立到 `database_asset` 的连接，前端通过 Web 控制台/Monaco 发送 SQL。
- 每条 SQL 经**解析/改写**后转发，结果回传；同时写 `database_sql_log`（SQL、影响行数、耗时、状态）。
- 高危语句（DROP/DELETE 无 WHERE 等）可触发拦截或走 **`db_work_order` 审批流**。

## 8.5 Kubernetes

- 用 `client-go` 对 Pod 执行 `exec`（attach TTY），终端复用 xterm.js 与 SSH 同一套录像/命令审计管道。
- 资产以 kubeconfig/ServiceAccount 凭证接入。

## 8.6 Web 应用（website）

- 后端反向代理到内网 Web 应用，统一鉴权入口；可选**操作录屏**与访问留痕（`access_log`）。
- 证书由 `certificate` 模块托管。

## 8.7 网关与内网穿透

| 网关类型 | 机制 |
| --- | --- |
| `gateway` / `ssh-gateway` | 经跳板机 SSH 隧道到达目标（目标在内网） |
| `agent-gateway` | 部署在内网的 Agent **主动反向回连**控制端，免在边界开端口 |
| `gateway-group` | 网关分组、健康检查与故障转移 |

资产可绑定网关，会话网关建链时先经网关再到目标。

## 8.8 部署拓扑提示

guacd 作为独立容器与后端同网部署：
```yaml
services:
  guacd:
    image: guacamole/guacd
    # 后端通过 guacd:4822 连接
```
SSH/DB/K8s 自研部分内置于 Go 后端，无额外进程。
