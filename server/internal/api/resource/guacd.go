package resource

import (
	"net"
	"strings"
	"time"

	"github.com/dushixiang/next-terminal-clone/server/internal/crypto"
	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/hostkey"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

const guacdSettingKey = "guacd_asset_id"
const guacdPort = "4822"

// 安装并运行 guacd 的固定命令（Docker）。先尝试普通 docker，失败再 sudo。
const guacdRunCmd = `docker rm -f nt-guacd >/dev/null 2>&1; ` +
	`docker run -d --name nt-guacd --restart unless-stopped -p 4822:4822 docker.io/guacamole/guacd:latest 2>&1 || ` +
	`sudo docker rm -f nt-guacd >/dev/null 2>&1; sudo docker run -d --name nt-guacd --restart unless-stopped -p 4822:4822 docker.io/guacamole/guacd:latest 2>&1`

// GuacdHandler 选择/检测/自动安装 guacd 运行主机。
type GuacdHandler struct {
	store  *store.Store
	cipher *crypto.Cipher
	sshOptions gateway.SSHOptions
}

func NewGuacdHandler(s *store.Store, c *crypto.Cipher, sshOptions gateway.SSHOptions) *GuacdHandler {
	return &GuacdHandler{store: s, cipher: c, sshOptions: sshOptions}
}

func (h *GuacdHandler) Register(g *echo.Group) {
	g.GET("/config", h.config)
	g.POST("/select", h.selectHost)
	g.POST("/check", h.check)
	g.POST("/install", h.install)
}

type assetReq struct {
	AssetID string `json:"assetId"`
}

// config 返回当前选定的 guacd 主机资产与生效地址。
func (h *GuacdHandler) config(c echo.Context) error {
	assetID := h.store.GetSetting(guacdSettingKey)
	host := ""
	if assetID != "" {
		var a model.Asset
		if h.store.DB.First(&a, "id = ?", assetID).Error == nil {
			host = a.IP
		}
	}
	effective := ""
	if host != "" {
		effective = host + ":" + guacdPort
	}
	return web.OK(c, map[string]any{
		"assetId":       assetID,
		"host":          host,
		"effectiveAddr": effective,
	})
}

// selectHost 选定某台 SSH 资产作为 guacd 主机。
func (h *GuacdHandler) selectHost(c echo.Context) error {
	a, err := h.loadSSHAsset(c)
	if err != nil {
		return err
	}
	if e := h.store.SetSetting(guacdSettingKey, a.ID); e != nil {
		return web.Fail(c, 200, 500, e.Error())
	}
	return web.OK(c, map[string]any{"assetId": a.ID, "host": a.IP, "effectiveAddr": a.IP + ":" + guacdPort})
}

// check 检测目标 4822 端口是否可达。
func (h *GuacdHandler) check(c echo.Context) error {
	a, err := h.loadSSHAsset(c)
	if err != nil {
		return err
	}
	start := time.Now()
	conn, derr := net.DialTimeout("tcp", net.JoinHostPort(a.IP, guacdPort), 3*time.Second)
	if derr != nil {
		return web.OK(c, map[string]any{"reachable": false, "host": a.IP, "error": derr.Error()})
	}
	_ = conn.Close()
	return web.OK(c, map[string]any{
		"reachable": true, "host": a.IP, "latencyMs": time.Since(start).Milliseconds(),
	})
}

// install 经 SSH 在目标上用 Docker 安装并运行 guacd；含架构/docker 预检。
func (h *GuacdHandler) install(c echo.Context) error {
	a, err := h.loadSSHAsset(c)
	if err != nil {
		return err
	}
	target, terr := h.sshTarget(a)
	if terr != nil {
		return web.Fail(c, 200, 500, "凭证解析失败: "+terr.Error())
	}
	sshOptions := h.sshOptionsForUser(web.CurrentUser(c).ID)

	// 预检：架构 + docker 是否可用
	arch, _ := gateway.RunSSHCommand(*target, "uname -m", sshOptions)
	arch = strings.TrimSpace(arch)
	dockerVer, dverr := gateway.RunSSHCommand(*target, "docker version --format '{{.Server.Version}}' 2>/dev/null || sudo docker version --format '{{.Server.Version}}' 2>/dev/null", sshOptions)
	dockerOK := dverr == nil && strings.TrimSpace(dockerVer) != ""

	resp := map[string]any{"arch": arch, "dockerOK": dockerOK}
	// guacd 官方镜像仅 amd64
	if arch != "" && arch != "x86_64" && arch != "amd64" {
		resp["archWarning"] = "目标架构为 " + arch + "，guacd 官方镜像仅 amd64，可能无法运行（需 qemu 模拟或 amd64 主机）"
	}
	if !dockerOK {
		resp["ok"] = false
		resp["output"] = strings.TrimSpace(dockerVer)
		resp["message"] = "目标未检测到可用的 Docker（docker version 失败）"
		return web.OK(c, resp)
	}

	out, runErr := gateway.RunSSHCommand(*target, guacdRunCmd, sshOptions)
	resp["output"] = strings.TrimSpace(out)
	resp["ok"] = runErr == nil
	if runErr != nil {
		resp["message"] = "安装命令执行失败: " + runErr.Error()
	} else {
		resp["message"] = "guacd 容器已启动（nt-guacd），建议随后检测 4822 端口"
	}
	return web.OK(c, resp)
}

// loadSSHAsset 取 assetId 对应资产，要求为 SSH 协议（guacd 经 SSH 安装/运行）。
func (h *GuacdHandler) loadSSHAsset(c echo.Context) (*model.Asset, error) {
	var req assetReq
	if err := c.Bind(&req); err != nil {
		return nil, web.Fail(c, 200, 400, "请求参数错误")
	}
	if req.AssetID == "" {
		return nil, web.Fail(c, 200, 400, "缺少 assetId")
	}
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", req.AssetID).Error; err != nil {
		return nil, web.Fail(c, 200, 404, "资产不存在")
	}
	if a.Protocol != "ssh" {
		return nil, web.Fail(c, 200, 400, "guacd 主机需为 SSH 协议资产")
	}
	return &a, nil
}

// sshTarget 把资产解析为可拨号的 SSH 目标（内联或引用凭证，解密）。
func (h *GuacdHandler) sshTarget(a *model.Asset) (*gateway.SSHTarget, error) {
	dec := func(s string) string { v, _ := h.cipher.Decrypt(s); return v }
	t := &gateway.SSHTarget{Host: a.IP, Port: a.Port, User: a.Username}
	if a.AccountType == "credential" && a.CredentialID != "" {
		var cred model.Credential
		if err := h.store.DB.First(&cred, "id = ?", a.CredentialID).Error; err != nil {
			return nil, err
		}
		t.User = cred.Username
		t.Password = dec(cred.Password)
		t.PrivateKey = dec(cred.PrivateKey)
		t.Passphrase = dec(cred.Passphrase)
	} else {
		t.Password = dec(a.Password)
		t.PrivateKey = dec(a.PrivateKey)
		t.Passphrase = dec(a.Passphrase)
	}
	return t, nil
}

func (h *GuacdHandler) sshOptionsForUser(userID string) gateway.SSHOptions {
	opts := h.sshOptions
	if opts.HostKeyPolicy == "tofu" || opts.HostKeyPolicy == "" {
		cb, err := hostkey.Callback(h.store, opts.HostKeyPolicy, userID)
		if err == nil {
			opts.HostKeyCallback = cb
		}
	}
	return opts
}
