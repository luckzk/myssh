package access

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
	"github.com/pkg/sftp"
)

// 读取并解析远端名册（/etc/passwd 或 /etc/group）：返回 id->name 与 name->id。
func readNameDB(conn *gateway.SFTPConn, file string) (idToName map[int]string, nameToID map[string]int) {
	idToName, nameToID = map[int]string{}, map[string]int{}
	f, err := conn.Sftp.Open(file)
	if err != nil {
		return
	}
	defer f.Close()
	b, _ := io.ReadAll(f)
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.Split(line, ":")
		if len(parts) < 3 {
			continue
		}
		id, e := strconv.Atoi(parts[2])
		if e != nil {
			continue
		}
		idToName[id] = parts[0]
		nameToID[parts[0]] = id
	}
	return
}

func ownerName(conn *gateway.SFTPConn, uid int) string {
	m, _ := readNameDB(conn, "/etc/passwd")
	if n, ok := m[uid]; ok {
		return n
	}
	return strconv.Itoa(uid)
}

func uidGid(fi os.FileInfo) (uid, gid int) {
	if st, ok := fi.Sys().(*sftp.FileStat); ok {
		return int(st.UID), int(st.GID)
	}
	return -1, -1
}

// fsStat 返回文件的八进制权限 + 属主，供「设置权限」弹窗预填。
func (h *Handler) fsStat(c echo.Context) error {
	conn, _, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	p := c.QueryParam("path")
	fi, err := conn.Sftp.Stat(p)
	if err != nil {
		return web.Fail(c, 200, 404, err.Error())
	}
	uid, gid := uidGid(fi)
	pwd, _ := readNameDB(conn, "/etc/passwd")
	grp, _ := readNameDB(conn, "/etc/group")
	owner := strconv.Itoa(uid)
	if n, ok := pwd[uid]; ok {
		owner = n
	}
	group := strconv.Itoa(gid)
	if n, ok := grp[gid]; ok {
		group = n
	}
	return web.OK(c, map[string]any{
		"mode":  fmt.Sprintf("%03o", fi.Mode().Perm()),
		"owner": owner,
		"group": group,
		"isDir": fi.IsDir(),
	})
}

// fsChmod 设置权限（八进制 mode）+ 可选改属主（owner）+ 可选递归到子目录。
func (h *Handler) fsChmod(c echo.Context) error {
	conn, sess, err := h.connForSession(c.Param("sid"))
	if err != nil {
		return web.Fail(c, 200, 500, err.Error())
	}
	p := c.QueryParam("path")
	modeStr := strings.TrimSpace(c.QueryParam("mode"))
	owner := strings.TrimSpace(c.QueryParam("owner"))
	recursive := c.QueryParam("recursive") == "true"

	m64, perr := strconv.ParseUint(modeStr, 8, 32)
	if perr != nil {
		return web.Fail(c, 200, 400, "权限格式错误（应为八进制，如 755）")
	}
	perm := os.FileMode(m64)

	// 解析目标 uid（owner 可为名称或数字）
	uid := -1
	if owner != "" {
		if n, e := strconv.Atoi(owner); e == nil {
			uid = n
		} else {
			_, name2id := readNameDB(conn, "/etc/passwd")
			id, ok := name2id[owner]
			if !ok {
				return web.Fail(c, 200, 400, "未找到用户："+owner)
			}
			uid = id
		}
	}

	apply := func(target string) error {
		if e := conn.Sftp.Chmod(target, perm); e != nil {
			return e
		}
		if uid >= 0 {
			fi, e := conn.Sftp.Stat(target)
			if e != nil {
				return e
			}
			_, gid := uidGid(fi)
			if e := conn.Sftp.Chown(target, uid, gid); e != nil {
				return e
			}
		}
		return nil
	}

	if e := apply(p); e != nil {
		return web.Fail(c, 200, 500, e.Error())
	}
	if recursive {
		w := conn.Sftp.Walk(p)
		for w.Step() {
			if w.Err() != nil {
				continue
			}
			if w.Path() == p {
				continue
			}
			_ = apply(w.Path())
		}
	}
	detail := fmt.Sprintf("%s mode=%s", p, modeStr)
	if owner != "" {
		detail += " owner=" + owner
	}
	if recursive {
		detail += " (recursive)"
	}
	h.auditFS(sess, "chmod", detail, 0)
	return web.OK(c, map[string]any{"status": "ok"})
}
