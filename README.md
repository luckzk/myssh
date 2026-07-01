# Next Terminal Clone

复刻开源堡垒机 [Next Terminal](https://github.com/dushixiang/next-terminal) 的实现仓库。
技术栈与原版对齐：**Go + React + guacd**。规划文档见 [`docs/`](./docs)（VitePress），
真实 API 探查证据见 [`docs/recon/`](./docs/recon)。

## 目录结构

```
server/   Go 后端（Echo + GORM + SQLite，单二进制）
web/      React 前端（Vite + AntD + TanStack Query + Jotai + React Router）
docs/     实施方案（plan/）与现网探查证据（recon/）
docker-compose.yml
```

## 本地开发

**前置**：Go 1.25+、Node 20+。

```bash
# 后端（默认 :8088，sqlite 文件 server/nt.db，自动建表+种子 manager/manager）
cd server && go run ./cmd/server

# 前端（:5173，/api 反代到 :8088）
cd web && npm install && npm run dev
```

打开 http://localhost:5173 ，用 `manager / manager` 登录。

环境变量（`server/internal/config`）：`NT_ADDR`、`NT_DB_DRIVER`、`NT_DB_DSN`、
`NT_ENV`、`NT_DEMO_MODE`、`NT_SEED_ADMIN`、`NT_ENC_KEY`、`NT_ALLOWED_ORIGINS`、
`NT_SECURITY_TOKEN`、`NT_RECORDINGS`、`NT_GUACD_ADDR`、`NT_SSH_HOST_KEY_POLICY`、
`NT_SSH_KNOWN_HOSTS`。

生产环境建议设置：

```bash
NT_ENV=production
NT_ENC_KEY=<至少32字符的随机密钥>
NT_SEED_ADMIN=<管理员>:<强密码>
NT_ALLOWED_ORIGINS=https://your-domain.example
NT_SECURITY_TOKEN=<查看明文凭证的二次校验令牌>
NT_SSH_HOST_KEY_POLICY=known_hosts
NT_SSH_KNOWN_HOSTS=/app/known_hosts
```

## 容器

```bash
docker compose up --build   # 后端 :8088；guacd 待 S2 启用
```

## 开发原则：探查驱动（evidence-based）

实现任何模块前，**先用事实定契约，不猜路径**：

1. 用 Playwright 驱动 live demo（`next.typesafe.cn`，`manager/manager` 只读）对应页面，
   或反编译前端 bundle，拿到该模块**真实的端点、请求体、响应结构**；
2. 落盘到 `docs/recon/<模块>.md`（标明用途，供开发对照）；
3. 后端按契约实现 → 前端实现 → Playwright/手动验证与 demo 行为一致。

API 前缀约定（实测）：`/api/admin/{资源复数}`（管理端 CRUD）、`/api/account/*`（个人中心）、
`/api/access/*` `/api/portal/*`（终端工作台）。分页 `?pageIndex=&pageSize=`，返回 `{items,total}`。

## 进度

- [x] **S0** 脚手架（Go + React + compose）
- [x] **S1** 认证闭环（login-status/branding/captcha/login/logout/account-info，不透明令牌 + 动态菜单）
- [x] **S2** 资产 + 凭证（admin/assets、admin/credentials，敏感字段 AES-GCM 加密 + 列表脱敏 + decrypted）
- [x] **S3** SSH 会话网关（crypto/ssh + PTY，WS 终端）+ 终端录像（asciinema v2）+ 命令日志
- [x] **S4** 离线会话回放（asciinema-player + 命令 seek，复用上游协议）
- [x] **B** 在线会话监控 + 强制下线（活跃会话注册表，真正切断桥接）
- [x] **D** SFTP 文件传输 + 文件审计（pkg/sftp，filesystem_log）
- [x] **E** 图形协议 RDP/VNC（guacd 网关 + guacamole-common-js；guacd 镜像仅 amd64，arm64 本机用 mock 验证握手）

里程碑全图见 [`docs/plan/12-roadmap`](./docs/plan/12-roadmap.md)。
