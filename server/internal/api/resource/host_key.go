package resource

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

type HostKeyHandler struct {
	store *store.Store
}

func NewHostKeyHandler(s *store.Store) *HostKeyHandler {
	return &HostKeyHandler{store: s}
}

func (h *HostKeyHandler) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.POST("/:id/trust", h.trust)
	g.POST("/:id/revoke", h.revoke)
}

func (h *HostKeyHandler) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.TrustedHostKey{})
	if status := c.QueryParam("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	if host := c.QueryParam("host"); host != "" {
		q = q.Where("host LIKE ?", "%"+host+"%")
	}
	q = q.Order("updated_at desc")
	var items []model.TrustedHostKey
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	res["items"] = items
	return web.OK(c, res)
}

func (h *HostKeyHandler) trust(c echo.Context) error {
	id := c.Param("id")
	var rec model.TrustedHostKey
	if err := h.store.DB.First(&rec, "id = ?", id).Error; err != nil {
		return web.Fail(c, 200, 404, "主机密钥记录不存在")
	}
	now := model.NowMillis()
	if rec.Status == "pending" {
		h.store.DB.Model(&model.TrustedHostKey{}).Where("host = ? AND port = ? AND status = ?", rec.Host, rec.Port, "trusted").Updates(map[string]any{
			"status": "revoked", "updated_at": now,
		})
	}
	if err := h.store.DB.Model(&model.TrustedHostKey{}).Where("id = ?", id).Updates(map[string]any{
		"status": "trusted", "previous_fingerprint": "", "updated_at": now, "last_seen_at": now,
	}).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *HostKeyHandler) revoke(c echo.Context) error {
	if err := h.store.DB.Model(&model.TrustedHostKey{}).Where("id = ?", c.Param("id")).Updates(map[string]any{
		"status": "revoked", "updated_at": model.NowMillis(),
	}).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"status": "ok"})
}
