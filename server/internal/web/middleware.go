package web

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/labstack/echo/v4"
)

const TokenCookie = "X-Auth-Token"
const TokenHeader = "X-Auth-Token"

// AuthToken 解析令牌（头或 Cookie）→ 查会话表 → 注入当前用户。
// 证据：令牌双通道（X-Auth-Token 头 / HttpOnly Cookie）。
func AuthToken(s *store.Store) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			token := extractToken(c)
			if token == "" {
				return c.JSON(http.StatusUnauthorized, Resp{Code: 401, Message: "Unauthorized"})
			}
			var sess model.Session
			if err := s.DB.Where("token = ?", token).First(&sess).Error; err != nil {
				return c.JSON(http.StatusUnauthorized, Resp{Code: 401, Message: "Unauthorized"})
			}
			if sess.ExpiresAt > 0 && sess.ExpiresAt < model.NowMillis() {
				s.DB.Delete(&sess)
				return c.JSON(http.StatusUnauthorized, Resp{Code: 401, Message: "token expired"})
			}
			var u model.User
			if err := s.DB.Where("id = ?", sess.UserID).First(&u).Error; err != nil {
				return c.JSON(http.StatusUnauthorized, Resp{Code: 401, Message: "Unauthorized"})
			}
			SetUser(c, &u)
			return next(c)
		}
	}
}

// OriginAllowed 用于 WebSocket CheckOrigin；无 Origin 的非浏览器客户端允许通过。
func OriginAllowed(r *http.Request, allowed []string) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	for _, item := range allowed {
		if strings.TrimSpace(item) == "*" {
			return true
		}
		if origin == strings.TrimRight(strings.TrimSpace(item), "/") {
			return true
		}
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return u.Host == r.Host
}

// RequireSecurityToken 对查看明文凭证等高敏端点做二次令牌校验。
// 开发环境未配置令牌时保持兼容；配置后必须通过 query 或请求头传入。
func RequireSecurityToken(c echo.Context, expected string) bool {
	if expected == "" {
		return true
	}
	if c.QueryParam("securityToken") == expected {
		return true
	}
	if c.Request().Header.Get("X-Security-Token") == expected {
		return true
	}
	return false
}

func extractToken(c echo.Context) string {
	if h := c.Request().Header.Get(TokenHeader); h != "" {
		return strings.TrimSpace(h)
	}
	if ck, err := c.Cookie(TokenCookie); err == nil && ck.Value != "" {
		return ck.Value
	}
	// WS 回退：浏览器 WebSocket 无法设置自定义头，允许 query 携带令牌。
	if q := c.QueryParam("X-Auth-Token"); q != "" {
		return q
	}
	if q := c.QueryParam("token"); q != "" {
		return q
	}
	return ""
}

// DemoGuard 演示模式下拦截写操作。证据：{"code":400,"message":"演示模式下禁止新增、修改和删除。"}
func DemoGuard(enabled bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !enabled {
				return next(c)
			}
			switch c.Request().Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
				return c.JSON(http.StatusOK, Resp{Code: 400, Message: "演示模式下禁止新增、修改和删除。"})
			}
			return next(c)
		}
	}
}
