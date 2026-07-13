package access

import (
	"encoding/json"
	"io"
	"strconv"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/authz"
	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

// 资产级 Docker 管理：不依赖已打开的终端会话，直接按 assetId 解析目标 + 鉴权后经 SSH 跑 docker 命令。

// resolveTargetByAsset 按 assetId 解析 SSH 目标：加载资产 → 访问鉴权 → 复用 resolveTarget 解密凭证。
func (h *Handler) resolveTargetByAsset(u *model.User, assetID string) (*gateway.SSHTarget, *model.Asset, error) {
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", assetID).Error; err != nil {
		return nil, nil, echo.NewHTTPError(404, "资产不存在")
	}
	if !authz.CanAccess(h.store.DB, u, a.ID) {
		return nil, nil, echo.NewHTTPError(403, "无权访问该资产")
	}
	target, err := h.resolveTarget(&a)
	if err != nil {
		return nil, nil, echo.NewHTTPError(500, "凭证解析失败: "+err.Error())
	}
	return target, &a, nil
}

// dockerRunAsset 在资产目标上跑一段脚本，返回 stdout（保留非空输出即使退出码非 0）。
// 经 SSH 连接池复用连接，避免每次轮询重拨（远程高延迟主机提速明显）。
func (h *Handler) dockerRunAsset(c echo.Context, script string) (string, error) {
	u := web.CurrentUser(c)
	assetID := c.Param("assetId")
	target, _, err := h.resolveTargetByAsset(u, assetID)
	if err != nil {
		return "", err
	}
	out, runErr := h.sshPool.Run(poolKey(u.ID, target), *target, script, h.sshOptionsForUser(u.ID))
	if runErr != nil && strings.TrimSpace(out) == "" {
		return "", echo.NewHTTPError(500, "采集失败: "+runErr.Error())
	}
	return out, nil
}

// poolKey 连接池键：同一 App 用户 + 同一远程目标(host:port:user) 复用一条 SSH 连接，
// 让 docker 管理器与主机监控共享连接。
func poolKey(userID string, t *gateway.SSHTarget) string {
	return userID + "|" + t.User + "@" + t.Host + ":" + strconv.Itoa(t.Port)
}

// splitPipe 逐行解析 `{{.A}}|{{.B}}` 管道模板输出。用显式字段模板（而非 {{json .}}）
// 是因为 CLI 会把字段归一化，docker 与 podman 输出一致；podman 的原始 JSON key 各不相同。
// 忽略空行、分段标记、podman 的 "Emulate Docker CLI" 噪声行。
func splitPipe(section string) [][]string {
	rows := [][]string{}
	for _, ln := range strings.Split(section, "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "%%") || strings.Contains(ln, "Emulate Docker CLI") {
			continue
		}
		rows = append(rows, strings.Split(ln, "|"))
	}
	return rows
}

// at 安全取第 i 个字段。
func at(f []string, i int) string {
	if i >= 0 && i < len(f) {
		return f[i]
	}
	return ""
}

// jsonFrom 返回从首个 [ 或 { 起的子串（剥离 podman 前缀噪声后再解析 inspect）。
func jsonFrom(s string) string {
	if i := strings.IndexAny(s, "[{"); i >= 0 {
		return s[i:]
	}
	return ""
}

// stripNoise 去掉 podman 的 "Emulate Docker CLI" 提示行，净化操作回显。
func stripNoise(s string) string {
	lines := []string{}
	for _, ln := range strings.Split(s, "\n") {
		if strings.Contains(ln, "Emulate Docker CLI") {
			continue
		}
		lines = append(lines, ln)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// shortID 归一化容器/镜像 ID 到 12 位短 ID，便于 ps 与 stats 结果对齐。
func shortID(id string) string {
	id = strings.TrimPrefix(id, "sha256:")
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

const dockerHead = "command -v docker >/dev/null 2>&1 || { echo no_docker; exit 0; }\n"

// ---- 概览 ----

// 无 docker 时进一步区分原因：装了 podman 但缺 docker 兼容命令 vs 完全未装容器引擎。
// 各计数命令并行执行（后台 & + wait）；每项用单条 echo 输出（<PIPE_BUF 原子写，不交错），
// 顺序无关（parser 按 key=value 解析）。把 overview 从 ~8 次顺序调用降到并行 max。
const dockerOverviewScript = `if ! command -v docker >/dev/null 2>&1; then
  if command -v podman >/dev/null 2>&1; then echo reason=podman-no-shim; else echo reason=not-installed; fi
  exit 0
fi
{ docker ps >/dev/null 2>&1 && echo ok=1 || echo ok=0; } &
{ echo "ver=$(docker version --format '{{.Server.Version}}' 2>/dev/null)"; } &
{ echo "running=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"; } &
{ echo "total=$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"; } &
{ echo "images=$(docker images -q 2>/dev/null | wc -l | tr -d ' ')"; } &
{ echo "volumes=$(docker volume ls -q 2>/dev/null | wc -l | tr -d ' ')"; } &
{ echo "networks=$(docker network ls -q 2>/dev/null | wc -l | tr -d ' ')"; } &
{ echo "extra=$(docker info --format '{{.Driver}};{{.OperatingSystem}};{{.Architecture}};{{.NCPU}};{{.MemTotal}}' 2>/dev/null)"; } &
wait`

func (h *Handler) dockerOverview(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerOverviewScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "reason=") {
		reason := "not-installed"
		for _, ln := range strings.Split(out, "\n") {
			if k, v, ok := strings.Cut(strings.TrimSpace(ln), "="); ok && k == "reason" {
				reason = v
			}
		}
		return web.OK(c, map[string]any{"available": false, "reason": reason})
	}
	type info struct {
		ServerVersion string `json:"serverVersion"`
		Containers    int    `json:"containers"`
		Running       int    `json:"running"`
		Stopped       int    `json:"stopped"`
		Images        int    `json:"images"`
		Volumes       int    `json:"volumes"`
		Networks      int    `json:"networks"`
		Driver        string `json:"driver"`
		OS            string `json:"os"`
		Arch          string `json:"arch"`
		NCPU          int    `json:"ncpu"`
		MemTotalKB    int64  `json:"memTotalKB"`
	}
	var nfo info
	daemonOk := false
	for _, ln := range strings.Split(out, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(ln), "=")
		if !ok {
			continue
		}
		switch k {
		case "ok":
			daemonOk = v == "1"
		case "ver":
			nfo.ServerVersion = v
		case "running":
			nfo.Running = atoiSafe(v)
		case "total":
			nfo.Containers = atoiSafe(v)
		case "images":
			nfo.Images = atoiSafe(v)
		case "volumes":
			nfo.Volumes = atoiSafe(v)
		case "networks":
			nfo.Networks = atoiSafe(v)
		case "extra":
			e := strings.Split(v, ";")
			if len(e) >= 5 {
				nfo.Driver, nfo.OS, nfo.Arch = e[0], e[1], e[2]
				nfo.NCPU = atoiSafe(e[3])
				nfo.MemTotalKB = int64(atoiSafe(e[4])) / 1024
			}
		}
	}
	if nfo.Stopped = nfo.Containers - nfo.Running; nfo.Stopped < 0 {
		nfo.Stopped = 0
	}
	return web.OK(c, map[string]any{"available": true, "daemonOk": daemonOk, "info": nfo})
}

// ---- 容器 ----
// 只跑 docker ps（快）；stats 单列到 /containers/stats（docker stats --no-stream 慢，异步补齐占用率）。

const dockerContainersScript = dockerHead + `docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}' 2>/dev/null`

func (h *Handler) dockerContainers(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerContainersScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type container struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Image     string `json:"image"`
		State     string `json:"state"`
		Status    string `json:"status"`
		Ports     string `json:"ports"`
		CreatedAt string `json:"createdAt"`
	}
	list := []container{}
	for _, f := range splitPipe(out) {
		list = append(list, container{ID: shortID(at(f, 0)), Name: at(f, 1), Image: at(f, 2), State: at(f, 3), Status: at(f, 4), Ports: at(f, 5), CreatedAt: at(f, 6)})
	}
	return web.OK(c, map[string]any{"available": true, "containers": list})
}

// dockerContainerStats 单独采集容器 CPU/内存占用（慢命令，前端异步补齐）。
const dockerStatsScript = dockerHead + `docker stats --no-stream --format '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null`

func (h *Handler) dockerContainerStats(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerStatsScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type stat struct {
		ID       string  `json:"id"`
		CPU      string  `json:"cpu"`
		MemUsage string  `json:"memUsage"`
		MemPct   float64 `json:"memPct"`
	}
	list := []stat{}
	for _, f := range splitPipe(out) {
		list = append(list, stat{ID: shortID(at(f, 0)), CPU: at(f, 1), MemUsage: at(f, 2), MemPct: pctFloat(at(f, 3))})
	}
	return web.OK(c, map[string]any{"available": true, "stats": list})
}

// ---- 镜像 ----

const dockerImagesScript = dockerHead + `docker images --format '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedSince}}' 2>/dev/null`

func (h *Handler) dockerImages(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerImagesScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type image struct {
		ID      string `json:"id"`
		Repo    string `json:"repo"`
		Tag     string `json:"tag"`
		Size    string `json:"size"`
		Created string `json:"created"`
	}
	list := []image{}
	for _, f := range splitPipe(out) {
		list = append(list, image{ID: shortID(at(f, 0)), Repo: at(f, 1), Tag: at(f, 2), Size: at(f, 3), Created: at(f, 4)})
	}
	return web.OK(c, map[string]any{"available": true, "images": list})
}

// ---- 网络 ----

// 注意：不用 {{.Scope}}——podman network ls 不支持该字段会整体报错。
const dockerNetworksScript = dockerHead + `docker network ls --format '{{.ID}}|{{.Name}}|{{.Driver}}' 2>/dev/null`

func (h *Handler) dockerNetworks(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerNetworksScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type network struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Driver string `json:"driver"`
	}
	list := []network{}
	for _, f := range splitPipe(out) {
		list = append(list, network{ID: shortID(at(f, 0)), Name: at(f, 1), Driver: at(f, 2)})
	}
	return web.OK(c, map[string]any{"available": true, "networks": list})
}

// ---- 数据卷 ----

const dockerVolumesScript = dockerHead + `docker volume ls --format '{{.Name}}|{{.Driver}}' 2>/dev/null`

func (h *Handler) dockerVolumes(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerVolumesScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type volume struct {
		Name   string `json:"name"`
		Driver string `json:"driver"`
	}
	list := []volume{}
	for _, f := range splitPipe(out) {
		list = append(list, volume{Name: at(f, 0), Driver: at(f, 1)})
	}
	return web.OK(c, map[string]any{"available": true, "volumes": list})
}

// ---- inspect（原始 JSON）----

func (h *Handler) dockerInspect(c echo.Context) error {
	id := c.QueryParam("id")
	if !isSafeToken(id) {
		return web.Fail(c, 200, 400, "ID 非法")
	}
	out, err := h.dockerRunAsset(c, dockerHead+"docker inspect "+id+" 2>&1")
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	// podman 会在 JSON 前打印噪声行，从首个 [ / { 起解析。
	if js := jsonFrom(out); js != "" {
		var arr []any
		if json.Unmarshal([]byte(js), &arr) == nil && len(arr) > 0 {
			return web.OK(c, map[string]any{"available": true, "inspect": arr[0]})
		}
	}
	// 解析失败（多半是 docker 报错文本）：净化后回传供前端展示
	return web.OK(c, map[string]any{"available": true, "raw": stripNoise(out)})
}

// ---- 操作（写）----

// dockerCmdFor 按 type+action 生成固定命令；参数已在调用前过 isSafeToken。
// 返回空串表示不支持的组合。
func dockerCmdFor(typ, action, id, name string) string {
	switch typ {
	case "container":
		switch action {
		case "start", "stop", "restart", "kill", "pause", "unpause":
			return "docker " + action + " " + id
		case "rm":
			return "docker rm -f " + id
		case "rename":
			return "docker rename " + id + " " + name
		case "prune":
			return "docker container prune -f"
		}
	case "image":
		switch action {
		case "rm":
			return "docker rmi " + id
		case "prune":
			return "docker image prune -f"
		}
	case "volume":
		switch action {
		case "rm":
			return "docker volume rm " + id
		case "create":
			return "docker volume create " + name
		case "prune":
			return "docker volume prune -f"
		}
	case "network":
		switch action {
		case "rm":
			return "docker network rm " + id
		case "create":
			return "docker network create " + name
		case "prune":
			return "docker network prune -f"
		}
	case "system":
		if action == "prune" {
			return "docker system prune -f"
		}
	case "builder":
		if action == "prune" {
			return "docker builder prune -f"
		}
	}
	return ""
}

// actionNeedsID 除 create/prune 外，写操作都需要合法 id。
func actionNeedsID(action string) bool {
	return action != "create" && action != "prune"
}

func (h *Handler) dockerAssetAction(c echo.Context) error {
	var req struct {
		Type   string `json:"type"`
		ID     string `json:"id"`
		Action string `json:"action"`
		Name   string `json:"name"`
	}
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if actionNeedsID(req.Action) && !isSafeToken(req.ID) {
		return web.Fail(c, 200, 400, "目标 ID 非法")
	}
	if (req.Action == "create" || req.Action == "rename") && !isSafeToken(req.Name) {
		return web.Fail(c, 200, 400, "名称非法")
	}
	cmd := dockerCmdFor(req.Type, req.Action, req.ID, req.Name)
	if cmd == "" {
		return web.Fail(c, 200, 400, "不支持的操作")
	}
	out, err := h.dockerRunAsset(c, dockerHead+cmd+" 2>&1")
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.Fail(c, 200, 400, "目标未安装 Docker")
	}
	return web.OK(c, map[string]any{"ok": true, "output": stripNoise(out)})
}

// cutSection 从形如 markerA\n...\nmarkerB\n... 的输出里切出两段。
func cutSection(out, markerA, markerB string) (a, b string) {
	rest := out
	if i := strings.Index(rest, markerA); i >= 0 {
		rest = rest[i+len(markerA):]
	}
	a, b, _ = strings.Cut(rest, markerB)
	return a, b
}

// pctFloat 解析 "12.3%" → 12.3。
func pctFloat(s string) float64 {
	s = strings.TrimSuffix(strings.TrimSpace(s), "%")
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

// isSafeImageRef 镜像引用校验：比 isSafeToken 多允许 / : @（registry/repo:tag@digest）。防注入。
func isSafeImageRef(s string) bool {
	if s == "" || len(s) > 256 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' ||
			r == '_' || r == '.' || r == '-' || r == '/' || r == ':' || r == '@') {
			return false
		}
	}
	return true
}

// ---- 流式端点（WS）：日志 / 进入容器终端 / 镜像 pull ----

const dockerStreamGuard = "command -v docker >/dev/null 2>&1 || { echo '目标未安装 Docker'; exit 0; }; "

// dockerStreamStart 统一 WS 引导：鉴权解析目标 → 升级 WS → DialSSH → StreamSSHCommand。
func (h *Handler) dockerStreamStart(c echo.Context, cmd string, pty bool, cols, rows int) error {
	u := web.CurrentUser(c)
	target, _, err := h.resolveTargetByAsset(u, c.Param("assetId"))
	if err != nil {
		return fail(c, err) // 升级前失败：回 JSON，前端 WS onerror
	}
	ws, err := h.upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return nil
	}
	defer ws.Close()
	client, derr := gateway.DialSSH(*target, h.sshOptionsForUser(u.ID))
	if derr != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte(gateway.EncodeError("SSH 连接失败: "+derr.Error())))
		return nil
	}
	defer client.Close()
	_ = gateway.StreamSSHCommand(ws, client, cmd, pty, cols, rows)
	return nil
}

// dockerLogs 流式跟随容器日志（只读）。
func (h *Handler) dockerLogs(c echo.Context) error {
	id := c.QueryParam("id")
	if !isSafeToken(id) {
		return web.Fail(c, 200, 400, "容器 ID 非法")
	}
	tail := c.QueryParam("tail")
	if !isSafeToken(tail) {
		tail = "200"
	}
	cmd := dockerStreamGuard + "docker logs --tail " + tail + " -f " + id + " 2>&1"
	return h.dockerStreamStart(c, cmd, false, 0, 0)
}

// dockerExec 进入容器交互终端（PTY）。优先 bash，回退 sh。
func (h *Handler) dockerExec(c echo.Context) error {
	id := c.QueryParam("id")
	if !isSafeToken(id) {
		return web.Fail(c, 200, 400, "容器 ID 非法")
	}
	cmd := dockerStreamGuard + "docker exec -it " + id + " sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'"
	return h.dockerStreamStart(c, cmd, true, atoiSafe(c.QueryParam("cols")), atoiSafe(c.QueryParam("rows")))
}

// dockerPull 拉取镜像并流式回传进度（只读）。
func (h *Handler) dockerPull(c echo.Context) error {
	ref := c.QueryParam("ref")
	if !isSafeImageRef(ref) {
		return web.Fail(c, 200, 400, "镜像引用非法")
	}
	cmd := dockerStreamGuard + "docker pull " + ref + " 2>&1"
	return h.dockerStreamStart(c, cmd, false, 0, 0)
}

// shq 单引号转义，供 run/compose/文件路径等安全拼接到远程 shell 命令。
func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// ---- 磁盘占用 (system df) ----

// dockerDiskUsage 解析 `docker system df` 默认表格（不用 --format：podman 字段名不同会报错）。
func (h *Handler) dockerDiskUsage(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerHead+"docker system df 2>/dev/null")
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type row struct {
		Type        string `json:"type"`
		Total       string `json:"total"`
		Active      string `json:"active"`
		Size        string `json:"size"`
		Reclaimable string `json:"reclaimable"`
	}
	// 双词类型放前面优先匹配
	prefixes := []string{"Local Volumes", "Build Cache", "Images", "Containers"}
	rows := []row{}
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "TYPE") || strings.Contains(ln, "Emulate Docker CLI") {
			continue
		}
		var typ, rest string
		for _, p := range prefixes {
			if strings.HasPrefix(ln, p) {
				typ, rest = p, strings.TrimSpace(ln[len(p):])
				break
			}
		}
		if typ == "" {
			continue
		}
		f := strings.Fields(rest)
		rows = append(rows, row{Type: typ, Total: at(f, 0), Active: at(f, 1), Size: at(f, 2), Reclaimable: at(f, 3)})
	}
	return web.OK(c, map[string]any{"available": true, "usage": rows})
}

// ---- 从镜像运行容器 ----

// dockerRunCreate 组装 docker run -d，每个用户字段单引号转义（shq），杜绝注入。
func (h *Handler) dockerRunCreate(c echo.Context) error {
	var req struct {
		Image   string   `json:"image"`
		Name    string   `json:"name"`
		Ports   []string `json:"ports"`
		Envs    []string `json:"envs"`
		Volumes []string `json:"volumes"`
		Restart string   `json:"restart"`
		Command string   `json:"command"`
	}
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if !isSafeImageRef(req.Image) {
		return web.Fail(c, 200, 400, "镜像引用非法")
	}
	if req.Name != "" && !isSafeToken(req.Name) {
		return web.Fail(c, 200, 400, "容器名称非法")
	}
	parts := []string{"docker run -d"}
	if req.Name != "" {
		parts = append(parts, "--name", shq(req.Name))
	}
	appendFlag := func(flag string, vals []string) {
		for _, v := range vals {
			if v = strings.TrimSpace(v); v != "" {
				parts = append(parts, flag, shq(v))
			}
		}
	}
	appendFlag("-p", req.Ports)
	appendFlag("-e", req.Envs)
	appendFlag("-v", req.Volumes)
	if r := strings.TrimSpace(req.Restart); r != "" {
		parts = append(parts, "--restart", shq(r))
	}
	parts = append(parts, shq(req.Image))
	for _, tok := range strings.Fields(req.Command) {
		parts = append(parts, shq(tok))
	}
	out, err := h.dockerRunAsset(c, dockerHead+strings.Join(parts, " ")+" 2>&1")
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.Fail(c, 200, 400, "目标未安装 Docker")
	}
	return web.OK(c, map[string]any{"ok": true, "output": stripNoise(out)})
}

// ---- Compose 编排 ----

// dockerComposeList `docker compose ls --format json`。无 compose 插件时优雅降级。
func (h *Handler) dockerComposeList(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerHead+"docker compose ls --format json 2>&1")
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") || strings.Contains(out, "compose provider") || strings.Contains(out, "is not a docker command") {
		return web.OK(c, map[string]any{"available": false})
	}
	type project struct {
		Name        string `json:"name"`
		Status      string `json:"status"`
		ConfigFiles string `json:"configFiles"`
	}
	list := []project{}
	if js := jsonFrom(out); js != "" {
		var raw []map[string]any
		if json.Unmarshal([]byte(js), &raw) == nil {
			for _, m := range raw {
				list = append(list, project{Name: str(m, "Name"), Status: str(m, "Status"), ConfigFiles: str(m, "ConfigFiles")})
			}
		}
	}
	return web.OK(c, map[string]any{"available": true, "projects": list})
}

// str 从 map 安全取字符串。
func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

// dockerComposeAction up/down/restart 一个 compose 项目（按 configFile 路径）。
func (h *Handler) dockerComposeAction(c echo.Context) error {
	var req struct {
		ConfigFile string `json:"configFile"`
		Action     string `json:"action"`
	}
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if strings.TrimSpace(req.ConfigFile) == "" {
		return web.Fail(c, 200, 400, "缺少 compose 文件")
	}
	var tail string
	switch req.Action {
	case "up":
		tail = "up -d"
	case "down":
		tail = "down"
	case "restart":
		tail = "restart"
	default:
		return web.Fail(c, 200, 400, "不支持的操作")
	}
	cmd := "docker compose -f " + shq(req.ConfigFile) + " " + tail + " 2>&1"
	out, err := h.dockerRunAsset(c, dockerHead+cmd)
	if err != nil {
		return fail(c, err)
	}
	return web.OK(c, map[string]any{"ok": true, "output": stripNoise(out)})
}

// dockerComposeFile 读取 compose 文件内容（SSH 用户本就有 shell 权限，shq 防注入即可）。
func (h *Handler) dockerComposeFile(c echo.Context) error {
	path := c.QueryParam("path")
	if strings.TrimSpace(path) == "" {
		return web.Fail(c, 200, 400, "缺少路径")
	}
	out, err := h.dockerRunAsset(c, "cat "+shq(path)+" 2>&1")
	if err != nil {
		return fail(c, err)
	}
	return web.OK(c, map[string]any{"content": stripNoise(out)})
}

// ---- 容器内文件（docker exec 浏览 / 查看 / 下载）----

// dockerFileLs 列容器内某目录（ls -lA 解析）。
func (h *Handler) dockerFileLs(c echo.Context) error {
	id := c.QueryParam("id")
	if !isSafeToken(id) {
		return web.Fail(c, 200, 400, "容器 ID 非法")
	}
	path := c.QueryParam("path")
	if strings.TrimSpace(path) == "" {
		path = "/"
	}
	out, err := h.dockerRunAsset(c, dockerHead+"docker exec "+id+" ls -lA "+shq(path)+" 2>&1")
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type entry struct {
		Name   string `json:"name"`
		IsDir  bool   `json:"isDir"`
		IsLink bool   `json:"isLink"`
		Size   string `json:"size"`
		Mode   string `json:"mode"`
	}
	list := []entry{}
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimRight(ln, "\r")
		if ln == "" || strings.HasPrefix(ln, "total ") || strings.Contains(ln, "Emulate Docker CLI") {
			continue
		}
		f := strings.Fields(ln)
		if len(f) < 9 || len(f[0]) < 1 {
			continue
		}
		name := strings.Join(f[8:], " ")
		isLink := f[0][0] == 'l'
		if isLink {
			if i := strings.Index(name, " -> "); i >= 0 {
				name = name[:i]
			}
		}
		if name == "." || name == ".." {
			continue
		}
		list = append(list, entry{Name: name, IsDir: f[0][0] == 'd', IsLink: isLink, Size: at(f, 4), Mode: f[0]})
	}
	return web.OK(c, map[string]any{"available": true, "path": path, "entries": list})
}

// dockerFileRead 读容器内文本文件（截断到 512KB）。
func (h *Handler) dockerFileRead(c echo.Context) error {
	id := c.QueryParam("id")
	if !isSafeToken(id) {
		return web.Fail(c, 200, 400, "容器 ID 非法")
	}
	path := c.QueryParam("path")
	if strings.TrimSpace(path) == "" {
		return web.Fail(c, 200, 400, "缺少路径")
	}
	out, err := h.dockerRunAsset(c, dockerHead+"docker exec "+id+" cat "+shq(path)+" 2>&1")
	if err != nil {
		return fail(c, err)
	}
	out = stripNoise(out)
	const maxRead = 512 * 1024
	if len(out) > maxRead {
		out = out[:maxRead] + "\n…(已截断)"
	}
	return web.OK(c, map[string]any{"content": out})
}

// dockerFileDownload 流式下载容器内文件（docker exec cat → HTTP attachment）。token 走 query。
func (h *Handler) dockerFileDownload(c echo.Context) error {
	id := c.QueryParam("id")
	path := c.QueryParam("path")
	if !isSafeToken(id) || strings.TrimSpace(path) == "" {
		return web.Fail(c, 200, 400, "参数非法")
	}
	u := web.CurrentUser(c)
	target, _, err := h.resolveTargetByAsset(u, c.Param("assetId"))
	if err != nil {
		return fail(c, err)
	}
	client, derr := gateway.DialSSH(*target, h.sshOptionsForUser(u.ID))
	if derr != nil {
		return web.Fail(c, 200, 500, "SSH 连接失败: "+derr.Error())
	}
	defer client.Close()
	sess, serr := client.NewSession()
	if serr != nil {
		return web.Fail(c, 200, 500, serr.Error())
	}
	defer sess.Close()
	stdout, _ := sess.StdoutPipe()
	base := path[strings.LastIndex(path, "/")+1:]
	if base == "" {
		base = "download"
	}
	c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+base+"\"")
	c.Response().Header().Set("Content-Type", "application/octet-stream")
	if e := sess.Start("docker exec " + id + " cat " + shq(path)); e != nil {
		return web.Fail(c, 200, 500, e.Error())
	}
	_, _ = io.Copy(c.Response(), stdout)
	_ = sess.Wait()
	return nil
}
