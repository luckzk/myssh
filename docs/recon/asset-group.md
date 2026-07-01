# 资产分组 · 契约（对齐上游 asset-api.ts）

> **用途**：G 阶段事实依据。资产分组是 demo 资产页左侧的树面板（新建/拖拽/折叠），
> 每个资产归属一个分组（`groupId`），列表可按分组过滤。

## 端点（group = `admin/assets`）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/assets/groups` | 返回**整棵分组树** `TreeDataNode[]`（`{key,title,children}`）|
| PUT | `/api/admin/assets/groups` | 保存**整棵树**（建/改名/排序/嵌套一次提交）|
| DELETE | `/api/admin/assets/groups/{groupId}` | 删除分组节点 |
| GET | `/api/admin/assets/paging?groupId=&...` | 资产分页，可按分组过滤 |

## 数据

- 分组节点 `key` = `groupId`（demo 实测前缀 `AG_`）。
- `TreeDataNode = { key, title, children? }`（AntD 树结构）。
- 资产含 `groupId`（归属）+ `groupFullName`（派生：分组全路径名，如「图形协议」）。
- demo 实测分组：`文本协议`、`图形协议`，资产 vnc/rdp→图形协议、ssh→文本协议。

## 交互（demo）

- 左侧「Group」面板：`New group` 新建、拖拽排序、`Collapse groups` 折叠。
- 点击某分组 → 资产列表按该 `groupId` 过滤。
- 资产表格有「分组」列；资产表单可选所属分组。

## 本仓库实现

- 后端 `AssetGroup{ id(AG_), name, parentId, sort }`；
  - GET groups：行 → 树（按 parentId 组装）。
  - PUT groups：收整棵树 → 扁平化为行（含 parentId/order）整体替换。
  - DELETE groups/{id}：删节点，其资产 `groupId` 置空，子节点上提到父级。
- asset paging 支持 `groupId` 过滤；DTO 计算 `groupFullName`（沿 parent 链拼接）。
- 前端资产页加左侧分组树（新建/删除/点击过滤）+ 表格分组列 + 表单分组选择。

## 落地状态（已实现）

- 后端 `asset_group.go` 此前已写好但**未接入路由**、`AssetGroup` 漏迁移 → 现已：
  `router.go` 接 `assetH.RegisterGroups(...)`、`store.go` AutoMigrate 补 `AssetGroup`。
- 前端 `web/src/components/GroupTree.tsx`（递归树：新建/子分组/重命名/删除/点击过滤）+
  `AssetPage.tsx` 两栏布局 + 「分组」列（`groupFullName` 全路径）+ 表单「所属分组」下拉。
- 实测：嵌套分组「文本协议/生产环境」、资产归属、`groupId` 过滤、`groupFullName='文本协议 / 生产环境'` 均通。
- **未做**：分组拖拽排序（`sort` 字段后端已支持，前端暂未接拖拽）。
