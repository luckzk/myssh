package model

// Credential 凭证。字段对齐 docs/recon/asset-credential.md。
// password/privateKey/passphrase 加密落库；JSON 序列化时默认脱敏（见 handler）。
type Credential struct {
	ID          string `gorm:"primaryKey;size:36" json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"` // password | private-key
	Username    string `json:"username"`
	Password    string `json:"password"`   // 密文落库
	PrivateKey  string `json:"privateKey"` // 密文落库
	Passphrase  string `json:"passphrase"` // 密文落库
	Description string `json:"description"`
	CreatedAt   int64  `json:"createdAt"`
}

func (Credential) TableName() string { return "credentials" }

// Asset 主机资产。字段对齐实测 paging 结构。
type Asset struct {
	ID          string `gorm:"primaryKey;size:36" json:"id"`
	Name        string `json:"name"`
	Alias       string `json:"alias"`
	Logo        string `json:"logo"`
	Protocol    string `json:"protocol"` // ssh | rdp | vnc | telnet | ...
	IP          string `json:"ip"`
	Port        int    `json:"port"`
	AccountType string `json:"accountType"` // password | private-key | credential
	CredentialID string `json:"credentialId"`
	Username    string `json:"username"`
	Password    string `json:"password"`   // 内联凭证·密文
	PrivateKey  string `json:"privateKey"` // 密文
	Passphrase  string `json:"passphrase"` // 密文
	Description string `json:"description"`
	Status      string `json:"status"`
	StatusText  string `json:"statusText"`
	GatewayType string `json:"gatewayType"`
	GatewayID   string `json:"gatewayId"`
	// 跳板机多层链路：ssh-gateway id 列表（JSON），顶部为第一跳。空则回退 GatewayID。
	GatewayChain string `gorm:"column:gateway_chain" json:"-"`
	// 连接设置
	Timeout   int `json:"timeout"`   // 超时(ms)
	Heartbeat int `json:"heartbeat"` // 心跳(ms)（暂存）
	// 初始化
	DefaultPath string `json:"defaultPath"`
	InitCommand string `json:"initCommand"`
	// 代理（暂存，未接转发）
	DisableProxy bool   `json:"disableProxy"`
	Proxy        string `json:"proxy"`
	// 高级（暂存）
	X11         bool   `json:"x11"`
	X11Cookie   string `json:"x11Cookie"`
	Encoding    string `json:"encoding"`
	HostKeyAlgo string `json:"hostKeyAlgo"`
	Cipher      string `json:"cipher"`
	Kex         string `json:"kex"`
	Tags        string `gorm:"column:tags" json:"-"` // 内部以逗号分隔存储
	OS          string `json:"os"`     // 系统家族：linux | macos | windows
	Distro      string `json:"distro"` // 发行版 id：ubuntu | debian | centos | alpine ...
	GroupID     string `json:"groupId"`
	Sort        string `json:"sort"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

func (Asset) TableName() string { return "assets" }

// AssetGroup 资产分组（树，parentId 串起层级）。
type AssetGroup struct {
	ID        string `gorm:"primaryKey;size:48" json:"id"`
	Name      string `json:"name"`
	ParentID  string `gorm:"index;size:48" json:"parentId"`
	Icon      string `json:"icon"`      // boxicons 类名，如 bx-folder（空=默认文件夹）
	IconColor string `json:"iconColor"` // 图标颜色 #hex（空=默认琥珀色）
	Sort      int    `json:"sort"`
	CreatedAt int64  `json:"createdAt"`
}

func (AssetGroup) TableName() string { return "asset_groups" }
