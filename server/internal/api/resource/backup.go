package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dushixiang/next-terminal-clone/server/internal/backup"
	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/crypto"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

const backupCfgKey = "backup.config"

// BackupHandler 加密备份到 S3 兼容存储。
type BackupHandler struct {
	store      *store.Store
	cipher     *crypto.Cipher
	dbDriver   string
	recordings string
}

func NewBackupHandler(s *store.Store, cfg config.Config, c *crypto.Cipher) *BackupHandler {
	return &BackupHandler{store: s, cipher: c, dbDriver: cfg.DBDriver, recordings: cfg.Recordings}
}

func (h *BackupHandler) Register(g *echo.Group) {
	g.GET("/config", h.getConfig)
	g.PUT("/config", h.saveConfig)
	g.POST("/run", h.run)
	g.GET("/history", h.history)
}

// backupCfg 持久化到 settings 的配置；secretKey/passphrase 加密存。
type backupCfg struct {
	Endpoint   string `json:"endpoint"`
	Region     string `json:"region"`
	Bucket     string `json:"bucket"`
	Prefix     string `json:"prefix"`
	AccessKey  string `json:"accessKey"`
	SecretKey  string `json:"secretKey"`
	UseSSL     bool   `json:"useSSL"`
	Passphrase string `json:"passphrase"`
}

func (h *BackupHandler) load() backupCfg {
	var c backupCfg
	raw := h.store.GetSetting(backupCfgKey)
	if raw == "" {
		return c
	}
	_ = json.Unmarshal([]byte(raw), &c)
	c.SecretKey, _ = h.cipher.Decrypt(c.SecretKey)
	c.Passphrase, _ = h.cipher.Decrypt(c.Passphrase)
	return c
}

// getConfig 返回配置，敏感字段不回明文，仅标记是否已设置。
func (h *BackupHandler) getConfig(c echo.Context) error {
	cfg := h.load()
	return web.OK(c, map[string]any{
		"endpoint": cfg.Endpoint, "region": cfg.Region, "bucket": cfg.Bucket,
		"prefix": cfg.Prefix, "accessKey": cfg.AccessKey, "useSSL": cfg.UseSSL,
		"secretKeySet": cfg.SecretKey != "", "passphraseSet": cfg.Passphrase != "",
	})
}

// saveConfig 保存配置；secretKey/passphrase 留空表示不改（沿用旧值）。
func (h *BackupHandler) saveConfig(c echo.Context) error {
	var in backupCfg
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	old := h.load()
	if strings.TrimSpace(in.SecretKey) == "" {
		in.SecretKey = old.SecretKey
	}
	if strings.TrimSpace(in.Passphrase) == "" {
		in.Passphrase = old.Passphrase
	}
	// 加密敏感字段后落库
	enc := in
	enc.SecretKey, _ = h.cipher.Encrypt(in.SecretKey)
	enc.Passphrase, _ = h.cipher.Encrypt(in.Passphrase)
	b, _ := json.Marshal(enc)
	if err := h.store.SetSetting(backupCfgKey, string(b)); err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"ok": true})
}

// run 立即备份：快照 DB + 录像 → 加密 → 上传。
func (h *BackupHandler) run(c echo.Context) error {
	cfg := h.load()
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return web.Fail(c, 200, 400, "请先完整配置 S3 目标（endpoint/bucket/accessKey/secretKey）")
	}
	if cfg.Passphrase == "" {
		return web.Fail(c, 200, 400, "请先设置备份加密口令")
	}
	if h.dbDriver != "sqlite" {
		return web.Fail(c, 200, 400, "最小版备份仅支持 sqlite（postgres 需 pg_dump，后续支持）")
	}

	// DB 一致性快照（VACUUM INTO 到临时文件）
	snap := filepath.Join(os.TempDir(), "ntbk-"+uuid.NewString()+".db")
	defer os.Remove(snap)
	if err := h.store.DB.Exec("VACUUM INTO ?", snap).Error; err != nil {
		return web.Fail(c, 200, 500, "DB 快照失败: "+err.Error())
	}

	now := time.Now()
	key := strings.TrimSuffix(cfg.Prefix, "/")
	obj := fmt.Sprintf("nt-backup-%s.tar.gz.enc", now.Format("20060102-150405"))
	if key != "" {
		obj = key + "/" + obj
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	size, err := backup.Upload(ctx, backup.Config{
		Endpoint: cfg.Endpoint, Region: cfg.Region, Bucket: cfg.Bucket, Prefix: cfg.Prefix,
		AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey, UseSSL: cfg.UseSSL, Passphrase: cfg.Passphrase,
	}, snap, h.recordings, obj)

	rec := model.Backup{ID: uuid.NewString(), ObjectKey: obj, Size: size, CreatedAt: now.UnixMilli()}
	if err != nil {
		rec.Status, rec.Message = "error", err.Error()
		h.store.DB.Create(&rec)
		return web.Fail(c, 200, 500, "备份失败: "+err.Error())
	}
	rec.Status = "success"
	h.store.DB.Create(&rec)
	return web.OK(c, map[string]any{"ok": true, "objectKey": obj, "size": size})
}

// history 最近备份记录。
func (h *BackupHandler) history(c echo.Context) error {
	var list []model.Backup
	h.store.DB.Order("created_at desc").Limit(50).Find(&list)
	return web.OK(c, list)
}
