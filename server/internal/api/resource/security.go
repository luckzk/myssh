package resource

import (
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

// SecurityHandler 暴露运行时安全体检，供设置页把生产风险显式展示出来。
type SecurityHandler struct {
	store *store.Store
	cfg   config.Config
}

type securityCheck struct {
	Key         string `json:"key"`
	Title       string `json:"title"`
	Status      string `json:"status"` // ok | warning | danger
	Message     string `json:"message"`
	Remediation string `json:"remediation"`
}

type securitySummary struct {
	Env       string          `json:"env"`
	Blocking  bool            `json:"blocking"`
	Checks    []securityCheck `json:"checks"`
	UpdatedAt int64           `json:"updatedAt"`
}

func NewSecurityHandler(s *store.Store, cfg config.Config) *SecurityHandler {
	return &SecurityHandler{store: s, cfg: cfg}
}

func (h *SecurityHandler) Register(g *echo.Group) {
	g.GET("/security/checks", h.checks)
}

func (h *SecurityHandler) checks(c echo.Context) error {
	cfg := h.cfg
	checks := []securityCheck{
		{
			Key:         "enc-key",
			Title:       "凭证加密密钥",
			Status:      statusDanger(cfg.EncKey == "" || cfg.EncKey == config.DefaultEncKey || len(cfg.EncKey) < 32),
			Message:     encKeyMessage(cfg.EncKey),
			Remediation: "设置 NT_ENC_KEY 为不少于 32 字符的随机值，并妥善备份。",
		},
		{
			Key:         "seed-admin",
			Title:       "默认管理员",
			Status:      statusDanger(cfg.SeedAdmin == "" || cfg.SeedAdmin == "manager:manager"),
			Message:     seedAdminMessage(cfg.SeedAdmin),
			Remediation: "设置 NT_SEED_ADMIN=用户名:强密码，或初始化后禁用默认账号。",
		},
		{
			Key:         "security-token",
			Title:       "敏感明文二次校验",
			Status:      statusDanger(cfg.SecurityToken == ""),
			Message:     tokenMessage(cfg.SecurityToken),
			Remediation: "设置 NT_SECURITY_TOKEN，并在查看凭证明文时要求二次令牌。",
		},
		{
			Key:         "origin",
			Title:       "CORS / WebSocket Origin",
			Status:      statusDanger(hasWildcard(cfg.AllowedOrigins)),
			Message:     "当前允许来源：" + strings.Join(cfg.AllowedOrigins, ", "),
			Remediation: "设置 NT_ALLOWED_ORIGINS 为可信前端域名列表，生产环境不要使用 *。",
		},
		{
			Key:         "host-key",
			Title:       "SSH HostKey 策略",
			Status:      hostKeyStatus(cfg.SSHHostKeyPolicy),
			Message:     "当前策略：" + cfg.SSHHostKeyPolicy,
			Remediation: "建议生产使用 tofu 或 known_hosts；known_hosts 模式需设置 NT_SSH_KNOWN_HOSTS。",
		},
	}
	return web.OK(c, securitySummary{
		Env:       cfg.Env,
		Blocking:  cfg.Production(),
		Checks:    checks,
		UpdatedAt: model.NowMillis(),
	})
}

func statusDanger(bad bool) string {
	if bad {
		return "danger"
	}
	return "ok"
}

func encKeyMessage(key string) string {
	switch {
	case key == "":
		return "未配置 NT_ENC_KEY。"
	case key == config.DefaultEncKey:
		return "正在使用默认加密密钥。"
	case len(key) < 32:
		return "加密密钥长度不足 32 字符。"
	default:
		return "已配置非默认加密密钥。"
	}
}

func seedAdminMessage(seed string) string {
	if seed == "" {
		return "未配置初始管理员。"
	}
	if seed == "manager:manager" {
		return "仍在使用默认 manager:manager。"
	}
	user := seed
	if i := strings.IndexByte(seed, ':'); i >= 0 {
		user = seed[:i]
	}
	return "初始管理员用户名：" + user
}

func tokenMessage(token string) string {
	if token == "" {
		return "未设置 NT_SECURITY_TOKEN，开发模式下明文接口会放行。"
	}
	return "已启用敏感明文二次校验。"
}

func hostKeyStatus(policy string) string {
	if policy == "insecure" {
		return "danger"
	}
	if policy == "known_hosts" || policy == "tofu" {
		return "ok"
	}
	return "warning"
}

func hasWildcard(origins []string) bool {
	for _, o := range origins {
		if strings.TrimSpace(o) == "*" {
			return true
		}
	}
	return false
}
