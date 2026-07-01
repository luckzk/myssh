# 04 技术选型

选型原则：**贴近原版、生态成熟、便于审计与并发会话处理**。

## 4.1 后端（Go）

| 关注点 | 选型 | 理由 |
| --- | --- | --- |
| 语言 | **Go 1.25+** | 同原版；并发会话（goroutine）天然契合；单二进制易部署；与当前依赖、Dockerfile、README 保持一致 |
| Web 框架 | **Echo** 或 Gin | 轻量、中间件生态全；Next Terminal 系 Echo 风格 |
| ORM | **GORM** | 多数据库方言、迁移、关联查询成熟 |
| 数据库 | **PostgreSQL**（主）/ MySQL / SQLite | SQLite 便于单机演示；PG 用于生产 |
| 缓存/队列 | **Redis**（可选） | 会话状态、在线会话心跳、限流；单机可省 |
| SSH 客户端 | `golang.org/x/crypto/ssh` | 原生实现终端与 SFTP |
| 图形协议 | **guacd**（Apache Guacamole） | RDP/VNC/Telnet 转换，自己只实现 guacamole 协议客户端 |
| WebSocket | `nhooyr.io/websocket` 或 `gorilla/websocket` | 会话桥接 |
| 认证令牌 | 不透明令牌 + 服务端会话表 | 支持强制下线（见 [03](/plan/03-architecture)） |
| MFA | `pquerna/otp` | TOTP |
| 调度 | `robfig/cron` | 计划任务、巡检 |
| 配置 | Viper / 环境变量 | 12-factor |
| 日志 | `slog`（标准库） | 结构化日志 |

## 4.2 前端（React）

完全对齐 [02 探查](/plan/02-recon) 得到的真实栈：

| 关注点 | 选型 | 证据/理由 |
| --- | --- | --- |
| 框架 | **React 18** | 探查到 `react-*.js` |
| 组件库 | **Ant Design 5** | 探查到 `antd-*.js` |
| 构建 | **Vite**（原版用 Rolldown） | 探查到 `rolldown-runtime` |
| 数据请求 | **TanStack Query v5** | 探查到 `QueryClientProvider`/`useQuery` |
| 状态管理 | **Jotai** | 探查到 `atom-*.js` |
| Web 终端 | **xterm.js** | 探查到 `xterm-*.js` |
| 代码编辑 | **Monaco Editor** | 脚本/SQL/配置编辑 |
| 图形会话 | **guacamole-common-js** | 渲染 guacd 输出 |
| 国际化 | **react-i18next** | 探查到 `useTranslation` |
| 图表 | Recharts / ECharts | 仪表盘统计 |
| 路由 | React Router | 多模块 SPA |
| PWA | vite-plugin-pwa | 探查到 `manifest.webmanifest` |

## 4.3 协议转换层

| 协议 | 实现方式 |
| --- | --- |
| **SSH / SFTP** | Go 原生 `crypto/ssh`（自实现，便于精细审计） |
| **Telnet** | guacd（或 Go 原生，二选一） |
| **RDP** | **guacd** |
| **VNC** | **guacd** |
| **数据库（MySQL/PG/Redis…）** | Go 数据库驱动 + 自研代理（SQL 审计） |
| **Kubernetes** | client-go + exec/attach（终端复用 xterm.js） |
| **Web 应用** | 反向代理 + 可选录屏 |

## 4.4 基础设施

| 关注点 | 选型 |
| --- | --- |
| 容器化 | Docker + docker-compose（开发/小规模） |
| 编排（规模化） | Kubernetes + Helm |
| 反向代理 | Nginx / Caddy（TLS、WebSocket 升级） |
| 对象存储 | 本地盘 / MinIO / S3 兼容（录像、文件） |
| 可观测 | Prometheus + Grafana（指标）、结构化日志 |
| CI/CD | GitHub Actions / GitLab CI |

## 4.5 仓库与工程结构（建议）

```
next-terminal-clone/
├── server/                  # Go 后端
│   ├── cmd/                  # main 入口
│   ├── internal/
│   │   ├── api/              # HTTP handler（按模块分包）
│   │   ├── gateway/          # 会话网关：ssh / guac / db / k8s
│   │   ├── audit/            # 录像、命令、文件、SQL 审计
│   │   ├── auth/             # 登录、令牌、MFA、RBAC
│   │   ├── model/            # GORM 实体
│   │   ├── repo/             # 数据访问
│   │   ├── service/          # 业务逻辑
│   │   └── scheduler/        # 计划任务
│   └── migrations/           # 数据库迁移
├── web/                      # React 前端
│   ├── src/
│   │   ├── pages/            # 按 44 模块组织
│   │   ├── components/
│   │   ├── api/              # TanStack Query 封装
│   │   ├── store/            # Jotai atoms
│   │   └── i18n/
│   └── vite.config.ts
├── deploy/                   # compose / helm / nginx
└── docs/                     # 本方案（VitePress）
```
