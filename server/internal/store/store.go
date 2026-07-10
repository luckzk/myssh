package store

import (
	"errors"
	"log/slog"

	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Store struct {
	DB *gorm.DB
}

// Open 打开数据库、迁移表结构、注入种子数据。MVP 默认 sqlite。
func Open(cfg config.Config) (*Store, error) {
	var dialector gorm.Dialector
	switch cfg.DBDriver {
	case "sqlite":
		dialector = sqlite.Open(cfg.DBDSN)
	default:
		return nil, errors.New("unsupported db driver: " + cfg.DBDriver)
	}
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
	if err != nil {
		return nil, err
	}
	s := &Store{DB: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	if err := s.seed(cfg); err != nil {
		return nil, err
	}
	// 自愈：进程重启后，残留的连接/重连会话不可能仍在桥接 → 标记为 disconnected。
	s.DB.Model(&model.ConnSession{}).Where("status IN ?", []string{"connecting", "connected", "reconnecting"}).Updates(map[string]any{
		"status": "disconnected", "disconnected_at": model.NowMillis(),
	})
	// 自愈：运行中的端口转发随进程退出而消失。
	s.DB.Model(&model.PortForward{}).Where("status IN ?", []string{"starting", "running"}).Updates(map[string]any{
		"status": "stopped", "stopped_at": model.NowMillis(), "error": "server restarted",
	})
	// 自愈：清理指向已删除分组的资产（group_id 悬空 → 置空，避免「分组」列空白且无法解析）。
	s.DB.Exec("UPDATE assets SET group_id = '' WHERE group_id <> '' AND group_id NOT IN (SELECT id FROM asset_groups)")
	return s, nil
}

func (s *Store) migrate() error {
	return s.DB.AutoMigrate(
		&model.User{}, &model.Role{}, &model.RoleMenu{}, &model.UserRole{},
		&model.Authorization{}, &model.CommandFilter{},
		&model.Session{}, &model.LoginLog{},
		&model.Credential{}, &model.Asset{}, &model.AssetGroup{},
		&model.ConnSession{}, &model.ExecCommandLog{}, &model.FileSystemLog{},
		&model.PortForward{}, &model.TrustedHostKey{},
		&model.Snippet{}, &model.Storage{}, &model.DatabaseAsset{},
		&model.Certificate{}, &model.GatewayGroup{}, &model.SshGateway{},
		&model.AgentGateway{}, &model.AgentGatewayToken{},
		&model.Setting{},
	)
}

// seed 注入默认角色 system-administrator（全菜单勾选）与初始管理员。
func (s *Store) seed(cfg config.Config) error {
	const roleID = "system-administrator"
	var roleCount int64
	s.DB.Model(&model.Role{}).Where("id = ?", roleID).Count(&roleCount)
	if roleCount == 0 {
		role := model.Role{ID: roleID, Name: "admin", Type: "default", CreatedAt: model.NowMillis()}
		if err := s.DB.Create(&role).Error; err != nil {
			return err
		}
		for _, key := range model.MenuKeys {
			if err := s.DB.Create(&model.RoleMenu{RoleID: roleID, MenuKey: key, Checked: true}).Error; err != nil {
				return err
			}
		}
		slog.Info("seeded role", "id", roleID, "menus", len(model.MenuKeys))
	}

	// 默认普通用户角色：仅基础菜单（浏览+连接授权资产），新建 type=user 用户自动归入。
	const userRoleID = "user"
	var userRoleCount int64
	s.DB.Model(&model.Role{}).Where("id = ?", userRoleID).Count(&userRoleCount)
	if userRoleCount == 0 {
		role := model.Role{ID: userRoleID, Name: "普通用户", Type: "default", CreatedAt: model.NowMillis()}
		if err := s.DB.Create(&role).Error; err != nil {
			return err
		}
		for _, key := range []string{"dashboard", "resource", "asset", "log-audit", "online-session"} {
			if err := s.DB.Create(&model.RoleMenu{RoleID: userRoleID, MenuKey: key, Checked: true}).Error; err != nil {
				return err
			}
		}
		slog.Info("seeded default user role", "id", userRoleID)
	}

	// 命令过滤示例规则：首次注入，默认关闭，管理员按需开启（避免意外阻断）。
	var cfCount int64
	s.DB.Model(&model.CommandFilter{}).Count(&cfCount)
	if cfCount == 0 {
		examples := []model.CommandFilter{
			{Name: "禁止 rm -rf 根目录", Action: "block", Pattern: `rm\s+-rf?\s+/(\s|$)`, Regex: true, Priority: 10},
			{Name: "禁止关机/重启", Action: "block", Pattern: `shutdown|reboot|halt|poweroff`, Regex: true, Priority: 20},
			{Name: "禁止磁盘格式化/覆写", Action: "block", Pattern: `mkfs|dd\s+if=.*of=/dev`, Regex: true, Priority: 30},
			{Name: "sudo 告警", Action: "warn", Pattern: "sudo", Regex: false, Priority: 100},
		}
		for _, e := range examples {
			e.ID = uuid.NewString()
			e.Enabled = false
			e.CreatedAt = model.NowMillis()
			s.DB.Create(&e)
		}
		slog.Info("seeded example command filters (disabled)", "count", len(examples))
	}

	user, pass := parseCreds(cfg.SeedAdmin)
	var userCount int64
	s.DB.Model(&model.User{}).Where("username = ?", user).Count(&userCount)
	if userCount == 0 {
		hash, _ := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
		u := model.User{
			ID: uuid.NewString(), Username: user, Nickname: "管理员",
			Password: string(hash), Type: "admin", Source: "local",
			Recording: "enabled", Watermark: "enabled", CreatedAt: model.NowMillis(),
		}
		if err := s.DB.Create(&u).Error; err != nil {
			return err
		}
		if err := s.DB.Create(&model.UserRole{UserID: u.ID, RoleID: roleID}).Error; err != nil {
			return err
		}
		slog.Info("seeded admin user", "username", user)
	}
	return nil
}

// GetSetting 读取键值设置；不存在返回空串。
func (s *Store) GetSetting(key string) string {
	var st model.Setting
	if err := s.DB.First(&st, "key = ?", key).Error; err != nil {
		return ""
	}
	return st.Value
}

// SetSetting 写入键值设置（upsert）。
func (s *Store) SetSetting(key, value string) error {
	return s.DB.Save(&model.Setting{Key: key, Value: value}).Error
}

func parseCreds(s string) (string, string) {
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			return s[:i], s[i+1:]
		}
	}
	return s, ""
}
