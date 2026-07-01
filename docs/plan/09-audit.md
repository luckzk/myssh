# 09 审计与会话录像

审计是堡垒机的立身之本。复制版要求**所有接入路径可录制、可回放、可检索**，本章给出录像格式、各类日志与回放体系。

## 9.1 审计能力全景（对应探查到的 9 个日志模块）

| 模块 key | 内容 | 来源 |
| --- | --- | --- |
| `online-session` | 实时在线会话，可监控/协同/强制下线 | 会话网关心跳 |
| `offline-session` | 历史会话 + 录像回放 | 会话结束落库 |
| `exec-command-log` | SSH/K8s 命令逐条 | 终端输入解析 |
| `filesystem-log` | 上传/下载/删除 | SFTP 旁路 |
| `database-sql-log` | SQL 执行 | DB 代理 |
| `access-log` | 资源访问明细 | 连接事件 |
| `access-log-stats` | 访问聚合报表 | 调度器聚合 |
| `login-log` | 平台登录 | 认证模块 |
| `operation-log` | 后台操作 | OperationLog 中间件 |

## 9.2 会话录像

### 终端录像（SSH/Telnet/K8s）
- 格式：**asciinema v2** 或自定义二进制帧（`[时间偏移, 数据]`）。
- 写入：审计管道异步缓冲 → storage（本地/S3）。
- 体积小、可纯文本回放、可做命令级索引。

### 图形录像（RDP/VNC）
- 用 **guacd 原生录制**（`recording-path`），产出 guacamole 录像文件。
- 回放用对应的 guacd 录像播放器（前端 `guacamole-common-js`）。

### 录像生命周期
```
会话开始 → 创建录像文件 → 实时写帧
会话结束 → 关闭文件 → session.recording_path 落库
调度器   → 超期录像归档至 S3 / 按策略清理
```

## 9.3 实时监控与协同（online-session）

- 管理员可**实时观看**他人会话（订阅同一录像/字节流的只读副本）。
- **强制下线**：向会话网关发控制指令，立即关闭目标会话。
- **会话协同/接管**：可选，多人共享同一终端（受权限控制）。
- 在线判定：会话网关周期心跳更新 `session.status` 与 `connected_at`。

## 9.4 命令审计与拦截（exec-command-log + command-filter）

```
键入字节 → 行缓冲(遇回车) → 命令分词/规范化
   → 写 exec_command_log(command, risk_level)
   → 匹配 command_filter 正则集
        命中 black → 阻断 + 告警
        命中 white → 放行
        高危      → 标记 risk_level=high
```
- 风险分级用于审计高亮与告警。
- 拦截动作受策略：拒绝执行 / 仅告警 / 强制录像留证。

## 9.5 文件与 SQL 审计

- **filesystem-log**：每次 SFTP upload/download/rm/mkdir 记录路径、大小、方向；文件可留存到 storage 以便取证。
- **database-sql-log**：SQL 原文、影响行数、耗时、成功/失败；高危 SQL 关联 `db_work_order` 审批。

## 9.6 登录与操作审计

- **login-log**：每次登录（成功/失败、IP、UA、原因），失败累计触发 `login_locked`。
- **operation-log**：所有后台写操作由中间件统一记录（操作者、动作、对象、详情 JSON、时间），append-only。

## 9.7 访问统计（access-log-stats）

- 原始 `access_log` 记录每次资源访问。
- 调度器周期聚合为报表：按用户/资产/时间维度统计访问次数、时长，供仪表盘与合规报告。

## 9.8 合规与取证要点

1. **日志只增不改**（append-only），防篡改；可选哈希链/外发 SIEM。
2. **录像加密存储**，访问录像本身也要鉴权并留 `operation_log`。
3. **保留期可配置**，到期归档/清理由 `scheduled-task` 执行。
4. **时间统一**：所有审计时间用 UTC 存储，前端按时区展示。
5. 录制行为涉及隐私合规，需在 [13 风险](/plan/13-risks) 中的合规清单内落实告知与授权。
