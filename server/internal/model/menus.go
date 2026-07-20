package model

// MenuKeys 是 account/info 下发的菜单权限树的完整 key 列表，
// 顺序与层级来自对 demo 的真实抓取（44 项 unique，其中 5 项为分组父节点）。
// 证据：docs/recon/auth.md + /api/account/info menus[]。
var MenuKeys = []string{
	"dashboard",
	// resource 域
	"resource", "asset", "database-asset", "db-work-order", "credential",
	"snippet", "storage", "backup-destination", "website", "certificate",
	"gateway", "ssh-gateway", "agent-gateway", "gateway-group",
	// log-audit 域
	"log-audit", "online-session", "offline-session", "exec-command-log",
	"filesystem-log", "access-log", "access-log-stats", "login-log",
	"operation-log", "database-sql-log",
	// sysops 域
	"sysops", "backup", "scheduled-task", "tools", "monitoring",
	// identity 域
	"identity", "user", "user-group", "department", "role",
	"login-policy", "login-locked", "oidc-client",
	// authorised 域
	"authorised", "command-filter", "strategy",
	"authorised-asset", "authorised-website", "authorised-database-asset",
	// system
	"setting", "dev",
}
