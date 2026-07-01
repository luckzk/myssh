# 15 源码复用可行性研究

> 本章基于对上游仓库 [`next-terminal/next-terminal`](https://github.com/next-terminal/next-terminal)
> 的实测分析，评估「直接复用其源码」的可行性、边界与对本复刻方案的影响。

## 15.1 结论速览

| 维度 | 结论 |
| --- | --- |
| 许可证 | **Apache-2.0**，可合法复用源码 |
| 公开范围 | 仓库现为**纯前端**（TypeScript/React，430 文件全在 `src/`），**后端已闭源** |
| 前端形态 | **未压缩源码**，含全 44 模块的 API 契约、页面与交互组件 |
| 最高价值 | `src/api/*.ts`（权威 API 契约）、`src/pages/access/*`（终端 / guacd / 回放等难点） |
| 对本方案 | 我方逆向方向已被证实正确；建议**前端大量参考、后端自研**，并对齐其 WS 协议 |

## 15.2 许可证与合规边界

上游声明 **Apache-2.0**。复用须遵守：

- ✅ 可复制、修改、分发其源码（含商用），**前提是保留 `LICENSE` 与版权 / NOTICE 署名**。
- ✅ 修改处建议标注变更。
- ❌ 不得使用其**商标 / 品牌**：`NEXT TERMINAL` 名称、Logo、版权署名「指针漂移科技工作室」——本仓库已用自有 branding。
- ⚠️ 仓库内 `src/api/license-api.ts`、enterprise 相关逻辑属其**商业版授权**范畴，社区复刻应置空或自实现。
- ⚠️ guacd（Apache Guacamole）本身 Apache-2.0，复用合规。

> 实践建议：复用的文件**整文件保留原 License 头**，并在仓库根 `NOTICE` 中致谢上游。自研代码用自有版权。

## 15.3 公开仓库的真实构成

实测 `git/trees/master?recursive=1`：430 个文件，**全部位于 `src/`**，无任何 `.go`。

```
src/
├── api/         51  接口层（每模块一个 *-api.ts，含 TS 类型）
├── pages/      211  各模块页面（含 access/ 终端接入与回放）
├── components/  36  通用组件（表格、图表、拖拽周时段…）
├── layout/      17  布局
├── hook/ utils/ helper/ …
```

**这说明**：上游把后端（Go）转为闭源/商业化（印证我们在前端 bundle 中观察到的 `license-api`、enterprise chunk）。因此：
- **后端无源码可抄** → 必须自研（本方案本就是 Go 自研，不受影响）。
- **前端是完整 Apache-2.0 源码** → 正是我们逆向得到的那套，可直接对照甚至复用。

## 15.4 可复用清单（按价值排序）

### 一级：API 契约（强烈建议直接采纳）
`src/api/core/api.ts` + 各 `*-api.ts`。基类与我方 S2 实现**完全一致**：

```ts
class Api<T> {
  constructor(group){ this.group = group }            // 如 "admin/assets"
  getPaging = (p) => requests.get(`/${group}/paging?${qs(p)}`)  // {items,total}
  create/updateById/deleteById/getById/getAll …
}
```
- 价值：44 模块的**端点命名 + 请求/响应 TS 类型**一次到位，免去逐个逆向。
- 用法：作为后端 API 设计与前端类型定义的**权威参照**。

### 一级：会话 / 终端协议（S3 对齐依据）
`src/pages/access/Terminal.ts` 暴露了 WS 帧协议（甚至注释内贴了 Go 端 `Message` 结构）：

| 类型常量 | 值 | 含义 |
| --- | --- | --- |
| MessageTypeError | 0 | 错误 |
| MessageTypeData | 1 | 终端数据（双向） |
| MessageTypeResize | 2 | 尺寸变化，内容 `"cols,rows"` |
| MessageTypeJoin | 3 | 加入（协同观看） |
| MessageTypeExit | 4 | 退出 |
| MessageTypeDirChanged | 5 | SFTP 目录变化 |
| MessageTypeKeepAlive | 6 | 服务端保活，客户端回 Ping |
| MessageTypeAuthPrompt | 7 | 请求认证信息（如改密/二次） |
| MessageTypeAuthReply | 8 | 回复认证信息 |
| MessageTypePing | 9 | 延迟探测 |

帧编码：`message.toString() === String(type) + content`（单数字前缀 + 字符串内容）。
流程：`POST /api/portal/sessions?securityToken=` body `{assetId}` → `WS /api/access/terminal?cols=&rows=&sessionId=`。

### 二级：高难度交互组件（建议参考实现）
`src/pages/access/`：
- `hooks/use-guacamole.ts` + `guacamole/*` + `AccessGuacamole.tsx` —— **RDP/VNC 图形接入**，`Guacamole.WebSocketTunnel(.../access/graphics)`。自研代价极高，强烈建议参考。
- `GuacdPlayback.tsx` / `TerminalPlayback.tsx` —— **图形 / 终端录像回放**（S4 直接受益）。
- `FileSystemPage.tsx` / `FileEditor.tsx` —— SFTP 文件浏览/编辑。
- `AccessTerminal.tsx` —— 终端主组件（标签、协同、认证提示、resize）。

### 三级：页面与通用组件（加速铺开）
`src/pages/*` 各 CRUD 页、`src/components/*`（`DraggableTable` 拖拽排序对应资产 `sort` 分数索引、`drag-weektime` 对应登录策略时间段、`charts/*` 对应监控/仪表盘）。

## 15.5 对本方案 S1–S3 的影响

| 已交付 | 与上游对照结论 |
| --- | --- |
| S1 认证（令牌 + 动态菜单） | ✅ 方向正确，`account-api`/`branding-api` 印证 |
| S2 资产/凭证（`/admin/{复数}/paging`） | ✅ 与 `Api<T>` 基类**完全一致**，无需改动 |
| S3 SSH 网关（自定义 JSON 帧） | ⚠️ 帧格式与上游不同 → **决定对齐**，以便复用其终端/回放组件 |

## 15.6 协议对齐决策（已采纳）

**决策：S3 的 WS 协议对齐上游「数字前缀帧」格式**，而非保留我方 JSON 帧。

理由：
1. 对齐后可**直接复用** `AccessTerminal.tsx`、`TerminalPlayback.tsx`、`use-guacamole.ts` 等高价值组件。
2. 录像格式、协同（Join）、认证提示（AuthPrompt）等能力随之打通。
3. 成本低：仅改 `gateway/bridge.go` 编解码与前端 `TerminalPage.tsx` 收发。

落地见进度文档 S3「对齐」小节与 `docs/recon/session-ssh.md`（已更新为上游协议）。

## 15.7 复用策略小结

- **前端**：以上游 `src/api/*` 为契约权威；终端/图形/回放/SFTP 等难点**参考或整文件复用**（保留 License 头），常规 CRUD 页自写或裁剪。
- **后端**：无源码，**全自研 Go**，但严格对齐上游对外协议（REST 命名 + WS 帧），保证前端组件可直接对接。
- **合规**：保留 Apache-2.0 署名、自有品牌、置空商业授权逻辑。
