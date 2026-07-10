package gateway

import (
	"bytes"
	"io"
	"net"
	"strings"
	"sync"
	"time"
)

// 最小 telnet 客户端：处理 IAC 协商（ECHO/SGA/NAWS/TTYPE），把纯终端数据交给 LiveSession。
// telnet 明文协议、仅用于老旧设备；不支持 exec / SFTP / 跳板。

const (
	iac  = 255 // 0xFF Interpret As Command
	dont = 254
	do   = 253
	wont = 252
	will = 251
	sb   = 250 // subnegotiation begin
	se   = 240 // subnegotiation end
	nop  = 241

	optEcho  = 1
	optSGA   = 3  // suppress go ahead
	optTType = 24 // terminal type
	optNAWS  = 31 // negotiate about window size
)

type telnetSession struct {
	conn net.Conn

	mu         sync.Mutex
	cols, rows int

	// 自动登录（best-effort）
	user, pass          string
	sentUser, sentPass  bool
	loginBuf            []byte
}

func dialTelnet(t SSHTarget, cols, rows int) (TermSession, error) {
	timeout := 10 * time.Second
	if t.TimeoutMs > 0 {
		timeout = time.Duration(t.TimeoutMs) * time.Millisecond
	}
	port := t.Port
	if port == 0 {
		port = 23
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(t.Host, itoa(port)), timeout)
	if err != nil {
		return nil, err
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	s := &telnetSession{conn: conn, cols: cols, rows: rows, user: t.User, pass: t.Password}
	// 主动声明我们会做 NAWS/TTYPE（很多服务端据此发 DO）
	_, _ = conn.Write([]byte{iac, will, optNAWS, iac, will, optTType})
	s.sendNAWS()
	return s, nil
}

func (s *telnetSession) Stdin() io.Writer  { return telnetWriter{s} }
func (s *telnetSession) Stdout() io.Reader { return s }
func (s *telnetSession) Stderr() io.Reader { return nil }
func (s *telnetSession) Exec(string) (string, error) { return "", errNotSupported }
func (s *telnetSession) Close() error { return s.conn.Close() }
func (s *telnetSession) KeepAlive() error {
	_, err := s.conn.Write([]byte{iac, nop})
	return err
}
func (s *telnetSession) Resize(cols, rows int) error {
	s.mu.Lock()
	s.cols, s.rows = cols, rows
	s.mu.Unlock()
	return s.sendNAWS()
}

func (s *telnetSession) sendNAWS() error {
	s.mu.Lock()
	c, r := s.cols, s.rows
	s.mu.Unlock()
	if c <= 0 {
		c = 80
	}
	if r <= 0 {
		r = 24
	}
	// IAC SB NAWS w1 w2 h1 h2 IAC SE（宽高各占两字节，值里的 0xFF 需转义）
	payload := []byte{byte(c >> 8), byte(c & 0xff), byte(r >> 8), byte(r & 0xff)}
	out := []byte{iac, sb, optNAWS}
	for _, b := range payload {
		if b == iac {
			out = append(out, iac)
		}
		out = append(out, b)
	}
	out = append(out, iac, se)
	_, err := s.conn.Write(out)
	return err
}

// telnetWriter：把用户输入写向服务端，转义数据中的 0xFF。
type telnetWriter struct{ s *telnetSession }

func (w telnetWriter) Write(p []byte) (int, error) {
	if bytes.IndexByte(p, iac) < 0 {
		return w.s.conn.Write(p)
	}
	esc := make([]byte, 0, len(p)+4)
	for _, b := range p {
		if b == iac {
			esc = append(esc, iac)
		}
		esc = append(esc, b)
	}
	if _, err := w.s.conn.Write(esc); err != nil {
		return 0, err
	}
	return len(p), nil
}

// Read 实现 telnet 读侧状态机：剥离 IAC 命令/子协商，只返回终端数据。
func (s *telnetSession) Read(p []byte) (int, error) {
	buf := make([]byte, len(p))
	for {
		n, err := s.conn.Read(buf)
		if n > 0 {
			data := s.process(buf[:n])
			if len(data) > 0 {
				s.autoLogin(data)
				copy(p, data)
				return len(data), nil
			}
			// 本次全是协商字节 → 继续读，避免返回 0,nil
			if err == nil {
				continue
			}
		}
		if err != nil {
			return 0, err
		}
	}
}

// process 逐字节跑状态机，返回纯数据字节；对命令做出应答。
func (s *telnetSession) process(in []byte) []byte {
	out := make([]byte, 0, len(in))
	i := 0
	for i < len(in) {
		b := in[i]
		if b != iac {
			out = append(out, b)
			i++
			continue
		}
		// b == IAC
		if i+1 >= len(in) {
			break // 命令跨包（少见）——本期简化丢弃残尾
		}
		cmd := in[i+1]
		switch cmd {
		case iac: // 字面 0xFF
			out = append(out, iac)
			i += 2
		case will, wont, do, dont:
			if i+2 >= len(in) {
				i = len(in)
				break
			}
			s.respond(cmd, in[i+2])
			i += 3
		case sb:
			// 子协商，读到 IAC SE
			j := i + 2
			for j+1 < len(in) && !(in[j] == iac && in[j+1] == se) {
				j++
			}
			s.subneg(in[i+2 : telMin(j, len(in))])
			i = j + 2
		default: // NOP / GA / 其它单字节命令
			i += 2
		}
	}
	return out
}

func telMin(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// respond 依据服务端的 WILL/WONT/DO/DONT 做出应答。
func (s *telnetSession) respond(cmd, opt byte) {
	var reply []byte
	switch cmd {
	case will: // 服务端将启用 opt
		if opt == optEcho || opt == optSGA {
			reply = []byte{iac, do, opt} // 同意（服务端回显 / 抑制 GA）
		} else {
			reply = []byte{iac, dont, opt}
		}
	case do: // 服务端要求我们启用 opt
		if opt == optNAWS || opt == optTType {
			reply = []byte{iac, will, opt}
			if opt == optNAWS {
				_ = s.sendNAWS()
			}
		} else if opt == optSGA {
			reply = []byte{iac, will, opt}
		} else {
			reply = []byte{iac, wont, opt}
		}
	case wont:
		reply = []byte{iac, dont, opt}
	case dont:
		reply = []byte{iac, wont, opt}
	}
	if reply != nil {
		_, _ = s.conn.Write(reply)
	}
}

// subneg 处理子协商（主要是 TTYPE SEND → 回 xterm）。
func (s *telnetSession) subneg(data []byte) {
	if len(data) >= 2 && data[0] == optTType && data[1] == 1 { // TERMINAL-TYPE SEND
		out := []byte{iac, sb, optTType, 0} // 0 = IS
		out = append(out, []byte("xterm")...)
		out = append(out, iac, se)
		_, _ = s.conn.Write(out)
	}
}

// autoLogin 在输出里匹配登录/密码提示，注入一次凭证（best-effort）。
func (s *telnetSession) autoLogin(data []byte) {
	if (s.sentUser && s.sentPass) || (s.user == "" && s.pass == "") {
		return
	}
	s.loginBuf = append(s.loginBuf, data...)
	if len(s.loginBuf) > 4096 {
		s.loginBuf = s.loginBuf[len(s.loginBuf)-4096:]
	}
	low := strings.ToLower(string(s.loginBuf))
	if !s.sentUser && s.user != "" && (strings.Contains(low, "login:") || strings.Contains(low, "username:")) {
		s.sentUser = true
		s.loginBuf = nil
		_, _ = s.conn.Write([]byte(s.user + "\r\n"))
		return
	}
	if !s.sentPass && s.pass != "" && strings.Contains(low, "password:") {
		s.sentPass = true
		s.loginBuf = nil
		_, _ = s.conn.Write([]byte(s.pass + "\r\n"))
	}
}

