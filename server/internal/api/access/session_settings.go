package access

import (
	"strconv"
	"time"

	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

const (
	settingSessionTTL        = "session_ttl"
	settingSessionScrollback = "session_scrollback"
)

// effectiveTTL 运行时保活时长：DB 设置优先，缺省/非法回落启动环境值。
func (h *Handler) effectiveTTL() time.Duration {
	if v := h.store.GetSetting(settingSessionTTL); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return h.sessionTTL
}

// effectiveScrollback 运行时回滚缓冲字节数：DB 设置优先，缺省/非法回落启动环境值。
func (h *Handler) effectiveScrollback() int {
	if v := h.store.GetSetting(settingSessionScrollback); v != "" {
		return config.ParseBytes(v, h.scrollback)
	}
	return h.scrollback
}

func fmtDuration(d time.Duration) string {
	if d%time.Hour == 0 {
		return strconv.FormatInt(int64(d/time.Hour), 10) + "h"
	}
	if d%time.Minute == 0 {
		return strconv.FormatInt(int64(d/time.Minute), 10) + "m"
	}
	return d.String()
}

func fmtBytes(n int) string {
	switch {
	case n%(1024*1024) == 0:
		return strconv.Itoa(n/(1024*1024)) + "m"
	case n%1024 == 0:
		return strconv.Itoa(n/1024) + "k"
	default:
		return strconv.Itoa(n)
	}
}

// getSessionSettings 返回当前生效的保活配置（DB 值，缺省时回落环境默认）。
func (h *Handler) getSessionSettings(c echo.Context) error {
	ttl := h.store.GetSetting(settingSessionTTL)
	if ttl == "" {
		ttl = fmtDuration(h.sessionTTL)
	}
	sb := h.store.GetSetting(settingSessionScrollback)
	if sb == "" {
		sb = fmtBytes(h.scrollback)
	}
	return web.OK(c, map[string]any{"ttl": ttl, "scrollback": sb})
}

type sessionSettingsReq struct {
	TTL        string `json:"ttl"`
	Scrollback string `json:"scrollback"`
}

// saveSessionSettings 校验并持久化保活配置（即时生效，无需重启）。
func (h *Handler) saveSessionSettings(c echo.Context) error {
	var r sessionSettingsReq
	if err := c.Bind(&r); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	if d, err := time.ParseDuration(r.TTL); err != nil || d <= 0 {
		return web.Fail(c, 200, 400, "保活时长格式无效（示例：12h、90m、24h）")
	}
	if config.ParseBytes(r.Scrollback, -1) <= 0 {
		return web.Fail(c, 200, 400, "回滚大小格式无效（示例：256k、1m）")
	}
	_ = h.store.SetSetting(settingSessionTTL, r.TTL)
	_ = h.store.SetSetting(settingSessionScrollback, r.Scrollback)
	return web.OK(c, map[string]any{"status": "ok"})
}
