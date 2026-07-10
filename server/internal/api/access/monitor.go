package access

import (
	"strconv"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

// resolveTargetBySession 按 sessionID 解析 SSH 目标（校验会话归属该用户）。
func (h *Handler) resolveTargetBySession(u *model.User, sessionID string) (*gateway.SSHTarget, error) {
	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ? AND user_id = ?", sessionID, u.ID).Error; err != nil {
		return nil, echo.NewHTTPError(404, "会话不存在")
	}
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", sess.AssetID).Error; err != nil {
		return nil, echo.NewHTTPError(404, "资产不存在")
	}
	target, err := h.resolveTarget(&a)
	if err != nil {
		return nil, echo.NewHTTPError(500, "凭证解析失败: "+err.Error())
	}
	return target, nil
}

// resolveSessionTarget 由 query 的 sessionId 解析 SSH 目标。stats/processes/docker/gpu 共用。
func (h *Handler) resolveSessionTarget(c echo.Context) (*gateway.SSHTarget, *model.User, error) {
	u := web.CurrentUser(c)
	target, err := h.resolveTargetBySession(u, c.QueryParam("sessionId"))
	return target, u, err
}

// isSafeToken 仅允许 [A-Za-z0-9_.-]，防命令注入。
func isSafeToken(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '.' || r == '-') {
			return false
		}
	}
	return true
}

// dockerAction 对容器执行 start/stop/restart。写操作：动作白名单 + ID 严格校验防注入。
func (h *Handler) dockerAction(c echo.Context) error {
	u := web.CurrentUser(c)
	var req struct {
		SessionID string `json:"sessionId"`
		ID        string `json:"id"`
		Action    string `json:"action"`
	}
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if req.Action != "start" && req.Action != "stop" && req.Action != "restart" {
		return web.Fail(c, 200, 400, "不支持的操作")
	}
	if !isSafeToken(req.ID) {
		return web.Fail(c, 200, 400, "容器 ID 非法")
	}
	target, err := h.resolveTargetBySession(u, req.SessionID)
	if err != nil {
		return fail(c, err)
	}
	out, runErr := h.sshPool.Run(poolKey(u.ID, target), *target, "docker "+req.Action+" "+req.ID+" 2>&1", h.sshOptionsForUser(u.ID))
	if runErr != nil {
		return web.Fail(c, 200, 500, "操作失败: "+strings.TrimSpace(out))
	}
	return web.OK(c, map[string]any{"ok": true})
}

// runOnSession 在会话目标上跑一段脚本，返回 stdout。
func (h *Handler) runOnSession(c echo.Context, script string) (string, error) {
	target, u, err := h.resolveSessionTarget(c)
	if err != nil {
		return "", err
	}
	out, runErr := h.sshPool.Run(poolKey(u.ID, target), *target, script, h.sshOptionsForUser(u.ID))
	if runErr != nil && strings.TrimSpace(out) == "" {
		return "", echo.NewHTTPError(500, "采集失败: "+runErr.Error())
	}
	return out, nil
}

func fail(c echo.Context, err error) error {
	if he, ok := err.(*echo.HTTPError); ok {
		return web.Fail(c, 200, he.Code, he.Message.(string))
	}
	return web.Fail(c, 200, 500, err.Error())
}

// ---- 进程列表 ----

// 首行输出进程总数 total=N，其后为 ps 输出（含表头）。取前 100 供列表+客户端搜索。
const psPrefix = "echo \"total=$(( $(ps -e 2>/dev/null | wc -l) - 1 ))\"\n"
const psBodyCPU = `ps -eo pid,comm,user,%cpu,%mem,rss --sort=-%cpu 2>/dev/null | head -n 101`
const psBodyMem = `ps -eo pid,comm,user,%cpu,%mem,rss --sort=-%mem 2>/dev/null | head -n 101`

// processes 采集 Top 进程（按 CPU 或内存排序）+ 进程总数。
func (h *Handler) processes(c echo.Context) error {
	script := psPrefix + psBodyCPU
	if c.QueryParam("sort") == "mem" {
		script = psPrefix + psBodyMem
	}
	out, err := h.runOnSession(c, script)
	if err != nil {
		return fail(c, err)
	}
	type proc struct {
		PID   int64   `json:"pid"`
		Name  string  `json:"name"`
		User  string  `json:"user"`
		CPU   float64 `json:"cpu"`
		Mem   float64 `json:"mem"`
		RssKB int64   `json:"rssKB"`
	}
	list := []proc{}
	total := 0
	sawHeader := false
	for _, ln := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.HasPrefix(ln, "total=") {
			total = atoiSafe(strings.TrimPrefix(ln, "total="))
			continue
		}
		if !sawHeader { // ps 表头
			sawHeader = true
			continue
		}
		f := strings.Fields(ln)
		if len(f) < 6 {
			continue
		}
		pid, _ := strconv.ParseInt(f[0], 10, 64)
		cpu, _ := strconv.ParseFloat(f[3], 64)
		mem, _ := strconv.ParseFloat(f[4], 64)
		rss, _ := strconv.ParseInt(f[5], 10, 64)
		list = append(list, proc{PID: pid, Name: f[1], User: f[2], CPU: cpu, Mem: mem, RssKB: rss})
	}
	if total == 0 {
		total = len(list)
	}
	return web.OK(c, map[string]any{"processes": list, "total": total})
}

// ---- Docker 容器 ----

func atoiSafe(s string) int { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }

// dockerScript：无 docker 则输出 no_docker；否则分三段。INFO 用 key=value + 便携计数命令
// （docker/podman 通用；不依赖各家不同的 `docker info` 模板字段）；extra 为可选详情（podman 可能为空）。
const dockerScript = `command -v docker >/dev/null 2>&1 || { echo no_docker; exit 0; }
echo '%%INFO%%'
docker ps >/dev/null 2>&1 && echo ok=1 || echo ok=0
echo "ver=$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
echo "running=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
echo "total=$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
echo "images=$(docker images -q 2>/dev/null | wc -l | tr -d ' ')"
echo "extra=$(docker info --format '{{.Driver}};{{.OperatingSystem}};{{.Architecture}};{{.NCPU}};{{.MemTotal}}' 2>/dev/null)"
echo '%%PS%%'
docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}' 2>/dev/null
echo '%%STATS%%'
docker stats --no-stream --format '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null
echo '%%IMAGES%%'
docker images --format '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}' 2>/dev/null
echo '%%VOLUMES%%'
docker volume ls --format '{{.Name}}|{{.Driver}}' 2>/dev/null`

func (h *Handler) dockerPS(c echo.Context) error {
	out, err := h.runOnSession(c, dockerScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_docker") {
		return web.OK(c, map[string]any{"available": false})
	}
	type dockerInfo struct {
		ServerVersion string `json:"serverVersion"`
		Containers    int    `json:"containers"`
		Running       int    `json:"running"`
		Stopped       int    `json:"stopped"`
		Images        int    `json:"images"`
		Driver        string `json:"driver"`
		OS            string `json:"os"`
		Arch          string `json:"arch"`
		NCPU          int    `json:"ncpu"`
		MemTotalKB    int64  `json:"memTotalKB"`
	}
	type container struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Image    string  `json:"image"`
		State    string  `json:"state"`
		Status   string  `json:"status"`
		CPU      string  `json:"cpu"`
		MemUsage string  `json:"memUsage"`
		MemPct   float64 `json:"memPct"`
	}
	type image struct {
		ID   string `json:"id"`
		Repo string `json:"repo"`
		Tag  string `json:"tag"`
		Size string `json:"size"`
	}
	type volume struct {
		Name   string `json:"name"`
		Driver string `json:"driver"`
	}
	var info dockerInfo
	daemonOk := false
	byID := map[string]*container{}
	order := []string{}
	images := []image{}
	volumes := []volume{}
	section := ""
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		switch ln {
		case "%%INFO%%", "%%PS%%", "%%STATS%%", "%%IMAGES%%", "%%VOLUMES%%":
			section = ln
			continue
		}
		switch section {
		case "%%INFO%%":
			k, v, ok := strings.Cut(ln, "=")
			if !ok {
				continue
			}
			switch k {
			case "ok":
				daemonOk = v == "1"
			case "ver":
				info.ServerVersion = v
			case "running":
				info.Running = atoiSafe(v)
			case "total":
				info.Containers = atoiSafe(v)
			case "images":
				info.Images = atoiSafe(v)
			case "extra": // driver;os;arch;ncpu;memTotal（可选，podman 可能为空）
				e := strings.Split(v, ";")
				if len(e) >= 5 {
					info.Driver = e[0]
					info.OS = e[1]
					info.Arch = e[2]
					info.NCPU = atoiSafe(e[3])
					mt, _ := strconv.ParseInt(strings.TrimSpace(e[4]), 10, 64)
					info.MemTotalKB = mt / 1024
				}
			}
		case "%%PS%%":
			f := strings.Split(ln, "|")
			if len(f) < 5 {
				continue
			}
			id := f[0]
			if len(id) > 12 {
				id = id[:12]
			}
			byID[id] = &container{ID: id, Name: f[1], Image: f[2], State: f[3], Status: f[4]}
			order = append(order, id)
		case "%%STATS%%":
			f := strings.Split(ln, "|")
			if len(f) < 4 {
				continue
			}
			id := f[0]
			if len(id) > 12 {
				id = id[:12]
			}
			if ct := byID[id]; ct != nil {
				ct.CPU = f[1]
				ct.MemUsage = f[2]
				pct, _ := strconv.ParseFloat(strings.TrimSuffix(f[3], "%"), 64)
				ct.MemPct = pct
			}
		case "%%IMAGES%%":
			f := strings.Split(ln, "|")
			if len(f) < 4 {
				continue
			}
			id := f[0]
			if len(id) > 12 {
				id = id[:12]
			}
			images = append(images, image{ID: id, Repo: f[1], Tag: f[2], Size: f[3]})
		case "%%VOLUMES%%":
			f := strings.Split(ln, "|")
			if len(f) < 2 {
				continue
			}
			volumes = append(volumes, volume{Name: f[0], Driver: f[1]})
		}
	}
	list := make([]*container, 0, len(order))
	for _, id := range order {
		list = append(list, byID[id])
	}
	if info.Stopped = info.Containers - info.Running; info.Stopped < 0 {
		info.Stopped = 0
	}
	return web.OK(c, map[string]any{
		"available":  true,
		"daemonOk":   daemonOk,
		"info":       info,
		"containers": list,
		"images":     images,
		"volumes":    volumes,
	})
}

// ---- GPU (nvidia-smi) ----

const gpuScript = `command -v nvidia-smi >/dev/null 2>&1 || { echo no_gpu; exit 0; }
echo "driver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader,nounits 2>/dev/null | head -1)"
echo "cuda=$(nvidia-smi 2>/dev/null | awk -F'CUDA Version:' 'NF>1{split($2,a,\" \"); print a[1]; exit}')"
echo '%%GPUS%%'
nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total,memory.free,power.draw,power.limit,pstate,fan.speed,uuid --format=csv,noheader,nounits 2>/dev/null`

func (h *Handler) gpu(c echo.Context) error {
	out, err := h.runOnSession(c, gpuScript)
	if err != nil {
		return fail(c, err)
	}
	if strings.Contains(out, "no_gpu") {
		return web.OK(c, map[string]any{"available": false, "gpus": []any{}})
	}
	type gpuInfo struct {
		Index      int     `json:"index"`
		Name       string  `json:"name"`
		TempC      int     `json:"tempC"`
		UtilPct    int     `json:"utilPct"`
		MemUsedMB  int     `json:"memUsedMB"`
		MemTotalMB int     `json:"memTotalMB"`
		MemFreeMB  int     `json:"memFreeMB"`
		PowerW     float64 `json:"powerW"`
		PowerLimit float64 `json:"powerLimitW"`
		Pstate     string  `json:"pstate"`
		FanPct     int     `json:"fanPct"` // -1 = N/A
		UUID       string  `json:"uuid"`
	}
	atoi := func(s string) int { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }
	atof := func(s string) float64 { f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return f }
	fan := func(s string) int {
		s = strings.TrimSpace(s)
		if s == "" || strings.Contains(s, "N/A") || strings.Contains(s, "[") {
			return -1
		}
		return atoi(s)
	}
	driver, cuda := "", ""
	list := []gpuInfo{}
	inGPUs := false
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		if ln == "%%GPUS%%" {
			inGPUs = true
			continue
		}
		if !inGPUs {
			if k, v, ok := strings.Cut(ln, "="); ok {
				if k == "driver" {
					driver = v
				} else if k == "cuda" {
					cuda = v
				}
			}
			continue
		}
		f := strings.Split(ln, ",")
		if len(f) < 12 {
			continue
		}
		list = append(list, gpuInfo{
			Index:      atoi(f[0]),
			Name:       strings.TrimSpace(f[1]),
			TempC:      atoi(f[2]),
			UtilPct:    atoi(f[3]),
			MemUsedMB:  atoi(f[4]),
			MemTotalMB: atoi(f[5]),
			MemFreeMB:  atoi(f[6]),
			PowerW:     atof(f[7]),
			PowerLimit: atof(f[8]),
			Pstate:     strings.TrimSpace(f[9]),
			FanPct:     fan(f[10]),
			UUID:       strings.TrimSpace(f[11]),
		})
	}
	return web.OK(c, map[string]any{
		"available":     true,
		"driverVersion": driver,
		"cudaVersion":   cuda,
		"gpus":          list,
	})
}
