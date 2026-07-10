package identity

import (
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type CommandFilterHandler struct {
	store *store.Store
}

func NewCommandFilterHandler(s *store.Store) *CommandFilterHandler {
	return &CommandFilterHandler{store: s}
}

// Register 挂载 /admin/command-filters。
func (h *CommandFilterHandler) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.POST("", h.create)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.remove)
}

type cfDTO struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Enabled   bool     `json:"enabled"`
	Action    string   `json:"action"`
	Pattern   string   `json:"pattern"`
	Regex     bool     `json:"regex"`
	Priority  int      `json:"priority"`
	UserIDs   []string `json:"userIds"`
	AssetIDs  []string `json:"assetIds"`
	CreatedAt int64    `json:"createdAt"`
}

func toCfDTO(f model.CommandFilter) cfDTO {
	return cfDTO{
		ID: f.ID, Name: f.Name, Enabled: f.Enabled, Action: f.Action,
		Pattern: f.Pattern, Regex: f.Regex, Priority: f.Priority,
		UserIDs: decodeIDs(f.UserIDs), AssetIDs: decodeIDs(f.AssetIDs), CreatedAt: f.CreatedAt,
	}
}

func (h *CommandFilterHandler) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.CommandFilter{})
	if kw := strings.TrimSpace(c.QueryParam("keyword")); kw != "" {
		q = q.Where("name LIKE ? OR pattern LIKE ?", "%"+kw+"%", "%"+kw+"%")
	}
	q = q.Order("priority asc, created_at desc")
	var items []model.CommandFilter
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	dtos := make([]cfDTO, 0, len(items))
	for _, f := range items {
		dtos = append(dtos, toCfDTO(f))
	}
	res["items"] = dtos
	return web.OK(c, res)
}

type cfIn struct {
	Name     string   `json:"name"`
	Enabled  bool     `json:"enabled"`
	Action   string   `json:"action"`
	Pattern  string   `json:"pattern"`
	Regex    bool     `json:"regex"`
	Priority int      `json:"priority"`
	UserIDs  []string `json:"userIds"`
	AssetIDs []string `json:"assetIds"`
}

func (in cfIn) validate() (string, bool) {
	if strings.TrimSpace(in.Name) == "" {
		return "规则名称必填", false
	}
	if strings.TrimSpace(in.Pattern) == "" {
		return "关键字/正则必填", false
	}
	if in.Action != "block" && in.Action != "warn" {
		return "动作须为 block 或 warn", false
	}
	return "", true
}

func (h *CommandFilterHandler) create(c echo.Context) error {
	var in cfIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	if msg, ok := in.validate(); !ok {
		return web.Fail(c, 200, 400, msg)
	}
	f := model.CommandFilter{
		ID: uuid.NewString(), Name: in.Name, Enabled: in.Enabled, Action: in.Action,
		Pattern: in.Pattern, Regex: in.Regex, Priority: in.Priority,
		UserIDs: encodeIDs(in.UserIDs), AssetIDs: encodeIDs(in.AssetIDs), CreatedAt: model.NowMillis(),
	}
	if err := h.store.DB.Create(&f).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": f.ID})
}

func (h *CommandFilterHandler) update(c echo.Context) error {
	var cur model.CommandFilter
	if err := h.store.DB.First(&cur, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	var in cfIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	if msg, ok := in.validate(); !ok {
		return web.Fail(c, 200, 400, msg)
	}
	cur.Name, cur.Enabled, cur.Action = in.Name, in.Enabled, in.Action
	cur.Pattern, cur.Regex, cur.Priority = in.Pattern, in.Regex, in.Priority
	cur.UserIDs = encodeIDs(in.UserIDs)
	cur.AssetIDs = encodeIDs(in.AssetIDs)
	if err := h.store.DB.Save(&cur).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": cur.ID})
}

func (h *CommandFilterHandler) remove(c echo.Context) error {
	h.store.DB.Delete(&model.CommandFilter{}, "id = ?", c.Param("id"))
	return web.OK(c, map[string]any{"status": "ok"})
}
