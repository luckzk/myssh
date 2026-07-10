# 实现进度

记录复刻仓库（`server/` + `web/`）的实际落地进度。每个阶段遵循「探查驱动」工作流：
**抓真实契约 → 落盘 `docs/recon/` → 后端 → 前端 → Playwright 验证**。

## 总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **S0** | 工程脚手架（Go + React + compose） | ✅ 完成 |
| **S1** | 认证闭环（不透明令牌 + 动态菜单） | ✅ 完成 |
| **S2** | 资产 + 凭证（加密落库 + 列表脱敏） | ✅ 完成 |
| **S3** | SSH 会话网关 + 终端录像 + 命令日志 | ✅ 完成 |
| **S4** | 离线会话回放 | ✅ 完成 |
| **B** | 在线会话监控 + 强制下线 | ✅ 完成 |

> **M1 核心审计闭环已达成**：登录 → 连 SSH → 录像 → 命令留痕 → 离线回放 → 在线监控/强制下线。

---

## S0 · 脚手架

| 层 | 内容 |
| --- | --- |
| 工具链 | Go 1.25+ + Node 22 + Playwright/Chromium |
| 后端 | Go + Echo + GORM + SQLite，单二进制；统一 `{code,message,data}` 包络、中间件链、健康检查 |
| 前端 | Vite + React 18 + AntD 5 + TanStack Query + Jotai + React Router |
| 交付物 | `docker-compose.yml`、`server/Dockerfile`、`.gitignore`、`README.md` |

## S1 · 认证闭环

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/auth.md` —— login-status / branding / captcha / login / logout / account-info 真实端点与响应结构 |
| 后端 | 不透明令牌 `NT_…` + 服务端会话表 + HttpOnly Cookie；`account/info` 按角色计算 `menus[].checked`；未知路由 `{code:500,"Not Found"}`、401、演示模式写拦截 |
| 前端 | 登录页（按 login-status 渲染登录方式）、鉴权布局、**后端驱动的动态侧边栏**（菜单即权限）、401 跳登录 |
| 验证 | Playwright 驱动真实 UI 登录 → dashboard，侧边栏渲染 8 个顶级项 / 44 模块 |

**关键事实对齐**：登录返回 `{needTotp, token}` + `Set-Cookie X-Auth-Token; HttpOnly`；菜单可见性由后端下发。

## S2 · 资产 + 凭证

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/asset-credential.md` —— `admin/assets`/`admin/credentials` 真实端点 + 字段（分数索引 `sort`、内联/引用两种凭证、`decrypted` 需 securityToken） |
| 后端 | `crypto`（AES-256-GCM）、`Credential`/`Asset` 模型、CRUD + 分页；**敏感字段加密落库 + 列表脱敏 `******` + `/decrypted` 出明文**；tags 数组；演示模式写拦截挂到 `/admin/*` |
| 前端 | 凭证页（type 切换 password/密钥）、资产页（协议/端口联动、内联或引用凭证、标签）；TanStack Query + 失效刷新；已实现模块自动替换占位页 |
| 验证 | Playwright：登录 → 新建凭证 → 新建资产 → 列表可见；实测密码列表脱敏、`decrypted` 出明文 |

**关键事实对齐**：密码不回传明文（列表 `******`），结构与 demo 的 asset paging 一致，REST 走 `/api/admin/{复数}/paging`，返回 `{items,total}`。

## S3 · SSH 会话网关 + 审计

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/session-ssh.md` —— **已对齐上游 Apache-2.0 源码**：「REST 建会话 → WS `/access/terminal?cols=&rows=&sessionId=`」，WS 帧为上游「数字类型前缀 + 内容」格式（Data1/Resize2/Exit4/KeepAlive6/Ping9…） |
| 后端 | `gateway`（crypto/ssh 拨号 + PTY 桥接，上游帧编解码、resize="cols,rows"、密码/密钥/键盘交互）；`POST /account/sessions` 建会话；WS `/access/terminal` 鉴权(cookie/query 令牌)→解密凭证→桥接；`connect_session` 生命周期落库 |
| 审计 | `audit` 包：终端录像 **asciinema v2 `.cast`** 写 storage；stdin 行缓冲解析命令 → `exec_command_log`；会话结束落 `recording_path` + 时长 |
| 前端 | xterm.js 全屏终端页（`/term/:assetId`），fit 自适应 + resize 上报；资产列表「连接」按钮新标签打开 |
| 验证 | ① 协议级 WS 测试：`echo`/`whoami` 正确回显，录像与命令日志落库；② Playwright 浏览器：登录→资产→连接→输入命令→终端回显（截图存档） |

**关键事实对齐**：同源 WS 自动携带 HttpOnly 令牌；连接前解密凭证（明文不下发前端）；会话录像与命令逐条留痕，为 S4 离线回放打底。**WS 帧协议已对齐上游**，可直接对接其 `AccessTerminal.tsx` / `TerminalPlayback.tsx` 等组件（见 [15 复用可行性](/plan/15-reuse-feasibility)）。

> 已知局限：命令解析为行缓冲近似还原，交互式/全屏程序（vim、top）内的输入无法逐命令审计——这是终端审计的通用局限，已在 [13 风险](/plan/13-risks) 标注。

## S4 · 离线会话回放

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/playback.md` —— 对齐上游：`/admin/sessions/{id}/recording` 出 `.cast`、`asciinema-player` 直接消费、命令 seek `pos=(cmd.createdAt-connectedAt)/1000` |
| 后端 | `admin/sessions/paging`（status 过滤 在线/离线）、`/{id}`、`/{id}/recording`（返回 .cast）、`/{id}/disconnect`、`/clear`；`admin/session-commands/paging`（按 sessionId） |
| 前端 | 离线会话列表页（时长/命令数/录像大小）+ 全屏回放页：**复用 `asciinema-player`** 播放 + 命令列表点击 seek |
| 验证 | Playwright：列表 3 条会话 → 打开回放 → 录像逐帧播放（截图：登录横幅+命令+输出）+ 命令列表可点击跳转 |

**关键事实对齐**：我方 S3 录像本就是 asciinema v2，**直接复用上游播放器**零改造；在线/离线同表不同 `status` 视图。

## B · 在线会话监控 + 强制下线

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/online-session.md` —— `admin/sessions/paging?status=connected`、`/{id}/disconnect`；实时监控 WS 待后续 |
| 后端 | **活跃会话注册表**（sessionId→关闭函数）：WS 桥接时注册、结束注销；`disconnect` 真正切断正在进行的 ws+ssh；会话生命周期 connecting→connected→disconnected；进程重启自愈（残留在线置为离线）|
| 前端 | 在线会话列表（status=connected，3s 轮询自动刷新）+ 强制下线按钮 |
| 验证 | ① 协议级：开会话→在线列表可见→disconnect(killed:true)→WS 被服务端切断→转入离线；② Playwright：UI 强制下线，终端收到断开提示，列表减少 |

**关键事实对齐**：强制下线不是只改库状态，而是经注册表**真正切断桥接**——堡垒机「即时踢人」的核心；非纯 JWT 的服务端会话模型正是为此。

## D · SFTP 文件传输 + 文件审计

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/filesystem.md` —— group `access/filesystem`，按 sessionId：ls/rm/mkdir/touch/rename/upload/download |
| 后端 | `gateway.SFTPManager`（按 sessionId 缓存 SFTP 连接，复用会话资产凭证）；`pkg/sftp` 实现 ls/mkdir/touch/rename/rm/upload/download；每次变更写 `filesystem_log` |
| 前端 | 终端页「文件管理」抽屉（目录浏览/上传/下载/删除/新建）+ 文件传输日志审计页 |
| 验证 | 协议：mkdir/upload(19B)/download 内容回环 + 3 条审计；Playwright：抽屉上传文件→列表可见→审计页有 upload |

**关键事实对齐**：文件操作复用已建立会话的 SSH 连接（懒建 SFTP 子系统、按会话缓存）；变更类操作全部留痕，`ls` 只读不记。

## E · 图形协议（RDP/VNC）/ guacd

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/graphics.md` —— WS `/access/graphics`（Guacamole.WebSocketTunnel）、guacd 握手序列（select→args→size/audio/video/image→connect→ready）|
| 后端 | `gateway/guac_protocol.go`（length-prefixed 指令编解码，按 rune 计长）+ `gateway/guac.go`（连 guacd、握手、按 args 顺序回 connect、ready 后双向桥接）；WS `/access/graphics` 解密凭证→握手→浏览器↔guacd 透传 |
| 前端 | `GraphicsPage`（`guacamole-common-js` + WebSocketTunnel 渲染 + 键鼠）；资产 rdp/vnc「连接」走图形页 |
| 验证 | ① 单测：指令编解码（含 UTF-8）；② mock guacd 协议级：网关发出完全正确的握手（`select vnc`→`size/audio/video/image`→`connect VERSION_…,host,port,user,pass`），post-ready 指令流桥接到 WS；③ Playwright：浏览器 guacamole 客户端经网关连到 mock guacd、建显示、进入连接/等待态 |

**关键事实对齐**：RDP/VNC 复杂协议全交给 guacd，网关只做「浏览器↔guacd」指令流转发 + 握手参数注入；凭证解密后注入 connect，不下发前端。

> **环境限制（诚实声明）**：官方 `guacamole/guacd` 镜像仅 amd64，本机为 **arm64** 且无 qemu 模拟可用，故**未能跑真实 guacd 连真实 VNC 出桌面像素**。已用「协议精确的 mock guacd」端到端验证网关握手与桥接逻辑正确；在 amd64 或装好 binfmt 模拟的主机上 `docker compose up guacd` + 一个 VNC/RDP 目标即可出画面。

## C · 资源管理域批量模块（通用 CRUD）

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/resources.md` —— snippet/storage/database-asset/certificate/gateway-group/ssh-gateway 真实字段与端点 |
| 后端 | **Go 泛型 `Crud[T]`**（paging/getAll/get/create/update/delete + 加密钩子 + 列表脱敏）；6 个模型一次注册 `/admin/{复数}`；database-asset/ssh-gateway/certificate 敏感字段加密落库 |
| 前端 | **配置驱动的 `ResourcePage`**（字段定义 → 表格列 + 表单）；6 个模块各一份字段配置，接入动态菜单 |
| 验证 | 协议：snippet 增/列/改、database-asset 密码脱敏；Playwright：UI 建 snippet/database-asset，密码列 `••••`，资源管理子菜单 6 项齐全 |

**关键收益**：泛型 CRUD + 配置驱动页面，让标准资源模块「一份框架、多处复用」——新增一个 CRUD 模块只需加一个模型 + 一份字段配置。

> 资源管理域已实现：主机资产、凭证、命令片段、存储、数据库资产、证书、网关组、SSH 网关、**Agent 网关**。
> 待后续：网站（反向代理，复杂）、数据库工单（审批流）。

### C+ · Agent 网关（agent-gateway）

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/agent-gateway.md` —— 实测 `/agent/version`、`admin/agent-gateway-tokens`、`admin/agent-gateways/paging?sortField=sort` |
| 后端 | 两模型走通用 `Crud[T]`（agents 按 sort 排序；token create 自动生成 UUID）；新增公开 `/api/agent/{version,register}`，register 校验 token → 按 IP upsert Agent 置在线 |
| 前端 | `AgentGatewayPage` 三段式：版本提示条 + 注册 Token 表（生成/复制/删除）+ 已注册 Agent 表（在线 Tag/删除） |
| 验证 | 协议级 curl：生成 token → register（有效/无效）→ paging 见在线 Agent；前端 tsc 通过 |

**诚实边界**：真实 Agent 二进制不在仓库范围（类比 guacd）；`POST /api/agent/register` 让 token→注册→列表链路真实可测。

## F · 前端 Ynex 改版（Bootstrap 5）

| 层 | 内容 |
| --- | --- |
| 决策 | 保留 React + Vite + 数据层（Router/Query/Jotai/`api/*`），**移除 Ant Design**，UI 改用 Bootstrap 5 + Ynex 编译主题（`web/public/ynex/`）。终端/回放/图形是框架无关 JS 库的 React 挂载点，仅重写外壳样式 |
| 设施 | `web/src/ui/`（Card/PageHeader/DataTable/Modal/confirm/toast/Badge/Field… 替代 antd 原语）；`AuthLayout` 复刻 Ynex 外壳（白色侧栏 + 分类标题 + boxicons + 毛玻璃顶栏 + 搜索框）；靛紫 `#845ADF` 主题 |
| 坑 | Ynex `styles.min.css` 仅是主题覆盖层，**栅格/工具类在单独的 `bootstrap.min.css`**——补上后布局/栅格正常；顶栏 fixed 与内容 margin 等高导致标题被 margin 合并吃掉，用 `.main-content` padding-top 修正 |
| 验证 | `tsc` + `npm run build` 通过；无 antd 残留；JS 包 1.82MB→840KB；Playwright 截图登录/仪表盘/资产/Agent 网关均正常 |

## G · 主机资产分组（对齐 demo）

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/asset-group.md` —— `GET/PUT /admin/assets/groups`（整棵树）、`DELETE /admin/assets/groups/{id}`、`paging?groupId=` 过滤 |
| 后端 | 已有 `asset_group.go`（树存取/删除、`groupFullName` 全路径）此前**未接入路由**且 `AssetGroup` 漏迁移——本次补接线 + AutoMigrate |
| 前端 | 资产页改两栏：左 `GroupTree`（新建/重命名/删除/点击过滤，支持嵌套）；表格加「分组」列（全路径）；表单加「所属分组」下拉 |
| 验证 | 协议级：建嵌套分组「文本协议/生产环境」→ 资产归该组 → `groupFullName='文本协议 / 生产环境'`、按组过滤生效；Playwright 截图左树 + 分组列 |

> 待后续：分组**拖拽排序**。

## H · guacd 网关选择 + 自动安装（运维能力）

| 层 | 内容 |
| --- | --- |
| 契约 | `docs/recon/guacd-gateway.md` —— `/admin/guacd/{config,select,check,install}`（自定义，非 demo） |
| 后端 | `Setting` KV 模型；graphics 由静态 `NT_GUACD_ADDR` 改为 `resolveGuacdAddr()` 动态解析（选定资产 IP:4822，否则回退配置）；`gateway.RunSSHCommand`；install 经 SSH 预检 `uname -m`+docker → `docker run -d -p 4822:4822 docker.io/guacamole/guacd` 并**完整回显**，非 amd64 给架构警告；限 SSH 协议资产 |
| 前端 | 资产页「guacd 网关」按钮 → 弹窗：风险提示 + SSH 资产下拉 + 风险勾选 + 检测 4822 / 安装 / 设为当前 guacd |
| 验证 | 协议级：config/select/check 通过；install 真跑出 arm64 警告 + 真实失败输出（本机 podman/无 docker 权限）；非 SSH 资产选 guacd 被拒 |

**诚实边界**：install 仅在装了 Docker、账号有 docker 权限的 **amd64 SSH 主机**上才会成功；本机 arm64 如实报错（与「guacd 仅 amd64」一致）。

## I · SSH 终端工作台 1:1 对齐 demo（AccessTerminal 全功能）

参考上游 `AccessTerminal.tsx` + live demo 实测截图（资产页/监控面板），把单 asset 全屏终端建成完整工作台。
组件落在 `web/src/pages/access/`（AssetTree/SearchBox/SnippetSheet/StatsPanel/ShareModal/ShellAssistantSheet/Watermark/PermissionDialog）+ `TerminalPage` 编排。

| 功能 | 内容 |
| --- | --- |
| 布局 | 暗色 `#1E1F22`：`[左资源树 \| 状态条+终端 \| 监控面板(开则显) \| 右竖排工具栏]`；抽屉统一暗色（`ui/Drawer` 加 `dark`） |
| 左资源树 | `AssetTree`：`assetApi.list` + `assetGroupApi.tree`，按分组展示资产 + 协议彩色徽章（SSH 绿/RDP 紫/VNC 黄）+ 图标，可折叠；点资产新标签连接 |
| 搜索 | `@xterm/addon-search` 浮层：实时高亮 + `n/总` + ↑↓ + Esc |
| 命令片段 | `SnippetSheet`（复用 `makeCrud('snippets')`）：预取(`prefetchQuery`+staleTime)秒开、每行「执行」、右上「新增」内联表单 |
| 监控统计 | `StatsPanel` **demo 同款卡片**：System / System Load(1·5·15) / CPU(折线 sparkline) / Memory(Used·Free·Cache 圆点) / Disk / Network(rx·tx)；后端 `/access/stats` 经 SSH 跑脚本采两次算 CPU%/网速 + 内存/负载/磁盘/uname |
| 会话共享 | 分享链接 + **只读观战**：`ShareGroup` 把主会话 PTY 输出广播给观战 WS；`POST /access/sessions/:id/share` 发令牌；观战 WS 不 DialSSH、禁输入；`bridge.go` `MsgPing` 回显 → 前端真实 RTT |
| 文件管理 | `FileManager` 暗色**懒加载文件树**（每目录独立 `fsApi.ls`）；上传/新建文件(touch)/新建目录用**暗色内联对话框**（不再用浏览器 prompt）；选中目录定位上传 |
| 文件权限 | 右键菜单（设置权限/下载/删除）→ **宝塔风格暗色权限弹窗**：表格 所有者/所属组/公共 × 读取(4)/写入(2)/执行(1) + 八进制(双向联动) + 属主 + 应用到子目录；后端 `/access/filesystem/:sid/{stat,chmod}`（读 `/etc/passwd`解析属主名、`Chmod`+可选`Chown`+递归`Walk`） |
| 水印 / Ping / AI | 用户名 SVG 平铺水印；顶栏真实 Ping(ms，绿/黄/红)；AI 助手**仅占位**（按要求不接模型） |
| 验证 | Playwright 连本地 `nttest@127.0.0.1`：终端连通、搜索高亮、监控真实数据(含 CPU 折线/网速)、片段执行/新增、共享广播(主输入→观战实时同屏)、文件树展开、chmod 644→755 落盘、宝塔权限弹窗；`go build`+`tsc`+`npm run build` 全通过 |

**诚实边界**：AI 助手占位；`Chown` 需权限（普通账号 chown 他人会如实报错）；多标签页用「点资产=新标签」替代 demo 的 tab 系统。

## J · 终端工作台进阶 + 系统设置 + 跳板机

在 I 的基础上，把工作台做成真正的多 tab 工作台，并补齐设置与 SSH 网关路由。

| 主题 | 内容 |
| --- | --- |
| 内部多 tab 工作台 | 路由 `/access`（`AccessWorkspace`）：左资源树 + 顶部 Tab 栏 + 内容区**全部渲染、仅 active 可见（保活）**。拆出 `TerminalView`/`GraphicsView` 单会话视图；资产页「连接」→ `window.open('/access?open=...', 'nt-workspace')`（固定窗口名复用同一浏览器标签），**点资源树其他资产=开内部 tab**，不再开浏览器标签；同一资产可**重复打开**多个 tab（id 唯一，标签加序号）；tab 列表存 `sessionStorage` |
| 资源搜索 | `AssetTree` 顶部搜索框，按名称/IP 过滤、命中分组自动展开 |
| 终端设置入口 | `TerminalView` 工具栏齿轮 → 暗色「终端设置」抽屉（外观/鼠标/键盘）；共享 `TermPrefsForm`，与设置页同源 |
| 终端主题/偏好持久 | `store/termSettings`（localStorage + `useSyncExternalStore`，跨标签同步）：6 套配色 + 字号/字体 + 选中复制/右键粘贴/拦截 Ctrl·Cmd+F/macOptionIsMeta；`TerminalView` 实时应用，字号 ± 写回持久化 |
| 系统设置页 | 参考 demo「System Settings」改为 **Ynex「Vertical Tab Style-1」(`nav-pills tab-style-7`)** 竖向标签：站点信息(真实，后端 `/admin/site-settings` 存 `Setting` KV) / 资产接入设置(终端偏好) / 安全·通知·日志保留·系统维护(占位)；接入「设置」菜单 |
| **SSH 跳板机/网关路由 (ProxyJump)** | `SSHTarget.Jump` + `DialSSH` 经跳板机隧道连目标（递归可多级）；`resolveTarget` 读资产 `gatewayType=ssh-gateway`/`gatewayId` → `resolveGateway` 解密网关凭证(direct/credential)→ 设 `Jump`。**SSH 终端与 SFTP 同走 `DialSSH`，自动一起经跳板机**；资产表单(仅 SSH)加「SSH 网关/跳板机」下拉 |
| 验证 | Playwright：同一 SSH 重复开多 tab 且切 tab 保活、资源搜索、终端设置抽屉、主题预览、设置页竖向标签；**跳板机双跳**（网关 127.0.0.1 → 目标 127.0.0.1 → shell）实测通；`go build`+`tsc`+`npm run build` 全通过 |

**诚实边界**：跳板机支持 `direct`/`credential` 两种 configMode（`asset` 待做）；SSH HostKey 默认本地开发为 `insecure`，生产可通过 `NT_SSH_HOST_KEY_POLICY=known_hosts` + `NT_SSH_KNOWN_HOSTS` 收紧；从资产页再次「连接」会复用工作台窗口并重载（tab 从 sessionStorage 恢复、会话重连）；设置页安全/通知/日志保留/系统维护为占位。

## K · OxideTerm 借鉴能力

参考 OxideTerm 的远程工作区能力，挑选适合本项目堡垒机定位的功能落地。详细任务见 `docs/tasks.md`。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 端口转发管理与审计 | ✅ 完成 | SSH 会话上的本地/远程/动态 SOCKS5 转发，启动/停止/状态/退出原因与审计 |
| SSH HostKey TOFU | ✅ 完成 | 首次信任主机指纹，后续变更阻断并要求管理员确认 |
| 断线宽限期重连 | ✅ 完成 | WS 抖动后短时间用同一 `sessionId` 恢复审计记录，失败才重建 |
| SFTP 队列与预览 | ✅ 完成 | 多文件上传队列、进度、失败提示、文本/图片预览 |

**诚实边界**：断线宽限重连是同会话续接审计 + 自动重拨 SSH，不是 PTY 进程级保活；SFTP 预览限制 2MB，优先覆盖文本/图片。

## L · 会话、安全、SFTP、工作区增强

继续从远程工作区产品能力中挑选适合堡垒机的功能，优先补“管理员可观测、风险可见、文件操作可审计、批量操作可确认”。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 管理员只读观战 | ✅ 完成 | 在线会话列表新增「观战」；后端 `GET /api/admin/sessions/:id/watch` 校验管理员和在线状态后生成 join token，复用终端 ShareGroup，只读接入、不 DialSSH、不允许输入 |
| 生产安全硬化面板 | ✅ 完成 | 后端 `GET /api/admin/security/checks` 暴露默认加密密钥、默认管理员、敏感明文二次令牌、CORS/WS Origin、SSH HostKey 策略体检；设置页安全 Tab 显示风险和修复建议 |
| SFTP 远程编辑/书签 | ✅ 完成 | 文件管理新增目录书签；文本文件可读入暗色编辑器并保存；后端 `/access/filesystem/:sid/{read,write}` 限制 2MB，保存写 `edit` 文件审计 |
| 工作区分屏/广播输入 | ✅ 完成 | `/access` 工作台新增单窗/双分屏/四宫格；广播输入弹窗需确认，向当前工作台所有 SSH tab 发送输入，录像和命令审计仍按会话分别记录 |

**诚实边界**：观战仍是只读，不做接管输入；安全面板只显示运行时配置风险，不直接修改环境变量；远程编辑只适合 2MB 内文本；广播输入仅覆盖当前浏览器工作台内已打开 SSH tab。

## M · 文件管理停靠面板 + 目录同步 + 右键管理菜单

参考 `conn_ssh/8.png`（工具栏/目录树）与 `9/10/11.png`（右键菜单）把 `/access` 文件管理从抽屉重构为停靠面板，并打通「终端 cd → 文件树自动定位」。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 停靠式面板 | ✅ 完成 | 文件管理由右侧抽屉改为终端内 340px 停靠列；开关时终端 `fit()` 重排，`overflow:hidden` 防止 xterm 溢出到面板下方 |
| 目录同步（OSC7） | ✅ 完成 | 会话初始化注入 `PROMPT_COMMAND` 输出 `OSC7 file://host/pwd`；`bridge.go` 旁路扫描（跨块拼接、BEL/ST 终止）→ 发 `MsgDirChanged(5)`；前端据此把树根定位到当前目录（可关“跟随”） |
| 工具栏 | ✅ 完成 | 路径输入回车跳转；返回家目录/定位当前终端目录/折叠全部/显示隐藏文件/刷新/跟随开关/书签下拉管理/上传/新建文件/新建目录 |
| 右键管理菜单 | ✅ 完成 | 刷新·新建文件·新建文件夹·重命名·下载·修改权限·终端▸(执行CD到终端 / 新建终端到当前目录)·复制文件名·复制绝对路径·删除·上传▸(文件 / 文件夹)·其他▸(压缩)；靠右时子菜单向左弹出防裁剪 |
| 终端联动 | ✅ 完成 | 「执行 CD」写 `cd` 到当前终端；「新建终端到当前目录」派发事件，工作台开同资产新 tab 并连接后自动 cd；「压缩」向终端发 `tar czvf` |

**诚实边界**：目录同步依赖 bash 的 `PROMPT_COMMAND`（sh/zsh 不生效，仅初始定位）；注入行会在终端首屏回显一行（与既有 defaultPath/initCommand 一致）；「压缩」「上传文件夹」经终端/SFTP 逐文件执行，无独立打包接口；文件夹下载需先压缩。

## N · 资产授权体系（RBAC：用户 ↔ 资产）

把 `access.go` 里的 `TODO admin 直通` 落成真正的访问控制——堡垒机的安全地基。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 授权模型 | ✅ 完成 | `model.Authorization{ 名称, 启用, userIds[], assetIds[], assetGroupIds[] }`（JSON 列，仿 GatewayChain）；`AutoMigrate` 建表 |
| 鉴权内核 | ✅ 完成 | `internal/authz`：`AuthorizedAssetIDs`（并集直授资产 + 授权分组递归展开）+ `CanAccess`（admin 直通），供 access/resource 复用 |
| 会话门禁 | ✅ 完成 | `POST /account/sessions`（SSH）与 `graphics`（RDP/VNC）建会话前 `CanAccess`，无权返回 403「无权访问该资产」 |
| 资产按权过滤 | ✅ 完成 | `/admin/assets` paging+list：非 admin 只返回被授权资产（空集返回空）；admin 全量 |
| 用户管理 | ✅ 完成 | `identity/user.go`：用户 CRUD（bcrypt、唯一名校验、不可删自身/最后一个 admin）；新建普通用户自动归入默认 `user` 角色 |
| 授权策略 | ✅ 完成 | `identity/authorization.go`：DTO 数组 ↔ JSON 列 CRUD；`store.go` 补种默认 `user` 角色（基础菜单：仪表盘/资产/在线会话） |
| 前端页面 | ✅ 完成 | 用户页（`/user`）、资产授权页（`/authorised-asset`，带搜索的用户/分组/资产多选框）；资产页对非 admin 隐藏 新增/编辑/删除 |

**验证**：协议级 alice（普通用户）只见被授权资产、连授权资产成功、连未授权资产 403、admin 全量放行；Playwright 用户页/授权页/alice 资产页（只读+过滤）截图通过。

**诚实边界**：本期主体只绑定「用户」（用户组、按角色授权、有效期/时段留待后期）；普通用户仍复用 admin 资产页（隐藏管理按钮 + 按权过滤），无独立「我的资产」视图；非 admin 调 `/api/admin/*` 仍无统一 admin-only 中间件，靠各接口按权过滤/门禁兜底；命令过滤（`command-filter`）另立里程碑。

## O · 持久 SSH 会话（保活 + 跨浏览器/重登重新附着）

把「浏览器一断 SSH 就死、重连丢 shell 状态」改成服务器端持久会话——SSH 连接与浏览器 WS 解耦。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| LiveSession 内核 | ✅ 完成 | `access/live.go`：持有 `*ssh.Client + PTY + 回滚环形缓冲 + 附着 WS 集合`；单输出泵→录像+OSC7+回滚+广播；`attach/detach/close`；管理器 + 回收 goroutine。回滚大小 `NT_SESSION_SCROLLBACK`（默认 256KB，支持 `64k`/`1m` 后缀） |
| SSH keepalive | ✅ 完成 | 每 30s `SendRequest("keepalive@openssh.com")`，防 NAT/空闲掉线；失败即判定连接死亡回收 |
| 重新附着 | ✅ 完成 | `terminal()` 改造：存活会话直接附着（换浏览器/重登/自动重连，**shell 状态不丢**），首次才拨号；附着时回放回滚缓冲 |
| 分离而非杀死 | ✅ 完成 | 前端卸载=分离（去掉 `MsgExit`），仅「断开并关闭」才结束；tab `×`=分离保活 |
| 账号级会话 | ✅ 完成 | `GET /account/sessions`（可恢复列表）+ `POST /account/sessions/:id/disconnect`；工作台「恢复会话」弹窗（恢复/断开/全部恢复） |
| 有界保活 | ✅ 完成 | 分离超保活时长无人连接自动回收；管理员踢下线/`shell` 退出/keepalive 失败也回收 |
| 页面配置 | ✅ 完成 | 系统设置→「会话保活」面板可视化配置保活时长 + 回滚大小（`GET/PUT /admin/session-settings` 存 Setting KV），**运行时即时生效、无需重启**；env（`NT_SESSION_TTL`/`NT_SESSION_SCROLLBACK`）作为默认/回落 |
| 观战收敛 | ✅ 完成 | share `joinViewer` 改为只读附着到 LiveSession，统一广播 |

**验证**：协议级——建会话→设 `FOO`+`cd /tmp`→关 WS（不发 MsgExit）→同 id 重开 WS→回放+ `echo $FOO;pwd` 得 `persisted123`+`/tmp`（**shell 状态存活**）；`GET /account/sessions` 含之、`disconnect` 后消失。Playwright——浏览器1 设状态后关闭→浏览器2（全新 context）自动弹出「检测到 N 个未断开的会话」恢复弹窗。

**诚实边界**：回放≈近期输出（`NT_SESSION_SCROLLBACK`，默认 256KB），非精确屏幕重建（vim/htop 恢复后需一次重绘/`Ctrl-L`）；**不跨服务器重启**（LiveSession 在内存，重启由 store 自愈标 disconnected）；keepalive 挡不住远端 sshd 硬空闲策略或超 TCP 超时的网络分区；同用户多浏览器同附着=共享同一 PTY；分离会话在内存持有已解密 SSH 连接至回收/关闭（有界 TTL + 手动/管理员兜底）。

## P · 终端工作区能力补齐（关键字高亮）

「终端工作区：多标签 / 分屏 / 搜索 / 自动重连 / 命令片段 / 关键字高亮」——前 5 项此前已具备（工作台保活多 tab、单/双/四宫格、SearchBox、宽限重连+持久会话、SnippetSheet）；本次补上**关键字高亮**。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 高亮内核 | ✅ 完成 | `store/highlight.ts`：写入 xterm 前按规则用 ANSI 真彩前景色包裹命中关键字；仅作用于「非转义序列」文本片段（`split(/(\x1b\[...m)/)`），不破坏程序自身 ANSI 着色 |
| 规则与持久化 | ✅ 完成 | `termSettings` 增 `highlightEnabled` + `highlightRules[]`（关键字/正则 + 颜色 + 词边界）；默认三组：error 类→红、warn 类→黄、success 类→绿；localStorage 持久、跨标签同步 |
| 配置 UI | ✅ 完成 | 终端设置抽屉 + 系统设置「资产接入设置」的 `TermPrefsForm` 加「关键字高亮」段：开关 + 规则列表（关键字/取色/正则/删除）+ 添加/恢复默认 |
| 接入 | ✅ 完成 | `TerminalView` MsgData 写入前过 `highlighterRef`（规则变更即重编译）；回滚回放同样着色 |

**验证**：Playwright 连本地会话 `printf` 三行日志，xterm DOM 确认 `error/refused`→`rgb(255,92,92)`、`warning/deprecated`→`rgb(241,196,15)`、`success/active/ok`→`rgb(46,204,113)`。

**诚实边界**：关键字跨两个输出帧拆分时不匹配（少见）；高亮是前景色包裹 + 复位到默认前景（`\x1b[39m`），若关键字后同色文本依赖更早的 SGR 状态可能被复位（日志场景少见）；用户自定义正则含捕获组不影响（按规则逐条应用）。

## Q · 命令过滤 / 拦截（command-filter）

授权解决「谁能连」，命令过滤解决「连上能干啥」——安全地基第二层。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 规则模型 | ✅ 完成 | `model.CommandFilter{名称,启用,动作(block|warn),pattern,regex,优先级,userIds[],assetIds[]}`；迁移 + 首次 seed 4 条**默认关闭**示例（rm -rf /、关机、mkfs/dd、sudo 告警） |
| 过滤引擎 | ✅ 完成 | `audit/command_guard.go`：按会话用户/资产加载并预编译适用规则（字面量条件词边界、正则原样、忽略大小写）；行还原（可见字符/退格/Ctrl-U/Ctrl-C）；回车时 `evaluate`（block 优先、按优先级） |
| 拦截机制 | ✅ 完成 | block=吞掉回车 + 注入 `Ctrl-U` 清空远端当前行（命令因此不执行）+ 红色 `[命令已拦截]` 提示 + 记 `riskLevel=blocked`；warn=放行 + `riskLevel=warn` |
| 全屏豁免 | ✅ 完成 | 输出侧扫描 alt-screen 切换（`\x1b[?1049h/l`、`?47h/l`），vim/top/less 内关闭过滤，退出恢复 |
| 接入 | ✅ 完成 | `live.go` 用 `CommandGuard` 取代 `CommandParser`；`attach()` 输入过 `ProcessInput`，`pump()` 输出扫 alt-screen |
| CRUD + UI | ✅ 完成 | `identity/command_filter.go`（镜像授权）；`CommandFilterPage`（动作/规则/正则/范围/优先级/绑定用户资产 + 局限说明横幅）；菜单 `command-filter` 落地 |

**验证**：协议级——block 规则命中→红色拦截提示 + **文件侧效应证明命令未执行** + `riskLevel=blocked`；warn 放行 + `riskLevel=warn`；绑定他人的规则不影响本用户；Playwright——命令过滤页 5 条规则渲染、终端输入被拦截命令出现红色 `[命令已拦截]`。

**诚实边界**：行还原近似（Tab 补全/历史/多行粘贴可能漏判误判）；拦截为尽力而为、非内核强制，不能替代目标机自身权限；全屏 TUI 内不过滤；规则匹配整行命令字符串（不解析管道/子命令语义）；示例规则默认关闭。

## 修复：多开同资产终端时部分终端输入/广播都失效

**现象**：开 4 个「本地测试」，其中两个手动输入**和**广播都进不去。**根因（关键）**：`TerminalView` 建会话是 `await createSession` 后再 `wire()`；dev 下 `React.StrictMode` 双挂载（setup→cleanup→setup），第一次 setup 的异步 `createSession` 在 cleanup 之后才 resolve，仍执行 `wire()`，**用一个终端已被 `dispose()` 的 ws 覆盖了 `wsRef.current`**。此后 `term.onData`（手动输入）与 `onBroadcast`（广播）都写这个死 socket → 该 tab 既打不进字也收不到广播；哪几个中招取决于两次 `createSession` 网络返回的先后（故「4 个里坏 2 个」）。**修复**：`await createSession` 后加 `if (closed) return`——effect 已清理则丢弃陈旧结果，不再覆盖 `wsRef`。同时保留广播补发（socket 未 OPEN 时 `pendingBcastRef` 暂存、`onopen` 补发）。

**验证**：grid 四宫格开 4 个同资产终端，逐个注入唯一标记 `echo TABMARKi`，4/4 均回显+执行（两次运行均通过）；开 4 tab 后立即广播也 4/4 送达。

（旁注：此竞态主要由 `React.StrictMode` 双挂载在 **dev** 触发；生产构建不重复触发 effect。`if (closed) return` 同时能防生产环境下的快速卸载/重挂载。dev 里因双挂载 + 持久会话会残留分离会话，按 `NT_SESSION_TTL` 回收或在「恢复会话」手动断开。）

## 修复：分屏(双列/四宫格)标签显示逻辑改为 MRU

**现象**：双列下看着 tab1、tab2，再开新终端，布局会莫名把 tab2 换掉、重新配对到最旧的 tab1，让人以为"新终端没正常显示"。**根因**：`visibleTabs = [active, ...others 按开启顺序].slice(0,limit)`——另一格永远锁死在"最旧的 tab"，与用户实际在看的无关。**修复**（`AccessWorkspace.tsx`）：引入 `mru`（最近聚焦顺序），`activate()` 统一更新；分屏显示「最近聚焦的 limit 个 tab」（活跃 tab 必在内，其余按 MRU，不足用开启顺序补齐）。这样：开新终端一定显示它 + 你刚在看的那个；点某 tab 稳定保持当前配对。验证：双列看 1、2 → 开新终端 → 右格=新终端(可输入回显)、左格=tab2（非最旧的 tab1）。

## R · 终端工作台两级 tab（工作组 → 组内 SSH 标签 + 组内分屏）

把扁平单层 tab 重构为**两级**：外层工作组（可新建/删除/双击重命名），每组内多个 SSH 标签 + 组内单/双/四宫格分屏。纯前端。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 数据模型 | ✅ 完成 | `Group{ name, terms[], activeTermId, layout, mru }`；`groups[]`+`activeGroupId`；sessionStorage 存 `{groups,activeGroupId}`，兼容旧 `Tab[]`（迁移成单组） |
| 两级 tab 条 | ✅ 完成 | 外层工作组条（`📁名 [n] ×` + `+`，双击重命名）；内层当前组 SSH 标签条 + 单/双/四宫格 + 广播 |
| 保活切组 | ✅ 完成 | 渲染**所有组的所有终端**，可见=`组===当前 && term∈可见集`，仅 `display:none` 切换——切组不卸载、shell 状态不丢 |
| 组内分屏/MRU | ✅ 完成 | 分屏 layout 与 MRU 均按组独立；开新终端进当前组并置顶 |
| 广播按组 | ✅ 完成 | 广播事件带 `targets`=当前组 SSH term id；`TerminalView` 加 `termId` 按 targets 过滤；只发当前工作组 |
| 关组=分离 | ✅ 完成 | 关闭工作组只分离其终端（服务器端保活），可在「恢复会话」找回；恢复并入当前组 |

**验证**：Playwright——建工作组2；组1 term 里 `export G1=keepX`，切到组2再切回组1 `echo $G1` 仍为 keepX（**切组保活**）；组1 内广播 marker，命令审计核对**仅组1 的 2 个终端**收到、组2 未收到（**按组广播**）；两级 tab 条渲染正常（工作组1[2]/工作组2[1]/+）。

**诚实边界**：工作组仅前端组织、不落库、不跨浏览器（同浏览器 sessionStorage 持久；跨浏览器靠「恢复会话」逐个找回并入当前组）；关组=分离非杀（防误关丢会话）；暂无拖拽排序 / 跨组拖动终端。

### R2 · 分屏改为「每格独立选择终端」

去掉共享的内层 SSH tab 条，改成**每个分屏格各自一个终端选择器**（下拉选本格显示哪个终端 + 关闭），布局/广播移到外层工作组条右侧。模型：`Group.panes[]`（每格 termId）+ `activePane`；`normalizePanes` 归一化（长度=格数、剔除已删、空格用未显示 term 补齐）；`assignPane(i,termId)` 保证同一 term 不重复占两格。开新终端进空格或当前聚焦格。保活不变（所有 term 常挂载，按 `panes.indexOf` 用 grid 显式定位，未显示 `display:none`）。sessionStorage 兼容上一版无 panes 的 group（迁移时归一化）。验证：双列 3 终端，两格分别下拉选 (1)/(3)，各格独立显示、菜单列全部 3 个终端。

### R3 · 分屏改横向标签 + 拖拽 + 精简

用户要「精简 + 不用下拉 + 每格多个终端横向排列 + 可从一个分屏拖到另一个」。
- 模型升级：`Pane = { termIds[], activeTermId }`（每格可容纳多个终端），`normalizePanes` 去重/补齐/修正 active；切布局用 `distribute` 轮流分配到各格。
- **每格横向标签条 `PaneTabs`**（替代下拉）：列出本格的终端标签（点选/关闭）；标签 `draggable`，格（含标签条与内容区）为 drop 区，`onDrop` → `moveTerm(id, 目标格)`，拖拽中目标格紫色虚线高亮。
- **精简**：`TerminalView` 加 `compact` 隐藏顶部状态条（名称已在分屏标签上），分屏里每格只剩 `[横向标签条][终端]`。
- 保活：拖拽/切格只改 CSS 定位，终端不卸载不重连。
- 验证（Playwright）：双列 3 终端 `distribute` 成 `[(1),(3)] | [(2)]`；把 (3) 标签拖到右格 → `[(1)] | [(2),(3)]`；页面无 per-terminal `Ping` 状态行（compact 生效）。

### R4 · 修复四宫格右侧工具栏外溢挡字

**现象**：开四宫格后，小格放不下终端右侧那条 ~14 个按钮的工具栏（约 550px），按钮**溢出格子**盖住下方面板文字，并把页面整体顶高（body 比视口高 ~10px）。**修复**：工具栏容器加 `minHeight:0 + overflowY:auto`（小格内改为可滚动、隐藏滚动条 `.nt-toolrail`），`TerminalView` 根 `overflow:hidden`+`minHeight:0`，工作台分屏容器 `overflow:hidden`。验证：四宫格下 body 高度=视口(820=820)，4 个工具栏底部均在各自格内（不外溢）。

**补充**：四宫格下工作组 tab 条被 flex 压缩（36→19px、「工作组1」被裁到 top=-1）。修复：工作组条加 `flexShrink:0`（+`overflowY:hidden`），高度锁定 36。验证：双屏/四屏下工作组条 top=0 height=36、「工作组1」top=8 完全一致、无裁剪。

## S · 资产图标（默认 → 系统 → 用户，优先级 用户>系统>默认）

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 系统探测 | ✅ 完成 | `access.go detectOS`：首连成功后异步 exec `uname -s || ver` → 家族 `linux/macos/windows` 写入 `asset.os`（复用已有字段），失败静默 |
| 用户上传 | ✅ 完成 | `AssetForm` 基本信息加「图标」：预览 + 上传(FileReader→base64 data URL，≤256KB) + 清除，存入已有 `asset.logo`，随 create/update 保存；后端加 `logo>512KB` 400 护栏 |
| 图标解析 | ✅ 完成 | `components/AssetIcon.tsx`：优先级 `logo(<img>)` > `os(bxl-tux/windows/apple)` > 默认协议图标；用于 `AssetTree`/`GroupTree`/`AssetPage 名称列`/工作台 `PaneTabs`（Term 带 logo/os 快照） |

**验证**：接口——连本地 nttest 后 `asset.os=="linux"`；PUT base64 logo 持久化、超大 logo 400。Playwright——资产列表本地测试连接后显 `bxl-tux`（系统）；上传图标后该行显自定义 `<img>`（用户>系统）；清除后回落系统/默认。

**诚实边界**：系统图标只到 OS 家族（各发行版都显 Linux 企鹅）；Windows 经 SSH 尽力而为；图标 base64 入库（≤256KB）；工作台标签的 os 图标为打开时快照（资产树/列表会随重新拉取刷新）。

## T · Telnet 终端支持

原来 telnet 只是"有选项无实现"（一律走 DialSSH 必失败）。本期让它真正可用，复用整套 LiveSession（保活/多附着/录像/命令过滤/工作台分屏）。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 连接抽象 | ✅ 完成 | `gateway/termsession.go`：`TermSession` 接口（Stdin/Stdout/Stderr/Resize/KeepAlive/Exec/Close）+ SSH 实现（把 shell/pty 建立搬进来）+ `DialTerminal(target, protocol,…)` 工厂 |
| telnet 客户端 | ✅ 完成 | `gateway/telnet.go`：自实现最小 telnet——IAC 读侧状态机（剥离协商、应答 ECHO/SGA/NAWS/TTYPE）、输入 0xFF 转义、NAWS 改窗口、`IAC NOP` 保活、best-effort 自动登录（匹配 login:/password: 注入 user/pass） |
| 接入 | ✅ 完成 | `live.go` 改用 `conn TermSession`（keepalive/resize/close/detectOS/pump 统一）；telnet 跳过 initCmd/OSC7、Exec 不支持→跳过 OS 探测；`access.go` 把 `a.Protocol` 传入 `startLive` |
| 前端 | ✅ 完成 | AssetForm：telnet 已复用登录用户/密码字段（仅隐藏 SSH 验证方式分段），补一句自动/手动登录说明 |

**验证**：起本地 mock telnet（发 IAC 协商 + login/Password 提示 + 回显 shell）。协议级——连接后**输出无 0xFF/IAC 乱码**（协商剥离）、**自动登录**到 `MOCKSHELL$`、`echo TELNET_OK` 回显、resize 不崩。Playwright——AssetForm 选 telnet 显登录字段+说明；工作台连 telnet 资产可交互（`echo UITELNET` 回显），资源树显 TELNET 徽章+图标。

**诚实边界**：telnet 明文、无 SFTP/文件管理/目录同步/OS 探测；不支持跳板机（GatewayChain 忽略）；自动登录靠标准提示符匹配，非标准需手动登录；只实现最小协商选项。

## U · 串口（Serial）终端支持

第 3 种终端类型落地，复用 `TermSession` 抽象接入 LiveSession（保活/多附着/录像/命令过滤/分屏）。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| serial 实现 | ✅ 完成 | `gateway/serial.go`：`dialSerial(path,baud)` 用 `x/sys/unix` termios 打开本地串口（raw/cfmakeraw + CS8/CREAD/CLOCAL + baud 映射 `Bxxxx`，8N1），实现 `TermSession`（Resize/KeepAlive no-op、Exec 不支持）；`DialTerminal` 加 `serial` 分支 |
| 安全护栏 | ✅ 完成 | 设备路径必须匹配白名单前缀 `NT_SERIAL_ALLOW`（默认 `/dev/tty,/dev/serial/`）；`gateway.SetSerialAllow` 启动注入；防打开 `/etc/passwd` 等任意文件 |
| 模型 | ✅ 完成 | 零迁移：`protocol='serial'`，设备路径存 `IP`、波特率存 `Port`；无账号密码 |
| 前端 | ✅ 完成 | `PROTOCOLS`+serial、`DEFAULT_PORT.serial=9600`；AssetForm serial 时「地址→串口设备」「端口→波特率」、隐藏认证块 + 说明；`AssetIcon` serial→`bx-microchip` |
| 修复 | ✅ 完成 | `startLive` 原 `protocol!="telnet"` 才注入 initCmd → 改为**仅 `ssh`**（否则 serial/telnet 会被塞入 bash `PROMPT_COMMAND` 造成乱码） |

**验证**：Python PTY 造假串口（`/dev/pts/N`，回显+banner+`SER$` 提示）。协议级——连接收到 banner、`echo SERIAL_OK` 回显、输出无 initCmd 乱码；**安全护栏**——`/etc/passwd` 设备被拒。Playwright——表单选 serial 显「串口设备/波特率」且无账号密码；工作台连 serial 资产可交互（`echo UISERIAL`），资源树显 SERIAL 徽章+微芯片图标。

**诚实边界**：仅 Linux termios（无 Windows COM）；8N1 固定不可配；串口在**堡垒机主机本地**（需读设备权限，通常 root/dialout）；默认只允许 `/dev/tty*`、`/dev/serial/*`（测试临时放行 `/dev/pts/`）；无 SFTP/目录同步/OS 探测/跳板；打开即连、无自动登录。

## V · 本地终端（Local Terminal）— 跨平台

第 4 种终端：给「运行后端的机器」开 shell（服务器模式=堡垒机主机；桌面软件模式=用户本机）。跨平台，复用 `TermSession` 接入 LiveSession。

| 主题 | 状态 | 内容 |
| --- | --- | --- |
| 跨平台实现 | ✅ 完成 | `gateway/local.go`：`github.com/aymanbagabas/go-pty`（Unix PTY / Windows ConPTY 统一 API）起 shell（Unix `$SHELL`/bash，Windows powershell，可自定义带参）；实现 `TermSession`（Resize 生效、KeepAlive/Exec no-op、Close 杀进程+关 pty）；`DialTerminal` 加 `local` 分支 |
| 安全双闸 | ✅ 完成 | `NT_LOCAL_TERMINAL`（默认 **false**）+ 仅管理员；`access.go localTerminalGate` 在 createSession/terminal 双点校验，未启用/非管理员→403 |
| 跨平台编译 | ✅ 完成 | serial 拆 `serial_linux.go`(termios) + `serial_stub.go`(!linux) + `serial.go`(白名单通用)，使 `GOOS=windows`/`darwin` 均可编译；本地终端三平台 build 通过 |
| 前端 | ✅ 完成 | `PROTOCOLS`+local；AssetForm serial/local 复用：local 隐藏地址/端口/账号、只留名称+可选 Shell(存 username)+说明、放开 ip/port 必填；`AssetIcon` local→`bxs-terminal` |

**验证**：Linux 实测——管理员连 local→真机 bash 提示符、`echo LOCAL_OK` 回显、`whoami`=`opc`（后端主机用户）、resize 不崩；**安全**——默认(未启用)→403「本地终端未启用」，普通用户 alice→403「仅管理员」。三平台交叉编译（linux/windows/darwin）全过。Playwright——表单 local 只显名称+Shell 无地址/账号；工作台连 local 交互 `whoami` 正常，树显 LOCAL 徽章。

**诚实边界**：**Windows 路径仅交叉编译校验、未在 Windows 实机运行**（此环境无 Windows）；macOS 与 Linux 共用 Unix PTY 路径、未单独在 mac 实测；本地终端=主机 shell 极敏感，**默认关闭**，需 `NT_LOCAL_TERMINAL=true`+管理员（命令过滤仍生效）；无网络目标/跳板/SFTP/OS 探测。至此 **SSH / Telnet / 串口 / 本地终端** 四类终端全部落地。

## W · UI 主题体系（可扩展）+ 扁平设计（Flat Design）主题
**背景**：原生 Ynex 外壳用大量渐变 + 阴影卡片（模板 CSS 内 38 处 gradient、209 处 box-shadow）。新增一套**扁平设计**皮肤作为可选主题（非替换、非二态开关），并在顶栏放主题切换器。

**主题注册表**（`web/src/store/theme.ts`，仿 termSettings 的 localStorage + `useSyncExternalStore` 模式，无新依赖）：`THEMES: ThemeDef[]`（`ynex`=默认/原生、`flat`=扁平；将来加主题只需追加一项 + 一段作用域 CSS）。`applyUITheme(id)`——默认主题移除 `data-ui-theme` 属性（原 Ynex 完全不受影响），其它主题各对应一个 `[data-ui-theme="<id>"]` CSS 作用域。localStorage key `nt-ui-theme`，跨标签页同步。

**无闪烁**：`index.html` `<head>` 样式表之前内联脚本，读 `nt-ui-theme` 非 `ynex` 即刻设属性（避免 FOUC）。

**扁平样式**（`web/src/flat-theme.css`，`main.tsx` 于 `ynex-overrides.css` 之后 import，全部 `[data-ui-theme="flat"]` 作用域）：去阴影/去渐变、纯色浅灰底、卡片 1px 描边 + 4px 圆角、按钮纯色主色（hover 深一档）、侧栏高亮纯色软底 + 左侧 3px 主色条、表单 1px 边 + 聚焦仅变边框色（去发光）、下拉/模态/抽屉 1px 边小圆角、徽章 3px、表格纯色表头 + 1px 分隔。**仅覆盖后台外壳**；深色终端工作区（`.term-*`/`.fs-*`）不在作用域内，保持原样。

**切换器**（`AuthLayout.tsx` 顶栏用户下拉之前）：Bootstrap dropdown，`THEMES.map` 渲染每项（图标 + 名称），当前项软底 + 主色字 + `bx-check` 勾选；注册表加主题此列表自动出现新项。

**验证**：Playwright（manager/manager，资产页）——默认态 `data-ui-theme=null`、卡片有阴影；切「扁平设计」→ 属性=flat、卡片 box-shadow=none、1px border、body 纯色底；**刷新持久**（仍 flat、无闪烁）；切回「默认」→ 阴影恢复。编辑抽屉表单——`.form-control` radius 4px/1px border/shadow none，按钮纯色，tab 高亮扁平。`tsc --noEmit` + `vite build` 均过。

### W.1 · 颜色模式（明亮 / 暗色 / 跟随系统）
默认（Ynex）主题启用暗色 + 随系统自动切换。与「皮肤」正交的第二维度，靠 Ynex 原生 `data-theme-mode` / `data-menu-styles`(382 条暗色规则驱动侧栏) / `data-header-styles` 三属性生效。

**store**（`web/src/store/colorMode.ts`）：`ColorMode = light|dark|auto`，localStorage `nt-color-mode`（默认 light）。`resolveColorMode` 把 `auto` 经 `matchMedia('(prefers-color-scheme: dark)')` 解析为 light/dark；`applyColorMode` 同步三属性。监听 `matchMedia` 的 `change`——仅当当前为 `auto` 时系统明暗变化**即时生效**（无需刷新）；跨标签页同步。

**皮肤×模式协同**：`ThemeDef.supportsDark`（ynex=true、flat=false）。`applyColorMode` 对**浅色专用主题钉 light**（`themeSupportsDark(getUITheme())?resolve:'light'`）；`setUITheme` 变皮肤后重调 `applyColorMode`（切到扁平→钉 light、切回默认→恢复用户所选模式）。避免了扁平+暗色时「暗色文字色落到扁平浅底上不可见」的问题。FOUC 内联脚本同规则（`t==='flat'` 时钉 light）。切换器中当前皮肤不支持暗色时，颜色模式项 `disabled` + 标注「（当前主题仅浅色）」。

**验证**：Playwright——默认+选「暗色」→ 三属性=dark、body `rgb(26,28,30)`、刷新持久；`colorScheme:dark`+选「跟随系统」→ dark，运行时 `emulateMedia` 翻转到 light → **实时**变 light（无刷新）；扁平+localStorage 存 dark → 实际 `mode=light`、文字可读（回归修复）；运行时 扁平→默认 恢复 dark、默认→扁平 钉 light。`tsc` + `vite build` 均过。

### W.2 · 黏土拟态（Claymorphism）主题
第 3 套皮肤，经 ui-ux-pro-max 设计库确认规范后与用户交互定稿：**多色粉彩配色 + Nunito 圆润字体 + 完整趣味版（24px 圆角 / 内高光+外投影双层黏土阴影 / 弹性回弹按压 / 背景漂浮 blob）+ 仅浅色**。

**注册**（`store/theme.ts`）：`THEMES` 追加 `{id:'clay', icon:'bxs-cube', supportsDark:false, fontHref:<Nunito>}`。新增 `ThemeDef.fontHref` + `ensureThemeFont(id)`——主题专属字体**按需注入**（只有切到黏土才加载 Nunito，同 href 只注入一次）；`applyUITheme` 调用它。

**样式**（`clay-theme.css`，`[data-ui-theme="clay"]` 作用域）：粉彩 token（薰衣草底 #F1EEF9 非纯白、白卡片、violet #7C3AED 主 CTA 可达 4.5:1、peach/blue/mint/lilac 点缀）；`--clay-out`（外投影+外高光凸起）/`--clay-inflate`/`--clay-inset`（输入框凹陷）三套黏土阴影；圆角 24/18/16；Nunito 字体（标题 800）；`.btn` 凸起+`:active` scale(.96)+回弹 `cubic-bezier(.34,1.56,.64,1)`，主按钮 violet 渐变；侧栏 active = 丁香胶囊+黏土阴影；输入框凹陷阴影+聚焦紫环；卡片/下拉/模态大圆角+黏土阴影；徽章粉彩胶囊；背景 `body::before` 四色粉彩 radial-gradient blob（`blur(20px)` + 22s 漂浮，`prefers-reduced-motion` 关动画）。

**两个回归 bug 修复**：① 背景 blob 初版用 `z-index:0`——按 CSS 层叠规则会盖住非定位的内容块（主内容区全白），改 `z-index:-1` 稳妥置底 + 内容区 `background:transparent` 让 blob 透出、白卡片浮其上。② 黏土为浅色专用主题，但 FOUC 内联脚本只对 `flat` 钉 light，导致「黏土+曾存 dark」刷新后 `mode=dark`；修复：内联脚本 light-only 列表加 `clay`，并在 `main.tsx` 启动时按注册表 `applyUITheme+applyColorMode` 再校正一次（store 为唯一真源，自动修正内联脚本漂移）。

**验证**：Playwright（manager/manager，资产页）——切黏土后 `ui=clay`、`mode=light`、body `rgb(241,238,249)`、卡片 radius 24px + violet 双层阴影、按钮 radius 18px、输入 radius 16px + inset 阴影、`document.fonts.check('16px Nunito')=true`、标题 font-family=Nunito；`elementFromPoint` 命中真实内容（blob 未遮挡）；黏土下颜色模式项 disabled 标「当前主题仅浅色」，存 dark 刷新仍 `mode=light`。`tsc` + `vite build` 均过。至此主题体系：**皮肤（默认 / 扁平 / 黏土，可扩展）× 颜色模式（明亮 / 暗色 / 跟随系统，浅色专用主题自动钉 light）**。

## X · 主机监控面板扩展：进程 / Docker / GPU 三个 Tab
依据用户提供的参考截图（`conn_ssh/monitoring-{ps,docker,nvidia}.png`）——终端右侧监控侧栏除「总览」外还有进程/Docker/GPU 三块——扩展现有「监控统计」面板。

**后端**（`server/internal/api/access/monitor.go` 新增）：抽 `resolveSessionTarget(c)` + `runOnSession(c, script)`（复用 stats 的会话归属校验 → `resolveTarget` → `gateway.RunSSHCommand`）。三个只读端点：
- `GET /access/processes?sessionId=&sort=cpu|mem` → `ps -eo pid,comm,user,%cpu,%mem,rss --sort=-%cpu|head -26` 解析 → `{processes:[{pid,name,user,cpu,mem,rssKB}]}`。
- `GET /access/docker?sessionId=` → 无 docker 输出 `no_docker`；否则 `docker ps -a` + `docker stats --no-stream` 按 ID 合并 → `{available,containers:[{id,name,image,state,status,cpu,memUsage,memPct}]}`。
- `GET /access/gpu?sessionId=` → 无 nvidia-smi 输出 `no_gpu`；否则 `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` → `{available,gpus:[{index,name,tempC,utilPct,memUsedMB,memTotalMB,powerW,powerLimitW}]}`。
在 `RegisterAccess` 注册三条路由。安全同 stats（会话须属当前用户、命令只读）；docker/nvidia 未装或无权限 → `available:false` 优雅降级。

**前端**：`api/access.ts` 加类型 `ProcInfo`/`DockerResp`/`GpuResp` + 三个方法。`pages/access/StatsPanel.tsx` 重构为 **Tab 面板**（总览/进程/Docker/GPU），原总览逻辑抽成 `OverviewTab`（不变），新增 `ProcessTab`（进程表 + CPU/内存排序切换）/`DockerTab`（容器行 + 状态点 + CPU/内存条 + 空态）/`GpuTab`（每卡利用率/显存条 + 温度/功耗 + 空态），复用原 `Card`/`Box`/`Bar`/`color`。各 tab `useQuery` 懒加载、`refetchInterval` 2.5–3s。面板宽 320→340。`TerminalView` 无需改。

**验证**：① API 直测（login→createSession→调三端点）：processes 返回真实进程（node 25.5%、sshd-session 14.2%…）；docker `{available:true,containers:[]}`（本机装了 docker 但无运行容器）；gpu `{available:false}`（无 N 卡）。② Playwright（连 nttest@127.0.0.1，开面板切 4 tab）：总览 System/Memory ✓、进程 PID 表头+排序按钮 ✓、Docker 空态 ✓、GPU「未检测到 NVIDIA GPU」空态 ✓。`go build` + `tsc` + `vite build` 全过。
（注：E2E 中 xterm 透明层会吞掉 Playwright 合成点击，需用 `el.click()` 直接派发 DOM 事件；与功能无关。）

**边界**：仅 SSH 主机（复用 RunSSHCommand）；docker/GPU 依赖目标机已装且 SSH 用户有权限，否则空态；未建独立「监控」菜单页（截图均为终端内侧栏）；未引图表库。

### X.1 · Docker Tab 增强：展示守护进程信息（不再只写"没有容器"）
按用户要求，Docker 有则展示信息、没容器也不留白、没装才显示"未获取到"。
- 后端 `dockerScript` 增加 `%%INFO%%` 段，用**便携计数命令**（docker/podman 通用，不依赖各家不同的 `docker info` 模板字段）：`docker ps>/dev/null && ok=1`、`docker version --format '{{.Server.Version}}'`、`docker ps -q|wc -l`(running)、`docker ps -aq|wc -l`(total)、`docker images -q|wc -l`(images)，另加可选 `extra`（`docker info` 的 driver/os/arch/ncpu/memTotal，podman 上可能为空）。返回 `{available, daemonOk, info:{serverVersion,containers,running,stopped,images,driver,os,arch,ncpu,memTotalKB}, containers:[]}`。
- 前端 `DockerTab`：`available:false`→「未获取到 Docker（未安装或无权限）」；`daemonOk:false`→「Docker 守护进程未运行或无权限」；否则展示 **Docker 信息卡**（版本 + 容器 运行/总 + 镜像数 +（有则）存储驱动/系统/架构/CPU/内存 + 运行/停止圆点），再列容器；0 容器时卡片仍在、下方仅一行「暂无容器」。
- 发现测试机的 `docker` 实为 **podman 模拟**，`docker info --format` 用 Docker 字段名会报错——故改用上述便携计数命令，docker 与 podman 都可用。验证：podman 下返回 `daemonOk:true, serverVersion:5.8.2, containers:0, images:0`，UI 显示「Docker 5.8.2 / 0 运行·0 总 / 镜像 0 / 暂无容器」。

### X.2 · 监控三 tab 信息补全（对照参考图逐项）
放大参考图右侧面板逐字段对比后，按用户确认补齐：

**进程**：后端加进程**总数**（`ps -e|wc -l`），列表取 Top 100。前端加 **6 档占用率渐变色**（红≥90→橙≥70→黄≥50→蓝≥30→青≥10→绿，新 `usageColor`）+ **每行左侧同色竖条**（用户特别要求的"占用率颜色区分"）、顶部**总数徽章**、**搜索框**（按名/PID 客户端过滤）。

**GPU**：后端 query 增补 `driver_version` + 解析 `nvidia-smi` 头部的 **CUDA 版本**，每卡加 `memory.free / pstate / fan.speed / uuid`（fan `[N/A]`→-1）。前端加**顶部标题**（NVIDIA 驱动 + CUDA）、**汇总条**（GPU 数量 / 最高利用率 / 显存合计 / 最高温度）、每卡 **GPU#N 彩色徽章 + 左侧利用率色条**、利用率/显存双色条、详情行（温度/功耗/风扇/空闲显存）+ UUID。

**Docker**：后端 `dockerScript` 增 `%%IMAGES%%`（`docker images --format`）、`%%VOLUMES%%`（`docker volume ls`）两段；新增 `POST /access/docker/action`（start/stop/restart，**动作白名单 + `isSafeToken` 严格校验容器 ID 防命令注入**）。前端 Docker 改 **子标签（容器/镜像/卷，带计数）+ 搜索**；容器卡片加 **运行中/已退出 徽章 + 短 ID + 状态色左边框 + 启停/重启内联按钮**（`toast` 反馈 + 失效重拉）；镜像列表（repo:tag / 短 ID / 大小）；卷列表（名/驱动）。`color()` 保留为内存/磁盘健康色，占用率类统一用 `usageColor()`。

**验证**：API 直测——进程 `total:368/394`、Top 100、real CPU%；Docker 返回 `images/volumes` 数组（nttest 的 rootless podman 为空）；GPU 结构含 driver/cuda（本机无 N 卡）。Playwright——进程 tab 显示总数徽章 + 搜索 + **左侧渐变色条**（截图 mon2-process）；Docker 显示 Docker 5.8.2 信息卡 + **容器/镜像/卷 子标签** + 搜索 + 空态；GPU 空态。`go build`+`tsc`+`vite build` 全过。
**诚实边界**：测试机 SSH 用户 nttest 的 rootless podman 无容器/镜像/卷、且无 NVIDIA 卡，故 Docker 容器卡片/启停动作、镜像/卷列表、GPU 汇总/卡片的**填充态未在本机端到端跑通**；但采集命令的 `--format` 输出已在同机 podman 上验证可正确解析（opc 账户 5 镜像/1 容器解析正常），解析逻辑与已验证的容器解析同构。启停动作端点已做注入防护但未在真实容器上实跑。

### R.1 · 分屏布局扩展：上下双分屏 + 横向/纵向四分
在原 单窗/左右双分屏/四宫格 基础上，按用户要求新增 3 种布局，`AccessWorkspace.tsx`：
- `Layout` 增 `'two-v'`（上下）、`'grid-h'`（横向四分=4 列）、`'grid-v'`（纵向四分=4 行）。
- 用统一的 `GRID_DIM: Record<Layout,[cols,rows]>` 驱动：`single[1,1] two[2,1] two-v[1,2] grid[2,2] grid-h[4,1] grid-v[1,4]`。`PANE_COUNT` 由 `cols×rows` 自动派生；`cellStyle` 按列数行优先定位（一处逻辑适配所有布局）；网格容器 `gridTemplateColumns/Rows` 改为 `repeat(cols/rows, minmax(0,1fr))`。
- 头部布局按钮由 3 个增至 6 个：单窗 / 左右分屏(bx-columns) / 上下分屏(bx-columns 旋转 90°) / 四宫格(bx-grid-alt) / 横向四分(bx-menu 旋转 90°) / 纵向四分(bx-menu)。
- 兼容：旧持久化的 `single/two/grid` 值不变；`normalizePanes/distribute/moveTerm/拖拽` 均按 `PANE_COUNT` 计算，无需改动。

**验证**：Playwright 逐布局读网格容器 `gridTemplateColumns/Rows` 轨道数——单窗 1x1 / 左右 2x1 / 上下 1x2 / 四宫格 2x2 / 横向四分 4x1 / 纵向四分 1x4 全部命中；截图确认上下分屏（上格终端下格占位）与横向四分（4 列）渲染正常无溢出。`tsc`+`vite build` 通过。

### S.1 · 资产分组图标：分组编辑可改图标 + 颜色
资产页分组编辑（GroupTree）原只能改名，现允许自定义分组图标与颜色。
- **后端**：`model.AssetGroup` 加 `Icon`/`IconColor` 字段（AutoMigrate 自动加列）；`asset_group.go` treeNode 加 `icon`/`iconColor`，`buildTree`/`saveGroups` 读写透传（整棵树 PUT 覆盖式保存）。
- **前端**：`GroupNode` 加 `icon?`/`iconColor?`；`GroupTree` 编辑弹窗（原"重命名"→"编辑分组"）加 **图标选择器**（22 个 boxicons 预设：folder/server/cloud/network/cube/shield/… 网格点选）+ **颜色调色板**（9 色）+ 名称旁**实时预览**；新建/子分组也可选图标。树节点渲染由固定 `bx-folder/#e0a23b` 改为 `g.icon||默认 / g.iconColor||默认`。
- **验证**：API——PUT 带 icon/iconColor 的树 → 重取持久化正确（`bx-server`/`#22c55e`）、子节点保留；Playwright——编辑弹窗标题"编辑分组"、22 图标 + 9 色板渲染、预览随选中变化。`go build`+`tsc`+`vite build` 全过。测试改动已还原。

### S.2 · 分组图标：支持上传自定义图片 + 同步终端工作区
在 S.1（预设图标+颜色）基础上补两点：
- **上传自定义图片**：分组编辑弹窗加「上传图标」（`FileReader`→base64 data URL，≤256KB，复用 AssetForm 同款），存入同一 `icon` 字段（后端无需改，仍为字符串）。上传后显示「已用自定义图片 + 移除」，并隐藏颜色板（图片不吃颜色）。
- **共用渲染组件** `components/GroupIcon.tsx`：`icon` 以 `data:` 开头→`<img>`，否则按 boxicons 类名+颜色渲染（默认 bx-folder/琥珀）。
- **同步终端工作区**：`AccessWorkspace` 左侧 `AssetTree` 的分组文件夹由写死 `bxs-folder/#e0a23b` 改用 `<GroupIcon>`；与资产页 `GroupTree` 共用同一 `asset-groups` 查询，故改一处两处一致。

**验证**：Playwright 上传 32×32 PNG→保存→资产页 GroupTree 显示 `<img>`、终端工作区 AssetTree 同步显示同一 `<img>`（截图确认工作区「文本协议」变自定义图标）。`tsc`+`vite build` 通过；测试改动已还原。
