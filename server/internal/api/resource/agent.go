package resource

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// AgentVersion 当前 Agent 二进制版本，供「资源管理 → Agent 网关」页展示与升级提示。
const AgentVersion = "v0.1.0"

// AgentHandler 处理 Agent 自身的对接端点（/api/agent/*，公开——Agent 注册时无登录态）。
type AgentHandler struct {
	store *store.Store
}

func NewAgentHandler(s *store.Store) *AgentHandler { return &AgentHandler{store: s} }

func (h *AgentHandler) Register(g *echo.Group) {
	g.GET("/version", h.version)
	g.POST("/register", h.register)
}

func (h *AgentHandler) version(c echo.Context) error {
	return web.OK(c, map[string]any{"version": AgentVersion})
}

// registerReq Agent 注册请求体。
type registerReq struct {
	Token   string `json:"token"`
	Name    string `json:"name"`
	IP      string `json:"ip"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
	Version string `json:"version"`
}

// register 校验 token → 按 IP upsert 一条 AgentGateway 并置在线。
func (h *AgentHandler) register(c echo.Context) error {
	var req registerReq
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	if req.Token == "" {
		return web.Fail(c, 200, 400, "缺少 token")
	}
	var tok model.AgentGatewayToken
	if err := h.store.DB.First(&tok, "token = ?", req.Token).Error; err != nil {
		return web.Fail(c, 200, 400, "无效的注册 token")
	}

	now := model.NowMillis()
	var ag model.AgentGateway
	err := h.store.DB.First(&ag, "ip = ?", req.IP).Error
	if err != nil {
		// 新建
		ag = model.AgentGateway{
			Name:    req.Name,
			IP:      req.IP,
			OS:      req.OS,
			Arch:    req.Arch,
			Version: req.Version,
			Online:  true,
		}
		ag.SetID(uuid.NewString())
		ag.SetCreatedAt(now)
		ag.UpdatedAt = now
		if err := h.store.DB.Create(&ag).Error; err != nil {
			return web.Fail(c, 200, 500, err.Error())
		}
	} else {
		// 已存在 → 刷新状态（心跳/重连）
		ag.Name = req.Name
		ag.OS = req.OS
		ag.Arch = req.Arch
		ag.Version = req.Version
		ag.Online = true
		ag.UpdatedAt = now
		if err := h.store.DB.Save(&ag).Error; err != nil {
			return web.Fail(c, 200, 500, err.Error())
		}
	}
	return web.OK(c, map[string]any{"id": ag.GetID()})
}
