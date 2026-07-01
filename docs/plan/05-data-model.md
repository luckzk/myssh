# 05 数据模型

全表 **UUID 主键**（探查到 ID 为 UUID）、统一 `created_at/updated_at`、软删除可选。以下为核心实体与关系，按域组织。

## 5.1 实体关系总览

```
department ──< user >── user_group_member >── user_group
   │             │
   │             └──< user_role >── role ──< role_menu
   │
authorised: (user|user_group) ── strategy ──< (asset|website|database_asset)
                                   │
                              command_filter

asset ──> credential          asset ──> gateway ──> gateway_group
asset ──< session ──> recording
session ──< exec_command_log
session ──< filesystem_log
database_asset ──< database_sql_log ──> db_work_order
```

## 5.2 身份与组织

### user
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | PK |
| username | string | 唯一 |
| nickname | string | 显示名 |
| password | string | bcrypt/argon2 哈希 |
| type | enum | `admin` / `user`（探查得到） |
| department_id | uuid? | 所属部门 |
| enabled_totp | bool | 是否启用 TOTP（探查得到） |
| totp_secret | string? | 加密存储 |
| status | enum | 正常/禁用/锁定 |
| created_at / updated_at | ts | |

### role / role_menu / user_role
- `role(id, name, type)`：如 `system-administrator`。
- `role_menu(role_id, menu_key, checked)`：**驱动菜单下发**（探查到 `menus[].checked`）。
- `user_role(user_id, role_id)`。

### user_group / department
- `user_group(id, name)` + `user_group_member(group_id, user_id)`：授权载体。
- `department(id, name, parent_id)`：组织树。

## 5.3 资源

### asset（主机资产）
| 字段 | 说明 |
| --- | --- |
| id, name, description | |
| protocol | `ssh`/`rdp`/`vnc`/`telnet`/`k8s` |
| ip, port | 目标地址 |
| credential_id | 绑定凭证 |
| gateway_id | 经由网关（可空=直连） |
| tags / department_id | 归属与标签 |

### credential（凭证）
`id, name, type(password|private_key), username, secret(加密), passphrase(加密)`。**密钥/密码加密落库**，连接时解密。

### database_asset
`id, name, db_type(mysql|postgres|redis|...), host, port, credential_id, gateway_id`。

### 其他资源实体
`snippet`（命令片段）、`storage`（存储空间）、`website`（Web 接入）、`certificate`（TLS 证书）、`gateway` / `ssh_gateway` / `agent_gateway` / `gateway_group`（网关族）。

## 5.4 授权与策略

| 表 | 说明 |
| --- | --- |
| `strategy` | 授权策略：是否允许上传/下载/复制/粘贴/录像等开关 |
| `authorised_asset` | (主体: user/user_group) × asset × strategy |
| `authorised_website` | 网站授权关系 |
| `authorised_database_asset` | 数据库授权关系 |
| `command_filter` | 命令过滤规则集：`type(black/white)`, `rule(正则)`, `action(拒绝/告警/录像)` |
| `login_policy` | 登录策略：IP 段、时间段、是否强制 MFA |

> 鉴权判定：用户对某资产是否可连 = 通过 user 或其 user_group 命中 `authorised_*`，并叠加 `strategy` 的细粒度开关。

## 5.5 会话与审计（核心）

### session（会话）
| 字段 | 说明 |
| --- | --- |
| id | uuid |
| user_id / asset_id | 谁连了什么 |
| protocol | ssh/rdp/... |
| client_ip | 来源 |
| status | `connected` / `disconnected` |
| connected_at / disconnected_at | 在线/离线（对应 online/offline-session 两个视图） |
| recording_path | 录像地址 |
| width/height | 终端/图形尺寸 |

> **在线会话** = `status=connected` 的 session；**离线会话** = 已结束、可回放的 session。二者同一张表不同视图。

### recording（录像）
存储抽象：SSH 用 asciinema/自定义帧格式，图形会话用 guacd 录像格式。`recording(session_id, path, format, size, duration)`。

### exec_command_log / filesystem_log / database_sql_log
| 表 | 关键字段 |
| --- | --- |
| `exec_command_log` | session_id, command, result?, risk_level, created_at |
| `filesystem_log` | session_id, action(upload/download/rm/mkdir), path, size |
| `database_sql_log` | session_id, database_asset_id, sql, rows, duration, status |

### login_log / operation_log / access_log
| 表 | 关键字段 |
| --- | --- |
| `login_log` | user_id, client_ip, user_agent, success, reason, created_at |
| `operation_log` | user_id, action, target, detail(json), created_at |
| `access_log` | user_id, asset_id, created_at（驱动 `access-log-stats` 聚合） |

## 5.6 运维与系统

| 表 | 说明 |
| --- | --- |
| `scheduled_task` | name, cron, type(shell/检查), targets, last_run, status |
| `monitoring` | asset_id, metric, value, collected_at |
| `setting` | key, value（全局配置：品牌、演示模式、会话策略等） |
| `oidc_client` | client_id, secret, issuer, scopes（SSO） |
| `db_work_order` | database_asset_id, sql, applicant, approver, status（审批流） |
| `login_locked` | user_id/ip, locked_until（失败锁定） |

## 5.7 设计要点小结

1. **录像与会话解耦**：session 存元数据，录像走存储抽象，便于归档/转 S3。
2. **授权可叠加策略**：`authorised_* + strategy + command_filter` 三者组合出细粒度控制。
3. **菜单即数据**：`role_menu` 决定前端可见模块，呼应探查到的动态菜单。
4. **敏感字段加密**：credential / totp_secret / oidc secret 均加密落库。
5. **审计表只增不改**：日志类表 append-only，便于合规取证。
