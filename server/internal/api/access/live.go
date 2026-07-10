package access

import (
	"bytes"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dushixiang/next-terminal-clone/server/internal/audit"
	"github.com/dushixiang/next-terminal-clone/server/internal/gateway"
	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/gorilla/websocket"
)

func frame(typ int, content string) string { return strconv.Itoa(typ) + content }

// parseWH 解析 "cols,rows"。
func parseWH(s string) (cols, rows int, ok bool) {
	parts := strings.SplitN(s, ",", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	c, e1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	r, e2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if e1 != nil || e2 != nil || c <= 0 || r <= 0 {
		return 0, 0, false
	}
	return c, r, true
}

// ring 定长回滚缓冲（超上限从头丢弃）。max 由配置 NT_SESSION_SCROLLBACK 决定。
type ring struct {
	mu  sync.Mutex
	buf []byte
	max int
}

func (r *ring) write(p []byte) {
	r.mu.Lock()
	r.buf = append(r.buf, p...)
	if r.max > 0 && len(r.buf) > r.max {
		r.buf = append([]byte(nil), r.buf[len(r.buf)-r.max:]...)
	}
	r.mu.Unlock()
}
func (r *ring) snapshot() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]byte(nil), r.buf...)
}

// wsClient 一个附着的浏览器连接（canWrite=false 为只读观战）。写入需串行化。
type wsClient struct {
	ws       *websocket.Conn
	canWrite bool
	mu       sync.Mutex
}

func (c *wsClient) send(f string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ws.WriteMessage(websocket.TextMessage, []byte(f))
}

// liveSession 服务器端持久 SSH 会话：持有 ssh.Client + PTY + 回滚缓冲 + 附着的 WS 集合，
// 与任一浏览器 WS 解耦。浏览器只是附着/分离，会话在 keepalive 下持续存活。
type liveSession struct {
	h    *Handler
	sess model.ConnSession

	conn  gateway.TermSession
	stdin io.Writer
	cols  int
	rows  int

	rec   *audit.Recording
	guard *audit.CommandGuard

	initFilter *gateway.InitEchoFilter // 初始命令/跟随开关注入的回显过滤（受 mu 保护）；nil 表示不过滤
	protocol   string                  // ssh/telnet/serial：仅 ssh 支持目录跟随的实时开关

	mu            sync.Mutex
	dirFollow     bool // 当前是否开启目录跟随（PROMPT_COMMAND 是否已注入）
	clients       map[*wsClient]struct{}
	lastDir       string
	detachedSince int64 // 0=有连接；否则为最后一个连接离开的毫秒时间戳

	scroll ring
	closed chan struct{}
	once   sync.Once
}

// startLive 按协议建立终端连接（SSH/telnet），启动输出泵与 keepalive；返回后即可 attach。
func (h *Handler) startLive(sess model.ConnSession, target gateway.SSHTarget, protocol, initCmd string, rec *audit.Recording, guard *audit.CommandGuard, dirFollow bool) (*liveSession, error) {
	cols, rows := sess.Width, sess.Height
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	conn, err := gateway.DialTerminal(target, protocol, cols, rows, h.sshOptionsForUser(sess.UserID))
	if err != nil {
		return nil, err
	}
	// 仅 SSH 注入初始命令（telnet/serial 无 PROMPT_COMMAND 目录同步，跳过）。
	// 用起止标记包裹注入内容，并启用回显过滤，让命令回显不刷屏（见 gateway.InitEchoFilter）。
	var initFilter *gateway.InitEchoFilter
	if protocol == "ssh" && strings.TrimSpace(initCmd) != "" {
		_, _ = conn.Stdin().Write([]byte(gateway.WrapInitCmd(initCmd)))
		initFilter = gateway.NewInitEchoFilter()
	}

	l := &liveSession{
		h: h, sess: sess, conn: conn, stdin: conn.Stdin(),
		cols: cols, rows: rows, rec: rec, guard: guard,
		initFilter: initFilter, dirFollow: dirFollow, protocol: protocol,
		clients: make(map[*wsClient]struct{}), closed: make(chan struct{}),
		scroll: ring{max: h.effectiveScrollback()},
	}
	go l.pump(conn.Stdout(), true)
	if se := conn.Stderr(); se != nil {
		go l.pump(se, false)
	}
	go l.keepAlive()
	return l, nil
}

// pump 读 SSH 输出 → 录像 + OSC7 目录 + 回滚缓冲 + 广播给所有 client。EOF → 关闭会话。
func (l *liveSession) pump(r io.Reader, scanDir bool) {
	var scanner *gateway.DirScanner
	if scanDir {
		scanner = gateway.NewDirScanner()
	}
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			// 目录扫描与全屏检测始终基于原始字节，不受回显过滤影响。
			if scanner != nil {
				scanner.Feed(chunk, func(dir string) {
					l.mu.Lock()
					l.lastDir = dir
					l.mu.Unlock()
					l.broadcast(frame(gateway.MsgDirChanged, dir))
				})
				// 全屏程序（vim/top/less）进入/退出 alt-screen 时开/关命令过滤
				if l.guard != nil {
					if bytes.Contains(chunk, []byte("\x1b[?1049h")) || bytes.Contains(chunk, []byte("\x1b[?47h")) {
						l.guard.SetAltScreen(true)
					}
					if bytes.Contains(chunk, []byte("\x1b[?1049l")) || bytes.Contains(chunk, []byte("\x1b[?47l")) {
						l.guard.SetAltScreen(false)
					}
				}
			}
			// 可见流（录像 + 回滚缓冲 + 广播）过滤掉初始命令/跟随开关注入的回显。
			// filter 指针受 mu 保护（实时开关会重新装填），但其内部仅本 pump 协程读写。
			visible := chunk
			if scanDir {
				l.mu.Lock()
				flt := l.initFilter
				l.mu.Unlock()
				if flt != nil {
					visible = flt.Filter(chunk)
				}
			}
			if len(visible) > 0 {
				l.rec.WriteOutput(visible)
				l.scroll.write(visible)
				l.broadcast(frame(gateway.MsgData, string(visible)))
			}
		}
		if err != nil {
			if scanDir { // 仅 stdout 的 EOF 视为 shell 结束
				l.close("shell exited")
			}
			return
		}
	}
}

// setDirFollow 会话中实时开关目录跟随（仅 SSH）：开→注入 osc7Init 恢复 PROMPT_COMMAND；
// 关→unset PROMPT_COMMAND，之后不再产生 OSC7 目录上报。两种注入都用标记过滤器抑制回显。
func (l *liveSession) setDirFollow(on bool) {
	if l.protocol != "ssh" {
		return
	}
	l.mu.Lock()
	if l.dirFollow == on {
		l.mu.Unlock()
		return
	}
	l.dirFollow = on
	l.mu.Unlock()

	cmd := "unset PROMPT_COMMAND\n"
	if on {
		cmd = osc7Init
	}
	// 先装填过滤器，再写入 stdin：回显随后由 pump 读到新过滤器时被吞掉。
	l.armInitFilter()
	_, _ = l.stdin.Write([]byte(gateway.WrapInitCmd(cmd)))
}

// armInitFilter 装填一个新的回显过滤器（实时开关注入用，连尾随提示符一并抑制，切换无感）。
func (l *liveSession) armInitFilter() {
	f := gateway.NewInitEchoFilterHideTrailing()
	l.mu.Lock()
	l.initFilter = f
	l.mu.Unlock()
}

// keepAlive 周期性发送 SSH keepalive，防 NAT/空闲掉线；失败即判定连接死亡。
func (l *liveSession) keepAlive() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-l.closed:
			return
		case <-t.C:
			if err := l.conn.KeepAlive(); err != nil {
				l.close("keepalive failed")
				return
			}
		}
	}
}

func (l *liveSession) broadcast(f string) {
	l.mu.Lock()
	clients := make([]*wsClient, 0, len(l.clients))
	for c := range l.clients {
		clients = append(clients, c)
	}
	l.mu.Unlock()
	for _, c := range clients {
		_ = c.send(f)
	}
}

// attach 把一个浏览器 WS 附着到会话（阻塞至该 WS 断开或会话关闭）。canWrite=false 为只读观战。
func (l *liveSession) attach(ws *websocket.Conn, canWrite bool) {
	cl := &wsClient{ws: ws, canWrite: canWrite}
	// 注册 + 回放快照：持 cl.mu 期间广播会排队，保证「先回放、后实时」的顺序。
	cl.mu.Lock()
	l.mu.Lock()
	l.clients[cl] = struct{}{}
	l.detachedSince = 0
	snap := l.scroll.snapshot()
	dir := l.lastDir
	l.mu.Unlock()
	_ = ws.WriteMessage(websocket.TextMessage, []byte(frame(gateway.MsgData, string(snap))))
	if dir != "" {
		_ = ws.WriteMessage(websocket.TextMessage, []byte(frame(gateway.MsgDirChanged, dir)))
	}
	cl.mu.Unlock()

	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			break
		}
		typ, content := gateway.DecodeFrame(string(msg))
		switch typ {
		case gateway.MsgData:
			if canWrite {
				fwd, notice := content, ""
				if l.guard != nil {
					var b []byte
					b, notice = l.guard.ProcessInput([]byte(content))
					fwd = string(b)
				}
				if notice != "" {
					l.broadcast(frame(gateway.MsgData, notice))
				}
				if len(fwd) > 0 {
					_, _ = l.stdin.Write([]byte(fwd))
				}
			}
		case gateway.MsgResize:
			if canWrite {
				if c, r, ok := parseWH(content); ok {
					l.mu.Lock()
					l.cols, l.rows = c, r
					l.mu.Unlock()
					_ = l.conn.Resize(c, r)
				}
			}
		case gateway.MsgPing:
			_ = cl.send(frame(gateway.MsgPing, content))
		case gateway.MsgExit:
			if canWrite {
				l.close("client exit")
			}
			l.detach(cl)
			return
		}
	}
	l.detach(cl)
}

func (l *liveSession) detach(cl *wsClient) {
	l.mu.Lock()
	delete(l.clients, cl)
	if len(l.clients) == 0 {
		l.detachedSince = model.NowMillis()
	}
	l.mu.Unlock()
}

// close 结束会话（幂等）：关 SSH、落录像、清理注册表与 SFTP，唤醒并关闭所有附着的 WS。
func (l *liveSession) close(reason string) {
	l.once.Do(func() {
		close(l.closed)
		if l.conn != nil {
			_ = l.conn.Close()
		}
		path := l.rec.Close()
		l.h.finishSession(&l.sess, path)
		l.h.removeLive(l.sess.ID)
		l.h.registry.Remove(l.sess.ID)
		l.mu.Lock()
		clients := make([]*wsClient, 0, len(l.clients))
		for c := range l.clients {
			clients = append(clients, c)
		}
		l.clients = map[*wsClient]struct{}{}
		l.mu.Unlock()
		for _, c := range clients {
			_ = c.send(frame(gateway.MsgExit, reason))
			_ = c.ws.Close()
		}
	})
}

// ---- 管理器 ----

func (h *Handler) getLive(id string) *liveSession {
	h.livesMu.Lock()
	defer h.livesMu.Unlock()
	return h.lives[id]
}

func (h *Handler) putLive(id string, l *liveSession) {
	h.livesMu.Lock()
	h.lives[id] = l
	h.livesMu.Unlock()
}

func (h *Handler) removeLive(id string) {
	h.livesMu.Lock()
	delete(h.lives, id)
	h.livesMu.Unlock()
}

func (h *Handler) hasLive(id string) bool {
	h.livesMu.Lock()
	defer h.livesMu.Unlock()
	_, ok := h.lives[id]
	return ok
}

// closeLive 显式关闭某会话（账号端「断开」/管理员踢下线）。返回是否命中。
func (h *Handler) closeLive(id string) bool {
	l := h.getLive(id)
	if l == nil {
		return false
	}
	l.close("closed by user")
	return true
}

// reapLiveSessions 周期回收分离超过 SessionTTL 的会话。
func (h *Handler) reapLiveSessions() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for range t.C {
		now := model.NowMillis()
		ttlMs := h.effectiveTTL().Milliseconds()
		var stale []*liveSession
		h.livesMu.Lock()
		for _, l := range h.lives {
			l.mu.Lock()
			ds := l.detachedSince
			n := len(l.clients)
			l.mu.Unlock()
			if n == 0 && ds > 0 && now-ds > ttlMs {
				stale = append(stale, l)
			}
		}
		h.livesMu.Unlock()
		for _, l := range stale {
			l.close("idle ttl")
		}
	}
}
