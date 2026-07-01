package auth

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

// RegisterAccount 挂载需鉴权的 /account/* 端点。
func (h *Handler) RegisterAccount(g *echo.Group) {
	g.GET("/info", h.accountInfo)
}

type menuItem struct {
	Key     string `json:"key"`
	Checked bool   `json:"checked"`
}

// accountInfo 返回当前用户 + 菜单权限树（动态菜单来源）。
// 证据：{id,username,nickname,type,enabledTotp,mfaEnabled,roles[],menus[],language,needChangePassword,forceTotpEnabled}
func (h *Handler) accountInfo(c echo.Context) error {
	u := web.CurrentUser(c)
	if u == nil {
		return web.Fail(c, 401, 401, "Unauthorized")
	}

	// 用户角色
	var userRoles []model.UserRole
	h.store.DB.Where("user_id = ?", u.ID).Find(&userRoles)
	roleIDs := make([]string, 0, len(userRoles))
	for _, ur := range userRoles {
		roleIDs = append(roleIDs, ur.RoleID)
	}

	// 合并角色的菜单勾选（任一角色勾选即可见）
	checked := map[string]bool{}
	if len(roleIDs) > 0 {
		var rms []model.RoleMenu
		h.store.DB.Where("role_id IN ? AND checked = ?", roleIDs, true).Find(&rms)
		for _, rm := range rms {
			checked[rm.MenuKey] = true
		}
	}
	menus := make([]menuItem, 0, len(model.MenuKeys))
	for _, key := range model.MenuKeys {
		menus = append(menus, menuItem{Key: key, Checked: checked[key]})
	}

	return web.OK(c, map[string]any{
		"id":                 u.ID,
		"username":           u.Username,
		"nickname":           u.Nickname,
		"type":               u.Type,
		"enabledTotp":        u.EnabledTotp,
		"mfaEnabled":         u.EnabledTotp,
		"roles":              roleIDs,
		"language":           u.Language,
		"needChangePassword": false,
		"forceTotpEnabled":   false,
		"menus":              menus,
	})
}
