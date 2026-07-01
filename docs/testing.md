# 本地测试账号

用于测试「资源管理 → 主机资产 → 新增资产」并发起真实 SSH 连接的本地目标账号。
后端与该账号都在同一台机器上，资产直连 `127.0.0.1` 即可走通「连接 → 终端 → 录像/命令审计」闭环。

## 账号信息

| 项 | 值 |
| --- | --- |
| 用户名 | `nttest` |
| 密码 | 见本机文件 `/home/opc/.nttest-pass`（权限 600，未入文档/仓库） |
| 主机 | `127.0.0.1` |
| 端口 | `22` |
| 协议 | SSH |
| 权限 | 普通用户（无 sudo） |

## 在 UI 中新增主机资产

主机资产 → 新增资产，填：

- 名称：`本地测试`（随意）
- 协议：`SSH`（端口自动填 `22`）
- IP / 主机：`127.0.0.1`
- 账号方式：`密码`
- 用户名：`nttest`
- 密码：见本机文件 `/home/opc/.nttest-pass`（`cat /home/opc/.nttest-pass`）

保存后点该行「连接」，新开终端页连到本机 SSH。

## 图形协议测试（RDP / VNC）

RDP/VNC 与 SSH 不同：不是后端直连目标，而是 **后端 ↔ guacd ↔ 目标**。
前端走 `/access/graphics`（guacamole 协议），由 **guacd** 把 guacamole 协议转成真实 RDP/VNC。

在 UI 新增资产时这样填（端口按协议自动带出）：

| 协议 | 端口 | 账号方式 | 说明 |
| --- | --- | --- | --- |
| `RDP` | `3389` | 密码 | 目标需开 RDP（如 Windows / xrdp） |
| `VNC` | `5900` | 密码 | 目标需开 VNC（如 tigervnc / x11vnc），密码填 VNC 密码 |

点「连接」会打开**图形页**（`/graphics/:id`，guacamole-common-js 渲染键鼠+画面）。

### 前置条件（重要）

1. **guacd 可达**：后端按 `NT_GUACD_ADDR`（默认 `127.0.0.1:4822`）连 guacd。
   `docker compose up guacd` 起一个即可。
2. **一个真实 RDP/VNC 目标**：本机或同网段的 Windows(RDP) / VNC 服务器。

### ⚠️ 本机（arm64）限制

官方 `guacamole/guacd` 镜像**仅 amd64**；本机为 **arm64** 且**未注册 qemu binfmt**
（amd64 容器会 `Exec format error`），故**无法在本机直接起 guacd 跑出真实画面**。
代码侧图形链路已实现并以「协议精确的 mock guacd」验证过握手与桥接（见 `docs/progress.md` E 阶段）。

要在本机跑真实 RDP/VNC 画面，二选一：

- **换 amd64 主机**：`docker compose up guacd` + 一个 RDP/VNC 目标，直接可用；或
- **本机启用模拟**：装 `qemu-user-static` 并注册 binfmt（如
  `docker run --privileged --rm tonistiigi/binfmt --install amd64`），再
  `docker run -d --name guacd --platform linux/amd64 -p 4822:4822 guacamole/guacd`，
  另起一个 arm64 原生的 VNC 服务器作目标（模拟下 guacd 偏慢，仅供功能验证）。

> 即便不能出画面，**新增 RDP/VNC 资产本身在当前 UI 已可正常创建/编辑/保存**——
> 缺的只是「连接」时的 guacd 运行环境。

## 安全性

**仅允许本地（回环地址）登录。** 通过 sshd 配置 `/etc/ssh/sshd_config.d/99-nttest-localonly.conf`，
对来自非 `127.0.0.1` / `::1` 的连接关闭该账号的全部认证方式：

```sshd
Match User nttest Address *,!127.0.0.1,!::1
    PasswordAuthentication no
    PubkeyAuthentication no
    KbdInteractiveAuthentication no
    GSSAPIAuthentication no
```

已实测：`ssh nttest@127.0.0.1` 成功；`ssh nttest@<本机外网/内网 IP>` 一律 `Permission denied`。

**结论**：在本测试机上是安全的——即使密码泄露，外部也无法用它登录，攻击者必须先登上本机；
且该账号无 sudo，影响面有限。

> ⚠️ 注意：本文档站点绑定 `0.0.0.0` 对外暴露，故密码**不写入本页**，仅存于本机
> `/home/opc/.nttest-pass`（权限 600，不入仓库）。即便如此也请勿用于真实/生产主机。

## 清理

```bash
sudo rm -f /etc/ssh/sshd_config.d/99-nttest-localonly.conf
sudo systemctl reload sshd
sudo userdel -r nttest
rm -f /home/opc/.nttest-pass
```
