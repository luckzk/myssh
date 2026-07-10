package access

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dushixiang/next-terminal-clone/server/internal/audit"
	"github.com/dushixiang/next-terminal-clone/server/internal/authz"
	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/crypto"
	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/hostkey"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

const reconnectGraceMs int64 = 30_000

// osc7Init 目录同步注入：设置 PROMPT_COMMAND 让 bash 每次提示符输出 OSC7 当前目录序列
// （紧随其后的首个提示符即触发一次，无需再显式 printf）。保留已存在的 PROMPT_COMMAND，
// 对非 bash（sh/zsh）无害（仅设置一个未使用变量）。
const osc7Init = "export PROMPT_COMMAND='printf \"\\033]7;file://%s%s\\007\" \"$HOSTNAME\" \"$PWD\"'\"${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"\n"

type Handler struct {
	store     *store.Store
	cfg       config.Config
	cipher    *crypto.Cipher
	recorder  *audit.Recorder
	registry  *gateway.Registry
	sftp      *gateway.SFTPManager
	forwards  *gateway.PortForwardManager
	guacdAddr string
	upgrader  websocket.Upgrader

	// 会话共享（只读观战）
	shareMu     sync.Mutex
	shareGroups map[string]*shareGroup
	shareTokens map[string]string // token -> sessionId

	// 持久会话：sessionId -> LiveSession（与浏览器 WS 解耦，保活/重新附着）
	livesMu    sync.Mutex
	lives      map[string]*liveSession
	sessionTTL time.Duration
	scrollback int
}

func New(s *store.Store, cfg config.Config, c *crypto.Cipher, rec *audit.Recorder, reg *gateway.Registry) *Handler {
	ttl := cfg.SessionTTL
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}
	scrollback := cfg.SessionScrollback
	if scrollback <= 0 {
		scrollback = 256 * 1024
	}
	h := &Handler{
		store: s, cfg: cfg, cipher: c, recorder: rec, registry: reg,
		sftp:        gateway.NewSFTPManager(),
		forwards:    gateway.NewPortForwardManager(),
		shareGroups: make(map[string]*shareGroup),
		shareTokens: make(map[string]string),
		lives:       make(map[string]*liveSession),
		sessionTTL:  ttl,
		scrollback:  scrollback,
		upgrader: websocket.Upgrader{
			CheckOrigin:     func(r *http.Request) bool { return web.OriginAllowed(r, cfg.AllowedOrigins) },
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
		},
	}
	go h.reapLiveSessions()
	return h
}

// RegisterAccount 挂载 /api/account/sessions（创建/列出/断开会话）。
func (h *Handler) RegisterAccount(g *echo.Group) {
	g.POST("/sessions", h.createSession)
	g.GET("/sessions", h.listAccountSessions)
	g.POST("/sessions/:id/disconnect", h.disconnectAccountSession)
	g.POST("/sessions/:id/dir-follow", h.setSessionDirFollow)
}

// RegisterAccess 挂载 /api/access/terminal（WS 终端）+ 会话共享 + 监控统计。
func (h *Handler) RegisterAccess(g *echo.Group) {
	g.GET("/terminal", h.terminal)
	g.POST("/sessions/:id/share", h.shareSession)
	g.GET("/stats", h.stats)
	g.GET("/processes", h.processes)
	g.GET("/docker", h.dockerPS)
	g.POST("/docker/action", h.dockerAction)
	// 资产级 Docker 管理（不依赖已开会话，按 assetId 鉴权）
	g.GET("/docker/:assetId/overview", h.dockerOverview)
	g.GET("/docker/:assetId/containers", h.dockerContainers)
	g.GET("/docker/:assetId/images", h.dockerImages)
	g.GET("/docker/:assetId/networks", h.dockerNetworks)
	g.GET("/docker/:assetId/volumes", h.dockerVolumes)
	g.GET("/docker/:assetId/inspect", h.dockerInspect)
	g.POST("/docker/:assetId/action", h.dockerAssetAction)
	g.GET("/docker/:assetId/logs", h.dockerLogs)   // WS：跟随日志
	g.GET("/docker/:assetId/exec", h.dockerExec)   // WS：进入容器终端
	g.GET("/docker/:assetId/pull", h.dockerPull)   // WS：镜像 pull 进度
	g.GET("/gpu", h.gpu)
	g.GET("/forwards", h.forwardList)
	g.POST("/forwards", h.forwardCreate)
	g.POST("/forwards/:id/stop", h.forwardStop)
}

// RegisterAdmin 挂载管理端会话增强能力。
func (h *Handler) RegisterAdmin(g *echo.Group) {
	g.GET("/sessions/:id/watch", h.watchSession)
	g.GET("/session-settings", h.getSessionSettings)
	g.PUT("/session-settings", h.saveSessionSettings)
}

type createReq struct {
	AssetID string `json:"assetId"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
}

// createSession 校验授权 → 建 connect_session（status=connected 待 WS 接入）。
func (h *Handler) createSession(c echo.Context) error {
	u := web.CurrentUser(c)
	var req createReq
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", req.AssetID).Error; err != nil {
		return web.Fail(c, 200, 404, "资产不存在")
	}
	// 本地终端闸：未启用/非管理员一律拒绝（等于后端主机 shell，极敏感）。
	if msg, ok := h.localTerminalGate(u, &a); !ok {
		return web.Fail(c, 200, 403, msg)
	}
	// 资产访问控制：admin 直通，普通用户须有授权策略覆盖该资产。
	if !authz.CanAccess(h.store.DB, u, a.ID) {
		return web.Fail(c, 200, 403, "无权访问该资产")
	}
	now := model.NowMillis()
	sess := model.ConnSession{
		ID: uuid.NewString(), UserID: u.ID, Username: u.Username,
		AssetID: a.ID, AssetName: a.Name, Protocol: a.Protocol,
		IP: a.IP, Port: a.Port, ClientIP: c.RealIP(),
		// connecting：尚未接入 WS，不计入「在线会话」；WS 桥接开始才转 connected。
		Status: "connecting", Width: req.Width, Height: req.Height,
		ConnectedAt: now, CreatedAt: now,
	}
	if err := h.store.DB.Create(&sess).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{
		"id": sess.ID, "protocol": sess.Protocol, "assetId": a.ID,
		"width": sess.Width, "height": sess.Height,
	})
}

// terminal 把浏览器 WS 附着到该会话的服务器端 LiveSession（join 非空为只读观战）。
// 已存在 LiveSession → 直接重新附着（换浏览器/重登/自动重连，shell 状态不丢）；
// 不存在 → 首次桥接：鉴权 + 拨号 + 建 LiveSession。会话在 keepalive 下持久存活，浏览器断开只是分离。
func (h *Handler) terminal(c echo.Context) error {
	u := web.CurrentUser(c)
	sessionID := c.QueryParam("sessionId")
	if join := c.QueryParam("join"); join != "" {
		return h.joinViewer(c, sessionID, join)
	}
	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ? AND user_id = ?", sessionID, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}

	// 已有存活会话 → 重新附着（不重新拨号，保留 shell 状态）。
	if live := h.getLive(sessionID); live != nil {
		ws, err := h.upgrader.Upgrade(c.Response(), c.Request(), nil)
		if err != nil {
			return err
		}
		defer ws.Close()
		live.attach(ws, true)
		return nil
	}

	// 首次桥接。
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", sess.AssetID).Error; err != nil {
		return web.Fail(c, 200, 404, "资产不存在")
	}
	if msg, ok := h.localTerminalGate(u, &a); !ok {
		return web.Fail(c, 200, 403, msg)
	}
	if !authz.CanAccess(h.store.DB, u, a.ID) {
		return web.Fail(c, 200, 403, "无权访问该资产")
	}
	target, err := h.resolveTarget(&a)
	if err != nil {
		return web.Fail(c, 200, 500, "凭证解析失败: "+err.Error())
	}

	ws, err := h.upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	cols, rows := sess.Width, sess.Height
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	rec := h.recorder.Start(sess.ID, cols, rows)
	initCmd := ""
	if a.DefaultPath != "" {
		initCmd += "cd " + a.DefaultPath + "\n"
	}
	if a.InitCommand != "" {
		initCmd += a.InitCommand + "\n"
	}
	// 目录同步：注入 PROMPT_COMMAND 输出 OSC7(file://host/pwd)，LiveSession 扫描后发 MsgDirChanged。
	// 由前端「目录跟随」开关（dirFollow 参数，缺省开）决定；关闭时不注入，从源头去掉相关输出。
	dirFollow := c.QueryParam("dirFollow") != "0"
	if dirFollow {
		initCmd += osc7Init
	}
	guard := audit.NewCommandGuard(h.store, &sess)

	live, err := h.startLive(sess, *target, a.Protocol, initCmd, rec, guard, dirFollow)
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte(gateway.EncodeError("连接失败: "+err.Error())))
		rec.Close()
		h.finishSession(&sess, "")
		return nil
	}
	h.putLive(sess.ID, live)
	// 在线 + 立即落 recording_path（便于管理员回放进行中的会话）。
	h.store.DB.Model(&model.ConnSession{}).Where("id = ?", sess.ID).Updates(map[string]any{
		"status": "connected", "connected_at": model.NowMillis(), "reconnect_until": 0,
		"recording_path": rec.Path(),
	})
	// 强制下线：管理员 disconnect 时关闭整个 LiveSession。
	h.registry.Add(sess.ID, func() { live.close("killed") })
	// 连接成功后异步探测目标系统家族（写入 asset.os，用于系统图标）；仅首连一次。
	go h.detectOS(live, a.ID)

	live.attach(ws, true) // 阻塞至该浏览器分离；不 close，会话保活等待重新附着。
	return nil
}

// localTerminalGate 本地终端双保险：须服务端启用 + 管理员。非 local 协议直接放行。
func (h *Handler) localTerminalGate(u *model.User, a *model.Asset) (string, bool) {
	if a.Protocol != "local" {
		return "", true
	}
	if !h.cfg.LocalTerminal {
		return "本地终端未启用（需服务端设置 NT_LOCAL_TERMINAL=true）", false
	}
	if u == nil || u.Type != "admin" {
		return "本地终端仅管理员可用", false
	}
	return "", true
}

// detectOS 另开 exec 通道探测目标系统家族（linux/macos/windows），写入 asset.os。失败静默。
func (h *Handler) detectOS(live *liveSession, assetID string) {
	if live == nil || live.conn == nil {
		return
	}
	out, err := live.conn.Exec("uname -s 2>/dev/null || ver 2>/dev/null || echo unknown")
	if err != nil {
		return // telnet 等不支持 exec → 跳过
	}
	s := strings.ToLower(out)
	family := ""
	switch {
	case strings.Contains(s, "linux"):
		family = "linux"
	case strings.Contains(s, "darwin"):
		family = "macos"
	case strings.Contains(s, "windows"):
		family = "windows"
	}
	if family == "" {
		return
	}
	h.store.DB.Model(&model.Asset{}).Where("id = ? AND os <> ?", assetID, family).Update("os", family)
}

// listAccountSessions 返回当前用户仍存活（可恢复）的会话，供「恢复会话」。
func (h *Handler) listAccountSessions(c echo.Context) error {
	u := web.CurrentUser(c)
	var rows []model.ConnSession
	h.store.DB.Where("user_id = ? AND status = ?", u.ID, "connected").Order("connected_at desc").Find(&rows)
	out := make([]map[string]any, 0, len(rows))
	for _, s := range rows {
		if !h.hasLive(s.ID) {
			continue
		}
		out = append(out, map[string]any{
			"id": s.ID, "assetId": s.AssetID, "assetName": s.AssetName,
			"protocol": s.Protocol, "connectedAt": s.ConnectedAt,
		})
	}
	return web.OK(c, out)
}

// disconnectAccountSession 显式关闭当前用户的某会话（真正结束，非分离）。
func (h *Handler) disconnectAccountSession(c echo.Context) error {
	u := web.CurrentUser(c)
	id := c.Param("id")
	var s model.ConnSession
	if err := h.store.DB.First(&s, "id = ? AND user_id = ?", id, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}
	killed := h.closeLive(id)
	if !killed {
		h.store.DB.Model(&model.ConnSession{}).Where("id = ?", id).Updates(map[string]any{
			"status": "disconnected", "disconnected_at": model.NowMillis(),
		})
	}
	return web.OK(c, map[string]any{"status": "ok", "killed": killed})
}

// setSessionDirFollow 会话中实时开关目录跟随（注入/撤销 PROMPT_COMMAND）。
// 单独走 REST 而非终端帧：帧协议 type 为单字符，0-9 已占满，无法再加新类型。
func (h *Handler) setSessionDirFollow(c echo.Context) error {
	u := web.CurrentUser(c)
	id := c.Param("id")
	var s model.ConnSession
	if err := h.store.DB.First(&s, "id = ? AND user_id = ?", id, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}
	var req struct {
		On bool `json:"on"`
	}
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	if live := h.getLive(id); live != nil {
		live.setDirFollow(req.On)
	}
	return web.OK(c, map[string]any{"on": req.On})
}

func (h *Handler) finishSession(sess *model.ConnSession, recordingPath string) {
	h.sftp.Close(sess.ID) // 顺带关闭该会话的 SFTP 连接
	h.stopSessionForwards(sess.ID)
	h.store.DB.Model(&model.ConnSession{}).Where("id = ?", sess.ID).Updates(map[string]any{
		"status":          "disconnected",
		"disconnected_at": model.NowMillis(),
		"recording_path":  recordingPath,
		"reconnect_until": 0,
	})
}

func (h *Handler) markReconnecting(sess *model.ConnSession, recordingPath string) {
	until := model.NowMillis() + reconnectGraceMs
	h.store.DB.Model(&model.ConnSession{}).Where("id = ?", sess.ID).Updates(map[string]any{
		"status":          "reconnecting",
		"recording_path":  recordingPath,
		"reconnect_until": until,
	})
	go h.expireReconnect(sess.ID, until)
}

func (h *Handler) shouldWaitReconnect(err error) bool {
	return err != nil && !errors.Is(err, gateway.ErrClientExit)
}

func (h *Handler) expireReconnect(sessionID string, until int64) {
	// 宽限期结束后若仍未接回，正式转离线，避免 reconnecting 残留。
	sleepMs := until - model.NowMillis() + 250
	if sleepMs > 0 {
		time.Sleep(time.Duration(sleepMs) * time.Millisecond)
	}
	now := model.NowMillis()
	h.store.DB.Model(&model.ConnSession{}).
		Where("id = ? AND status = ? AND reconnect_until <= ?", sessionID, "reconnecting", now).
		Updates(map[string]any{"status": "disconnected", "disconnected_at": now, "reconnect_until": 0})
}

// resolveTarget 把资产解析为可拨号目标（内联或引用凭证，解密）。
func (h *Handler) resolveTarget(a *model.Asset) (*gateway.SSHTarget, error) {
	t := &gateway.SSHTarget{Host: a.IP, Port: a.Port, User: a.Username}
	dec := func(s string) string { v, _ := h.cipher.Decrypt(s); return v }
	switch a.AccountType {
	case "credential":
		var cred model.Credential
		if err := h.store.DB.First(&cred, "id = ?", a.CredentialID).Error; err != nil {
			return nil, err
		}
		t.User = cred.Username
		t.Password = dec(cred.Password)
		t.PrivateKey = dec(cred.PrivateKey)
		t.Passphrase = dec(cred.Passphrase)
	default: // password | private-key（内联）
		t.Password = dec(a.Password)
		t.PrivateKey = dec(a.PrivateKey)
		t.Passphrase = dec(a.Passphrase)
	}
	t.TimeoutMs = a.Timeout
	// 跳板机：多层链路（GatewayChain，顶部=第一跳）；兼容旧单 GatewayID。
	chain := parseChain(a.GatewayChain)
	if len(chain) == 0 && a.GatewayType == "ssh-gateway" && a.GatewayID != "" {
		chain = []string{a.GatewayID}
	}
	var prev *gateway.SSHTarget // 第一跳 prev=nil（最外层），逐级嵌套
	for _, gid := range chain {
		j := h.resolveGateway(gid) // 先按 ssh-gateway
		if j == nil {
			j = h.resolveAssetJump(gid) // 再按已有 SSH 资产作跳板
		}
		if j == nil {
			continue
		}
		j.Jump = prev
		prev = j
	}
	if prev != nil {
		t.Jump = prev // 目标的 Jump = 最后一跳
	}
	return t, nil
}

func (h *Handler) sshOptions() gateway.SSHOptions {
	return gateway.SSHOptions{HostKeyPolicy: h.cfg.SSHHostKeyPolicy, KnownHostsPath: h.cfg.SSHKnownHosts}
}

func (h *Handler) sshOptionsForUser(userID string) gateway.SSHOptions {
	opts := h.sshOptions()
	if opts.HostKeyPolicy == "tofu" || opts.HostKeyPolicy == "" {
		cb, err := hostkey.Callback(h.store, opts.HostKeyPolicy, userID)
		if err == nil {
			opts.HostKeyCallback = cb
		}
	}
	return opts
}

func parseChain(s string) []string {
	out := []string{}
	if s != "" {
		_ = json.Unmarshal([]byte(s), &out)
	}
	return out
}

// resolveAssetJump 把一台已有 SSH 资产解析为跳板拨号目标（解密凭证，不再嵌套其自身跳板）。
func (h *Handler) resolveAssetJump(assetID string) *gateway.SSHTarget {
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", assetID).Error; err != nil {
		return nil
	}
	dec := func(s string) string { v, _ := h.cipher.Decrypt(s); return v }
	j := &gateway.SSHTarget{Host: a.IP, Port: a.Port, User: a.Username, TimeoutMs: a.Timeout}
	if a.AccountType == "credential" && a.CredentialID != "" {
		var cred model.Credential
		if h.store.DB.First(&cred, "id = ?", a.CredentialID).Error == nil {
			j.User, j.Password, j.PrivateKey, j.Passphrase = cred.Username, dec(cred.Password), dec(cred.PrivateKey), dec(cred.Passphrase)
		}
	} else {
		j.Password, j.PrivateKey, j.Passphrase = dec(a.Password), dec(a.PrivateKey), dec(a.Passphrase)
	}
	if j.Port == 0 {
		j.Port = 22
	}
	return j
}

// resolveGateway 把 ssh-gateway 解析为跳板机拨号目标（解密凭证）。
func (h *Handler) resolveGateway(gatewayID string) *gateway.SSHTarget {
	var g model.SshGateway
	if err := h.store.DB.First(&g, "id = ?", gatewayID).Error; err != nil {
		return nil
	}
	dec := func(s string) string { v, _ := h.cipher.Decrypt(s); return v }
	j := &gateway.SSHTarget{Host: g.IP, Port: g.Port, User: g.Username}
	if g.ConfigMode == "credential" && g.CredentialID != "" {
		var cred model.Credential
		if h.store.DB.First(&cred, "id = ?", g.CredentialID).Error == nil {
			j.User = cred.Username
			j.Password = dec(cred.Password)
			j.PrivateKey = dec(cred.PrivateKey)
			j.Passphrase = dec(cred.Passphrase)
		}
	} else { // direct（内联凭证）
		j.Password = dec(g.Password)
		j.PrivateKey = dec(g.PrivateKey)
		j.Passphrase = dec(g.Passphrase)
	}
	if j.Port == 0 {
		j.Port = 22
	}
	return j
}
