package resource

import (
	"encoding/json"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/authz"
	"github.com/dushixiang/next-terminal-clone/server/internal/crypto"
	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/hostkey"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// 跳板机链路 JSON 编解码（ssh-gateway id 列表）。
func marshalChain(ids []string) string {
	if len(ids) == 0 {
		return ""
	}
	b, _ := json.Marshal(ids)
	return string(b)
}
func unmarshalChain(s string) []string {
	out := []string{}
	if s != "" {
		_ = json.Unmarshal([]byte(s), &out)
	}
	return out
}

type AssetHandler struct {
	store         *store.Store
	cipher        *crypto.Cipher
	SecurityToken string
	SSHOptions    gateway.SSHOptions
}

func NewAssetHandler(s *store.Store, c *crypto.Cipher) *AssetHandler {
	return &AssetHandler{store: s, cipher: c}
}

// assetDTO 在实体外补充派生/数组字段（tags[]、groupFullName），对齐 demo 返回结构。
type assetDTO struct {
	model.Asset
	Tags          []string `json:"tags"`
	GatewayChain  []string `json:"gatewayChain"`
	GroupFullName string   `json:"groupFullName"`
}

func (h *AssetHandler) toDTO(a model.Asset) assetDTO {
	tags := []string{}
	if a.Tags != "" {
		tags = strings.Split(a.Tags, ",")
	}
	// 脱敏内联凭证
	a.Password = boolMask(a.Password)
	a.PrivateKey = boolMask(a.PrivateKey)
	a.Passphrase = boolMask(a.Passphrase)
	return assetDTO{Asset: a, Tags: tags, GatewayChain: unmarshalChain(a.GatewayChain), GroupFullName: h.groupFullName(a.GroupID)}
}

func (h *AssetHandler) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.POST("", h.create)
	g.POST("/test", h.test)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.remove)
	g.GET("/:id/decrypted", h.decrypted)
}

// test 用表单参数试连一次 SSH（含跳板链），不建会话、不入库。
func (h *AssetHandler) test(c echo.Context) error {
	var in assetIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	a := in.Asset
	a.GatewayChain = marshalChain(in.GatewayChain)
	// 内联凭证从表单来（明文）；引用凭证则按 id 解密
	t := &gateway.SSHTarget{Host: a.IP, Port: a.Port, User: a.Username, TimeoutMs: a.Timeout}
	dec := func(s string) string { v, _ := h.cipher.Decrypt(s); return v }
	if a.AccountType == "credential" && a.CredentialID != "" {
		var cred model.Credential
		if err := h.store.DB.First(&cred, "id = ?", a.CredentialID).Error; err != nil {
			return web.OK(c, map[string]any{"ok": false, "message": "凭证不存在"})
		}
		t.User, t.Password, t.PrivateKey, t.Passphrase = cred.Username, dec(cred.Password), dec(cred.PrivateKey), dec(cred.Passphrase)
	} else {
		t.Password, t.PrivateKey, t.Passphrase = a.Password, a.PrivateKey, a.Passphrase
	}
	// 跳板链（这些网关凭证在库里，需解密）
	chain := in.GatewayChain
	if len(chain) == 0 && a.GatewayID != "" {
		chain = []string{a.GatewayID}
	}
	var prev *gateway.SSHTarget
	for _, gid := range chain {
		j := h.resolveGatewayTarget(gid)
		if j == nil {
			j = h.resolveAssetTarget(gid)
		}
		if j == nil {
			continue
		}
		j.Jump = prev
		prev = j
	}
	t.Jump = prev

	client, err := gateway.DialSSH(*t, h.sshOptionsForUser(web.CurrentUser(c).ID))
	if err != nil {
		return web.OK(c, map[string]any{"ok": false, "message": err.Error()})
	}
	_ = client.Close()
	return web.OK(c, map[string]any{"ok": true, "message": "连接成功"})
}

func (h *AssetHandler) sshOptionsForUser(userID string) gateway.SSHOptions {
	opts := h.SSHOptions
	if opts.HostKeyPolicy == "tofu" || opts.HostKeyPolicy == "" {
		cb, err := hostkey.Callback(h.store, opts.HostKeyPolicy, userID)
		if err == nil {
			opts.HostKeyCallback = cb
		}
	}
	return opts
}

// groupIDsByName 返回名称匹配关键字的分组 id（用于「按分组名搜索资产」）。
func (h *AssetHandler) groupIDsByName(kw string) []string {
	var rows []model.AssetGroup
	h.store.DB.Where("name LIKE ?", "%"+kw+"%").Find(&rows)
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids
}

// descendantGroupIDs 返回某分组及其所有后代分组 id（用于「按分组过滤含子分组」）。
func (h *AssetHandler) descendantGroupIDs(root string) []string {
	var rows []model.AssetGroup
	h.store.DB.Find(&rows)
	children := map[string][]string{}
	for _, r := range rows {
		children[r.ParentID] = append(children[r.ParentID], r.ID)
	}
	out := []string{root}
	queue := []string{root}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, c := range children[cur] {
			out = append(out, c)
			queue = append(queue, c)
		}
	}
	return out
}

// resolveAssetTarget 把已有 SSH 资产解析为跳板拨号目标（解密凭证）。
func (h *AssetHandler) resolveAssetTarget(assetID string) *gateway.SSHTarget {
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

// resolveGatewayTarget 把 ssh-gateway 解析为跳板拨号目标（解密凭证）。
func (h *AssetHandler) resolveGatewayTarget(gatewayID string) *gateway.SSHTarget {
	var g model.SshGateway
	if err := h.store.DB.First(&g, "id = ?", gatewayID).Error; err != nil {
		return nil
	}
	dec := func(s string) string { v, _ := h.cipher.Decrypt(s); return v }
	j := &gateway.SSHTarget{Host: g.IP, Port: g.Port, User: g.Username}
	if g.ConfigMode == "credential" && g.CredentialID != "" {
		var cred model.Credential
		if h.store.DB.First(&cred, "id = ?", g.CredentialID).Error == nil {
			j.User, j.Password, j.PrivateKey, j.Passphrase = cred.Username, dec(cred.Password), dec(cred.PrivateKey), dec(cred.Passphrase)
		}
	} else {
		j.Password, j.PrivateKey, j.Passphrase = dec(g.Password), dec(g.PrivateKey), dec(g.Passphrase)
	}
	if j.Port == 0 {
		j.Port = 22
	}
	return j
}

// authorizedScope 对非 admin 用户按授权策略把查询限定到可访问资产；admin 不限制。
// 返回 (受限后的查询, 是否为空集)——空集时调用方应直接返回空列表。
func (h *AssetHandler) authorizedScope(c echo.Context, q *gorm.DB) (*gorm.DB, bool) {
	u := web.CurrentUser(c)
	if u == nil || u.Type == "admin" {
		return q, false
	}
	ids, _ := authz.AuthorizedAssetIDs(h.store.DB, u.ID)
	if len(ids) == 0 {
		return q, true
	}
	list := make([]string, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	return q.Where("id IN ?", list), false
}

func (h *AssetHandler) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.Asset{})
	q, empty := h.authorizedScope(c, q)
	if empty {
		return web.OK(c, map[string]any{"items": []assetDTO{}, "total": 0})
	}
	if aid := c.QueryParam("assetId"); aid != "" {
		// 聚焦单个资产（点击资源树叶子）——忽略分组/搜索
		q = q.Where("id = ?", aid)
	} else {
		if gid := c.QueryParam("groupId"); gid != "" {
			q = q.Where("group_id IN ?", h.descendantGroupIDs(gid)) // 含所有子分组（搜索范围）
		}
		if kw := strings.TrimSpace(c.QueryParam("keyword")); kw != "" {
			like := "%" + kw + "%"
			// 跨 名称/协议/地址/账号/标签，以及「分组名」匹配（解析成 group id）
			gids := h.groupIDsByName(kw)
			if len(gids) > 0 {
				q = q.Where("name LIKE ? OR protocol LIKE ? OR ip LIKE ? OR username LIKE ? OR tags LIKE ? OR group_id IN ?", like, like, like, like, like, gids)
			} else {
				q = q.Where("name LIKE ? OR protocol LIKE ? OR ip LIKE ? OR username LIKE ? OR tags LIKE ?", like, like, like, like, like)
			}
		}
	}
	q = q.Order("created_at desc")
	var items []model.Asset
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	dtos := make([]assetDTO, 0, len(items))
	for _, a := range items {
		dtos = append(dtos, h.toDTO(a))
	}
	res["items"] = dtos
	return web.OK(c, res)
}

func (h *AssetHandler) list(c echo.Context) error {
	q, empty := h.authorizedScope(c, h.store.DB.Model(&model.Asset{}))
	if empty {
		return web.OK(c, []assetDTO{})
	}
	var items []model.Asset
	q.Order("created_at desc").Find(&items)
	dtos := make([]assetDTO, 0, len(items))
	for _, a := range items {
		dtos = append(dtos, h.toDTO(a))
	}
	return web.OK(c, dtos)
}

func (h *AssetHandler) get(c echo.Context) error {
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	return web.OK(c, h.toDTO(a))
}

// bindAsset 接收前端传入（tags 为数组），落库时转逗号分隔。
type assetIn struct {
	model.Asset
	Tags         []string `json:"tags"`
	GatewayChain []string `json:"gatewayChain"`
}

func (h *AssetHandler) create(c echo.Context) error {
	var in assetIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	a := in.Asset
	if len(a.Logo) > 512*1024 {
		return web.Fail(c, 200, 400, "图标过大（≤ ~380KB）")
	}
	a.ID = uuid.NewString()
	a.Tags = strings.Join(in.Tags, ",")
	a.GatewayChain = marshalChain(in.GatewayChain)
	a.CreatedAt = model.NowMillis()
	a.UpdatedAt = a.CreatedAt
	if a.Status == "" {
		a.Status = "active"
	}
	h.encryptInline(&a)
	if err := h.store.DB.Create(&a).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": a.ID})
}

func (h *AssetHandler) update(c echo.Context) error {
	var cur model.Asset
	if err := h.store.DB.First(&cur, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	var in assetIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	n := in.Asset
	if len(n.Logo) > 512*1024 {
		return web.Fail(c, 200, 400, "图标过大（≤ ~380KB）")
	}
	cur.Name, cur.Alias, cur.Logo, cur.Protocol = n.Name, n.Alias, n.Logo, n.Protocol
	cur.IP, cur.Port, cur.Description = n.IP, n.Port, n.Description
	cur.AccountType, cur.CredentialID, cur.Username = n.AccountType, n.CredentialID, n.Username
	cur.GatewayType, cur.GatewayID, cur.GroupID = n.GatewayType, n.GatewayID, n.GroupID
	cur.GatewayChain = marshalChain(in.GatewayChain)
	cur.Timeout, cur.Heartbeat = n.Timeout, n.Heartbeat
	cur.DefaultPath, cur.InitCommand = n.DefaultPath, n.InitCommand
	cur.DisableProxy, cur.Proxy = n.DisableProxy, n.Proxy
	cur.X11, cur.X11Cookie, cur.Encoding = n.X11, n.X11Cookie, n.Encoding
	cur.HostKeyAlgo, cur.Cipher, cur.Kex = n.HostKeyAlgo, n.Cipher, n.Kex
	cur.Tags = strings.Join(in.Tags, ",")
	cur.UpdatedAt = model.NowMillis()
	if n.Password != "" && n.Password != "******" {
		cur.Password, _ = h.cipher.Encrypt(n.Password)
	}
	if n.PrivateKey != "" && n.PrivateKey != "******" {
		cur.PrivateKey, _ = h.cipher.Encrypt(n.PrivateKey)
	}
	if n.Passphrase != "" && n.Passphrase != "******" {
		cur.Passphrase, _ = h.cipher.Encrypt(n.Passphrase)
	}
	if err := h.store.DB.Save(&cur).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": cur.ID})
}

func (h *AssetHandler) remove(c echo.Context) error {
	h.store.DB.Delete(&model.Asset{}, "id = ?", c.Param("id"))
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *AssetHandler) decrypted(c echo.Context) error {
	if !web.RequireSecurityToken(c, h.SecurityToken) {
		return web.Fail(c, 200, 403, "securityToken 无效")
	}
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	a.Password, _ = h.cipher.Decrypt(a.Password)
	a.PrivateKey, _ = h.cipher.Decrypt(a.PrivateKey)
	a.Passphrase, _ = h.cipher.Decrypt(a.Passphrase)
	return web.OK(c, toDTOPlain(a))
}

// toDTOPlain 不脱敏（decrypted 专用）。
func toDTOPlain(a model.Asset) assetDTO {
	tags := []string{}
	if a.Tags != "" {
		tags = strings.Split(a.Tags, ",")
	}
	return assetDTO{Asset: a, Tags: tags}
}

func (h *AssetHandler) encryptInline(a *model.Asset) {
	a.Password, _ = h.cipher.Encrypt(a.Password)
	a.PrivateKey, _ = h.cipher.Encrypt(a.PrivateKey)
	a.Passphrase, _ = h.cipher.Encrypt(a.Passphrase)
}
