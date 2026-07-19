package model

// BaseResource 提供 Crud[T] 所需的 ID/CreatedAt 读写。
type BaseResource struct {
	ID        string `gorm:"primaryKey;size:36" json:"id"`
	CreatedAt int64  `json:"createdAt"`
}

func (b *BaseResource) SetID(id string)        { b.ID = id }
func (b *BaseResource) SetCreatedAt(t int64)   { b.CreatedAt = t }
func (b *BaseResource) GetID() string          { return b.ID }
func (b *BaseResource) GetCreatedAt() int64    { return b.CreatedAt }

// Snippet 命令片段。
type Snippet struct {
	BaseResource
	Name       string `json:"name"`
	Content    string `json:"content"`
	Visibility string `json:"visibility"` // public | private
	CreatedBy  string `json:"createdBy"`
}

func (Snippet) TableName() string { return "snippets" }

// Storage 存储空间。
type Storage struct {
	BaseResource
	Name      string `json:"name"`
	IsShare   bool   `json:"isShare"`
	IsDefault bool   `json:"isDefault"`
	LimitSize int64  `json:"limitSize"`
	UsedSize  int64  `json:"usedSize"`
	CreatedBy string `json:"createdBy"`
}

func (Storage) TableName() string { return "storages" }

// DatabaseAsset 数据库资产。
type DatabaseAsset struct {
	BaseResource
	Name        string `json:"name"`
	Type        string `json:"type"` // mysql | postgres | redis ...
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Database    string `json:"database"`
	Username    string `json:"username"`
	Password    string `json:"password"` // 加密
	Description string `json:"description"`
	Status      string `json:"status"`
	StatusText  string `json:"statusText"`
	GatewayType string `json:"gatewayType"`
	GatewayID   string `json:"gatewayId"`
	Tags        string `gorm:"column:tags" json:"-"`
	Sort        string `json:"sort"`
	UpdatedAt   int64  `json:"updatedAt"`
}

func (DatabaseAsset) TableName() string { return "database_assets" }

// Certificate 证书。
type Certificate struct {
	BaseResource
	CommonName        string `json:"commonName"`
	Subject           string `json:"subject"`
	Issuer            string `json:"issuer"`
	NotBefore         int64  `json:"notBefore"`
	NotAfter          int64  `json:"notAfter"`
	Type              string `json:"type"`
	StorageKey        string `json:"storageKey"`
	Certificate       string `json:"certificate"`
	PrivateKey        string `json:"privateKey"` // 加密
	RequireClientAuth bool   `json:"requireClientAuth"`
	IssuedStatus      string `json:"issuedStatus"`
	IssuedError       string `json:"issuedError"`
	IsDefault         bool   `json:"isDefault"`
	UpdatedAt         int64  `json:"updatedAt"`
}

func (Certificate) TableName() string { return "certificates" }

// GatewayGroup 网关组。members 以 JSON 文本存储。
type GatewayGroup struct {
	BaseResource
	Name          string `json:"name"`
	Description   string `json:"description"`
	SelectionMode string `json:"selectionMode"` // priority | latency | random
	Members       string `gorm:"column:members" json:"-"`
	UpdatedAt     int64  `json:"updatedAt"`
}

func (GatewayGroup) TableName() string { return "gateway_groups" }

// SshGateway SSH 网关。
type SshGateway struct {
	BaseResource
	Type          string `json:"type"`
	Name          string `json:"name"`
	ConfigMode    string `json:"configMode"` // direct | credential | asset
	IP            string `json:"ip"`
	Port          int    `json:"port"`
	AccountType   string `json:"accountType"`
	Username      string `json:"username"`
	Password      string `json:"password"`   // 加密
	PrivateKey    string `json:"privateKey"` // 加密
	Passphrase    string `json:"passphrase"` // 加密
	CredentialID  string `json:"credentialId"`
	AssetID       string `json:"assetId"`
	Status        string `json:"status"`
	StatusMessage string `json:"statusMessage"`
}

func (SshGateway) TableName() string { return "ssh_gateways" }

// AgentGateway Agent 网关。Agent 持 token 主动注册上报，管理端多为只读 + 删除。
type AgentGateway struct {
	BaseResource
	Name      string `json:"name"`
	IP        string `json:"ip"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	Online    bool   `json:"online"`
	Version   string `json:"version"`
	Sort      string `json:"sort"`
	Stat      string `gorm:"column:stat" json:"-"` // 资源统计 JSON 文本
	UpdatedAt int64  `json:"updatedAt"`
}

func (AgentGateway) TableName() string { return "agent_gateways" }

// AgentGatewayToken Agent 注册令牌：生成后交给 Agent，注册时回带校验。
type AgentGatewayToken struct {
	BaseResource
	Name      string `json:"name"`
	Token     string `json:"token"`
	CreatedBy string `json:"createdBy"`
}

func (AgentGatewayToken) TableName() string { return "agent_gateway_tokens" }

// Setting 通用键值设置（如选定的 guacd 主机 asset id）。
type Setting struct {
	Key   string `gorm:"primaryKey;size:64" json:"key"`
	Value string `json:"value"`
}

func (Setting) TableName() string { return "settings" }

// Backup 一次备份记录（历史）。
type Backup struct {
	ID        string `gorm:"primaryKey;size:36" json:"id"`
	ObjectKey string `json:"objectKey"` // S3 对象键
	Size      int64  `json:"size"`      // 上传字节数
	Status    string `json:"status"`    // success | error
	Message   string `json:"message"`   // 错误信息（失败时）
	CreatedAt int64  `json:"createdAt"`
}

func (Backup) TableName() string { return "backups" }
