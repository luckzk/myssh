package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

const DefaultEncKey = "0123456789abcdef0123456789abcdef"

// Config 来自环境变量（12-factor）。MVP 默认值便于本地一把起。
type Config struct {
	Addr             string   // HTTP 监听地址
	DBDriver         string   // sqlite | postgres
	DBDSN            string   // 数据源；sqlite 为文件路径
	Env              string   // development | production
	DemoMode         bool     // 演示只读模式（对应探查到的 demo 拦截）
	EncKey           string   // 凭证/敏感字段对称加密密钥
	SeedAdmin        string   // 初始管理员 用户名:密码
	Recordings       string   // 录像存储目录
	GuacdAddr        string   // guacd 地址（RDP/VNC 图形协议）
	AllowedOrigins   []string // CORS / WebSocket Origin 白名单
	SecurityToken    string   // 查看敏感明文的二次校验令牌
	SSHHostKeyPolicy string   // insecure | known_hosts | tofu
	SSHKnownHosts    string   // known_hosts 文件路径
	SessionTTL        time.Duration // 分离（无人连接）会话的保活上限，超时回收
	SessionScrollback int           // 每会话回滚缓冲字节数（重新附着时回放近期输出）
	SerialAllow       []string      // 串口设备路径允许前缀（防打开任意文件）
	LocalTerminal     bool          // 是否允许「本地终端」（后端主机 shell）——默认关闭，极敏感
}

func Load() Config {
	origins := splitCSV(env("NT_ALLOWED_ORIGINS", "*"))
	if len(origins) == 0 {
		origins = []string{"*"}
	}
	return Config{
		Addr:             env("NT_ADDR", ":8088"),
		DBDriver:         env("NT_DB_DRIVER", "sqlite"),
		DBDSN:            env("NT_DB_DSN", "nt.db"),
		Env:              strings.ToLower(env("NT_ENV", "development")),
		DemoMode:         env("NT_DEMO_MODE", "false") == "true",
		EncKey:           env("NT_ENC_KEY", DefaultEncKey),
		SeedAdmin:        env("NT_SEED_ADMIN", "zkiss:Aa9213"),
		Recordings:       env("NT_RECORDINGS", "recordings"),
		GuacdAddr:        env("NT_GUACD_ADDR", "127.0.0.1:4822"),
		AllowedOrigins:   origins,
		SecurityToken:    env("NT_SECURITY_TOKEN", ""),
		SSHHostKeyPolicy: strings.ToLower(env("NT_SSH_HOST_KEY_POLICY", "tofu")),
		SSHKnownHosts:    env("NT_SSH_KNOWN_HOSTS", ""),
		SessionTTL:        envDuration("NT_SESSION_TTL", 12*time.Hour),
		SessionScrollback: envBytes("NT_SESSION_SCROLLBACK", 256*1024),
		SerialAllow:       splitCSV(env("NT_SERIAL_ALLOW", "/dev/tty,/dev/serial/")),
		LocalTerminal:     env("NT_LOCAL_TERMINAL", "false") == "true",
	}
}

// envBytes 从环境变量解析字节大小；非法/缺省回落默认。
func envBytes(k string, def int) int {
	return ParseBytes(os.Getenv(k), def)
}

// ParseBytes 解析字节大小，支持 k/K/m/M 后缀（如 "256k"、"1m"）；非法/空回落 def。
func ParseBytes(v string, def int) int {
	v = strings.TrimSpace(v)
	if v == "" {
		return def
	}
	mult := 1
	switch v[len(v)-1] {
	case 'k', 'K':
		mult, v = 1024, v[:len(v)-1]
	case 'm', 'M':
		mult, v = 1024*1024, v[:len(v)-1]
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n <= 0 {
		return def
	}
	return n * mult
}

func envDuration(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func (c Config) Production() bool {
	return c.Env == "production" || os.Getenv("NT_PRODUCTION") == "true"
}

// Validate 拦截生产环境中会直接造成凭证/会话风险的配置。
func (c Config) Validate() error {
	if c.SSHHostKeyPolicy != "insecure" && c.SSHHostKeyPolicy != "known_hosts" && c.SSHHostKeyPolicy != "tofu" {
		return errors.New("NT_SSH_HOST_KEY_POLICY must be insecure, known_hosts, or tofu")
	}
	if c.SSHHostKeyPolicy == "known_hosts" && c.SSHKnownHosts == "" {
		return errors.New("NT_SSH_KNOWN_HOSTS is required when NT_SSH_HOST_KEY_POLICY=known_hosts")
	}
	if !c.Production() {
		return nil
	}
	var problems []string
	if c.EncKey == "" || c.EncKey == DefaultEncKey || len(c.EncKey) < 32 {
		problems = append(problems, "set NT_ENC_KEY to a non-default value with at least 32 characters")
	}
	if c.SeedAdmin == "" || c.SeedAdmin == "zkiss:Aa9213" || c.SeedAdmin == "manager:manager" {
		problems = append(problems, "set NT_SEED_ADMIN away from the built-in default")
	}
	if c.SecurityToken == "" {
		problems = append(problems, "set NT_SECURITY_TOKEN for decrypted secret endpoints")
	}
	if hasWildcard(c.AllowedOrigins) {
		problems = append(problems, "set NT_ALLOWED_ORIGINS to explicit trusted origins")
	}
	if c.SSHHostKeyPolicy == "insecure" {
		problems = append(problems, "set NT_SSH_HOST_KEY_POLICY=tofu or known_hosts")
	}
	if len(problems) > 0 {
		return errors.New("unsafe production config: " + strings.Join(problems, "; "))
	}
	return nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func hasWildcard(origins []string) bool {
	for _, o := range origins {
		if o == "*" {
			return true
		}
	}
	return false
}
