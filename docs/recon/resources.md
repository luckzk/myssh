# 资源管理模块 · 契约（对齐上游 api/*.ts）

> **用途**：C 阶段事实依据。字段/端点来自上游 `src/api/*-api.ts`，均为标准 `Api<T>`：
> `/admin/{复数}/paging`、`GET /admin/{复数}`、`GET/POST/PUT/DELETE /admin/{复数}[/{id}]`。

## snippet（命令片段）· group `admin/snippets`
`id, name, content, visibility('public'|'private'), createdBy, createdAt`

## storage（存储）· group `admin/storages`
`id, name, isShare, limitSize, isDefault, createdBy, createdAt, usedSize`

## database-asset（数据库资产）· group `admin/database-assets`
`id, name, type, host, port, database, username, password(加密), description,
status, statusText, gatewayType, gatewayId, tags[], sort, createdAt, updatedAt`
> `type` ∈ mysql/postgres/redis/...；password 加密落库、列表脱敏。

## certificate（证书）· group `admin/certificates`
`id, commonName, subject, issuer, notBefore, notAfter, type, storageKey,
certificate, privateKey(加密), requireClientAuth, issuedStatus, issuedError, isDefault, updatedAt`

## gateway-group（网关组）· group `admin/gateway-groups`
`id, name, description, selectionMode('priority'|'latency'|'random'), members[], createdAt, updatedAt`
- `members[]`: `{gatewayType, gatewayId, priority, enabled}`（存 JSON）

## ssh-gateway（SSH 网关）· group `admin/ssh-gateways`
`id, type, name, configMode('direct'|'credential'|'asset'), ip, port, accountType,
username, password(加密), privateKey(加密), passphrase(加密), credentialId, assetId, status, statusMessage, createdAt`

## agent-gateway（Agent 网关）· group `admin/agent-gateways`
`id, name, ip, os, arch, online, version, sort, stat{...}, createdAt, updatedAt`
> Agent 主动注册上报，多为只读 + 注册参数；本阶段先做基本列表/删除。

## 说明
- `gateway` 菜单为父分组节点（叶子是 ssh-gateway/agent-gateway/gateway-group），非独立 CRUD。
- 含敏感字段者（database-asset/ssh-gateway/certificate.privateKey）加密落库、列表脱敏，与 asset/credential 一致。
- 复杂子对象（gateway-group.members）以 JSON 存储。
