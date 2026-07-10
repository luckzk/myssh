package access

import (
	"net/url"
	"sync"

	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

// shareGroup 一个会话的只读观战者集合；主会话输出广播给所有 subs。
type shareGroup struct {
	mu   sync.Mutex
	subs map[*websocket.Conn]struct{}
}

func newShareGroup() *shareGroup {
	return &shareGroup{subs: make(map[*websocket.Conn]struct{})}
}

func (g *shareGroup) add(ws *websocket.Conn)    { g.mu.Lock(); g.subs[ws] = struct{}{}; g.mu.Unlock() }
func (g *shareGroup) remove(ws *websocket.Conn) { g.mu.Lock(); delete(g.subs, ws); g.mu.Unlock() }

// broadcast 把终端输出帧串行写给每个观战者（避免并发写同一 ws）。
func (g *shareGroup) broadcast(b []byte) {
	frame := []byte(gateway.EncodeData(string(b)))
	g.mu.Lock()
	defer g.mu.Unlock()
	for ws := range g.subs {
		_ = ws.WriteMessage(websocket.TextMessage, frame)
	}
}

func (g *shareGroup) closeAll() {
	g.mu.Lock()
	defer g.mu.Unlock()
	for ws := range g.subs {
		_ = ws.Close()
	}
	g.subs = make(map[*websocket.Conn]struct{})
}

// ---- Handler 上的共享状态（在 New 中初始化）----

func (h *Handler) getOrCreateGroup(sessionID string) *shareGroup {
	h.shareMu.Lock()
	defer h.shareMu.Unlock()
	g := h.shareGroups[sessionID]
	if g == nil {
		g = newShareGroup()
		h.shareGroups[sessionID] = g
	}
	return g
}

func (h *Handler) removeGroup(sessionID string) {
	h.shareMu.Lock()
	defer h.shareMu.Unlock()
	delete(h.shareGroups, sessionID)
}

func (h *Handler) resolveJoin(token string) (string, bool) {
	h.shareMu.Lock()
	defer h.shareMu.Unlock()
	sid, ok := h.shareTokens[token]
	return sid, ok
}

// shareSession 为某在线会话生成只读观战分享链接。
func (h *Handler) shareSession(c echo.Context) error {
	u := web.CurrentUser(c)
	id := c.Param("id")
	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ? AND user_id = ?", id, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}
	if sess.Status != "connected" {
		return web.Fail(c, 200, 400, "会话未在线，无法共享")
	}
	token := uuid.NewString()
	h.shareMu.Lock()
	h.shareTokens[token] = sess.ID
	h.shareMu.Unlock()
	url := "/term/" + sess.AssetID + "?sessionId=" + sess.ID + "&join=" + token
	return web.OK(c, map[string]any{"token": token, "url": url})
}

// watchSession 允许管理员从在线会话列表生成只读观战链接。
func (h *Handler) watchSession(c echo.Context) error {
	u := web.CurrentUser(c)
	if u == nil || u.Type != "admin" {
		return web.Fail(c, 200, 403, "仅管理员可观战会话")
	}
	id := c.Param("id")
	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ?", id).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}
	if sess.Status != "connected" {
		return web.Fail(c, 200, 400, "会话未在线，无法观战")
	}
	token := uuid.NewString()
	h.shareMu.Lock()
	h.shareTokens[token] = sess.ID
	h.shareMu.Unlock()
	watchURL := "/term/" + url.PathEscape(sess.AssetID) + "?sessionId=" + url.QueryEscape(sess.ID) + "&join=" + url.QueryEscape(token) + "&name=" + url.QueryEscape(sess.AssetName)
	return web.OK(c, map[string]any{"token": token, "url": watchURL})
}

// joinViewer 以只读观战身份附着到既有 LiveSession（不 DialSSH，输入被丢弃）。
func (h *Handler) joinViewer(c echo.Context, sessionID, token string) error {
	sid, ok := h.resolveJoin(token)
	if !ok || sid != sessionID {
		return web.Fail(c, 200, 403, "无效的观战令牌")
	}
	ws, err := h.upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	_ = ws.WriteMessage(websocket.TextMessage,
		[]byte(gateway.EncodeData("\x1b[33m== 只读观战模式（输入已禁用）==\x1b[0m\r\n")))
	live := h.getLive(sessionID)
	if live == nil {
		_ = ws.WriteMessage(websocket.TextMessage,
			[]byte(gateway.EncodeData("\x1b[31m会话当前不在线。\x1b[0m\r\n")))
		return nil
	}
	live.attach(ws, false) // 只读附着，阻塞至断开或会话结束
	return nil
}
