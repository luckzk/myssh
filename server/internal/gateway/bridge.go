package gateway

import (
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

var ErrClientExit = errors.New("client requested exit")

// 消息类型，对齐上游 src/pages/access/Terminal.ts（数字前缀帧）。
const (
	MsgError      = 0
	MsgData       = 1
	MsgResize     = 2 // 内容 "cols,rows"
	MsgJoin       = 3
	MsgExit       = 4
	MsgDirChanged = 5
	MsgKeepAlive  = 6
	MsgAuthPrompt = 7
	MsgAuthReply  = 8
	MsgPing       = 9
)

// encodeFrame 编码为「单数字类型前缀 + 内容」文本帧。
func encodeFrame(typ int, content string) string {
	return strconv.Itoa(typ) + content
}

// decodeFrame 解析文本帧 → (类型, 内容)。
func decodeFrame(s string) (int, string) {
	if s == "" {
		return MsgData, ""
	}
	typ, err := strconv.Atoi(s[:1])
	if err != nil {
		return MsgData, s
	}
	return typ, s[1:]
}

// EncodeError 编码一个 Error 帧（供 handler 在桥接前回报错误）。
func EncodeError(content string) string { return encodeFrame(MsgError, content) }

// EncodeData 编码一个 Data 帧（供会话共享广播终端输出给观战者）。
func EncodeData(content string) string { return encodeFrame(MsgData, content) }

// Hooks 旁路审计钩子（录像与命令解析）。
type Hooks struct {
	OnOutput func([]byte) // 终端输出（录像）
	OnInput  func([]byte) // 用户输入（命令解析）
	Init     string       // shell 起来后注入的初始命令（默认路径 + 初始执行）
}

// BridgeSSH 在 WS 与 SSH PTY 之间双向桥接，使用上游帧协议，直到任一端关闭。
func BridgeSSH(ws *websocket.Conn, client *ssh.Client, cols, rows int, hooks Hooks) error {
	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()

	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		return err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, _ := sess.StderrPipe()
	if err := sess.Shell(); err != nil {
		return err
	}

	// 注入初始命令（默认路径 + 初始执行）
	if strings.TrimSpace(hooks.Init) != "" {
		_, _ = stdin.Write([]byte(hooks.Init))
	}

	done := make(chan error, 4)

	writeFrame := func(typ int, content string) error {
		return ws.WriteMessage(websocket.TextMessage, []byte(encodeFrame(typ, content)))
	}

	// SSH 输出 → WS（Data 帧）并旁路录像
	pump := func(r interface{ Read([]byte) (int, error) }) {
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				if hooks.OnOutput != nil {
					hooks.OnOutput(chunk)
				}
				_ = writeFrame(MsgData, string(chunk))
			}
			if err != nil {
				if err != io.EOF {
					done <- err
				} else {
					done <- nil
				}
				return
			}
		}
	}
	go func() { pump(stdout) }()
	if stderr != nil {
		go pump(stderr)
	}

	// WS → SSH（解析上游帧）
	go func() {
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				sess.Close()
				done <- fmt.Errorf("websocket closed: %w", err)
				return
			}
			typ, content := decodeFrame(string(msg))
			switch typ {
			case MsgData:
				if hooks.OnInput != nil {
					hooks.OnInput([]byte(content))
				}
				_, _ = stdin.Write([]byte(content))
			case MsgResize:
				if c, r, ok := parseColsRows(content); ok {
					_ = sess.WindowChange(r, c)
				}
			case MsgPing:
				// 回显（含客户端时间戳）→ 前端据此算 RTT
				_ = writeFrame(MsgPing, content)
			case MsgKeepAlive:
				// 保活，无需处理
			case MsgExit:
				sess.Close()
				done <- ErrClientExit
				return
			}
		}
	}()

	err = <-done
	_ = writeFrame(MsgExit, "session closed")
	return err
}

// parseColsRows 解析 "cols,rows"。
func parseColsRows(s string) (cols, rows int, ok bool) {
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
