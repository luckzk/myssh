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
