package resource

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

// SiteHandler 站点信息设置（系统设置 → 站点信息），存 Setting KV。
type SiteHandler struct{ store *store.Store }

func NewSiteHandler(s *store.Store) *SiteHandler { return &SiteHandler{store: s} }

func (h *SiteHandler) Register(g *echo.Group) {
	g.GET("/site-settings", h.get)
	g.PUT("/site-settings", h.save)
}

func (h *SiteHandler) get(c echo.Context) error {
	return web.OK(c, map[string]any{
		"name":      h.store.GetSetting("site_name"),
		"copyright": h.store.GetSetting("site_copyright"),
		"icp":       h.store.GetSetting("site_icp"),
	})
}

type siteReq struct {
	Name      string `json:"name"`
	Copyright string `json:"copyright"`
	Icp       string `json:"icp"`
}

func (h *SiteHandler) save(c echo.Context) error {
	var r siteReq
	if err := c.Bind(&r); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	_ = h.store.SetSetting("site_name", r.Name)
	_ = h.store.SetSetting("site_copyright", r.Copyright)
	_ = h.store.SetSetting("site_icp", r.Icp)
	return web.OK(c, map[string]any{"status": "ok"})
}
