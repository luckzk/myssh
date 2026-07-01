package gateway

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"golang.org/x/crypto/ssh"
)

// PortForwardTarget 是启动转发所需的解密后 SSH 目标和转发参数。
type PortForwardTarget struct {
	SSH        SSHTarget
	ForwardID  string
	Type       string // local | remote | dynamic
	ListenHost string
	ListenPort int
	TargetHost string
	TargetPort int
}

type portForwardRuntime struct {
	listener net.Listener
	client   *ssh.Client
	stopOnce sync.Once
	done     chan struct{}
}

// PortForwardManager 管理运行中的 SSH 端口转发。
type PortForwardManager struct {
	mu    sync.Mutex
	items map[string]*portForwardRuntime
}

func NewPortForwardManager() *PortForwardManager {
	return &PortForwardManager{items: map[string]*portForwardRuntime{}}
}

// Start 启动一个端口转发，返回实际监听地址和异步退出通道。
func (m *PortForwardManager) Start(t PortForwardTarget, opts ...SSHOptions) (string, <-chan error, error) {
	client, err := DialSSH(t.SSH, opts...)
	if err != nil {
		return "", nil, err
	}

	var listener net.Listener
	addr := net.JoinHostPort(defaultHost(t.ListenHost), strconv.Itoa(t.ListenPort))
	switch t.Type {
	case "local", "dynamic":
		listener, err = net.Listen("tcp", addr)
	case "remote":
		listener, err = client.Listen("tcp", addr)
	default:
		err = fmt.Errorf("unsupported forward type: %s", t.Type)
	}
	if err != nil {
		_ = client.Close()
		return "", nil, err
	}

	rt := &portForwardRuntime{listener: listener, client: client, done: make(chan struct{})}
	m.mu.Lock()
	if old, ok := m.items[t.ForwardID]; ok {
		old.close()
	}
	m.items[t.ForwardID] = rt
	m.mu.Unlock()

	errCh := make(chan error, 1)
	go func() {
		defer close(rt.done)
		defer close(errCh)
		var runErr error
		for {
			in, e := listener.Accept()
			if e != nil {
				if !isClosedNetErr(e) {
					runErr = e
				}
				break
			}
			go m.handleConn(t, client, in)
		}
		m.mu.Lock()
		if m.items[t.ForwardID] == rt {
			delete(m.items, t.ForwardID)
		}
		m.mu.Unlock()
		_ = client.Close()
		errCh <- runErr
	}()

	return listener.Addr().String(), errCh, nil
}

func (m *PortForwardManager) Stop(id string) bool {
	m.mu.Lock()
	rt, ok := m.items[id]
	m.mu.Unlock()
	if ok {
		rt.close()
	}
	return ok
}

func (m *PortForwardManager) StopSession(sessionID string, ids []string) {
	for _, id := range ids {
		m.Stop(id)
	}
}

func (rt *portForwardRuntime) close() {
	rt.stopOnce.Do(func() {
		if rt.listener != nil {
			_ = rt.listener.Close()
		}
		if rt.client != nil {
			_ = rt.client.Close()
		}
	})
}

func (m *PortForwardManager) handleConn(t PortForwardTarget, client *ssh.Client, in net.Conn) {
	defer in.Close()
	var out net.Conn
	var err error
	switch t.Type {
	case "local":
		out, err = client.Dial("tcp", net.JoinHostPort(t.TargetHost, strconv.Itoa(t.TargetPort)))
	case "remote":
		out, err = net.Dial("tcp", net.JoinHostPort(t.TargetHost, strconv.Itoa(t.TargetPort)))
	case "dynamic":
		out, err = dialSOCKS5(client, in)
	}
	if err != nil {
		return
	}
	defer out.Close()
	copyBoth(in, out)
}

func dialSOCKS5(client *ssh.Client, conn net.Conn) (net.Conn, error) {
	br := bufio.NewReader(conn)
	header := make([]byte, 2)
	if _, err := io.ReadFull(br, header); err != nil {
		return nil, err
	}
	if header[0] != 0x05 {
		return nil, fmt.Errorf("unsupported socks version")
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(br, methods); err != nil {
		return nil, err
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return nil, err
	}
	req := make([]byte, 4)
	if _, err := io.ReadFull(br, req); err != nil {
		return nil, err
	}
	if req[0] != 0x05 || req[1] != 0x01 {
		_ = writeSocksReply(conn, 0x07)
		return nil, fmt.Errorf("unsupported socks command")
	}
	host, err := readSocksAddr(br, req[3])
	if err != nil {
		_ = writeSocksReply(conn, 0x08)
		return nil, err
	}
	portBuf := make([]byte, 2)
	if _, err := io.ReadFull(br, portBuf); err != nil {
		return nil, err
	}
	port := int(binary.BigEndian.Uint16(portBuf))
	out, err := client.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		_ = writeSocksReply(conn, 0x05)
		return nil, err
	}
	if _, err := conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
		_ = out.Close()
		return nil, err
	}
	if br.Buffered() > 0 {
		if _, err := io.CopyN(out, br, int64(br.Buffered())); err != nil {
			_ = out.Close()
			return nil, err
		}
	}
	return out, nil
}

func readSocksAddr(r *bufio.Reader, atyp byte) (string, error) {
	switch atyp {
	case 0x01:
		b := make([]byte, 4)
		if _, err := io.ReadFull(r, b); err != nil {
			return "", err
		}
		return net.IP(b).String(), nil
	case 0x03:
		l, err := r.ReadByte()
		if err != nil {
			return "", err
		}
		b := make([]byte, int(l))
		if _, err := io.ReadFull(r, b); err != nil {
			return "", err
		}
		return string(b), nil
	case 0x04:
		b := make([]byte, 16)
		if _, err := io.ReadFull(r, b); err != nil {
			return "", err
		}
		return net.IP(b).String(), nil
	default:
		return "", fmt.Errorf("unsupported address type")
	}
}

func writeSocksReply(w io.Writer, code byte) error {
	_, err := w.Write([]byte{0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
	return err
}

func copyBoth(a, b net.Conn) {
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(a, b); done <- struct{}{} }()
	go func() { _, _ = io.Copy(b, a); done <- struct{}{} }()
	<-done
}

func defaultHost(s string) string {
	if strings.TrimSpace(s) == "" {
		return "127.0.0.1"
	}
	return strings.TrimSpace(s)
}

func HostFromAddr(addr, fallback string) string {
	h := addr
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		h = addr[:i]
	}
	h = strings.Trim(h, "[]")
	if h == "" {
		return fallback
	}
	return h
}

func PortFromAddr(addr string, fallback int) int {
	i := strings.LastIndex(addr, ":")
	if i < 0 {
		return fallback
	}
	n := 0
	for _, r := range addr[i+1:] {
		if r < '0' || r > '9' {
			return fallback
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func isClosedNetErr(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "use of closed network connection") || strings.Contains(s, "closed")
}

// ForwardIDs 提取会话对应转发 id。
func ForwardIDs(items []model.PortForward) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}
