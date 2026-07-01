package web

import (
	"net/http"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/labstack/echo/v4"
)

// Resp 统一响应包络。证据：错误统一形如 {"code":500,"message":"Not Found"}。
type Resp struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

const ctxUserKey = "currentUser"

// OK 直接返回业务数据（demo 的读接口多为裸对象/数组，无包络）。
func OK(c echo.Context, data any) error {
	return c.JSON(http.StatusOK, data)
}

// Fail 返回 {code,message} 错误包络。
func Fail(c echo.Context, status, code int, msg string) error {
	return c.JSON(status, Resp{Code: code, Message: msg})
}

func NotFound(c echo.Context) error {
	return c.JSON(http.StatusOK, Resp{Code: 500, Message: "Not Found"})
}

// SetUser / CurrentUser 在中间件与 handler 间传递当前用户。
func SetUser(c echo.Context, u *model.User) { c.Set(ctxUserKey, u) }

func CurrentUser(c echo.Context) *model.User {
	if v, ok := c.Get(ctxUserKey).(*model.User); ok {
		return v
	}
	return nil
}
