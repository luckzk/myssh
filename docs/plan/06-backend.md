# 06 后端模块设计

后端按「API 服务 + 会话网关 + 审计管道 + 调度器」四块组织，下面给出包结构、统一约定与各模块要点。

## 6.1 统一约定（来自探查）

### 响应包络
```go
type Resp struct {
    Code    int         `json:"code"`
    Message string      `json:"message"`
    Data    interface{} `json:"data,omitempty"`
}
// 成功: {code:200, data:...}  失败: {code:400/500, message:"..."}
```
> 探查证据：错误统一形如 `{"code":500,"message":"Not Found"}`、`{"code":400,"message":"演示模式下禁止新增、修改和删除。"}`。

### 中间件链
```
Recover → RequestID → CORS → AuthToken → RBAC → DemoGuard → RateLimit → Handler → OperationLog
```
- **AuthToken**：解析 `X-Auth-Token`（头或 Cookie）→ 查会话表 → 注入当前用户。
- **RBAC**：按路由所需权限校验角色/菜单。
- **DemoGuard**：演示模式下拦截写操作（对应探查到的演示拦截）。
- **OperationLog**：写操作旁路记 `operation_log`。

## 6.2 认证模块（auth）

| 能力 | 实现 |
| --- | --- |
| 登录 `POST /api/login` | 校验密码 → 若 `enabled_totp` 返回 `needTotp:true` 等二阶段；否则签发令牌 |
| 令牌 | 不透明 `NT_` + 随机熵，存 `sessions` 表（userId、exp、ip、mfaPassed） |
| 登出 | 删除会话表记录（前端清 Cookie） |
| MFA | TOTP 校验、绑定/解绑 |
| 登录策略 | 校验 IP/时间段/强制 MFA（`login_policy`） |
| 登录锁定 | 连续失败计数 → 写 `login_locked` |
| OIDC SSO | 对接 `oidc_client`，授权码流换取本地会话 |
| 账号信息 | `GET /api/account/info` 返回用户 + 计算后的菜单树 |

## 6.3 资源模块（resource）

每个资源一套标准 CRUD + 分页 + 导入导出。关键非平凡逻辑：

- **credential**：保存时加密 secret/passphrase；提供"连接时解密"内部接口，绝不回传明文给前端。
- **asset**：连接前做**授权校验**（用户→授权→策略）；支持探活（配合 monitoring）。
- **gateway 族**：维护到内网的隧道；`agent_gateway` 走反向连接（Agent 主动回连，穿透内网）。
- **website**：注册反向代理路由，可选录屏。
- **certificate**：TLS 证书托管，供 website/接入层使用。

## 6.4 会话网关（gateway）

这是堡垒机的心脏。统一接口、多协议实现：

```go
type SessionGateway interface {
    Open(ctx, session *Session, conn *websocket.Conn) error // 桥接直到结束
}
```

| 实现 | 技术 | 审计旁路 |
| --- | --- | --- |
| `SSHGateway` | `crypto/ssh` + PTY | 录像帧 + 命令解析 + 命令过滤 |
| `SFTPSubsystem` | `pkg/sftp` | filesystem_log + storage |
| `GuacGateway` | guacamole 协议客户端 ↔ guacd | guacd 录像（RDP/VNC/Telnet） |
| `DBGateway` | 数据库驱动代理 | database_sql_log（SQL 解析/改写） |
| `K8sGateway` | client-go exec | 录像帧（复用终端审计） |

要点：
- **令牌即时校验 + 鉴权**：建链前再次确认该用户当前对该资产有效授权（防止授权刚被收回）。
- **背压与超时**：空闲超时、最大时长（来自策略）→ 自动断开并落 `offline-session`。
- **强制下线**：监听控制信道，管理员下线指令立即关闭会话。

## 6.5 审计管道（audit）

旁路、异步、不阻塞主转发：

```
会话字节流 ──┬─→ 录像写入器(帧+时间戳) ─→ storage
            ├─→ 行缓冲 → 命令分词 → exec_command_log
            ├─→ command_filter 匹配 → 命中则阻断/告警
            └─→ SFTP/SQL 事件 → 对应日志表
```
- 录像格式：终端用 asciinema v2 或自定义二进制帧；图形用 guacd recording。
- 写入用带缓冲的异步 channel + 批量落库，避免拖慢交互。
- **访问统计**（`access-log-stats`）由调度器周期聚合 `access_log`。

## 6.6 授权模块（authorised）

- 提供"主体（user/user_group）× 资源 × 策略"的授权管理 CRUD。
- 提供**鉴权判定服务**（`CanAccess(user, asset) (allowed, strategy)`），被网关与 API 复用。
- `command_filter` 编译为正则集合，会话内实时匹配。

## 6.7 运维与系统模块

| 模块 | 要点 |
| --- | --- |
| `scheduled-task` | cron 调度 shell/巡检任务，结果留痕 |
| `monitoring` | 周期采集资产指标（探活、负载），供仪表盘 |
| `tools` | 内置工具（如端口探测、ping） |
| `setting` | 全局配置读写（品牌、演示模式、会话默认策略） |
| `dashboard` | 聚合统计接口（在线会话数、资产数、近期登录等） |
| `db-work-order` | 数据库变更审批流：提交→审批→执行→留痩 |
| `dev` | 调试/接口自测（生产可关闭） |

## 6.8 接口风格

- REST，前缀 `/api/...`；WebSocket 走 `/ws/...`（会话）。
- 分页统一 `?pageIndex=&pageSize=&sort=&filter=`，返回 `{items, total}`。
- 所有写操作经 `DemoGuard` 与 `OperationLog`。
