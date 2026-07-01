package resource

import (
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// 资产分组：取整棵树 / 存整棵树 / 删节点。契约见 docs/recon/asset-group.md。

// treeNode AntD TreeDataNode：{key,title,children}。
type treeNode struct {
	Key      string      `json:"key"`
	Title    string      `json:"title"`
	Children []*treeNode `json:"children,omitempty"`
}

// RegisterGroups 挂载 /admin/assets/groups（在 asset 组下）。
func (h *AssetHandler) RegisterGroups(g *echo.Group) {
	g.GET("/groups", h.groupTree)
	g.PUT("/groups", h.saveGroups)
	g.DELETE("/groups/:id", h.deleteGroup)
}

func (h *AssetHandler) groupTree(c echo.Context) error {
	var rows []model.AssetGroup
	h.store.DB.Order("sort asc").Find(&rows)
	return web.OK(c, buildTree(rows, ""))
}

func buildTree(rows []model.AssetGroup, parent string) []*treeNode {
	out := []*treeNode{}
	for _, r := range rows {
		if r.ParentID == parent {
			node := &treeNode{Key: r.ID, Title: r.Name}
			node.Children = buildTree(rows, r.ID)
			out = append(out, node)
		}
	}
	return out
}

// saveGroups 接收整棵树，扁平化整体替换 asset_groups。
func (h *AssetHandler) saveGroups(c echo.Context) error {
	var tree []*treeNode
	if err := c.Bind(&tree); err != nil {
		return web.Fail(c, 200, 400, "请求参数错误")
	}
	rows := make([]model.AssetGroup, 0)
	var walk func(nodes []*treeNode, parent string)
	walk = func(nodes []*treeNode, parent string) {
		for i, n := range nodes {
			id := n.Key
			if id == "" || len(id) < 3 { // 新建节点：生成 AG_ 前缀 id
				id = "AG_" + uuid.NewString()
			}
			rows = append(rows, model.AssetGroup{
				ID: id, Name: n.Title, ParentID: parent, Sort: i, CreatedAt: model.NowMillis(),
			})
			walk(n.Children, id)
		}
	}
	walk(tree, "")

	// 整体替换
	tx := h.store.DB.Begin()
	if err := tx.Where("1 = 1").Delete(&model.AssetGroup{}).Error; err != nil {
		tx.Rollback()
		return web.Fail(c, 200, 500, err.Error())
	}
	for _, r := range rows {
		if err := tx.Create(&r).Error; err != nil {
			tx.Rollback()
			return web.Fail(c, 200, 500, err.Error())
		}
	}
	tx.Commit()
	return web.OK(c, map[string]any{"status": "ok"})
}

func (h *AssetHandler) deleteGroup(c echo.Context) error {
	id := c.Param("id")
	var g model.AssetGroup
	if err := h.store.DB.First(&g, "id = ?", id).Error; err != nil {
		return web.NotFound(c)
	}
	// 子节点上提到父级；该组资产置空分组
	h.store.DB.Model(&model.AssetGroup{}).Where("parent_id = ?", id).Update("parent_id", g.ParentID)
	h.store.DB.Model(&model.Asset{}).Where("group_id = ?", id).Update("group_id", "")
	h.store.DB.Delete(&model.AssetGroup{}, "id = ?", id)
	return web.OK(c, map[string]any{"status": "ok"})
}

// groupFullName 沿 parent 链拼接分组全路径名。
func (h *AssetHandler) groupFullName(groupID string) string {
	if groupID == "" {
		return ""
	}
	var rows []model.AssetGroup
	h.store.DB.Find(&rows)
	byID := map[string]model.AssetGroup{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	name := ""
	cur := groupID
	for i := 0; i < 32; i++ {
		g, ok := byID[cur]
		if !ok {
			break
		}
		if name == "" {
			name = g.Name
		} else {
			name = g.Name + " / " + name
		}
		cur = g.ParentID
		if cur == "" {
			break
		}
	}
	return name
}
