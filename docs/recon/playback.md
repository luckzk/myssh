# 离线会话回放 · 契约（对齐上游源码）

> **用途**：S4 的事实依据。来自上游 Apache-2.0 源码 `pages/audit/OfflineSessionPage.tsx`、
> `pages/access/TerminalPlayback.tsx`、`api/session-api.ts`、`api/session-command-api.ts`。
> 我方录像已是 asciinema v2，可直接复用上游 `asciinema-player` 回放。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/sessions/paging?status=disconnected&...` | 离线会话列表（`status=connected` 即在线会话，同表不同视图） |
| GET | `/api/admin/sessions/{id}` | 会话详情（含 recordingSize、connectedAt 等） |
| GET | `/api/admin/sessions/{id}/recording` | **返回 .cast 录像**（asciinema-player 直接吃这个 URL） |
| GET | `/api/admin/session-commands/paging?sessionId=&sortField=createdAt` | 该会话命令列表 |
| POST | `/api/admin/sessions/{id}/disconnect` | 强制断开（在线会话） |
| POST | `/api/admin/sessions/clear` | 清空 |

## Session 关键字段（上游 session-api.ts）

```ts
interface Session {
  id, protocol, ip, port, username, assetId, assetName,
  userId, clientIp, status,
  connectedAt, disconnectedAt, connectionDuration,
  recording, recordingSize, commandCount, auditStatus
}
interface SessionCommand { id, sessionId, riskLevel, command, result, createdAt }
```

## 回放实现（上游）

```ts
import * as AsciinemaPlayer from 'asciinema-player'
const url = `${baseUrl()}/admin/sessions/${sessionId}/recording`
AsciinemaPlayer.create(url, playerEl, { fit: 'both', autoPlay: true })
```
- 播放器自带 播放/暂停/倍速/进度。
- **命令跳转**：点命令 → `pos = (cmd.createdAt - session.connectedAt)/1000` → `player.seek(pos - 0.5)`。
  - 这要求命令时间戳与录像起点对齐 → 我方 `connectedAt` 即录像 header 的起点，天然对齐。

## 我方实现说明

- 录像下载端点：`GET /api/admin/sessions/{id}/recording`，读 `recording_path` 的 `.cast` 原样返回（`Content-Type: text/plain`）。
- 列表：复用 S3 的 `connect_session` 表，`status` 过滤 connected/disconnected。
- 命令：复用 S3 的 `exec_command_log`，按 `sessionId` 过滤；端点命名对齐上游 `admin/session-commands`。
- 前端：装 `asciinema-player` 直接复用；离线列表页 + 回放页（播放器 + 命令列表 + seek）。
