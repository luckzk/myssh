# 图形协议（RDP/VNC）/ guacd · 契约

> **用途**：E 阶段事实依据。前端来自上游 `hooks/use-guacamole.ts`；后端需实现 guacamole 协议
> 客户端对接 guacd。RDP/VNC 复杂协议交给 guacd，我方只做「浏览器 ↔ guacd」指令流转发 + 握手。

## 前端（上游，已确认）

```ts
const tunnel = new Guacamole.WebSocketTunnel(`${baseWebSocketUrl()}/access/graphics`)
const client = new Guacamole.Client(tunnel)
// 建会话同终端：portalApi.createSessionByAssetsId(assetId)
client.connect(qs.stringify({ sessionId, width, height, dpi: 192 }))
```
- WS 端点：`/api/access/graphics`（同源带 HttpOnly 令牌）。
- 连接参数：`sessionId` + 显示尺寸 `width/height/dpi`。
- 客户端用 `@dushixiang/guacamole-common-js`（上游 fork），渲染 + 键鼠 + 剪贴板 + resize（`sendSize`）。

## guacamole 协议（网关 ↔ guacd 4822）

指令格式（length-prefixed，逗号分隔，分号结尾）：
```
OPCODE 与每个参数都写成  <字节长度>.<值>
例：  5.error,3.foo,1.0;     4.size,4.1024,3.768,2.96;
```

握手序列（我方网关作为「客户端」对 guacd 发起）：
```
网关 → guacd:  6.select,3.vnc;            # 选择协议(rdp/vnc)
guacd → 网关:  <args>...;                 # 返回该协议需要的参数名列表(handshake args)
网关 → guacd:  4.size,W,H,DPI;  audio; video; image;   # 显示与媒体能力
网关 → guacd:  7.connect,<按 args 顺序回每个参数值>;     # 提供 hostname/port/username/password 等
guacd → 网关:  5.ready,<connection-id>;   # 就绪
之后：guacd ↔ 网关 双向透传图形/输入指令；网关再把这条流原样桥接到浏览器 WS。
```

## 我方实现（E 阶段）

- 后端 `gateway/guacd.go`：
  1. 连接 `guacd:4822`（配置 `NT_GUACD_ADDR`）。
  2. `select` 协议(资产 protocol) → 读 args → 按 args 用资产参数(hostname=ip, port, username, password 解密, 以及 width/height/dpi/ignore-cert 等)回 `connect`。
  3. 读到 `ready` 后，把 guacd 与浏览器 WS 双向透传（guacd 文本指令 ⇋ WS 文本帧）。
- WS 端点：`GET /api/access/graphics?sessionId=`（鉴权同终端）。
- 部署：guacd 以容器运行（`guacamole/guacd`），仅内网可达。
- 录像（guacd 原生 `recording-path`）与剪贴板/文件传输策略 —— 后续阶段补。

> 范围说明：E 先打通 **握手 + 指令流双向转发**（能连上、出画面）。录像、音频、驱动器重定向等增强后续迭代。
