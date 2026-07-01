# 01 项目概览与功能图谱

## 1.1 Next Terminal 是什么

Next Terminal 是一款**开源、轻量级的堡垒机（运维审计系统 / PAM）**，由「指针漂移科技工作室」（dushixiang）开发。它以单一入口统一管理异构系统的远程访问，并对全过程进行录制与审计。

- **多协议接入**：RDP、SSH、VNC、Telnet、HTTP(S)、Kubernetes
- **会话审计**：登录日志、命令记录、文件传输记录、会话录像与回放
- **细粒度授权**：用户 / 用户组 / 角色 / 部门 + 资产授权 + 命令过滤策略
- **轻量**：基于 Apache Guacamole（guacd）做图形协议转换，资源占用小，可跑在 NAS、低配设备上

竞品定位参考：相比 JumpServer（功能全但偏重）、Teleport（安全强但需改造被管资产），Next Terminal **更轻、更简单、对被管资产透明**，适合个人与中小团队。

## 1.2 我们要复制的目标版本

本方案基于对其 **Live Demo（`https://next.typesafe.cn`）** 的真实探查，目标版本：

| 项 | 值 |
| --- | --- |
| 版本 | **v3.4.0** |
| 品牌 | NEXT TERMINAL |
| 版权 | Copyright © 2020-2026 指针漂移科技工作室 |
| 运行模式 | 演示模式（demo，禁止增删改） |

> 探查的完整细节见 [02 现网探查结论](/plan/02-recon)。

## 1.3 完整功能图谱（44 模块）

这是从已登录账号的 `/api/account/info` 菜单树逆向得到的**真实模块清单**，按六大域归类：

### 域一：资源管理（Resource）
| 模块 | key | 说明 |
| --- | --- | --- |
| 主机资产 | `asset` | SSH/RDP/VNC/Telnet 主机 |
| 数据库资产 | `database-asset` | MySQL/PG/Redis 等数据库连接 |
| 数据库工单 | `db-work-order` | 数据库变更审批流 |
| 凭证 | `credential` | 账号密码 / 密钥，集中托管 |
| 命令片段 | `snippet` | 常用命令收藏，一键下发 |
| 存储 | `storage` | 文件存储空间（上传下载） |
| 网站 | `website` | Web 应用代理接入 |
| 证书 | `certificate` | TLS 证书管理 |
| 网关 | `gateway` | 跳板/出口网关 |
| SSH 网关 | `ssh-gateway` | 基于 SSH 隧道的网关 |
| Agent 网关 | `agent-gateway` | 反向 Agent 接入内网 |
| 网关组 | `gateway-group` | 网关分组与高可用 |

### 域二：日志审计（Log Audit）
| 模块 | key | 说明 |
| --- | --- | --- |
| 在线会话 | `online-session` | 实时监控、强制下线、协同 |
| 离线会话 | `offline-session` | 历史会话录像回放 |
| 命令执行日志 | `exec-command-log` | SSH 命令逐条留痕 |
| 文件传输日志 | `filesystem-log` | 上传/下载/删除审计 |
| 访问日志 | `access-log` | 资源访问明细 |
| 访问统计 | `access-log-stats` | 访问聚合报表 |
| 登录日志 | `login-log` | 平台登录留痕 |
| 操作日志 | `operation-log` | 后台操作审计 |
| 数据库 SQL 日志 | `database-sql-log` | SQL 执行留痕 |

### 域三：运维（Sysops）
| 模块 | key | 说明 |
| --- | --- | --- |
| 计划任务 | `scheduled-task` | 定时巡检/脚本 |
| 工具 | `tools` | 内置运维小工具 |
| 监控 | `monitoring` | 资产可用性/性能监控 |

### 域四：身份（Identity）
| 模块 | key | 说明 |
| --- | --- | --- |
| 用户 | `user` | 账号管理 |
| 用户组 | `user-group` | 批量授权载体 |
| 部门 | `department` | 组织架构树 |
| 角色 | `role` | RBAC 角色 |
| 登录策略 | `login-policy` | IP/时间/MFA 限制 |
| 登录锁定 | `login-locked` | 失败锁定与解锁 |
| OIDC 客户端 | `oidc-client` | 单点登录对接 |

### 域五：授权（Authorised）
| 模块 | key | 说明 |
| --- | --- | --- |
| 命令过滤 | `command-filter` | 黑白名单/正则拦截 |
| 策略 | `strategy` | 授权策略编排 |
| 资产授权 | `authorised-asset` | 主机授权关系 |
| 网站授权 | `authorised-website` | Web 授权关系 |
| 数据库授权 | `authorised-database-asset` | 数据库授权关系 |

### 域六：系统（System）
| 模块 | key | 说明 |
| --- | --- | --- |
| 仪表盘 | `dashboard` | 概览统计 |
| 设置 | `setting` | 全局配置 |
| 开发者 | `dev` | 调试/接口工具 |

## 1.4 复制范围与原则

- **完整对标**：以上 44 模块全部纳入规划，按里程碑分批交付（见 [12 里程碑路线图](/plan/12-roadmap)）。
- **同栈复刻**：后端 Go，前端 React + Ant Design，协议转换复用 guacd。
- **审计优先**：所有接入路径必须可录制、可回放、可检索——这是堡垒机的立身之本，不能后补。
- **先闭环后铺开**：第一阶段先打通「SSH 接入 → 凭证 → 授权 → 会话录像 → 回放」核心闭环，再横向扩展协议与模块。
