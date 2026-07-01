# Project Memory

## 项目画像

本仓库是复刻 Next Terminal 的堡垒机/运维审计系统，不是单纯的静态模板。

- `server/`: Go 后端，Echo + GORM + SQLite，负责认证、资源管理、SSH/SFTP/guacd 网关与审计。
- `web/`: React + Vite 前端，使用 Bootstrap/Ynex 风格、自研 UI 原语、xterm.js、asciinema-player、guacamole-common-js。
- `docs/`: VitePress 文档，包含实施方案和对 Next Terminal demo/API 的探查证据。
- `Bootstrap5管理员系统前端后台模板 - Ynex/`: 第三方 Bootstrap 后台模板素材，主要用于 UI 参考/资源复用，不是主应用入口。

## 当前实现重点

- 已实现认证闭环、资产/凭证、SSH 终端、终端录像、离线回放、在线会话与强制下线、SFTP 文件管理、RDP/VNC guacd 网关、资源 CRUD、Agent 网关、资产分组、guacd 运维选择、多 tab 终端工作台、SSH 跳板机。
- 后端路由入口在 `server/internal/api/router.go`。
- 数据库迁移和默认管理员种子在 `server/internal/store/store.go`。
- 前端路由入口在 `web/src/App.tsx`。
- 进度记录在 `docs/progress.md`，但部分文档可能落后于代码。

## 已知风险

- 生产安全需要重点关注：默认管理员、默认加密密钥、CORS/WS Origin、SSH HostKey 校验、凭证明文接口二次校验。
- `go.mod`、README、Dockerfile 的 Go 版本必须保持一致。
- 当前自动化测试覆盖偏薄，后端只有少量 guacd 协议测试；核心 API/网关应补集成测试。
- 前端构建可通过，但主 JS chunk 偏大，后续适合做路由级懒加载拆包。
- 录像文件、SQLite 数据库、`node_modules`、构建产物不应提交。

## 工作约定

- 所有说明使用简体中文；代码保持原语言。
- 修改前先看现有实现和文档，优先保持仓库已有模式。
- 安全相关改动要兼顾本地开发便利和生产默认防护，必要时通过环境变量开启宽松模式。
