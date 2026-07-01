package resource

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/crypto"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// RegisterResourceModules 用通用 CRUD 注册资源管理域的标准模块。
func RegisterResourceModules(admin *echo.Group, s *store.Store, cipher *crypto.Cipher) {
	enc := func(v string) string { e, _ := cipher.Encrypt(v); return e }

	// snippet
	NewCrud[*model.Snippet](s,
		func() *model.Snippet { return &model.Snippet{} },
		func() any { return &[]*model.Snippet{} },
	).WithSearch("name").Register(admin.Group("/snippets"))

	// storage
	NewCrud[*model.Storage](s,
		func() *model.Storage { return &model.Storage{} },
		func() any { return &[]*model.Storage{} },
	).WithSearch("name").Register(admin.Group("/storages"))

	// gateway-group
	NewCrud[*model.GatewayGroup](s,
		func() *model.GatewayGroup { return &model.GatewayGroup{} },
		func() any { return &[]*model.GatewayGroup{} },
	).WithSearch("name").Register(admin.Group("/gateway-groups"))

	// database-asset（加密 password，列表脱敏）
	NewCrud[*model.DatabaseAsset](s,
		func() *model.DatabaseAsset { return &model.DatabaseAsset{} },
		func() any { return &[]*model.DatabaseAsset{} },
	).WithSearch("name").
		WithBeforeSave(func(m *model.DatabaseAsset) {
			if m.Password != "" && m.Password != "******" {
				m.Password = enc(m.Password)
			}
			if m.Status == "" {
				m.Status = "active"
			}
		}).
		WithMask(func(m *model.DatabaseAsset) *model.DatabaseAsset {
			if m.Password != "" {
				m.Password = "******"
			}
			return m
		}).Register(admin.Group("/database-assets"))

	// certificate（加密 privateKey）
	NewCrud[*model.Certificate](s,
		func() *model.Certificate { return &model.Certificate{} },
		func() any { return &[]*model.Certificate{} },
	).WithSearch("common_name").
		WithBeforeSave(func(m *model.Certificate) {
			if m.PrivateKey != "" && m.PrivateKey != "******" {
				m.PrivateKey = enc(m.PrivateKey)
			}
		}).
		WithMask(func(m *model.Certificate) *model.Certificate {
			if m.PrivateKey != "" {
				m.PrivateKey = "******"
			}
			return m
		}).Register(admin.Group("/certificates"))

	// ssh-gateway（加密 password/privateKey/passphrase）
	NewCrud[*model.SshGateway](s,
		func() *model.SshGateway { return &model.SshGateway{} },
		func() any { return &[]*model.SshGateway{} },
	).WithSearch("name").
		WithBeforeSave(func(m *model.SshGateway) {
			if m.Password != "" && m.Password != "******" {
				m.Password = enc(m.Password)
			}
			if m.PrivateKey != "" && m.PrivateKey != "******" {
				m.PrivateKey = enc(m.PrivateKey)
			}
			if m.Passphrase != "" && m.Passphrase != "******" {
				m.Passphrase = enc(m.Passphrase)
			}
		}).
		WithMask(func(m *model.SshGateway) *model.SshGateway {
			if m.Password != "" {
				m.Password = "******"
			}
			if m.PrivateKey != "" {
				m.PrivateKey = "******"
			}
			if m.Passphrase != "" {
				m.Passphrase = "******"
			}
			return m
		}).Register(admin.Group("/ssh-gateways"))

	// agent-gateway（Agent 自注册，按 sort 排序；管理端只读列表 + 删除）
	NewCrud[*model.AgentGateway](s,
		func() *model.AgentGateway { return &model.AgentGateway{} },
		func() any { return &[]*model.AgentGateway{} },
	).WithSearch("name").WithOrder("sort asc, created_at desc").Register(admin.Group("/agent-gateways"))

	// agent-gateway-token（生成令牌交给 Agent 注册用；create 时自动生成 token）
	NewCrud[*model.AgentGatewayToken](s,
		func() *model.AgentGatewayToken { return &model.AgentGatewayToken{} },
		func() any { return &[]*model.AgentGatewayToken{} },
	).WithSearch("name").
		WithBeforeSave(func(m *model.AgentGatewayToken) {
			if m.Token == "" {
				m.Token = uuid.NewString()
			}
		}).Register(admin.Group("/agent-gateway-tokens"))
}
