package api

import (
	"log/slog"
	"net/http"

	"github.com/dushixiang/next-terminal-clone/server/internal/api/access"
	"github.com/dushixiang/next-terminal-clone/server/internal/api/auth"
	"github.com/dushixiang/next-terminal-clone/server/internal/api/identity"
	"github.com/dushixiang/next-terminal-clone/server/internal/api/resource"
	"github.com/dushixiang/next-terminal-clone/server/internal/audit"
	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/crypto"
	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

// NewRouter 组装路由。前缀 /api；中间件链：Recover→RequestID→CORS→...
func NewRouter(s *store.Store, cfg config.Config) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Recover())
	e.Use(middleware.RequestID())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowCredentials: false,
		AllowHeaders:     []string{echo.HeaderContentType, web.TokenHeader},
	}))

	// 未知 /api 路由统一 {code:500,message:"Not Found"}（对齐 demo）
	e.HTTPErrorHandler = func(err error, c echo.Context) {
		if he, ok := err.(*echo.HTTPError); ok && he.Code == http.StatusNotFound {
			_ = c.JSON(http.StatusOK, web.Resp{Code: 500, Message: "Not Found"})
			return
		}
		e.DefaultHTTPErrorHandler(err, c)
	}

	apiG := e.Group("/api")
	apiG.GET("/health", func(c echo.Context) error {
		return web.OK(c, map[string]any{"status": "ok"})
	})

	authH := auth.New(s)
	authH.Register(apiG) // 公共：login-status/branding/captcha/login/logout

	// Agent 对接：/api/agent/*（公开——Agent 注册时无登录态）
	resource.NewAgentHandler(s).Register(apiG.Group("/agent"))

	cipher, err := crypto.New(cfg.EncKey)
	if err != nil {
		slog.Error("init cipher failed", "err", err)
	}
	recorder := audit.NewRecorder(cfg.Recordings)
	gateway.SetSerialAllow(cfg.SerialAllow) // 串口设备路径白名单
	registry := gateway.NewRegistry()
	sshOptions := gateway.SSHOptions{HostKeyPolicy: cfg.SSHHostKeyPolicy, KnownHostsPath: cfg.SSHKnownHosts}
	accessH := access.New(s, cfg, cipher, recorder, registry)

	// 需鉴权分组：按子前缀挂 AuthToken，避免空前缀组吞掉未匹配路由
	accountG := apiG.Group("/account", web.AuthToken(s))
	authH.RegisterAccount(accountG)
	accessH.RegisterAccount(accountG) // POST /account/sessions

	// 终端工作台：/api/access/*（WS 终端，鉴权走 cookie/query 令牌）
	accessG := apiG.Group("/access", web.AuthToken(s))
	accessH.RegisterAccess(accessG)
	accessH.RegisterFilesystem(accessG.Group("/filesystem"))
	accessH.RegisterGraphics(accessG, cfg.GuacdAddr)

	// 管理端：/api/admin/*，鉴权 + 演示模式写拦截
	adminG := apiG.Group("/admin", web.AuthToken(s), web.DemoGuard(cfg.DemoMode))
	accessH.RegisterAdmin(adminG)
	resource.NewCredentialHandler(s, cfg, cipher).Register(adminG.Group("/credentials"))
	resource.NewBackupHandler(s, cfg, cipher).Register(adminG)
	assetH := resource.NewAssetHandler(s, cipher)
	assetH.SecurityToken = cfg.SecurityToken
	assetH.SSHOptions = sshOptions
	assetH.Register(adminG.Group("/assets"))
	assetH.RegisterGroups(adminG.Group("/assets")) // 资产分组树（复用 asset_group.go）
	// guacd 网关：选择/检测/自动安装
	resource.NewGuacdHandler(s, cipher, sshOptions).Register(adminG.Group("/guacd"))
	resource.NewHostKeyHandler(s).Register(adminG.Group("/host-keys"))
	// 站点信息设置
	resource.NewSiteHandler(s).Register(adminG)
	resource.NewSecurityHandler(s, cfg).Register(adminG)
	sessionH := resource.NewSessionHandler(s, registry)
	sessionH.Register(adminG.Group("/sessions"))
	sessionH.RegisterCommands(adminG.Group("/session-commands"))
	sessionH.RegisterFilesystemLogs(adminG.Group("/filesystem-logs"))
	// 身份与授权：用户管理 + 资产授权策略
	identity.NewUserHandler(s).Register(adminG.Group("/users"))
	identity.NewAuthorizationHandler(s).Register(adminG.Group("/authorizations"))
	identity.NewCommandFilterHandler(s).Register(adminG.Group("/command-filters"))
	// 资源管理域：通用 CRUD 模块
	resource.RegisterResourceModules(adminG, s, cipher)

	return e
}
