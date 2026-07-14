# Netcatty 借鉴分析

> 对 [binaricat/Netcatty](https://github.com/binaricat/Netcatty) 的调研，评估有无值得本项目（myssh Web 堡垒机）借鉴之处。
>
> 结论:定位不同，能直接借鉴的不多，但 **AI 运维 Agent** 一个方向很值得做。

## 1. Netcatty 是什么

一个 **Electron 桌面 SSH 客户端**(类似 Termius / PuTTY / SecureCRT),面向开发者/运维/DevOps。

| 维度 | Netcatty | myssh |
| --- | --- | --- |
| 形态 | Electron 桌面 App(本地单机) | **Web 堡垒机**(浏览器访问) |
| 后端 | 无(node-pty/ssh2 直连) | **Go 服务端**,多用户 |
| 用户模型 | 单用户本地工具 | **多用户 + 授权 + 审计** |
| 技术栈 | Electron40 / React19 / TS / Vite7 / xterm.js5 / Tailwind4 / ssh2 / node-pty | Go + React + xterm.js + Ynex/Bootstrap |
| 许可证 | **GPL-3.0** | — |

## 2. 功能重叠(myssh 已有,不必借)

- xterm 工作台 + 横竖分屏 + 多标签
- SFTP + 就地编辑 + 拖拽上传下载
- 主题 + 关键字高亮
- OS 发行版图标自动识别
- ssh / telnet / serial / local 连接

## 3. myssh 领先的地方(Netcatty 没有)

- **Web 化**:零安装,浏览器直用
- **多用户 + 授权(authz) + 会话录像 + 命令拦截(command_guard)**
- **RDP / VNC 图形**(经 guacd)
- **Docker 管理器**(Netcatty 只有 AI 顺带能编排 Swarm,没有真正的 docker 工具)
- **主机监控**(CPU / 进程 / GPU)
- **跳板机 / 端口转发 / 会话共享 / SSH 连接池**

> 在"堡垒机 / 企业"维度,myssh 是**领先**的。

## 4. 真正值得借鉴:AI 运维 Agent(重点)

Netcatty 的杀手锏是 **Catty Agent** —— 自然语言驱动的运维助手:

- 自然语言控制,"不用背命令"
- **自己跑命令、读输出、诊断**(查状态/看日志/看资源)
- **跨多主机编排**(demo 里自动搭建 Docker Swarm:init、token 交换、节点加入全自动)
- 上下文感知目标主机环境

而 myssh 目前只有一个 **"AI 助手(占位)"** 按钮(`web/src/pages/access/*` 的 `ShellAssistantSheet`)。

### 为什么这个方向尤其适合 myssh

myssh 有 Netcatty 没有的底座,能把同样的能力做得**更安全**:

1. **命令天然被审计**:Agent 跑的每条命令都经现有审计管道(录像 + `command_guard` 命令拦截),自动记录/受控。
   > Netcatty README 完全未提任何执行前确认 / 安全机制 —— 这正是 myssh 能做得更稳的点:**执行前人工确认 + 命令白/黑名单**。
2. **多主机编排可复用现成能力**:直接搭在"工作组广播 + SSH 连接池"上,一个 Agent 指令并行到一组主机。
3. **Provider 用 Claude(最新模型)**:后端调 Anthropic API,命令经现有 gateway 执行。

### 建议形态

```
对话 → Agent 提议命令 → (可选)人工确认门 → 经审计桥执行 → 读结果续推
```

- 作用域:**当前会话** / **整个工作组(多主机)** 两种。
- 安全:默认人工确认;危险命令走 `command_guard` 拦截;全程录像。

## 5. 次要可借鉴(优先级低)

- **Mosh**:抗高延迟 / 断网漫游(可缓解远程主机如法兰克福的延迟)。但 Web 堡垒机需在 daemon 侧跑 mosh-client 再桥接到浏览器 WS,UDP 打通较重 —— **优先级中**。
- **Vault 视图切换(grid / list / tree)**:myssh 现为 tree,加卡片 / 列表视图属小 UX 打磨 —— **优先级低**。

## 6. ⚠️ 许可证提醒

Netcatty 是 **GPL-3.0**:**借思路 / 交互可以,不要抄代码**(抄代码会把 GPL 传染到本仓库)。

## 7. 结论与建议

- 唯一值得投入的是 **AI 运维 Agent**,且 myssh 的审计底座能让它比 Netcatty 更安全、更适合团队/堡垒场景。
- 其余(Mosh、视图切换)建议先放着。
- 下一步:可先出一份 **"AI 助手 Agent"实现方案**(后端 Anthropic 调用 + 命令经审计桥执行 + 人工确认门 + 当前会话/工作组作用域),评审后再落地。
