// Package identity 用户与授权策略的管理端接口（/api/admin/users、/api/admin/authorizations）。
package identity

import (
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

const defaultUserRoleID = "user"

type UserHandler struct {
	store *store.Store
}

func NewUserHandler(s *store.Store) *UserHandler { return &UserHandler{store: s} }

// Register 挂载 /admin/users。
func (h *UserHandler) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.GET("", h.list)
	g.POST("", h.create)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.remove)
}

func (h *UserHandler) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(&model.User{})
	if kw := strings.TrimSpace(c.QueryParam("keyword")); kw != "" {
		like := "%" + kw + "%"
		q = q.Where("username LIKE ? OR nickname LIKE ?", like, like)
	}
	q = q.Order("created_at desc")
	var items []model.User
	res, err := web.Paginate(q, p, &items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	res["items"] = items // Password/TotpSecret 已 json:"-"，不外泄
	return web.OK(c, res)
}

// list 精简用户列表（供授权页选人）。
func (h *UserHandler) list(c echo.Context) error {
	var items []model.User
	h.store.DB.Order("created_at desc").Find(&items)
	return web.OK(c, items)
}

type userIn struct {
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Type     string `json:"type"`   // admin | user
	Status   string `json:"status"` // "" 正常 | disabled
	Mail     string `json:"mail"`
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

func (h *UserHandler) create(c echo.Context) error {
	var in userIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	in.Username = strings.TrimSpace(in.Username)
	if in.Username == "" || in.Password == "" {
		return web.Fail(c, 200, 400, "用户名和密码必填")
	}
	var dup int64
	h.store.DB.Model(&model.User{}).Where("username = ?", in.Username).Count(&dup)
	if dup > 0 {
		return web.Fail(c, 200, 400, "用户名已存在")
	}
	if in.Type != "admin" {
		in.Type = "user"
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	u := model.User{
		ID: uuid.NewString(), Username: in.Username, Nickname: in.Nickname,
		Type: in.Type, Status: in.Status, Mail: in.Mail, Phone: in.Phone,
		Password: string(hash), Source: "local",
		LastUpdatePasswordAt: model.NowMillis(), CreatedAt: model.NowMillis(),
	}
	if err := h.store.DB.Create(&u).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	// 普通用户自动归入默认 user 角色（获得基础菜单）
	if u.Type == "user" {
		h.store.DB.Create(&model.UserRole{UserID: u.ID, RoleID: defaultUserRoleID})
	}
	return web.OK(c, map[string]any{"id": u.ID})
}

func (h *UserHandler) update(c echo.Context) error {
	var cur model.User
	if err := h.store.DB.First(&cur, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	var in userIn
	if err := c.Bind(&in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	// 不允许把最后一个 admin 降级为普通用户
	if cur.Type == "admin" && in.Type == "user" && h.adminCount() <= 1 {
		return web.Fail(c, 200, 400, "不能降级唯一的管理员")
	}
	cur.Nickname, cur.Status, cur.Mail, cur.Phone = in.Nickname, in.Status, in.Mail, in.Phone
	if in.Type == "admin" || in.Type == "user" {
		cur.Type = in.Type
	}
	if strings.TrimSpace(in.Password) != "" {
		hash, _ := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		cur.Password = string(hash)
		cur.LastUpdatePasswordAt = model.NowMillis()
	}
	if err := h.store.DB.Save(&cur).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": cur.ID})
}

func (h *UserHandler) remove(c echo.Context) error {
	id := c.Param("id")
	if u := web.CurrentUser(c); u != nil && u.ID == id {
		return web.Fail(c, 200, 400, "不能删除当前登录用户")
	}
	var target model.User
	if err := h.store.DB.First(&target, "id = ?", id).Error; err != nil {
		return web.NotFound(c)
	}
	if target.Type == "admin" && h.adminCount() <= 1 {
		return web.Fail(c, 200, 400, "不能删除唯一的管理员")
	}
	h.store.DB.Delete(&model.User{}, "id = ?", id)
	h.store.DB.Delete(&model.UserRole{}, "user_id = ?", id)
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *UserHandler) adminCount() int64 {
	var n int64
	h.store.DB.Model(&model.User{}).Where("type = ?", "admin").Count(&n)
	return n
}
