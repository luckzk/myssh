package resource

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/crypto"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type CredentialHandler struct {
	store         *store.Store
	cipher        *crypto.Cipher
	securityToken string
}

func NewCredentialHandler(s *store.Store, cfg config.Config, c *crypto.Cipher) *CredentialHandler {
	return &CredentialHandler{store: s, cipher: c, securityToken: cfg.SecurityToken}
}

// Register 挂载 /admin/credentials。
func (h *CredentialHandler) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.POST("", h.create)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.remove)
	g.GET("/:id/decrypted", h.decrypted)
}

// mask 脱敏：列表/详情不回传明文密钥，仅标记是否已设置。
func mask(c model.Credential) model.Credential {
	c.Password = boolMask(c.Password)
	c.PrivateKey = boolMask(c.PrivateKey)
	c.Passphrase = boolMask(c.Passphrase)
	return c
}

func boolMask(s string) string {
	if s == "" {
		return ""
	}
	return "******"
}

func (h *CredentialHandler) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.Credential{}).Order("created_at desc")
	var items []model.Credential
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	for i := range items {
		items[i] = mask(items[i])
	}
	res["items"] = items
	return web.OK(c, res)
}

func (h *CredentialHandler) list(c echo.Context) error {
	var items []model.Credential
	h.store.DB.Order("created_at desc").Find(&items)
	for i := range items {
		items[i] = mask(items[i])
	}
	return web.OK(c, items)
}

func (h *CredentialHandler) get(c echo.Context) error {
	var cred model.Credential
	if err := h.store.DB.First(&cred, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	return web.OK(c, mask(cred))
}

func (h *CredentialHandler) create(c echo.Context) error {
	var in model.Credential
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	in.ID = uuid.NewString()
	in.CreatedAt = model.NowMillis()
	h.encryptSecrets(&in)
	if err := h.store.DB.Create(&in).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": in.ID})
}

func (h *CredentialHandler) update(c echo.Context) error {
	var cur model.Credential
	if err := h.store.DB.First(&cur, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	var in model.Credential
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	cur.Name, cur.Type, cur.Username, cur.Description = in.Name, in.Type, in.Username, in.Description
	// 仅当传入非掩码值时才更新密钥（避免把 ****** 写回）
	if in.Password != "" && in.Password != "******" {
		cur.Password, _ = h.cipher.Encrypt(in.Password)
	}
	if in.PrivateKey != "" && in.PrivateKey != "******" {
		cur.PrivateKey, _ = h.cipher.Encrypt(in.PrivateKey)
	}
	if in.Passphrase != "" && in.Passphrase != "******" {
		cur.Passphrase, _ = h.cipher.Encrypt(in.Passphrase)
	}
	if err := h.store.DB.Save(&cur).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": cur.ID})
}

func (h *CredentialHandler) remove(c echo.Context) error {
	h.store.DB.Delete(&model.Credential{}, "id = ?", c.Param("id"))
	return web.OK(c, map[string]any{"status": "ok"})
}

// decrypted 返回明文；配置 NT_SECURITY_TOKEN 后需二次校验。
func (h *CredentialHandler) decrypted(c echo.Context) error {
	if !web.RequireSecurityToken(c, h.securityToken) {
		return web.Fail(c, 200, 403, "securityToken 无效")
	}
	var cred model.Credential
	if err := h.store.DB.First(&cred, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	cred.Password, _ = h.cipher.Decrypt(cred.Password)
	cred.PrivateKey, _ = h.cipher.Decrypt(cred.PrivateKey)
	cred.Passphrase, _ = h.cipher.Decrypt(cred.Passphrase)
	return web.OK(c, cred)
}

func (h *CredentialHandler) encryptSecrets(cred *model.Credential) {
	cred.Password, _ = h.cipher.Encrypt(cred.Password)
	cred.PrivateKey, _ = h.cipher.Encrypt(cred.PrivateKey)
	cred.Passphrase, _ = h.cipher.Encrypt(cred.Passphrase)
}
