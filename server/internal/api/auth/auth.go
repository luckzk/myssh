package auth

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	store    *store.Store
	branding Branding
}

// Branding 由后端注入，前端 window.branding 据此渲染（探查证据）。
type Branding struct {
	Name          string `json:"name"`
	Copyright     string `json:"copyright"`
	Version       string `json:"version"`
	ICP           string `json:"icp"`
	Debug         bool   `json:"debug"`
	HiddenUpgrade bool   `json:"hiddenUpgrade"`
}

func New(s *store.Store) *Handler {
	return &Handler{
		store: s,
		branding: Branding{
			Name:      "NEXT TERMINAL CLONE",
			Copyright: "Copyright © 2020-2026, All Rights Reserved.",
			Version:   "v0.1.0",
		},
	}
}

// Register 挂载公共认证端点（无需令牌）。
func (h *Handler) Register(g *echo.Group) {
	g.GET("/login-status", h.loginStatus)
	g.GET("/branding", h.getBranding)
	g.GET("/captcha", h.captcha)
	g.POST("/login", h.login)
	g.POST("/logout", h.logout)
}

// loginStatus 返回启用了哪些登录方式 → 前端据此渲染登录页。
// 证据：{"oidcEnabled":false,"passwordEnabled":true,"status":"Unlogged","webauthnEnabled":true,"wechatWorkEnabled":false}
func (h *Handler) loginStatus(c echo.Context) error {
	status := "Unlogged"
	if u := web.CurrentUser(c); u != nil {
		status = "Logged In"
	}
	return web.OK(c, map[string]any{
		"status":            status,
		"passwordEnabled":   true,
		"oidcEnabled":       false,
		"webauthnEnabled":   false,
		"wechatWorkEnabled": false,
	})
}

func (h *Handler) getBranding(c echo.Context) error { return web.OK(c, h.branding) }

// captcha 验证码开关。证据：{"captcha":"","enabled":false,"key":""}
func (h *Handler) captcha(c echo.Context) error {
	return web.OK(c, map[string]any{"captcha": "", "enabled": false, "key": ""})
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Captcha  string `json:"captcha"`
	Key      string `json:"key"`
}

// login 账号密码登录。证据：响应 {needTotp, token} + Set-Cookie X-Auth-Token(HttpOnly)。
func (h *Handler) login(c echo.Context) error {
	var req loginReq
	if err := c.Bind(&req); err != nil {
		return web.Fail(c, http.StatusOK, 400, "请求参数错误")
	}
	var u model.User
	err := h.store.DB.Where("username = ?", req.Username).First(&u).Error
	if err != nil || bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(req.Password)) != nil {
		h.writeLoginLog(c, &u, req.Username, false, "用户名或密码错误")
		return web.Fail(c, http.StatusOK, 400, "用户名或密码错误")
	}
	if u.Status == "disabled" || u.Status == "locked" {
		return web.Fail(c, http.StatusOK, 400, "账号已被禁用或锁定")
	}

	// needTotp：启用 TOTP 时进入二阶段（此处仅返回标志，validate-totp 待 S3 增强）
	if u.EnabledTotp {
		return web.OK(c, map[string]any{"needTotp": true, "token": ""})
	}

	token := h.issueToken(c, &u)
	h.writeLoginLog(c, &u, req.Username, true, "")
	return web.OK(c, map[string]any{"needTotp": false, "token": token})
}

// issueToken 生成不透明令牌 NT_... 写会话表，并下发 HttpOnly Cookie。
func (h *Handler) issueToken(c echo.Context, u *model.User) string {
	token := "NT_" + randToken(32)
	now := model.NowMillis()
	sess := model.Session{
		Token: token, UserID: u.ID,
		ClientIP:  c.RealIP(),
		UserAgent: c.Request().UserAgent(),
		ExpiresAt: now + int64(7*24*time.Hour/time.Millisecond),
		CreatedAt: now,
	}
	h.store.DB.Create(&sess)
	h.store.DB.Model(&model.User{}).Where("id = ?", u.ID).Update("last_login_at", now)

	c.SetCookie(&http.Cookie{
		Name: web.TokenCookie, Value: token, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Expires: time.UnixMilli(sess.ExpiresAt),
	})
	return token
}

func (h *Handler) logout(c echo.Context) error {
	if ck, err := c.Cookie(web.TokenCookie); err == nil {
		h.store.DB.Where("token = ?", ck.Value).Delete(&model.Session{})
	}
	if t := c.Request().Header.Get(web.TokenHeader); t != "" {
		h.store.DB.Where("token = ?", t).Delete(&model.Session{})
	}
	c.SetCookie(&http.Cookie{Name: web.TokenCookie, Value: "", Path: "/", MaxAge: -1})
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *Handler) writeLoginLog(c echo.Context, u *model.User, username string, ok bool, reason string) {
	uid := ""
	if u != nil {
		uid = u.ID
	}
	h.store.DB.Create(&model.LoginLog{
		ID: uuid.NewString(), UserID: uid, Username: username,
		ClientIP: c.RealIP(), UserAgent: c.Request().UserAgent(),
		Success: ok, Reason: reason, CreatedAt: model.NowMillis(),
	})
}

func randToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)[:n]
}
