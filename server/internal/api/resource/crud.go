package resource

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// Identifiable 资源实体需可设置 ID/创建时间。
type Identifiable interface {
	SetID(string)
	SetCreatedAt(int64)
}

// Crud 通用资源 CRUD，对齐上游 Api<T>：paging/getAll/get/create/update/delete。
// hooks 提供加密落库与列表脱敏。
type Crud[T Identifiable] struct {
	store    *store.Store
	newModel func() T
	newSlice func() any            // *[]T
	order    string                // 默认排序
	beforeSave func(T)             // 落库前（加密）
	mask       func(T) T           // 列表/详情脱敏
	searchCol  string              // 关键字模糊匹配列（可空）
}

func NewCrud[T Identifiable](s *store.Store, newModel func() T, newSlice func() any) *Crud[T] {
	return &Crud[T]{store: s, newModel: newModel, newSlice: newSlice, order: "created_at desc"}
}

func (h *Crud[T]) WithOrder(o string) *Crud[T]       { h.order = o; return h }
func (h *Crud[T]) WithBeforeSave(f func(T)) *Crud[T] { h.beforeSave = f; return h }
func (h *Crud[T]) WithMask(f func(T) T) *Crud[T]     { h.mask = f; return h }
func (h *Crud[T]) WithSearch(col string) *Crud[T]    { h.searchCol = col; return h }

func (h *Crud[T]) Register(g *echo.Group) {
	g.GET("/paging", h.paging)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.POST("", h.create)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.remove)
}

func (h *Crud[T]) paging(c echo.Context) error {
	p := web.ParsePage(c)
	q := h.store.DB.Model(h.newModel())
	if h.searchCol != "" {
		if kw := c.QueryParam("name"); kw != "" {
			q = q.Where(h.searchCol+" LIKE ?", "%"+kw+"%")
		}
	}
	q = q.Order(h.order)
	items := h.newSlice()
	res, err := web.Paginate(q, p, items)
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	res["items"] = h.maskSlice(items)
	return web.OK(c, res)
}

func (h *Crud[T]) list(c echo.Context) error {
	items := h.newSlice()
	h.store.DB.Order(h.order).Find(items)
	return web.OK(c, h.maskSlice(items))
}

func (h *Crud[T]) get(c echo.Context) error {
	m := h.newModel()
	if err := h.store.DB.First(m, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	if h.mask != nil {
		m = h.mask(m)
	}
	return web.OK(c, m)
}

func (h *Crud[T]) create(c echo.Context) error {
	m := h.newModel()
	if err := c.Bind(m); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	m.SetID(uuid.NewString())
	m.SetCreatedAt(model.NowMillis())
	if h.beforeSave != nil {
		h.beforeSave(m)
	}
	if err := h.store.DB.Create(m).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": idOf(m)})
}

func (h *Crud[T]) update(c echo.Context) error {
	m := h.newModel()
	if err := h.store.DB.First(m, "id = ?", c.Param("id")).Error; err != nil {
		return web.NotFound(c)
	}
	in := h.newModel()
	if err := c.Bind(in); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	in.SetID(c.Param("id"))
	// 保留原创建时间
	if g, ok := any(m).(interface{ GetCreatedAt() int64 }); ok {
		in.SetCreatedAt(g.GetCreatedAt())
	}
	if h.beforeSave != nil {
		h.beforeSave(in)
	}
	// Save：主键已设，整行更新
	if err := h.store.DB.Save(in).Error; err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	return web.OK(c, map[string]any{"id": c.Param("id")})
}

func (h *Crud[T]) remove(c echo.Context) error {
	h.store.DB.Delete(h.newModel(), "id = ?", c.Param("id"))
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *Crud[T]) maskSlice(items any) any {
	if h.mask == nil {
		return items
	}
	if sp, ok := items.(*[]T); ok {
		for i := range *sp {
			(*sp)[i] = h.mask((*sp)[i])
		}
	}
	return items
}

// idOf 通过接口取 ID（实体内嵌 BaseResource 提供）。
func idOf(m any) string {
	if g, ok := m.(interface{ GetID() string }); ok {
		return g.GetID()
	}
	return ""
}
