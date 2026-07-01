# 07 前端设计

前端是一个 **React 18 + Ant Design 5** 的 SPA（PWA），栈与原版对齐（见 [02 探查](/plan/02-recon) / [04 选型](/plan/04-tech-stack)）。

## 7.1 应用骨架

```
<App>
 ├─ <BrandingProvider>   // 读后端注入的 window.branding（名称/版本/ICP）
 ├─ <QueryClientProvider> // TanStack Query
 ├─ <JotaiProvider>       // 全局原子状态（当前用户、主题、语言）
 ├─ <I18nProvider>        // react-i18next（中/英）
 └─ <Router>
      ├─ /login                       公共
      └─ <AuthLayout>                 鉴权后
           ├─ <SiderMenu/>            ← 由后端菜单树动态渲染
           └─ <Routes/>              ← 44 模块页面
```

## 7.2 动态菜单（呼应探查）

登录后调 `GET /api/account/info`，用返回的 `menus[].checked` **动态生成侧边栏与可访问路由**，前端不硬编码权限：

```ts
const { data } = useQuery(['account'], fetchAccountInfo)
const visibleMenus = data.menus.filter(m => m.checked)
// 据此渲染 <Menu> 并过滤 <Route>
```
未授权模块既不显示菜单，路由也拦截（双保险）。

## 7.3 数据层（TanStack Query）

- 每个模块一组 hooks：`useAssets()`, `useCreateAsset()`...
- 列表统一分页参数；写操作 `useMutation` + 失效缓存（`invalidateQueries`）。
- 全局 `axios`/`fetch` 封装：注入 `X-Auth-Token`，统一解包 `{code,message,data}`，401 跳登录，演示模式 400 弹提示。

## 7.4 关键交互组件

### Web 终端（xterm.js）
- SSH/Telnet/K8s 会话：开 `WebSocket /ws/ssh?...`，xterm 输入→ws，ws→xterm 输出。
- 支持自适应尺寸（`fit` addon）、复制粘贴策略（受 strategy 控制）、主题。

### 图形会话（guacamole-common-js）
- RDP/VNC：用 `Guacamole.Client` + `WebSocketTunnel` 连到后端 GuacGateway。
- 处理剪贴板、分辨率自适应、文件传输面板。

### 录像回放
- 终端录像：自研/asciinema 播放器，支持快进、倍速、按命令跳转。
- 图形录像：guacd recording 播放器。

### 代码/SQL 编辑（Monaco）
- snippet 编辑、计划任务脚本、数据库工单 SQL，带语法高亮与校验。

### 仪表盘
- Recharts/ECharts 渲染在线会话、资产数、登录趋势等统计。

## 7.5 页面组织（按 44 模块）

```
src/pages/
 ├─ dashboard/
 ├─ resource/   asset, database-asset, db-work-order, credential,
 │              snippet, storage, website, certificate, gateway*…
 ├─ audit/      online-session, offline-session, *-log, access-log-stats
 ├─ sysops/     scheduled-task, tools, monitoring
 ├─ identity/   user, user-group, department, role, login-policy,
 │              login-locked, oidc-client
 ├─ authorised/ command-filter, strategy, authorised-*
 └─ system/     setting, dev
```
多数模块是「列表（ProTable）+ 抽屉表单 + 详情」三件套，可用**代码生成/模板**快速铺开，把精力集中在终端、录像、授权这些非平凡交互上。

## 7.6 国际化、主题、PWA

- **i18n**：`react-i18next`，中/英文案分离，对应探查到的 `useTranslation`。
- **主题**：AntD ConfigProvider，明暗主题 + 品牌色（Jotai 持久化）。
- **PWA**：vite-plugin-pwa，离线壳 + 可安装（对应探查到的 `manifest.webmanifest` / `registerSW.js`）。
- **白标**：标题/Logo/版权读后端 branding，支持私有化定制。

## 7.7 工程化

- Vite 构建、按模块代码分割（探查到大量 `modulepreload` 分包，如 `antd`/`monaco`/`xterm` 独立 chunk），首屏只加载必要包。
- ESLint + Prettier + TypeScript 严格模式。
- E2E：Playwright 覆盖登录、连接 SSH、回放等关键路径。
