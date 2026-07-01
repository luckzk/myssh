# 认证模块 · 真实 API 契约（recon evidence）

> **用途**：S1 认证闭环的事实依据。以下端点、请求体、响应结构均来自对 Live Demo
> `https://next.typesafe.cn`（v3.4.0，`manager/manager`，只读）的真实抓取——前端 bundle 中写死的调用
> 字符串 + 实测返回数据，**供后端/前端按此实现对齐**。

## 端点一览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/login-status` | 未登录即可调；返回启用了哪些登录方式 → 前端据此渲染登录页 |
| GET | `/api/branding` | 品牌信息（名称/版权/版本/ICP/debug） |
| GET | `/api/captcha` | 验证码开关与图形数据 |
| GET | `/api/logo` | 站点 Logo（image） |
| POST | `/api/login` | 账号密码登录，签发令牌 |
| POST | `/api/logout` | 登出（清会话） |
| POST | `/api/validate-totp` | TOTP 二阶段校验（needTotp 时） |
| GET | `/api/account/info` | 当前用户 + 菜单权限树（动态菜单来源） |

## 响应结构（实测）

### GET /api/login-status
```json
{ "oidcEnabled": false, "passwordEnabled": true, "status": "Unlogged",
  "webauthnEnabled": true, "wechatWorkEnabled": false }
```
> `status` 已登录时为 `"Logged In"`。前端按 `*Enabled` 决定显示密码框 / 通行密钥(WebAuthn) / 企业微信 / OIDC 入口。

### GET /api/branding
```json
{ "name": "NEXT TERMINAL",
  "copyright": "Copyright © 2020-2026 指针漂移科技工作室, All Rights Reserved.",
  "version": "v3.4.0", "icp": "", "debug": false, "hiddenUpgrade": true }
```

### GET /api/captcha
```json
{ "captcha": "", "enabled": false, "key": "" }
```
> demo 未开验证码（`enabled:false`）。开启时 `captcha` 为图形数据、`key` 为校验键，登录需回传 key+答案。

### POST /api/login
请求体：`{"username":"manager","password":"manager"}`
响应体：
```json
{ "needTotp": false, "token": "NT_4o5xNwc1Dg9iKvzuJm1MLmbnDwKRfJu6FUfkXmpvhTfo" }
```
响应头：
```
Set-Cookie: X-Auth-Token=NT_xxxx...; Path=/; Expires=...; HttpOnly; SameSite=Lax
```
> 令牌为 **不透明令牌**，`NT_` 前缀 + 随机串。**双通道下发**：响应体 `token` + HttpOnly Cookie `X-Auth-Token`。
> 后续请求用 `X-Auth-Token` 请求头 或 Cookie 携带。`needTotp:true` 时需再调 `validate-totp`。

### GET /api/account/info
```json
{ "id": "8760e3b0-…(UUID)", "username": "manager", "nickname": "管理员",
  "type": "admin", "enabledTotp": false, "mfaEnabled": false,
  "roles": ["system-administrator"],
  "language": "", "needChangePassword": false, "forceTotpEnabled": false,
  "menus": [ { "key": "dashboard", "checked": true }, … 79 项 ] }
```
> `menus[].checked` 由后端按角色计算，前端据此渲染侧边栏并过滤路由（菜单即权限）。

## 错误与状态约定（实测 + bundle）

| 现象 | 含义 | 前端处理 |
| --- | --- | --- |
| `{"code":500,"message":"Not Found"}` | 未知路由 | 统一 `{code,message}` 错误包络 |
| `{"code":400,"message":"演示模式下禁止新增、修改和删除。"}` | 演示只读拦截 | 弹提示 |
| HTTP 401 | 未认证 | `API:UN_AUTH` → 跳登录 |
| HTTP 418 | 需首次安装 | `API:REDIRECT` → `/setup` |

## 对实现的约束

- 令牌：服务端会话表（非纯 JWT），便于「在线会话」强制下线。
- 请求前缀：`/api`；WebSocket 前缀 `wss://host/api`（见后续会话模块）。
- 自助类端点在 `/api/account/*`；管理类在 `/api/admin/{资源复数}`；终端工作台在 `/api/access/*`、`/api/portal/*`。
