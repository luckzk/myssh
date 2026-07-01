# 资产 & 凭证模块 · 真实 API 契约（recon evidence）

> **用途**：S2 的事实依据。端点来自前端 bundle 写死的调用串（`*-api-*.js`），
> 字段结构来自实测 `paging` 返回 + 表单页 chunk。**供后端/前端按此实现对齐**。

## 凭证 credential

**资源组**：`admin/credentials`（前缀 `/api`）。标准 REST + 以下定制端点：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/credentials/paging?pageIndex=&pageSize=` | 分页列表，返回 `{items,total}` |
| GET | `/api/admin/credentials` | 全部（下拉用） |
| GET | `/api/admin/credentials/{id}` | 详情 |
| POST | `/api/admin/credentials` | 新增 |
| PUT | `/api/admin/credentials/{id}` | 修改 |
| DELETE | `/api/admin/credentials/{id}` | 删除 |
| GET | `/api/admin/credentials/{id}/decrypted?securityToken=` | **查看明文**（需 securityToken 二次校验） |
| GET | `/api/admin/credentials/{id}/public-key` | 取密钥对的公钥 |
| POST | `/api/admin/credentials/gen-private-key` | 生成密钥对 |

**字段**（表单 + 实体）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | |
| name | string | 名称 |
| type | enum | `password` \| `private-key` |
| username | string | 登录用户名 |
| password | string | 密码（**加密落库**，列表不回传明文） |
| privateKey | string | 私钥（加密） |
| passphrase | string | 私钥口令（加密） |
| description | string | 备注 |
| createdAt | epoch ms | |

> 关键：`password/privateKey/passphrase` 三个敏感字段**对称加密存储**，列表/详情默认返回脱敏（空或掩码），
> 仅 `/{id}/decrypted` 且带有效 `securityToken` 时返回明文。

## 主机资产 asset

**资源组**：`admin/assets`。标准 REST + 定制端点：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/assets/paging?...` | 分页 `{items,total}` |
| GET | `/api/admin/assets/groups` / `PUT .../groups` / `DELETE .../groups/{id}` | 分组（树）增删 |
| GET | `/api/admin/assets/tree?protocol=` | 资产树 |
| GET | `/api/admin/assets/tags` | 标签集 |
| GET | `/api/admin/assets/logos` | 内置图标 |
| GET | `/api/admin/assets/{id}/decrypted?securityToken=` | 查看明文内联凭证 |
| PATCH | `/api/admin/assets/{id}/basic` / `/advanced` | 分段更新基础/高级配置 |
| POST | `/api/admin/assets/{id}/detect-os` | 探测操作系统 |
| POST | `/api/admin/assets/{id}/wol` | Wake-on-LAN |
| POST | `/api/admin/assets/checking` | 批量探活 |
| POST | `/api/admin/assets/change-gateway` / `change-group` / `change-owner` | 批量改属性 |
| POST | `/api/admin/assets/sort` | 排序（分数索引） |
| POST(form) | `/api/admin/assets/import` | 批量导入 |

**字段**（实测 paging 单条，已脱敏密码为加密串）：

```json
{
  "id": "c4a7a8e2-…(uuid)", "name": "vnc", "alias": "",
  "logo": "data:image/png;base64,…",
  "protocol": "vnc",                // ssh | rdp | vnc | telnet | ...
  "ip": "172.18.0.1", "port": 15901,
  "accountType": "password",        // password | private-key | credential（凭证引用）
  "credentialId": "",               // accountType=credential 时引用 credential
  "username": "root",
  "password": "aW7oxTK9KA3Gy7Ua620CKg==",  // 内联凭证·加密串（非明文）
  "privateKey": "", "passphrase": "",
  "description": "", "status": "active", "statusText": "",
  "gatewayType": "", "gatewayId": "",
  "tags": [], "attrs": null,
  "os": "",
  "groupId": "AG_81c72ba54a8bc435d7885b8f3db02e5f",  // 分组 id（前缀 AG_）
  "sort": "0|iiiiik",               // 分数索引（LexoRank 风格）排序键
  "groupFullName": "图形协议",       // 派生：分组全路径名
  "createdAt": 1775963969523, "updatedAt": 1775963980994
}
```

**要点**：
- 凭证有两种来法：**内联**（`accountType=password|private-key`，密码/密钥加密存在 asset 上）或**引用**（`accountType=credential` + `credentialId`）。
- `sort` 是**分数索引字符串**（拖拽排序不重排全表），`groupId` 关联资产分组树，`groupFullName` 为派生展示字段。
- `password` 等在列表里是加密串，查看明文需 `/{id}/decrypted?securityToken=`。
- demo 环境 assets 共 3 条（ssh/rdp/vnc 各一），credentials 为空。
