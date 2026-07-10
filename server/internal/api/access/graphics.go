package access

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/authz"
	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

// RegisterGraphics 挂载 WS /api/access/graphics（RDP/VNC，经 guacd）。
func (h *Handler) RegisterGraphics(g *echo.Group, guacdAddr string) {
	h.guacdAddr = guacdAddr
	g.GET("/graphics", h.graphics)
}

// resolveGuacdAddr 动态解析 guacd 地址：
// 若设置里选了某台资产作为 guacd 主机（且资产存在）→ 用 该资产IP:4822；否则回退配置值。
func (h *Handler) resolveGuacdAddr() string {
	if assetID := h.store.GetSetting("guacd_asset_id"); assetID != "" {
		var a model.Asset
		if err := h.store.DB.First(&a, "id = ?", assetID).Error; err == nil && a.IP != "" {
			return a.IP + ":4822"
		}
	}
	return h.guacdAddr
}

// graphics 浏览器 ↔ guacd 图形指令流桥接。
func (h *Handler) graphics(c echo.Context) error {
	u := web.CurrentUser(c)
	sessionID := c.QueryParam("sessionId")
	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ? AND user_id = ?", sessionID, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", sess.AssetID).Error; err != nil {
		return web.Fail(c, 200, 404, "资产不存在")
	}
	if !authz.CanAccess(h.store.DB, u, a.ID) {
		return web.Fail(c, 200, 403, "无权访问该资产")
	}

	width := atoiDefault(c.QueryParam("width"), 1024)
	height := atoiDefault(c.QueryParam("height"), 768)
	dpi := atoiDefault(c.QueryParam("dpi"), 96)

	dec := func(s string) string { v, _ := h.cipher.Decrypt(s); return v }
	params := gateway.GuacParams{
		Protocol: a.Protocol, Hostname: a.IP, Port: a.Port,
		Username: a.Username, Password: dec(a.Password),
		Width: width, Height: height, DPI: dpi,
	}
	if a.AccountType == "credential" && a.CredentialID != "" {
		var cred model.Credential
		if h.store.DB.First(&cred, "id = ?", a.CredentialID).Error == nil {
			params.Username = cred.Username
			params.Password = dec(cred.Password)
		}
	}

	ws, err := h.upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	guacd, err := gateway.DialAndHandshake(h.resolveGuacdAddr(), params)
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte(gateway.FormatInstruction("error", err.Error(), "1000")))
		h.finishSession(&sess, "")
		return nil
	}
	defer guacd.Close()

	// 桥接开始 → 在线
	h.store.DB.Model(&model.ConnSession{}).Where("id = ?", sess.ID).Updates(map[string]any{
		"status": "connected", "connected_at": model.NowMillis(),
	})
	h.registry.Add(sess.ID, func() { _ = ws.Close(); guacd.Close() })
	defer h.registry.Remove(sess.ID)

	done := make(chan struct{})
	// guacd → 浏览器
	go func() {
		defer close(done)
		for {
			raw, err := guacd.ReadRaw()
			if err != nil {
				return
			}
			if ws.WriteMessage(websocket.TextMessage, []byte(raw)) != nil {
				return
			}
		}
	}()
	// 浏览器 → guacd
	go func() {
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				guacd.Close()
				return
			}
			if guacd.Write(string(msg)) != nil {
				return
			}
		}
	}()

	<-done
	h.finishSession(&sess, "")
	return nil
}

func atoiDefault(s string, def int) int {
	n := 0
	if s == "" {
		return def
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	if n == 0 {
		return def
	}
	return n
}
