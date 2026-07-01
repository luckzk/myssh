# 02 现网探查结论

本章记录对 Live Demo 的真实探查过程与结论。**方案的所有判断都建立在这些实测证据之上**，而非凭记忆臆测。

## 2.1 探查目标与方法

- 目标：`https://next.typesafe.cn`（v3.4.0 演示环境）
- 凭据：`manager / manager`（演示账号，仅可读）
- 方法：`curl` 抓取首页 HTML 与响应头 → 分析前端构建产物 → 登录获取 token → 调用已认证 API 还原菜单与数据结构

## 2.2 前端技术栈（由构建产物推断）

首页 `index.html` 的 `modulepreload` 资源名直接暴露了前端依赖：

| 证据（资源名） | 推断结论 |
| --- | --- |
| `react-*.js` | **React** |
| `antd-*.js` | **Ant Design** 组件库 |
| `monaco-*.js` / `monaco-*.css` | **Monaco Editor**（代码/脚本编辑） |
| `xterm-*.js` / `xterm-*.css` | **xterm.js**（Web 终端） |
| `QueryClientProvider`/`useQuery`/`useMutation` | **TanStack Query**（数据请求层） |
| `atom-*.js` | **Jotai**（原子化状态管理） |
| `charts-*.js` | 图表库（仪表盘统计） |
| `useTranslation-*.js` | **i18next / react-i18next**（国际化） |
| `rolldown-runtime-*.js` | **Vite + Rolldown** 构建 |
| `manifest.webmanifest` / `registerSW.js` | **PWA**（vite-plugin-pwa） |
| `license-api-*.js` | 存在**授权/许可证**相关逻辑（商业版能力） |

首页内联的品牌对象：

```js
window.branding = {
  "name": "NEXT TERMINAL",
  "copyright": "Copyright © 2020-2026 指针漂移科技工作室, All Rights Reserved.",
  "version": "v3.4.0",
  "icp": "", "debug": false, "hiddenUpgrade": false
}
```

> 启示：品牌信息由后端注入 HTML，前端据此渲染。我们的实现也应支持**可配置品牌/版本/ICP**。

## 2.3 后端与接口探查

### 登录端点
逐一试探后确认真实登录端点为 **`POST /api/login`**：

```bash
curl -X POST https://next.typesafe.cn/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"manager","password":"manager"}'
# → 200
# {"needTotp":false,"token":"NT_xxxxxxxx..."}
# Set-Cookie: X-Auth-Token=NT_xxxx; Path=/; HttpOnly; SameSite=Lax
```

关键结论：
- **认证令牌**形如 `NT_` 前缀字符串，同时通过 **响应体 `token`** 和 **`X-Auth-Token` Cookie（HttpOnly）** 下发。
- 后续请求可用 `X-Auth-Token` 头或 Cookie 携带令牌。
- 响应含 `needTotp` 字段 → 支持 **TOTP 两步验证**。
- 演示模式下写操作被拦截：`{"code":400,"message":"演示模式下禁止新增、修改和删除。"}` → 说明有**全局演示模式开关**。

### 错误约定
未知端点统一返回 `{"code":500,"message":"Not Found"}`，错误结构为 `{code, message}`。我们应沿用统一错误包络。

### 账号信息端点
`GET /api/account/info`（携带令牌）返回当前用户与**菜单权限树**：

```json
{
  "id": "8760e3b0-...",
  "username": "manager",
  "nickname": "管理员",
  "type": "admin",
  "enabledTotp": false,
  "mfaEnabled": false,
  "roles": ["system-administrator"],
  "menus": [ { "key": "dashboard", "checked": true }, ... ]
}
```

关键结论：
- 用户有 `type`（admin/user）与 `roles`（如 `system-administrator`）。
- **前端菜单按 `menus[].checked` 动态渲染** → 菜单可见性是后端下发的权限结果，前端不硬编码。
- ID 为 **UUID**。

## 2.4 对复制方案的直接影响

| 探查发现 | 设计决策 |
| --- | --- |
| 令牌 `NT_` + HttpOnly Cookie + 头部双通道 | 采用**不透明令牌（opaque token）+ 服务端会话表**，而非纯 JWT，便于强制下线 |
| `needTotp` / `enabledTotp` | 内置 **TOTP MFA** |
| 后端下发菜单树 | **RBAC 菜单权限**由后端计算，前端渲染 |
| 统一 `{code,message}` 错误 | 统一响应包络与错误码体系 |
| 品牌/版本由后端注入 | **可配置品牌**（白标能力） |
| 演示模式开关 | 内置 **demo/只读模式**，方便对外演示 |
| `license-api` | 预留**授权/许可证**扩展点（社区版可置空实现） |
| UUID 主键 | 全表 UUID 主键 |

## 2.5 探查的边界与诚实声明

- 演示模式禁止写操作，因此**未能实测增删改接口的请求体结构**——这些字段需在实现时按业务推导，或参考原项目开源代码（GitHub）。
- 部分常见端点（如 `/api/info`、`/api/dashboard`）返回 Not Found，说明**真实路由前缀/命名与猜测不同**，最终 API 命名应以开源源码为准。
- 协议转换层（guacd 对接）无法从前端探查得到，属于既有公开架构知识（Next Terminal 基于 Apache Guacamole）。
