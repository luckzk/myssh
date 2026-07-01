# Agent 网关 · 契约（探查驱动）

> **用途**：资源管理域 Agent 网关模块的事实依据。端点取自真实抓包
> `docs/recon/raw/route-summary.json`（landedURL `/agent-gateway`），**非猜测**。
> Agent 持注册 Token 主动上报；管理端以「只读列表 + Token 管理 + 版本展示」为主。

## 实测端点（live demo `/agent-gateway` 页发起）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/agent/version` | 当前 Agent 二进制版本（安装/升级提示） |
| GET | `/api/admin/agent-gateway-tokens` | 注册 Token 列表 |
| GET | `/api/admin/agent-gateways/paging?pageIndex=&pageSize=&sortField=sort&sortOrder=desc` | 已注册 Agent 分页 |

## 数据模型（对齐上游 agent-gateway-api.ts 字段）

### agent-gateway（group `admin/agent-gateways`）
`id, name, ip, os, arch, online(bool), version, sort, stat{...}(JSON), createdAt, updatedAt`
> Agent 自注册，管理端不手动新增；标准 CRUD 中实际使用列表 + 删除。按 `sort` 升序。

### agent-gateway-token（group `admin/agent-gateway-tokens`）
`id, name, token, createdBy, createdAt`
> 标准 CRUD：`create` 生成新 token（服务端用 UUID 填充）、列表、删除。

## 本仓库实现

- 后端：两模型走通用 `Crud[T]`（agent-gateways 用 `WithOrder("sort asc, created_at desc")`；
  agent-gateway-tokens 用 `WithBeforeSave` 在 `token==""` 时生成 UUID）。
- **Agent 对接端点**（`server/internal/api/resource/agent.go`，挂 `/api/agent`，公开）：
  - `GET /agent/version` → `{version:"v0.1.0"}`（常量）。
  - `POST /agent/register`（`{token,name,ip,os,arch,version}`）→ 校验 token 存在 →
    按 `ip` upsert 一条 AgentGateway 并置 `online=true`；无效 token 返回 `{code:400}`。
- 前端 `AgentGatewayPage.tsx`：版本提示条 + Token 表（生成/复制/删除）+ Agent 表（状态 Tag/删除）。

## 诚实边界

真实 Agent 二进制不在本仓库范围（类比 E 阶段 guacd）。
`POST /api/agent/register` 让「生成 Token → 注册 → 列表可见」链路真实可跑——
用 `curl` 模拟 Agent 即可端到端验证，无需部署真实 Agent。
