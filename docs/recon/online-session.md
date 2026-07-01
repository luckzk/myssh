# 在线会话监控 / 强制下线 · 契约（对齐上游）

> **用途**：B 阶段事实依据。来自上游 `pages/audit/OnlineSessionPage.tsx`、`api/session-api.ts`、
> `pages/access/TerminalMonitor.tsx`。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/sessions/paging?status=connected&...` | 在线会话列表（与离线同表，`status` 区分） |
| POST | `/api/admin/sessions/{id}/disconnect` | **强制下线**：切断正在进行的会话 |
| WS | `/api/admin/sessions/{id}/terminal-monitor?sessionId=` | 实时观看（只读，复用 Data/Join/Exit 帧）|

## 行为

- 列表：`getPaging({status:'connected'})`，前端定时刷新（轮询）。
- 强制下线：`disconnect(id)` 必须**真正切断**正在桥接的 WS/SSH，而不仅是改库状态——
  因此后端需维护**活跃会话注册表**（sessionId → 取消函数），disconnect 时触发取消。
- 实时监控：`terminal-monitor` WS 把目标会话的输出**广播**给观看者（只读）。

## 本仓库实现范围（B 阶段）

- ✅ 在线列表（status=connected，前端轮询刷新）
- ✅ **强制下线**：活跃会话注册表 + disconnect 真正切断桥接
- ✅ 进程重启自愈：启动时把残留 `connected` 标记为 `disconnected`（避免僵尸在线）
- ⏳ 实时监控 `terminal-monitor`（输出广播）—— 后续阶段实现（需会话输出多路广播）
