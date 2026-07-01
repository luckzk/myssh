package access

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	"github.com/dushixiang/next-terminal-clone/server/internal/audit"
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

type Handler struct {
	store    *store.Store
	cfg      config.Config
	cipher   *crypto.Cipher
	recorder *audit.Recorder
	registry  *gateway.Registry
	sftp      *gateway.SFTPManager
	forwards  *gateway.PortForwardManager
	guacdAddr string
	upgrader  websocket.Upgrader

	// 会话共享（只读观战）
	shareMu     sync.Mutex
	shareGroups map[string]*shareGroup
	shareTokens map[string]string // token -> sessionId
}

func New(s *store.Store, cfg config.Config, c *crypto.Cipher, rec *audit.Recorder, reg *gateway.Registry) *Handler {
	return &Handler{
		store: s, cfg: cfg, cipher: c, recorder: rec, registry: reg,
			sftp:        gateway.NewSFTPManager(),
			forwards:    gateway.NewPortForwardManager(),
		shareGroups: make(map[string]*shareGroup),
		shareTokens: make(map[string]string),
		upgrader: websocket.Upgrader{
			CheckOrigin:     func(r *http.Request) bool { return web.OriginAllowed(r, cfg.AllowedOrigins) },
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
		},
	}
}

// RegisterAccount 挂载 /api/account/sessions（创建会话）。
func (h *Handler) RegisterAccount(g *echo.Group) {
	g.POST("/sessions", h.createSession)
}

// RegisterAccess 挂载 /api/access/terminal（WS 终端）+ 会话共享 + 监控统计。
func (h *Handler) RegisterAccess(g *echo.Group) {
	g.GET("/terminal", h.terminal)
	g.POST("/sessions/:id/share", h.shareSession)
	g.GET("/stats", h.stats)
	g.GET("/forwards", h.forwardList)
	g.POST("/forwards", h.forwardCreate)
	g.POST("/forwards/:id/stop", h.forwardStop)
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
	// TODO(S2 授权域)：此处接入 CanAccess(user, asset) 鉴权；当前 admin 直通。
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

// terminal 建立 SSH 终端 WS 桥接（join 非空时为只读观战，不 DialSSH）。
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
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", sess.AssetID).Error; err != nil {
		return web.Fail(c, 200, 404, "资产不存在")
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

		client, err := gateway.DialSSH(*target, h.sshOptionsForUser(u.ID))
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte(gateway.EncodeError("连接失败: "+err.Error())))
		h.finishSession(&sess, "")
		return nil
	}
	defer client.Close()

	cols, rows := sess.Width, sess.Height
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	// 桥接开始 → 真正在线。
		h.store.DB.Model(&model.ConnSession{}).Where("id = ?", sess.ID).Updates(map[string]any{
			"status": "connected", "connected_at": model.NowMillis(), "reconnect_until": 0,
		})

	// 注册到活跃会话表：强制下线时关闭 ws+ssh，使桥接 read 循环退出。
	h.registry.Add(sess.ID, func() {
		_ = ws.Close()
		_ = client.Close()
	})
	defer h.registry.Remove(sess.ID)

	// 会话共享：本会话的只读观战组（终端输出广播给 subs）。
	group := h.getOrCreateGroup(sess.ID)
	defer func() { group.closeAll(); h.removeGroup(sess.ID) }()

	// 旁路审计：录像 + 命令解析（S3-3）+ 观战广播
	rec := h.recorder.Start(sess.ID, cols, rows)
	cmdParser := audit.NewCommandParser(h.store, &sess)
	initCmd := ""
	if a.DefaultPath != "" {
		initCmd += "cd " + a.DefaultPath + "\n"
	}
	if a.InitCommand != "" {
		initCmd += a.InitCommand + "\n"
	}
	hooks := gateway.Hooks{
		OnOutput: func(b []byte) { rec.WriteOutput(b); group.broadcast(b) },
		OnInput:  func(b []byte) { cmdParser.Feed(b) },
		Init:     initCmd,
	}

		bridgeErr := gateway.BridgeSSH(ws, client, cols, rows, hooks)

		path := rec.Close()
		if h.shouldWaitReconnect(bridgeErr) {
			h.markReconnecting(&sess, path)
		} else {
			h.finishSession(&sess, path)
		}
		return nil
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
}

func (h *Handler) shouldWaitReconnect(err error) bool {
	return err != nil && !errors.Is(err, gateway.ErrClientExit)
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
