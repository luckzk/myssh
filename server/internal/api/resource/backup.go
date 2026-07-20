package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
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
	"github.com/robfig/cron/v3"
)

const maskedSecret = "******"

// BackupHandler 备份：目标（资源）+ 任务（内容/时间/目标）+ 历史/恢复 + 定时调度。
type BackupHandler struct {
	store      *store.Store
	cipher     *crypto.Cipher
	dbDriver   string
	dbDSN      string
	recordings string
	cron       *cron.Cron
}

func NewBackupHandler(s *store.Store, cfg config.Config, c *crypto.Cipher) *BackupHandler {
	h := &BackupHandler{store: s, cipher: c, dbDriver: cfg.DBDriver, dbDSN: cfg.DBDSN, recordings: cfg.Recordings, cron: cron.New()}
	h.migrateLegacyConfig()
	h.cron.Start()
	h.reloadSchedule()
	return h
}

// Register 挂载三组路由：/backup（历史+恢复）、/backup-destinations、/backup-jobs。
func (h *BackupHandler) Register(admin *echo.Group) {
	b := admin.Group("/backup")
	b.GET("/history", h.history)
	b.POST("/restore", h.restore)

	d := admin.Group("/backup-destinations")
	d.GET("", h.destList)
	d.GET("/:id", h.destGet)
	d.POST("", h.destCreate)
	d.PUT("/:id", h.destUpdate)
	d.DELETE("/:id", h.destDelete)
	d.POST("/:id/test", h.destTest)
	d.GET("/:id/objects", h.destObjects)

	j := admin.Group("/backup-jobs")
	j.GET("", h.jobList)
	j.GET("/:id", h.jobGet)
	j.POST("", h.jobCreate)
	j.PUT("/:id", h.jobUpdate)
	j.DELETE("/:id", h.jobDelete)
	j.POST("/:id/run", h.jobRun)
}

// ---- 备份目标 CRUD ----

func (h *BackupHandler) maskDest(d *model.BackupDestination) *model.BackupDestination {
	if d.SecretKey != "" {
		d.SecretKey = maskedSecret
	}
	if d.Passphrase != "" {
		d.Passphrase = maskedSecret
	}
	return d
}

// toBackupDest 解密目标为 backup 包可用的配置。
func (h *BackupHandler) toBackupDest(d *model.BackupDestination) backup.Destination {
	sk, _ := h.cipher.Decrypt(d.SecretKey)
	return backup.Destination{
		Type: d.Type, Endpoint: d.Endpoint, Region: d.Region, Bucket: d.Bucket,
		Prefix: d.Prefix, AccessKey: d.AccessKey, SecretKey: sk, UseSSL: d.UseSSL, LocalPath: d.LocalPath,
	}
}

func (h *BackupHandler) destPassphrase(d *model.BackupDestination) string {
	p, _ := h.cipher.Decrypt(d.Passphrase)
	return p
}

func (h *BackupHandler) destList(c echo.Context) error {
	var list []*model.BackupDestination
	h.store.DB.Order("created_at desc").Find(&list)
	for _, d := range list {
		h.maskDest(d)
	}
	return web.OK(c, list)
}

func (h *BackupHandler) destGet(c echo.Context) error {
	var d model.BackupDestination
	if err := h.store.DB.First(&d, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	return web.OK(c, h.maskDest(&d))
}

func (h *BackupHandler) destCreate(c echo.Context) error {
	var in model.BackupDestination
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if strings.TrimSpace(in.Name) == "" {
		return web.Fail(c, 200, 400, "请填写名称")
	}
	if msg := validateDest(&in); msg != "" {
		return web.Fail(c, 200, 400, msg)
	}
	in.ID = uuid.NewString()
	in.CreatedAt = model.NowMillis()
	in.UpdatedAt = in.CreatedAt
	if u := web.CurrentUser(c); u != nil {
		in.CreatedBy = u.ID
	}
	in.SecretKey = h.encIfSet(in.SecretKey)
	in.Passphrase = h.encIfSet(in.Passphrase)
	h.clearOtherDefault(&in)
	if err := h.store.DB.Create(&in).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": in.ID})
}

func (h *BackupHandler) destUpdate(c echo.Context) error {
	var old model.BackupDestination
	if err := h.store.DB.First(&old, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	var in model.BackupDestination
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if msg := validateDest(&in); msg != "" {
		return web.Fail(c, 200, 400, msg)
	}
	in.ID = old.ID
	in.CreatedAt = old.CreatedAt
	in.CreatedBy = old.CreatedBy
	in.UpdatedAt = model.NowMillis()
	// 密钥/口令：留空或 ****** 时保留旧密文，否则加密新值
	in.SecretKey = h.keepOrEnc(in.SecretKey, old.SecretKey)
	in.Passphrase = h.keepOrEnc(in.Passphrase, old.Passphrase)
	h.clearOtherDefault(&in)
	if err := h.store.DB.Save(&in).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": in.ID})
}

func (h *BackupHandler) destDelete(c echo.Context) error {
	id := c.Param("id")
	var cnt int64
	h.store.DB.Model(&model.BackupJob{}).Where("destination_id = ?", id).Count(&cnt)
	if cnt > 0 {
		return web.Fail(c, 200, 400, fmt.Sprintf("该目标被 %d 个任务引用，请先解除", cnt))
	}
	h.store.DB.Delete(&model.BackupDestination{}, "id = ?", id)
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *BackupHandler) destTest(c echo.Context) error {
	var d model.BackupDestination
	if err := h.store.DB.First(&d, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	be, err := backup.NewBackend(h.toBackupDest(&d))
	if err != nil {
		return web.Fail(c, 200, 400, err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := be.Test(ctx); err != nil {
		return web.Fail(c, 200, 500, "连接失败: "+err.Error())
	}
	return web.OK(c, map[string]any{"ok": true})
}

func (h *BackupHandler) destObjects(c echo.Context) error {
	var d model.BackupDestination
	if err := h.store.DB.First(&d, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	be, err := backup.NewBackend(h.toBackupDest(&d))
	if err != nil {
		return web.Fail(c, 200, 400, err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	list, err := be.List(ctx)
	if err != nil {
		return web.Fail(c, 200, 500, "列举失败: "+err.Error())
	}
	if list == nil {
		list = []backup.ObjInfo{}
	}
	return web.OK(c, list)
}

// ---- 备份任务 CRUD ----

func (h *BackupHandler) jobList(c echo.Context) error {
	var list []*model.BackupJob
	h.store.DB.Order("created_at desc").Find(&list)
	return web.OK(c, list)
}

func (h *BackupHandler) jobGet(c echo.Context) error {
	var j model.BackupJob
	if err := h.store.DB.First(&j, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	return web.OK(c, j)
}

func (h *BackupHandler) validateJob(j *model.BackupJob) string {
	if strings.TrimSpace(j.Name) == "" {
		return "请填写任务名称"
	}
	if strings.TrimSpace(j.DestinationID) == "" {
		return "请选择备份目标"
	}
	var cnt int64
	h.store.DB.Model(&model.BackupDestination{}).Where("id = ?", j.DestinationID).Count(&cnt)
	if cnt == 0 {
		return "所选备份目标不存在"
	}
	inc := parseContents(j.Contents)
	if len(inc) == 0 {
		return "请至少选择一项备份内容"
	}
	if j.Enabled {
		if strings.TrimSpace(j.Cron) == "" {
			return "启用定时需填写 cron 表达式"
		}
		if _, err := cron.ParseStandard(j.Cron); err != nil {
			return "cron 表达式无效（5 段：分 时 日 月 周）"
		}
	}
	return ""
}

func (h *BackupHandler) jobCreate(c echo.Context) error {
	var in model.BackupJob
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if msg := h.validateJob(&in); msg != "" {
		return web.Fail(c, 200, 400, msg)
	}
	in.ID = uuid.NewString()
	in.CreatedAt = model.NowMillis()
	in.UpdatedAt = in.CreatedAt
	if u := web.CurrentUser(c); u != nil {
		in.CreatedBy = u.ID
	}
	if err := h.store.DB.Create(&in).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	h.reloadSchedule()
	return web.OK(c, map[string]any{"id": in.ID})
}

func (h *BackupHandler) jobUpdate(c echo.Context) error {
	var old model.BackupJob
	if err := h.store.DB.First(&old, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	var in model.BackupJob
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "参数错误")
	}
	if msg := h.validateJob(&in); msg != "" {
		return web.Fail(c, 200, 400, msg)
	}
	in.ID = old.ID
	in.CreatedAt = old.CreatedAt
	in.CreatedBy = old.CreatedBy
	in.LastRunAt = old.LastRunAt
	in.LastStatus = old.LastStatus
	in.LastMessage = old.LastMessage
	in.UpdatedAt = model.NowMillis()
	if err := h.store.DB.Save(&in).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	h.reloadSchedule()
	return web.OK(c, map[string]any{"id": in.ID})
}

func (h *BackupHandler) jobDelete(c echo.Context) error {
	h.store.DB.Delete(&model.BackupJob{}, "id = ?", c.Param("id"))
	h.reloadSchedule()
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *BackupHandler) jobRun(c echo.Context) error {
	var j model.BackupJob
	if err := h.store.DB.First(&j, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	rec, err := h.doJob(context.Background(), &j)
	if err != nil {
		return web.Fail(c, 200, 500, "备份失败: "+err.Error())
	}
	return web.OK(c, map[string]any{"ok": true, "objectKey": rec.ObjectKey, "size": rec.Size})
}

// ---- 执行 / 恢复 / 历史 ----

// doJob 执行一次备份：载目标→解密→快照 DB→打包加密上传→记历史+回填任务状态。
func (h *BackupHandler) doJob(ctx context.Context, j *model.BackupJob) (*model.Backup, error) {
	if h.dbDriver != "sqlite" {
		return nil, fmt.Errorf("最小版备份仅支持 sqlite")
	}
	var d model.BackupDestination
	if err := h.store.DB.First(&d, "id = ?", j.DestinationID).Error; err != nil {
		return nil, fmt.Errorf("备份目标不存在")
	}
	pass := h.destPassphrase(&d)
	if pass == "" {
		return nil, fmt.Errorf("目标未设置加密口令")
	}
	be, err := backup.NewBackend(h.toBackupDest(&d))
	if err != nil {
		return nil, err
	}
	inc := parseContents(j.Contents)
	includeDB, includeRec := inc["db"], inc["recordings"]

	var snap string
	if includeDB {
		snap = filepath.Join(os.TempDir(), "ntbk-"+uuid.NewString()+".db")
		defer os.Remove(snap)
		if err := h.store.DB.Exec("VACUUM INTO ?", snap).Error; err != nil {
			return nil, fmt.Errorf("DB 快照失败: %w", err)
		}
	}
	now := time.Now()
	filename := fmt.Sprintf("nt-backup-%s-%s.tar.gz.enc", safeName(j.Name), now.Format("20060102-150405"))
	key := backup.BuildKey(h.toBackupDest(&d), filename)

	cctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	size, err := backup.RunBackup(cctx, be, pass, snap, h.recordings, includeDB, includeRec, key)

	rec := &model.Backup{ID: uuid.NewString(), JobID: j.ID, DestinationID: d.ID, ObjectKey: key, Size: size, CreatedAt: now.UnixMilli()}
	if err != nil {
		rec.Status, rec.Message = "error", err.Error()
	} else {
		rec.Status = "success"
	}
	h.store.DB.Create(rec)
	// 回填任务状态
	h.store.DB.Model(&model.BackupJob{}).Where("id = ?", j.ID).Updates(map[string]any{
		"last_run_at": now.UnixMilli(), "last_status": rec.Status, "last_message": rec.Message,
	})
	if err != nil {
		return rec, err
	}
	return rec, nil
}

func (h *BackupHandler) history(c echo.Context) error {
	q := h.store.DB.Order("created_at desc").Limit(100)
	if jobID := c.QueryParam("jobId"); jobID != "" {
		q = q.Where("job_id = ?", jobID)
	}
	var list []model.Backup
	q.Find(&list)
	return web.OK(c, list)
}

// restore 下载+解密+解包到暂存位置，重启后由 store.Open 交换生效。
func (h *BackupHandler) restore(c echo.Context) error {
	var req struct {
		DestinationID string `json:"destinationId"`
		ObjectKey     string `json:"objectKey"`
		Passphrase    string `json:"passphrase"`
	}
	if err := c.Bind(&req); err != nil || req.ObjectKey == "" || req.DestinationID == "" {
		return web.Fail(c, 200, 400, "缺少目标或对象键")
	}
	if h.dbDriver != "sqlite" {
		return web.Fail(c, 200, 400, "最小版恢复仅支持 sqlite")
	}
	var d model.BackupDestination
	if err := h.store.DB.First(&d, "id = ?", req.DestinationID).Error; err != nil {
		return web.NotFound(c)
	}
	pass := h.destPassphrase(&d)
	if strings.TrimSpace(req.Passphrase) != "" {
		pass = req.Passphrase // 允许用不同口令恢复（跨实例的备份）
	}
	if pass == "" {
		return web.Fail(c, 200, 400, "缺少备份加密口令")
	}
	be, err := backup.NewBackend(h.toBackupDest(&d))
	if err != nil {
		return web.Fail(c, 200, 400, err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	if err := backup.Restore(ctx, be, pass, req.ObjectKey, h.dbDSN+".restore", h.recordings+".restore"); err != nil {
		os.Remove(h.dbDSN + ".restore")
		os.RemoveAll(h.recordings + ".restore")
		return web.Fail(c, 200, 500, "恢复失败: "+err.Error())
	}
	return web.OK(c, map[string]any{"ok": true, "message": "恢复文件已就绪，重启服务端后生效（现有数据将备份为 .pre-restore-*）"})
}

// ---- 调度 ----

func (h *BackupHandler) reloadSchedule() {
	for _, e := range h.cron.Entries() {
		h.cron.Remove(e.ID)
	}
	var jobs []model.BackupJob
	h.store.DB.Where("enabled = ?", true).Find(&jobs)
	n := 0
	for i := range jobs {
		j := jobs[i]
		if strings.TrimSpace(j.Cron) == "" {
			continue
		}
		if _, err := h.cron.AddFunc(j.Cron, func() {
			if _, err := h.doJob(context.Background(), &j); err != nil {
				slog.Warn("scheduled backup failed", "job", j.Name, "err", err)
			} else {
				slog.Info("scheduled backup ok", "job", j.Name)
			}
		}); err != nil {
			slog.Warn("invalid backup cron", "job", j.Name, "expr", j.Cron, "err", err)
		} else {
			n++
		}
	}
	if n > 0 {
		slog.Info("backup schedule loaded", "jobs", n)
	}
}

// ---- 旧配置一次性迁移 ----

// migrateLegacyConfig 若存在旧的单一配置且尚无任何目标，则据其建一个默认 S3 目标。
func (h *BackupHandler) migrateLegacyConfig() {
	var cnt int64
	h.store.DB.Model(&model.BackupDestination{}).Count(&cnt)
	if cnt > 0 {
		return
	}
	raw := h.store.GetSetting("backup.config")
	if raw == "" {
		return
	}
	var old struct {
		Endpoint, Region, Bucket, Prefix, AccessKey, SecretKey, Passphrase string
		UseSSL                                                             bool
	}
	if err := json.Unmarshal([]byte(raw), &old); err != nil || old.Endpoint == "" {
		return
	}
	d := model.BackupDestination{
		BaseResource: model.BaseResource{ID: uuid.NewString(), CreatedAt: model.NowMillis()},
		Name:         "默认目标（迁移）", Type: "s3",
		Endpoint: old.Endpoint, Region: old.Region, Bucket: old.Bucket, Prefix: old.Prefix,
		AccessKey: old.AccessKey, SecretKey: old.SecretKey, UseSSL: old.UseSSL,
		Passphrase: old.Passphrase, IsDefault: true, UpdatedAt: model.NowMillis(),
	}
	// 旧值已是密文（同一 cipher 加密存的），直接落库
	if err := h.store.DB.Create(&d).Error; err == nil {
		slog.Info("migrated legacy backup.config into a default destination", "id", d.ID)
	}
}

// ---- 工具 ----

func (h *BackupHandler) encIfSet(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	e, _ := h.cipher.Encrypt(v)
	return e
}

func (h *BackupHandler) keepOrEnc(in, old string) string {
	if strings.TrimSpace(in) == "" || in == maskedSecret {
		return old
	}
	e, _ := h.cipher.Encrypt(in)
	return e
}

func (h *BackupHandler) clearOtherDefault(d *model.BackupDestination) {
	if d.IsDefault {
		h.store.DB.Model(&model.BackupDestination{}).Where("id <> ?", d.ID).Update("is_default", false)
	}
}

func validateDest(d *model.BackupDestination) string {
	switch d.Type {
	case "local":
		if strings.TrimSpace(d.LocalPath) == "" {
			return "本地目标需填写存储路径"
		}
	case "s3", "":
		d.Type = "s3"
		if strings.TrimSpace(d.Endpoint) == "" || strings.TrimSpace(d.Bucket) == "" {
			return "S3 目标需填写 Endpoint 与 Bucket"
		}
	default:
		return "未知目标类型"
	}
	return ""
}

// parseContents 把 CSV（db,recordings）解析为集合。
func parseContents(csv string) map[string]bool {
	out := map[string]bool{}
	for _, p := range strings.Split(csv, ",") {
		p = strings.TrimSpace(p)
		if p == "db" || p == "recordings" {
			out[p] = true
		}
	}
	return out
}

// safeName 把任务名压成对象键安全片段。
func safeName(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "job"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}
