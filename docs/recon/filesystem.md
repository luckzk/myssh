# SFTP 文件传输 / 文件审计 · 契约（对齐上游）

> **用途**：D 阶段事实依据。来自上游 `src/api/filesystem-api.ts` + bundle（download/upload）。
> 文件操作按 **sessionId** 维度，复用该会话资产的 SSH 连接做 SFTP。

## 端点（group = `access/filesystem`，前缀 `/api`）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/access/filesystem/{sessionId}/ls?dir=&hiddenFileVisible=` | 列目录 → `FileInfo[]` |
| POST | `/access/filesystem/{sessionId}/rm?filename=` | 删除 |
| POST | `/access/filesystem/{sessionId}/mkdir?dir=` | 新建目录 |
| POST | `/access/filesystem/{sessionId}/touch?filename=` | 新建空文件 |
| POST | `/access/filesystem/{sessionId}/rename?oldName=&newName=` | 重命名/移动 |
| POST | `/access/filesystem/{sessionId}/chmod?filename=&mode=` | 改权限 |
| POST | `/access/filesystem/{sessionId}/edit` body `{filename,fileContent}` | 在线编辑 |
| POST(form) | `/access/filesystem/{sessionId}/upload?dir=` | 上传（multipart）|
| GET | `/access/filesystem/{sessionId}/download?filename=` | 下载 |
| GET | `/access/filesystem/{sessionId}/upload/progress?id=` | 上传进度 |

## 数据结构

```ts
interface FileInfo { name, size, modTime, path, mode, isDir, isLink }
```

## 文件审计（filesystem_log）

每次**变更类操作**（upload/download/rm/mkdir/rename/edit/chmod）写一条：
```
filesystem_log(id, session_id, user_id, asset_id, action, path, size, created_at)
```
> `ls` 只读不记（避免噪音）。审计模块 `filesystem-log` 列表读这张表。

## 本仓库实现说明

- 按 sessionId 维护 **SFTP 连接缓存**：首次文件操作时按会话资产解密凭证 → `crypto/ssh` 拨号 → `pkg/sftp` 打开；后续复用；会话结束/超时关闭。
- 端点前缀与上游一致（`access/filesystem`），便于复用上游 `FileSystemPage.tsx`。
- 受策略开关（strategy.upload/download）控制 —— 授权域（C 阶段）接入后生效。
