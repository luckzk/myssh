# guacd 网关选择 + 自动安装 · 契约（自定义运维能力）

> **用途**：让管理员选一台「已添加的 SSH 资产」作为 guacd 运行主机，经 SSH 自动用 Docker
> 安装/启动 guacd、检测 4822 端口，之后 RDP/VNC 连接走这台 guacd。
> **非 demo 功能**——这是本仓库自定义的运维能力（demo 无对应页）。

## 背景：为什么需要它

RDP/VNC 链路是 `浏览器 ─guacamole协议→ 后端 ─→ guacd ─RDP/VNC→ 目标`。
guacd 是协议翻译网关，**官方镜像仅 amd64**；本机 arm64 跑不了。
故把 guacd「外置」到一台 amd64 主机（可以是某台被控端或独立网关），后端动态指向它即可。

## 端点（group = `admin/guacd`，需鉴权 + 演示模式写拦截）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/guacd/config` | 当前选定主机与生效地址 `{assetId, host, effectiveAddr}` |
| POST | `/api/admin/guacd/select` `{assetId}` | 选定某台 **SSH 协议**资产作为 guacd 主机（存 `Setting`）|
| POST | `/api/admin/guacd/check` `{assetId}` | TCP 探测 `host:4822`（3s 超时）→ `{reachable, latencyMs}` |
| POST | `/api/admin/guacd/install` `{assetId}` | 经 SSH 预检 + Docker 安装/启动 guacd，回显输出 |

## install 行为

1. 解密该资产凭证 → SSH 连入（复用 `gateway.DialSSH` / `RunSSHCommand`）。
2. 预检：`uname -m`（架构）+ `docker version`（docker 是否可用）。
3. 运行：`docker rm -f nt-guacd; docker run -d --name nt-guacd --restart unless-stopped -p 4822:4822 docker.io/guacamole/guacd:latest`
   （docker 无权限回退 `sudo docker ...`；镜像用全限定名以兼容 podman 短名策略）。
4. 返回 `{arch, dockerOK, output, ok, message, archWarning?}`，**完整回显** stdout/stderr（不掩盖失败）。
   - 非 `x86_64/amd64` → `archWarning`（guacd 镜像仅 amd64）。

## 动态地址解析

`access/graphics.go` 的 `resolveGuacdAddr()`：读 `Setting[guacd_asset_id]` → 若设且资产存在 →
`asset.IP + ":4822"`；否则回退配置 `NT_GUACD_ADDR`。RDP/VNC 连接即用此地址连 guacd。

## 安全设计

- 仅允许 **SSH 协议**资产作为 guacd 主机（install/运行经 SSH）。
- install 命令**固定**，不接受任意拼接；挂演示模式写拦截。
- 前端弹窗强制**风险勾选**才允许安装；提示 guacd 默认无认证、监听 4822、需主机可信。

## 诚实边界

install 仅在装了 Docker、且资产账号有 docker 权限的 **amd64 SSH 主机**上才会真正拉起 guacd；
本机（arm64 + podman + 测试账号无 docker 权限）会如实报错。这与「guacd 仅 amd64」结论一致。

## 本仓库实现

- 后端：`server/internal/api/resource/guacd.go`（handler）、`model.Setting`、
  `store.GetSetting/SetSetting`、`gateway.RunSSHCommand`、`access.resolveGuacdAddr`。
- 前端：`web/src/components/GuacdModal.tsx` + 资产页「guacd 网关」按钮、`guacdApi`（`api/resource.ts`）。
