# 10 身份、授权与策略

本章覆盖「谁能登录、谁能看哪些菜单、谁能连哪些资产、连上后能做什么」四层控制。

## 10.1 身份模型

```
department(组织树)
   └─ user ──< user_role >── role ──< role_menu(菜单权限)
       └──< user_group_member >── user_group
```
- **user**：`type` ∈ {admin, user}（探查得到）；可绑部门、用户组、角色。
- **role**：如 `system-administrator`；通过 `role_menu` 决定可见菜单。
- **user_group**：批量授权的载体（授权挂在组上，成员继承）。
- **department**：组织架构树，用于范围化管理与数据隔离。

## 10.2 认证（登录）

呼应 [02 探查](/plan/02-recon)：

1. `POST /api/login` 校验用户名密码。
2. 命中 `login_policy`（IP 段 / 时间段 / 是否强制 MFA）校验。
3. 若启用 TOTP → 返回 `needTotp:true`，二阶段校验。
4. 签发不透明令牌 `NT_...`，写会话表，下发 `X-Auth-Token`（HttpOnly Cookie + 响应体）。
5. 失败累计 → `login_locked` 锁定。
6. **OIDC SSO**：`oidc_client` 配置 issuer/clientId/secret，授权码流换本地会话。

## 10.3 菜单级授权（RBAC，呼应探查）

- 登录后 `GET /api/account/info` 返回 `menus[].checked`，**后端按角色计算**，前端据此渲染侧边栏并过滤路由。
- 权限点 = 菜单 key（44 个）+ 操作（增删改查导出）。
- `role_menu(role_id, menu_key, checked)` 是单一事实来源。

## 10.4 资源级授权（authorised-*）

判定"某用户能否连某资产"：

```
主体(user 或其 user_group)
   ── authorised_asset / authorised_website / authorised_database_asset ──
   ── 关联 strategy(细粒度开关) ── 目标资源
```
- 授权可挂在 **user** 或 **user_group**（组授权对全员生效）。
- 网关建链前与 API 层都会调用统一判定服务 `CanAccess(user, asset) -> (allowed, strategy)`。
- **授权即时生效/回收**：会话建立时再校验，授权被收回则新连接被拒。

## 10.5 操作级授权（strategy 策略）

`strategy` 控制"连上之后能做什么"：

| 开关 | 作用 |
| --- | --- |
| upload / download | 是否允许文件上传/下载 |
| copy / paste | 剪贴板方向控制 |
| recording | 是否强制录像 |
| watermark | 是否水印（防泄密） |
| max_duration / idle_timeout | 会话时长/空闲限制 |
| command_filter_id | 绑定命令过滤规则集 |

这些开关在会话网关与前端交互组件中实时生效（例如禁用复制、隐藏上传按钮、命中命令拦截）。

## 10.6 命令过滤（command-filter）

- 规则集：`type(black/white)` + `rule(正则)` + `action(拒绝/告警/放行)`。
- 编译为正则数组，SSH 会话内逐命令匹配（见 [09 审计](/plan/09-audit)）。
- 可复用绑定到多个策略 / 授权关系。

## 10.7 登录策略与锁定

| 模块 | 作用 |
| --- | --- |
| `login-policy` | IP 白/黑名单、允许时间段、是否强制 MFA、密码复杂度 |
| `login-locked` | 失败次数阈值锁定账号/IP，到期或管理员手动解锁 |

## 10.8 授权判定优先级（建议）

```
1. 账号状态(禁用/锁定) ── 否决一切
2. login_policy        ── 控制能否登录
3. role_menu           ── 控制能看哪些模块
4. authorised_*        ── 控制能连哪些资源
5. strategy            ── 控制连上能做什么
6. command_filter      ── 控制能执行哪些命令
```
逐层收窄，任一层拒绝即终止。所有判定与变更写 `operation_log` 便于审计。
