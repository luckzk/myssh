package model

// ConnSession 连接会话（区别于 auth 的令牌 Session）。
// 对应 demo 的 online-session（status=connected）/ offline-session（已结束可回放）。
type ConnSession struct {
	ID             string `gorm:"primaryKey;size:36" json:"id"`
	UserID         string `gorm:"index;size:36" json:"userId"`
	Username       string `json:"username"`
	AssetID        string `gorm:"index;size:36" json:"assetId"`
	AssetName      string `json:"assetName"`
	Protocol       string `json:"protocol"`
	IP             string `json:"ip"`
	Port           int    `json:"port"`
	ClientIP       string `json:"clientIp"`
	Status         string `json:"status"` // connecting | connected | reconnecting | disconnected
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	RecordingPath  string `json:"recordingPath"`
	ConnectedAt    int64  `json:"connectedAt"`
	DisconnectedAt int64  `json:"disconnectedAt"`
	ReconnectUntil int64  `json:"reconnectUntil"`
	CreatedAt      int64  `json:"createdAt"`
}

func (ConnSession) TableName() string { return "connect_sessions" }

// ExecCommandLog SSH/K8s 命令逐条留痕。
type ExecCommandLog struct {
	ID        string `gorm:"primaryKey;size:36" json:"id"`
	SessionID string `gorm:"index;size:36" json:"sessionId"`
	UserID    string `gorm:"index;size:36" json:"userId"`
	AssetID   string `gorm:"index;size:36" json:"assetId"`
	Command   string `json:"command"`
	RiskLevel string `json:"riskLevel"`
	CreatedAt int64  `json:"createdAt"`
}

func (ExecCommandLog) TableName() string { return "exec_command_logs" }

// FileSystemLog 文件传输/操作留痕（upload/download/rm/mkdir/rename/edit/chmod）。
type FileSystemLog struct {
	ID        string `gorm:"primaryKey;size:36" json:"id"`
	SessionID string `gorm:"index;size:36" json:"sessionId"`
	UserID    string `gorm:"index;size:36" json:"userId"`
	AssetID   string `gorm:"index;size:36" json:"assetId"`
	Action    string `json:"action"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	CreatedAt int64  `json:"createdAt"`
}

func (FileSystemLog) TableName() string { return "filesystem_logs" }

// PortForward SSH 端口转发记录。既表示运行状态，也作为审计日志。
type PortForward struct {
	ID         string `gorm:"primaryKey;size:36" json:"id"`
	SessionID  string `gorm:"index;size:36" json:"sessionId"`
	UserID     string `gorm:"index;size:36" json:"userId"`
	Username   string `json:"username"`
	AssetID    string `gorm:"index;size:36" json:"assetId"`
	AssetName  string `json:"assetName"`
	Type       string `json:"type"` // local | remote | dynamic
	ListenHost string `json:"listenHost"`
	ListenPort int    `json:"listenPort"`
	TargetHost string `json:"targetHost"`
	TargetPort int    `json:"targetPort"`
	Status     string `gorm:"index" json:"status"` // starting | running | stopped | failed
	Error      string `json:"error"`
	StartedAt  int64  `json:"startedAt"`
	StoppedAt  int64  `json:"stoppedAt"`
	CreatedAt  int64  `json:"createdAt"`
}

func (PortForward) TableName() string { return "port_forwards" }

// TrustedHostKey SSH 主机密钥信任记录。TOFU 首次连接自动写入 trusted；
// 指纹变化时写 pending，管理员确认后再提升为 trusted。
type TrustedHostKey struct {
	ID                  string `gorm:"primaryKey;size:36" json:"id"`
	Host                string `gorm:"index;size:255" json:"host"`
	Port                int    `gorm:"index" json:"port"`
	KeyType             string `json:"keyType"`
	Fingerprint         string `gorm:"index;size:128" json:"fingerprint"`
	PublicKey           string `json:"publicKey"`
	PreviousFingerprint string `json:"previousFingerprint"`
	Status              string `gorm:"index;size:24" json:"status"` // trusted | pending | revoked
	CreatedBy           string `gorm:"index;size:36" json:"createdBy"`
	CreatedAt           int64  `json:"createdAt"`
	UpdatedAt           int64  `json:"updatedAt"`
	LastSeenAt           int64  `json:"lastSeenAt"`
}

func (TrustedHostKey) TableName() string { return "trusted_host_keys" }
