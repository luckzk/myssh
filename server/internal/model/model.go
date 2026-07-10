package model

import "time"

// 全表 UUID 主键、毫秒时间戳（与探查到的 createdAt 为 epoch ms 对齐）。

// EpochMillis 用 int64 存毫秒时间戳，JSON 直接是数字，匹配 demo 的 createdAt 格式。
type EpochMillis = int64

// User 用户。字段对齐 demo /api/admin/users 返回结构。
type User struct {
	ID                   string `gorm:"primaryKey;size:36" json:"id"`
	Username             string `gorm:"uniqueIndex;size:128" json:"username"`
	Nickname             string `json:"nickname"`
	Password             string `json:"-"` // bcrypt 哈希，绝不下发
	Type                 string `json:"type"`   // admin | user
	Status               string `json:"status"` // 空=正常 / disabled / locked
	Mail                 string `json:"mail"`
	Phone                string `json:"phone"`
	Source               string `json:"source"`    // local | ldap | oidc
	Recording            string `json:"recording"` // enabled | disabled（按用户强制录像）
	Watermark            string `json:"watermark"` // enabled | disabled
	Language             string `json:"language"`
	Remark               string `json:"remark"`
	EnabledTotp          bool   `json:"enabledTotp"`
	TotpSecret           string `json:"-"`
	Online               bool   `gorm:"-" json:"online"`
	LastLoginAt          int64  `json:"lastLoginAt"`
	LastUpdatePasswordAt int64  `json:"lastUpdatePasswordAt"`
	CreatedAt            int64  `json:"createdAt"`
}

func (User) TableName() string { return "users" }

// Role 角色。menus 承载菜单权限树（探查：role.menus[]）。
type Role struct {
	ID        string     `gorm:"primaryKey;size:64" json:"id"`
	Name      string     `json:"name"`
	Type      string     `json:"type"` // default | custom
	CreatedAt int64      `json:"createdAt"`
	Menus     []RoleMenu `gorm:"foreignKey:RoleID" json:"-"`
}

func (Role) TableName() string { return "roles" }

// RoleMenu 角色-菜单 勾选关系，驱动 account/info 的 menus[].checked。
type RoleMenu struct {
	RoleID  string `gorm:"primaryKey;size:64" json:"-"`
	MenuKey string `gorm:"primaryKey;size:64" json:"key"`
	Checked bool   `json:"checked"`
}

func (RoleMenu) TableName() string { return "role_menus" }

// UserRole 用户-角色。
type UserRole struct {
	UserID string `gorm:"primaryKey;size:36"`
	RoleID string `gorm:"primaryKey;size:64"`
}

func (UserRole) TableName() string { return "user_roles" }

// Authorization 资产授权策略：把用户[] 授权到 资产[]/资产分组[]。
// 三个 id 列表以 JSON 字符串存储（仿 Asset.GatewayChain），API 侧用 DTO 转数组。
type Authorization struct {
	ID            string `gorm:"primaryKey;size:36" json:"id"`
	Name          string `json:"name"`
	Enabled       bool   `json:"enabled"`
	UserIDs       string `gorm:"type:text" json:"-"` // JSON []string
	AssetIDs      string `gorm:"type:text" json:"-"` // JSON []string
	AssetGroupIDs string `gorm:"type:text" json:"-"` // JSON []string
	CreatedAt     int64  `json:"createdAt"`
}

func (Authorization) TableName() string { return "authorizations" }

// CommandFilter 命令过滤规则：命中输入的整行命令时按 Action 阻断/告警。
// UserIDs/AssetIDs 为空=全局，否则限定生效范围（JSON 字符串列，同 Authorization）。
type CommandFilter struct {
	ID        string `gorm:"primaryKey;size:36" json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	Action    string `json:"action"` // block | warn
	Pattern   string `json:"pattern"`
	Regex     bool   `json:"regex"`
	Priority  int    `json:"priority"`
	UserIDs   string `gorm:"type:text" json:"-"` // JSON []string
	AssetIDs  string `gorm:"type:text" json:"-"` // JSON []string
	CreatedAt int64  `json:"createdAt"`
}

func (CommandFilter) TableName() string { return "command_filters" }

// Session 服务端会话表（不透明令牌 NT_...），支持强制下线。
type Session struct {
	Token     string `gorm:"primaryKey;size:64" json:"token"`
	UserID    string `gorm:"index;size:36" json:"userId"`
	ClientIP  string `json:"clientIp"`
	UserAgent string `json:"userAgent"`
	MfaPassed bool   `json:"mfaPassed"`
	ExpiresAt int64  `json:"expiresAt"`
	CreatedAt int64  `json:"createdAt"`
}

func (Session) TableName() string { return "sessions" }

// LoginLog 登录留痕。
type LoginLog struct {
	ID        string `gorm:"primaryKey;size:36" json:"id"`
	UserID    string `gorm:"index;size:36" json:"userId"`
	Username  string `json:"username"`
	ClientIP  string `json:"clientIp"`
	UserAgent string `json:"userAgent"`
	Success   bool   `json:"success"`
	Reason    string `json:"reason"`
	CreatedAt int64  `json:"createdAt"`
}

func (LoginLog) TableName() string { return "login_logs" }

func NowMillis() int64 { return time.Now().UnixMilli() }
