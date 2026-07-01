# SSH 会话 / 终端 · 契约（已对齐上游源码）

> **用途**：S3 的事实依据。**已根据上游 Apache-2.0 源码**（`src/pages/access/Terminal.ts`、
> `AccessTerminal.tsx`、`api/portal-api.ts`）确认真实协议，并据此对齐本仓库实现，
> 以便后续直接复用上游终端 / 回放 / 图形组件。见 [15 复用可行性](../plan/15-reuse-feasibility)。

## demo / 上游抓到的事实

| 步骤 | 端点 | 说明 |
| --- | --- | --- |
| 建会话 | `POST /api/portal/sessions?securityToken=` body `{assetId}` | 返回 `ExportSession{id, protocol, ...}` |
| 终端流 | `WS /api/access/terminal?cols=&rows=&sessionId=` | SSH/Telnet/K8s 终端（xterm.js） |
| 图形流 | `WS /api/access/graphics`（Guacamole.WebSocketTunnel） | RDP/VNC（guacd） |
| 统计 | `GET /api/access/terminal/{id}/stats` | 会话流量/状态 |

- WS 基址：`wss://host/api`（https 时），同源自动携带 HttpOnly 令牌。
- 协议分流：终端类走 `access/terminal`，图形类走 `access/graphics`。

## WS 帧协议（上游格式 · 本仓库已采纳）

帧是**纯文本**：`第1个字符 = 消息类型(单个数字)`，其后为内容字符串。
编码：`toString() === String(type) + content`；解码：`type=parseInt(s[0]); content=s.slice(1)`。

| 类型 | 值 | 方向 | 内容 |
| --- | --- | --- | --- |
| Error | 0 | S→C | 错误信息 |
| Data | 1 | 双向 | 终端字节（输入/输出） |
| Resize | 2 | C→S | `"cols,rows"`（如 `120,32`） |
| Join | 3 | S→C | 协同观看者加入 |
| Exit | 4 | S→C | 会话退出 |
| DirChanged | 5 | S→C | SFTP 当前目录变化 |
| KeepAlive | 6 | S→C | 服务端保活；客户端收到后回 `Ping` |
| AuthPrompt | 7 | S→C | 请求认证信息（如二次/改密） |
| AuthReply | 8 | C→S | 回复认证信息 |
| Ping | 9 | C→S | 延迟探测，内容为时间戳 |

> 例：客户端发送一次回车 = `"1\r"`；上报尺寸 = `"2120,32"`；服务端输出 = `"1<终端输出>"`。

## 旁路审计（S3-3，不变）
- 录像：终端输出按 **asciinema v2** 帧 `[偏移秒,"o",数据]` 落 `storage`。
- 命令：对客户端 Data 帧做行缓冲，遇回车切分 → `exec_command_log`。
- 结束：写 `session` 的 `disconnected_at`、`recording_path`（驱动 offline-session 回放）。

## 本仓库实现说明
- 建会话端点：本仓库用 `POST /api/account/sessions`（自助域），语义同 `portal/sessions`；
  后续接入授权域后可加 `securityToken` 二次校验。
- WS 端点与帧格式**与上游一致**，确保可直接对接上游 `AccessTerminal.tsx` / `TerminalPlayback.tsx`。
