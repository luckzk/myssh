package identity

import (
	"encoding/json"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type AuthorizationHandler struct {
	store *store.Store
}

func NewAuthorizationHandler(s *store.Store) *AuthorizationHandler {
	return &AuthorizationHandler{store: s}
}

// Register 挂载 /admin/authorizations。
func (h *AuthorizationHandler) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.POST("", h.create)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.remove)
}

// authDTO 把 JSON 字符串列还原成数组，对齐前端。
type authDTO struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Enabled       bool     `json:"enabled"`
	UserIDs       []string `json:"userIds"`
	AssetIDs      []string `json:"assetIds"`
	AssetGroupIDs []string `json:"assetGroupIds"`
	CreatedAt     int64    `json:"createdAt"`
}

func decodeIDs(s string) []string {
	out := []string{}
	if s != "" {
		_ = json.Unmarshal([]byte(s), &out)
	}
	return out
}
func encodeIDs(ids []string) string {
	if len(ids) == 0 {
		return ""
	}
	b, _ := json.Marshal(ids)
	return string(b)
}

func toAuthDTO(a model.Authorization) authDTO {
	return authDTO{
		ID: a.ID, Name: a.Name, Enabled: a.Enabled,
		UserIDs: decodeIDs(a.UserIDs), AssetIDs: decodeIDs(a.AssetIDs),
		AssetGroupIDs: decodeIDs(a.AssetGroupIDs), CreatedAt: a.CreatedAt,
	}
}

func (h *AuthorizationHandler) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.Authorization{})
	if kw := strings.TrimSpace(c.QueryParam("keyword")); kw != "" {
		q = q.Where("name LIKE ?", "%"+kw+"%")
	}
	q = q.Order("created_at desc")
	var items []model.Authorization
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	dtos := make([]authDTO, 0, len(items))
	for _, a := range items {
		dtos = append(dtos, toAuthDTO(a))
	}
	res["items"] = dtos
	return web.OK(c, res)
}

func (h *AuthorizationHandler) list(c echo.Context) error {
	var items []model.Authorization
	h.store.DB.Order("created_at desc").Find(&items)
	dtos := make([]authDTO, 0, len(items))
	for _, a := range items {
		dtos = append(dtos, toAuthDTO(a))
	}
	return web.OK(c, dtos)
}

func (h *AuthorizationHandler) get(c echo.Context) error {
	var a model.Authorization
	if err := h.store.DB.First(&a, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	return web.OK(c, toAuthDTO(a))
}

type authIn struct {
	Name          string   `json:"name"`
	Enabled       bool     `json:"enabled"`
	UserIDs       []string `json:"userIds"`
	AssetIDs      []string `json:"assetIds"`
	AssetGroupIDs []string `json:"assetGroupIds"`
}

func (h *AuthorizationHandler) create(c echo.Context) error {
	var in authIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	if strings.TrimSpace(in.Name) == "" {
		return web.Fail(c, 200, 400, "策略名称必填")
	}
	a := model.Authorization{
		ID: uuid.NewString(), Name: in.Name, Enabled: in.Enabled,
		UserIDs: encodeIDs(in.UserIDs), AssetIDs: encodeIDs(in.AssetIDs),
		AssetGroupIDs: encodeIDs(in.AssetGroupIDs), CreatedAt: model.NowMillis(),
	}
	if err := h.store.DB.Create(&a).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": a.ID})
}

func (h *AuthorizationHandler) update(c echo.Context) error {
	var cur model.Authorization
	if err := h.store.DB.First(&cur, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	var in authIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	cur.Name, cur.Enabled = in.Name, in.Enabled
	cur.UserIDs = encodeIDs(in.UserIDs)
	cur.AssetIDs = encodeIDs(in.AssetIDs)
	cur.AssetGroupIDs = encodeIDs(in.AssetGroupIDs)
	if err := h.store.DB.Save(&cur).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": cur.ID})
}

func (h *AuthorizationHandler) remove(c echo.Context) error {
	h.store.DB.Delete(&model.Authorization{}, "id = ?", c.Param("id"))
	return web.OK(c, map[string]any{"status": "ok"})
}
