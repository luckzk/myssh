package access

import (
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type forwardReq struct {
	SessionID  string `json:"sessionId"`
	Type       string `json:"type"`
	ListenHost string `json:"listenHost"`
	ListenPort int    `json:"listenPort"`
	TargetHost string `json:"targetHost"`
	TargetPort int    `json:"targetPort"`
}

func (h *Handler) forwardList(c echo.Context) error {
	u := web.CurrentUser(c)
	q := h.store.DB.Model(&model.PortForward{}).Where("user_id = ?", u.ID)
	if sid := c.QueryParam("sessionId"); sid != "" {
		q = q.Where("session_id = ?", sid)
	}
	if status := c.QueryParam("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	var rows []model.PortForward
	if err := q.Order("created_at desc").Find(&rows).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, rows)
}

func (h *Handler) forwardCreate(c echo.Context) error {
	u := web.CurrentUser(c)
	var req forwardReq
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	req.Type = strings.ToLower(strings.TrimSpace(req.Type))
	if req.Type != "local" && req.Type != "remote" && req.Type != "dynamic" {
		return web.Fail(c, 200, 400, "转发类型必须是 local、remote 或 dynamic")
	}
	if req.ListenPort < 0 || req.ListenPort > 65535 {
		return web.Fail(c, 200, 400, "监听端口不合法")
	}
	if req.Type != "dynamic" {
		if strings.TrimSpace(req.TargetHost) == "" || req.TargetPort <= 0 || req.TargetPort > 65535 {
			return web.Fail(c, 200, 400, "目标地址或端口不合法")
		}
	}
	if req.ListenHost == "" {
		req.ListenHost = "127.0.0.1"
	}

	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ? AND user_id = ?", req.SessionID, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}
	if sess.Protocol != "ssh" {
		return web.Fail(c, 200, 400, "仅 SSH 会话支持端口转发")
	}
	if sess.Status != "connected" && sess.Status != "reconnecting" {
		return web.Fail(c, 200, 400, "会话未连接")
	}
	var asset model.Asset
	if err := h.store.DB.First(&asset, "id = ?", sess.AssetID).Error; err != nil {
		return web.Fail(c, 200, 404, "资产不存在")
	}
	target, err := h.resolveTarget(&asset)
	if err != nil {
		return web.Fail(c, 200, 500, "凭证解析失败: "+err.Error())
	}

	now := model.NowMillis()
	rec := model.PortForward{
		ID: uuid.NewString(), SessionID: sess.ID, UserID: u.ID, Username: u.Username,
		AssetID: sess.AssetID, AssetName: sess.AssetName, Type: req.Type,
		ListenHost: req.ListenHost, ListenPort: req.ListenPort,
		TargetHost: req.TargetHost, TargetPort: req.TargetPort,
		Status: "starting", StartedAt: now, CreatedAt: now,
	}
	if err := h.store.DB.Create(&rec).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}

	actualAddr, errCh, err := h.forwards.Start(gateway.PortForwardTarget{
		SSH: *target, ForwardID: rec.ID, Type: rec.Type,
		ListenHost: rec.ListenHost, ListenPort: rec.ListenPort,
		TargetHost: rec.TargetHost, TargetPort: rec.TargetPort,
	}, h.sshOptionsForUser(u.ID))
	if err != nil {
		h.store.DB.Model(&model.PortForward{}).Where("id = ?", rec.ID).Updates(map[string]any{
			"status": "failed", "error": err.Error(), "stopped_at": model.NowMillis(),
		})
		return web.Fail(c, 200, 500, err.Error())
	}
	if actualAddr != "" {
		h.store.DB.Model(&model.PortForward{}).Where("id = ?", rec.ID).Updates(map[string]any{
			"status": "running", "listen_host": gateway.HostFromAddr(actualAddr, rec.ListenHost), "listen_port": gateway.PortFromAddr(actualAddr, rec.ListenPort),
		})
		rec.Status = "running"
		rec.ListenHost = gateway.HostFromAddr(actualAddr, rec.ListenHost)
		rec.ListenPort = gateway.PortFromAddr(actualAddr, rec.ListenPort)
	}
	go h.watchForward(rec.ID, errCh)
	return web.OK(c, rec)
}

func (h *Handler) forwardStop(c echo.Context) error {
	u := web.CurrentUser(c)
	id := c.Param("id")
	var rec model.PortForward
	if err := h.store.DB.First(&rec, "id = ? AND user_id = ?", id, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "转发不存在")
	}
	stopped := h.forwards.Stop(id)
	h.store.DB.Model(&model.PortForward{}).Where("id = ?", id).Updates(map[string]any{
		"status": "stopped", "stopped_at": model.NowMillis(),
	})
	return web.OK(c, map[string]any{"status": "ok", "stopped": stopped})
}

func (h *Handler) watchForward(id string, errCh <-chan error) {
	err, ok := <-errCh
	if !ok {
		return
	}
	updates := map[string]any{"status": "stopped", "stopped_at": model.NowMillis()}
	if err != nil {
		updates["error"] = err.Error()
	}
	h.store.DB.Model(&model.PortForward{}).Where("id = ? AND status IN ?", id, []string{"starting", "running"}).Updates(updates)
}

func (h *Handler) stopSessionForwards(sessionID string) {
	var rows []model.PortForward
	h.store.DB.Where("session_id = ? AND status IN ?", sessionID, []string{"starting", "running"}).Find(&rows)
	for _, row := range rows {
		h.forwards.Stop(row.ID)
	}
	h.store.DB.Model(&model.PortForward{}).Where("session_id = ? AND status IN ?", sessionID, []string{"starting", "running"}).Updates(map[string]any{
		"status": "stopped", "stopped_at": model.NowMillis(), "error": "session closed",
	})
}
