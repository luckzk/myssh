package access

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// RegisterFilesystem 挂载 /api/access/filesystem/*（对齐上游 filesystem-api.ts）。
func (h *Handler) RegisterFilesystem(g *echo.Group) {
	g.GET("/:sid/ls", h.fsLs)
	g.POST("/:sid/rm", h.fsRm)
	g.POST("/:sid/mkdir", h.fsMkdir)
	g.POST("/:sid/touch", h.fsTouch)
	g.POST("/:sid/rename", h.fsRename)
	g.POST("/:sid/upload", h.fsUpload)
	g.GET("/:sid/download", h.fsDownload)
	g.GET("/:sid/preview", h.fsPreview)
	g.GET("/:sid/read", h.fsRead)
	g.POST("/:sid/write", h.fsWrite)
	g.GET("/:sid/stat", h.fsStat)
	g.POST("/:sid/chmod", h.fsChmod)
}

type fsWriteReq struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

func (h *Handler) fsRead(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	name := c.QueryParam("filename")
	f, err := conn.Sftp.Open(name)
	if err != nil {
		return web.Fail(c, 200, 404, err.Error())
	}
	defer f.Close()
	if fi, e := f.Stat(); e == nil && fi.Size() > 2*1024*1024 {
		return web.Fail(c, 200, 400, "编辑文件不能超过 2MB")
	}
	data, err := io.ReadAll(io.LimitReader(f, 2*1024*1024+1))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	if len(data) > 2*1024*1024 {
		return web.Fail(c, 200, 400, "编辑文件不能超过 2MB")
	}
	h.auditFS(sess, "read", name, int64(len(data)))
	return web.OK(c, map[string]any{"filename": name, "content": string(data), "size": len(data)})
}

func (h *Handler) fsWrite(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	var req fsWriteReq
	if err := c.Bind(&req); err != nil || req.Filename == "" {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	if len(req.Content) > 2*1024*1024 {
		return web.Fail(c, 200, 400, "编辑文件不能超过 2MB")
	}
	f, err := conn.Sftp.Create(req.Filename)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	n64, werr := io.Copy(f, strings.NewReader(req.Content))
	cerr := f.Close()
	if werr != nil {
		return web.Fail(c, 200, 500, werr.Error())
	}
	if cerr != nil {
		return web.Fail(c, 200, 500, cerr.Error())
	}
	h.auditFS(sess, "edit", req.Filename, n64)
	return web.OK(c, map[string]any{"status": "ok", "size": n64})
}

func (h *Handler) fsPreview(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	name := c.QueryParam("filename")
	f, err := conn.Sftp.Open(name)
	if err != nil {
		return web.Fail(c, 200, 404, err.Error())
	}
	defer f.Close()
	var size int64
	if fi, e := f.Stat(); e == nil {
		size = fi.Size()
		if size > 2*1024*1024 {
			return web.Fail(c, 200, 400, "预览文件不能超过 2MB")
		}
		c.Response().Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	ct := mime.TypeByExtension(path.Ext(name))
	if ct == "" {
		ct = "text/plain; charset=utf-8"
	}
	h.auditFS(sess, "preview", name, size)
	return c.Stream(http.StatusOK, ct, f)
}

// fileInfo 对齐上游 FileInfo。
type fileInfo struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
	Path    string `json:"path"`
	Mode    string `json:"mode"`
	IsDir   bool   `json:"isDir"`
	IsLink  bool   `json:"isLink"`
}

// connForSession 取/建该会话的 SFTP 连接（按会话资产解密凭证）。
func (h *Handler) connForSession(sid string) (*gateway.SFTPConn, *model.ConnSession, error) {
	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ?", sid).Error; err != nil {
		return nil, nil, fmt.Errorf("会话不存在")
	}
	// 优先复用该会话终端已建立的 SSH 连接，在其上开 SFTP 子系统，免二次拨号（首开更快）。
	if live := h.getLive(sid); live != nil {
		if p, ok := live.conn.(gateway.SSHClientProvider); ok {
			if client := p.SSHClient(); client != nil {
				if conn, err := h.sftp.GetOnClient(sid, client); err == nil {
					return conn, &sess, nil
				}
				// 复用失败则退回新建
			}
		}
	}
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", sess.AssetID).Error; err != nil {
		return nil, nil, fmt.Errorf("资产不存在")
	}
	target, err := h.resolveTarget(&a)
	if err != nil {
		return nil, nil, err
	}
	conn, err := h.sftp.Get(sid, *target, h.sshOptionsForUser(sess.UserID))
	return conn, &sess, err
}

func (h *Handler) auditFS(sess *model.ConnSession, action, p string, size int64) {
	h.store.DB.Create(&model.FileSystemLog{
		ID: uuid.NewString(), SessionID: sess.ID, UserID: sess.UserID,
		AssetID: sess.AssetID, Action: action, Path: p, Size: size,
		CreatedAt: model.NowMillis(),
	})
}

func (h *Handler) fsLs(c echo.Context) error {
	conn, _, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	dir := c.QueryParam("dir")
	if dir == "" {
		dir = "."
	}
	showHidden := c.QueryParam("hiddenFileVisible") == "true"
	entries, err := conn.Sftp.ReadDir(dir)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	items := make([]fileInfo, 0, len(entries))
	for _, e := range entries {
		if !showHidden && len(e.Name()) > 0 && e.Name()[0] == '.' {
			continue
		}
		items = append(items, fileInfo{
			Name: e.Name(), Size: e.Size(), ModTime: e.ModTime().UnixMilli(),
			Path: path.Join(dir, e.Name()), Mode: e.Mode().String(),
			IsDir: e.IsDir(), IsLink: e.Mode()&os.ModeSymlink != 0,
		})
	}
	return web.OK(c, items)
}

func (h *Handler) fsRm(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	name := c.QueryParam("filename")
	// 目录用 RemoveDirectory，文件用 Remove
	if fi, e := conn.Sftp.Stat(name); e == nil && fi.IsDir() {
		err = conn.Sftp.RemoveDirectory(name)
	} else {
		err = conn.Sftp.Remove(name)
	}
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	h.auditFS(sess, "rm", name, 0)
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *Handler) fsMkdir(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	dir := c.QueryParam("dir")
	if err := conn.Sftp.MkdirAll(dir); err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	h.auditFS(sess, "mkdir", dir, 0)
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *Handler) fsTouch(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	name := c.QueryParam("filename")
	f, err := conn.Sftp.Create(name)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	_ = f.Close()
	h.auditFS(sess, "touch", name, 0)
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *Handler) fsRename(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	oldName, newName := c.QueryParam("oldName"), c.QueryParam("newName")
	if err := conn.Sftp.Rename(oldName, newName); err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	h.auditFS(sess, "rename", oldName+" -> "+newName, 0)
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *Handler) fsUpload(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	dir := c.QueryParam("dir")
	if dir == "" {
		dir = "."
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return web.Fail(c, 200, 400, "缺少上传文件")
	}
	src, err := fh.Open()
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	defer src.Close()
	remote := path.Join(dir, fh.Filename)
	dst, err := conn.Sftp.Create(remote)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	defer dst.Close()
	n, err := io.Copy(dst, src)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	h.auditFS(sess, "upload", remote, n)
	return web.OK(c, map[string]any{"status": "ok", "size": n})
}

func (h *Handler) fsDownload(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	name := c.QueryParam("filename")
	f, err := conn.Sftp.Open(name)
	if err != nil {
		return web.Fail(c, 200, 404, err.Error())
	}
	defer f.Close()
	var size int64
	if fi, e := f.Stat(); e == nil {
		size = fi.Size()
		c.Response().Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+path.Base(name)+"\"")
	h.auditFS(sess, "download", name, size)
	return c.Stream(http.StatusOK, "application/octet-stream", f)
}
