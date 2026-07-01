package resource

import (
	"net/http"
	"os"

	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

// SessionHandler 管理端会话（在线/离线同表不同视图）+ 录像下载 + 命令列表。
// 契约见 docs/recon/playback.md、online-session.md。
type SessionHandler struct {
	store    *store.Store
	registry *gateway.Registry
}

func NewSessionHandler(s *store.Store, reg *gateway.Registry) *SessionHandler {
	return &SessionHandler{store: s, registry: reg}
}

func (h *SessionHandler) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.GET("/:id", h.get)
	g.GET("/:id/recording", h.recording)
	g.POST("/:id/disconnect", h.disconnect)
	g.POST("/clear", h.clear)
}

// RegisterCommands 挂载 /admin/session-commands。
func (h *SessionHandler) RegisterCommands(g *echo.Group) {
	g.GET("/paging", h.commandPaging)
}

// RegisterFilesystemLogs 挂载 /admin/filesystem-logs。
func (h *SessionHandler) RegisterFilesystemLogs(g *echo.Group) {
	g.GET("/paging", h.fsLogPaging)
}

// sessionDTO 在 ConnSession 上补充上游字段（recordingSize / commandCount）。
type sessionDTO struct {
	model.ConnSession
	Recording     string `json:"recording"`
	RecordingSize int64  `json:"recordingSize"`
	CommandCount  int64  `json:"commandCount"`
	AuditStatus   string `json:"auditStatus"`
}

func (h *SessionHandler) toDTO(s model.ConnSession) sessionDTO {
	var size int64
	if s.RecordingPath != "" {
		if fi, err := os.Stat(s.RecordingPath); err == nil {
			size = fi.Size()
		}
	}
	var cmdCount int64
	h.store.DB.Model(&model.ExecCommandLog{}).Where("session_id = ?", s.ID).Count(&cmdCount)
	return sessionDTO{ConnSession: s, Recording: s.RecordingPath, RecordingSize: size, CommandCount: cmdCount}
}

func (h *SessionHandler) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.ConnSession{})
	if status := c.QueryParam("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	if proto := c.QueryParam("protocol"); proto != "" {
		q = q.Where("protocol = ?", proto)
	}
	q = q.Order("connected_at desc")
	var items []model.ConnSession
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	dtos := make([]sessionDTO, 0, len(items))
	for _, s := range items {
		dtos = append(dtos, h.toDTO(s))
	}
	res["items"] = dtos
	return web.OK(c, res)
}

func (h *SessionHandler) get(c echo.Context) error {
	var s model.ConnSession
	if err := h.store.DB.First(&s, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	return web.OK(c, h.toDTO(s))
}

// recording 返回 .cast 录像（asciinema-player 直接消费）。
func (h *SessionHandler) recording(c echo.Context) error {
	var s model.ConnSession
	if err := h.store.DB.First(&s, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	if s.RecordingPath == "" {
		return web.Fail(c, 200, 404, "无录像")
	}
	data, err := os.ReadFile(s.RecordingPath)
	if err != nil {
		return web.Fail(c, 200, 404, "录像读取失败")
	}
	return c.Blob(http.StatusOK, "text/plain; charset=utf-8", data)
}

// disconnect 强制下线：真正切断正在进行的桥接（活跃会话注册表），再落库。
func (h *SessionHandler) disconnect(c echo.Context) error {
	id := c.Param("id")
	killed := h.registry.Kill(id) // 触发关闭 ws+ssh，桥接退出后会自行落库
	if !killed {
		// 非活跃（可能已断或异常残留）→ 直接落库
		h.store.DB.Model(&model.ConnSession{}).Where("id = ? AND status = ?", id, "connected").Updates(map[string]any{
			"status": "disconnected", "disconnected_at": model.NowMillis(),
		})
	}
	return web.OK(c, map[string]any{"status": "ok", "killed": killed})
}

func (h *SessionHandler) clear(c echo.Context) error {
	h.store.DB.Where("status = ?", "disconnected").Delete(&model.ConnSession{})
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *SessionHandler) commandPaging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.ExecCommandLog{})
	if sid := c.QueryParam("sessionId"); sid != "" {
		q = q.Where("session_id = ?", sid)
	}
	q = q.Order("created_at asc")
	var items []model.ExecCommandLog
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	res["items"] = items
	return web.OK(c, res)
}

func (h *SessionHandler) fsLogPaging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.FileSystemLog{})
	if sid := c.QueryParam("sessionId"); sid != "" {
		q = q.Where("session_id = ?", sid)
	}
	if action := c.QueryParam("action"); action != "" {
		q = q.Where("action = ?", action)
	}
	q = q.Order("created_at desc")
	var items []model.FileSystemLog
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	res["items"] = items
	return web.OK(c, res)
}
