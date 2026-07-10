package access

import (
	"encoding/json"
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
// 与 monitor.go 里 sessionId 版的 dockerPS/dockerAction 并存（后者供监控面板快览）。

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
func (h *Handler) dockerRunAsset(c echo.Context, script string) (string, error) {
	u := web.CurrentUser(c)
	target, _, err := h.resolveTargetByAsset(u, c.Param("assetId"))
	if err != nil {
		return "", err
	}
	out, runErr := gateway.RunSSHCommand(*target, script, h.sshOptionsForUser(u.ID))
	if runErr != nil && strings.TrimSpace(out) == "" {
		return "", echo.NewHTTPError(500, "采集失败: "+runErr.Error())
	}
	return out, nil
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

const dockerOverviewScript = dockerHead + `docker ps >/dev/null 2>&1 && echo ok=1 || echo ok=0
echo "ver=$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
echo "running=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
echo "total=$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
echo "images=$(docker images -q 2>/dev/null | wc -l | tr -d ' ')"
echo "volumes=$(docker volume ls -q 2>/dev/null | wc -l | tr -d ' ')"
echo "networks=$(docker network ls -q 2>/dev/null | wc -l | tr -d ' ')"
echo "extra=$(docker info --format '{{.Driver}};{{.OperatingSystem}};{{.Architecture}};{{.NCPU}};{{.MemTotal}}' 2>/dev/null)"`

func (h *Handler) dockerOverview(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerOverviewScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
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

// ---- 容器（ps 合并 stats）----

const dockerContainersScript = dockerHead + `echo '%%PS%%'
docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}' 2>/dev/null
echo '%%STATS%%'
docker stats --no-stream --format '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null`

func (h *Handler) dockerContainers(c echo.Context) error {
	out, err := h.dockerRunAsset(c, dockerContainersScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	psSec, statsSec := cutSection(out, "%%PS%%", "%%STATS%%")
	type container struct {
		ID        string  `json:"id"`
		Name      string  `json:"name"`
		Image     string  `json:"image"`
		State     string  `json:"state"`
		Status    string  `json:"status"`
		Ports     string  `json:"ports"`
		CreatedAt string  `json:"createdAt"`
		CPU       string  `json:"cpu"`
		MemUsage  string  `json:"memUsage"`
		MemPct    float64 `json:"memPct"`
	}
	stats := map[string][]string{}
	for _, f := range splitPipe(statsSec) {
		stats[shortID(at(f, 0))] = f
	}
	list := []container{}
	for _, f := range splitPipe(psSec) {
		id := shortID(at(f, 0))
		ct := container{ID: id, Name: at(f, 1), Image: at(f, 2), State: at(f, 3), Status: at(f, 4), Ports: at(f, 5), CreatedAt: at(f, 6)}
		if st := stats[id]; st != nil {
			ct.CPU = at(st, 1)
			ct.MemUsage = at(st, 2)
			ct.MemPct = pctFloat(at(st, 3))
		}
		list = append(list, ct)
	}
	return web.OK(c, map[string]any{"available": true, "containers": list})
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
		}
	case "image":
		if action == "rm" {
			return "docker rmi " + id
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
		}
	case "system":
		if action == "prune" {
			return "docker system prune -f"
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
