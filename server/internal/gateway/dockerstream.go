package gateway

import (
	"fmt"
	"io"
	"sync"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

// StreamSSHCommand 在 WS 与一条 SSH 远程命令之间桥接，复用终端帧协议（Data/Resize/Ping/Exit）。
// pty=true：分配伪终端并接受入站 Data(写 stdin)/Resize（用于 docker exec 交互）。
// pty=false：只读流（docker logs -f / docker pull 进度），忽略入站 Data。
// 命令自然结束（stdout EOF）或客户端断开时返回。
func StreamSSHCommand(ws *websocket.Conn, client *ssh.Client, cmd string, pty bool, cols, rows int) error {
	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()

	var wmu sync.Mutex // gorilla 不支持并发写：stdout/stderr/ping 写帧串行化
	writeFrame := func(typ int, content string) error {
		wmu.Lock()
		defer wmu.Unlock()
		return ws.WriteMessage(websocket.TextMessage, []byte(encodeFrame(typ, content)))
	}

	var stdin io.WriteCloser
	if pty {
		if cols <= 0 {
			cols = 80
		}
		if rows <= 0 {
			rows = 24
		}
		modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
		if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
			return err
		}
		if stdin, err = sess.StdinPipe(); err != nil {
			return err
		}
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, _ := sess.StderrPipe()

	if err := sess.Start(cmd); err != nil {
		return err
	}

	done := make(chan error, 3)
	pump := func(r io.Reader) {
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				_ = writeFrame(MsgData, string(buf[:n]))
			}
			if err != nil {
				if err == io.EOF {
					done <- nil
				} else {
					done <- err
				}
				return
			}
		}
	}
	go pump(stdout)
	if stderr != nil {
		go pump(stderr)
	}

	// WS 入站：交互写 stdin / resize；Ping 回显；Exit 关闭。
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
				if pty && stdin != nil {
					_, _ = stdin.Write([]byte(content))
				}
			case MsgResize:
				if pty {
					if cc, rr, ok := parseColsRows(content); ok {
						_ = sess.WindowChange(rr, cc)
					}
				}
			case MsgPing:
				_ = writeFrame(MsgPing, content)
			case MsgExit:
				sess.Close()
				done <- ErrClientExit
				return
			}
		}
	}()

	err = <-done
	_ = writeFrame(MsgExit, "stream closed")
	return err
}
