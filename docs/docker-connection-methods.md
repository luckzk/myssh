# Docker 资产:连接 Docker 的几种方式

> 记录"docker 资产"功能里,触达远程 Docker daemon 的可选方式与本项目的取舍。
>
> 结论:**当前实现只有 1 种 —— SSH**。docker 资产本质就是个 SSH 资产,"连接"打开的是 Docker 管理器而非终端。

## 1. 当前实现

所有 Docker 能力(概览 / 容器列表 / exec / 日志 / pull / 容器文件 / compose)都是**经 SSH 跑 `docker` / `podman` CLI**:

```
浏览器 ──WS/HTTP──> Go 后端 ──SSH──> 目标主机 ── 执行 docker/podman 命令
```

- REST 类(列表 / inspect / 操作):经 SSH 连接池执行一次性命令。
- 流式类(logs -f / exec -it / pull):经 SSH 开一条独立通道桥接到浏览器 WS。

## 2. 四种触达方式对比

Docker daemon 通用上有 4 种触达方式:

| 方式 | 说明 | 本项目 | 取舍 |
| --- | --- | :---: | --- |
| **① SSH + CLI** | SSH 到主机跑 `docker` 命令 | ✅ **现状** | 复用堡垒机 SSH 审计 / 凭证 / 跳板机 / 连接池;无需暴露 daemon;兼容 podman(带 docker shim)。缺点:每命令 spawn 一个 CLI 进程,依赖主机装了 docker CLI |
| ② Docker API + SSH 隧道 | `DOCKER_HOST=ssh://` 或 Go SDK 经 SSH 隧道连 `docker.sock` | ❌ | 走结构化 JSON API、更快;但需要主机有 docker daemon(podman rootless 要另开 socket) |
| ③ Docker API over TCP | daemon 监听 `tcp://host:2375`(明文)/ `2376`(TLS) | ❌ | 最原生(exec / logs 走 WebSocket attach);但要 daemon 开 TCP + TLS 证书,**暴露 daemon = 安全风险**(2375 明文 ≈ root 裸奔) |
| ④ 本地 unix socket | `/var/run/docker.sock`,仅同机 | ❌ | 只适合管理堡垒机本机的容器 |

## 3. 为什么选 ① SSH + CLI

- **与整体架构一致**:系统是"SSH 为中心、可审计"的堡垒机,命令都能过录像 / 命令拦截(`command_guard`)。
- **无需暴露 daemon**:不必在目标机开 2375/2376,安全。
- **兼容 podman**(带 docker 兼容 shim)。
- **复用现成能力**:SSH 凭证 / 跳板机 / 连接池全部复用。

## 4. docker 资产怎么填

填 docker 资产时,填的就是**目标主机的 SSH 连接信息**:

- 地址 / 端口(默认 22)
- 验证方式(密码 / 密钥 / 登录凭证 / 交互认证 / 每次询问)
- 登录用户
- 可选:跳板机

系统再经这条 SSH 去操作主机上的 docker。所以 docker 资产 = SSH 资产 + "连接"动作打开 Docker 管理器。

## 5. 未来扩展(可选,目前不需要)

若要支持 ②/③(直连 Docker API,不依赖主机 CLI、性能更高):

- 在资产表单加一个「连接方式」下拉:`SSH CLI` / `Docker API (TCP+TLS)` / `Docker API over SSH`。
- 后端按方式分派:CLI 走现有路径;API 方式用 Go 的 Docker SDK,exec/logs 走 daemon 的 attach WebSocket。
- 需要额外处理 TLS 证书管理(③)与 daemon 可达性检测。

目前 **SSH 这条已足够**,且安全性最好。
