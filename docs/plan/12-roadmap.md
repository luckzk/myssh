# 12 里程碑路线图

完整对标 44 模块，分 6 个里程碑递进交付。先打通核心审计闭环，再横向铺开协议与模块。时间为团队（2~3 名全栈）粗估，可按人力缩放。

## M1 · 核心闭环（约 5 周）
**目标：一条 SSH 接入路径完整可审计可回放。**
- 工程脚手架（Go 后端 + React 前端 + CI + compose）
- 认证：登录、不透明令牌、会话表、`account/info` 菜单下发（对齐探查）
- 资源最小集：`asset`、`credential`（加密）
- 会话网关：`SSHGateway`（xterm.js ⇄ ws ⇄ crypto/ssh）
- 审计最小集：终端录像 + `exec-command-log` + `offline-session` 回放
- 基础 RBAC：user / role / role_menu
- ✅ 验收：用户登录→连 SSH 资产→操作被录像→可回放→命令留痕

## M2 · 授权与图形协议（约 5 周）
- 授权体系：`authorised-asset`、`strategy`、`command-filter`、`user-group`、`department`
- guacd 集成：`GuacGateway` + RDP/VNC 接入 + guacd 录像 + 回放
- SFTP 文件传输 + `filesystem-log` + `storage`
- `online-session` 实时监控 + 强制下线
- ✅ 验收：细粒度授权生效；RDP 会话可连可回放；文件操作留痕

## M3 · 身份与安全增强（约 4 周）
- MFA（TOTP）、`login-policy`、`login-locked`
- OIDC SSO（`oidc-client`）
- 审计补全：`login-log`、`operation-log`、`access-log` + `access-log-stats`
- 网关族：`gateway`、`ssh-gateway`、`gateway-group`、`agent-gateway`（内网穿透）
- ✅ 验收：可对接企业 SSO；内网资产经网关可达；审计报表可用

## M4 · 数据库与工单（约 4 周）
- `database-asset` 接入 + Web SQL 控制台（Monaco）
- `DBGateway` + `database-sql-log`（SQL 审计）
- `db-work-order` 审批流（提交→审批→执行→留痕）
- `authorised-database-asset`
- ✅ 验收：数据库可连可审计；高危 SQL 走工单

## M5 · 运维与扩展协议（约 4 周）
- `scheduled-task`（cron 巡检/脚本）、`monitoring`（资产探活/指标）、`tools`
- `website` + `authorised-website`（Web 应用代理）、`certificate`
- `snippet`（命令片段）
- Kubernetes 接入（client-go exec）
- ✅ 验收：计划任务/监控可用；Web 应用可代理接入

## M6 · 平台化与打磨（约 4 周）
- `dashboard` 统计可视化、`setting`（品牌/演示模式/保留期）、`dev`
- 国际化（中/英）、明暗主题、PWA、白标
- 规模化：K8s/Helm、会话网关水平扩展、录像入 S3
- 性能压测、安全加固、合规清单落实（见 [13](/plan/13-risks)）
- ✅ 验收：44 模块齐全；可私有化部署；通过压测与安全检查

## 总览

| 里程碑 | 周期 | 关键产出 |
| --- | --- | --- |
| M1 | 5 周 | SSH 审计闭环 |
| M2 | 5 周 | 授权 + RDP/VNC + 文件审计 |
| M3 | 4 周 | MFA/SSO + 网关 + 审计报表 |
| M4 | 4 周 | 数据库审计 + 工单 |
| M5 | 4 周 | 运维 + Web/K8s + 片段 |
| M6 | 4 周 | 平台化打磨 + 规模化 |
| **合计** | **~26 周** | **44 模块完整对标** |

> 若只要 MVP，做完 **M1+M2（约 10 周）** 即得到一个可用的轻量堡垒机（SSH+RDP、授权、审计、回放）。
