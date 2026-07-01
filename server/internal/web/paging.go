package web

import (
	"strconv"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Page 分页参数。证据：?pageIndex=&pageSize=，返回 {items,total}。
type Page struct {
	PageIndex int
	PageSize  int
}

func ParsePage(c echo.Context) Page {
	idx, _ := strconv.Atoi(c.QueryParam("pageIndex"))
	size, _ := strconv.Atoi(c.QueryParam("pageSize"))
	if idx < 1 {
		idx = 1
	}
	if size < 1 || size > 1000 {
		size = 10
	}
	return Page{PageIndex: idx, PageSize: size}
}

// Paginate 对查询应用分页并返回 {items,total}。items 由调用方提供的切片承接。
func Paginate(db *gorm.DB, p Page, items any) (map[string]any, error) {
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, err
	}
	if err := db.Offset((p.PageIndex - 1) * p.PageSize).Limit(p.PageSize).Find(items).Error; err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total}, nil
}
