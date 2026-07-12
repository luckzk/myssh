package gateway

import (
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// SFTPConn 一个会话的 SFTP 连接（含底层 SSH）。
type SFTPConn struct {
	ssh  *ssh.Client
	Sftp *sftp.Client
}

func (c *SFTPConn) Close() {
	if c.Sftp != nil {
		_ = c.Sftp.Close()
	}
	if c.ssh != nil {
		_ = c.ssh.Close()
	}
}

// SFTPManager 按 sessionId 缓存 SFTP 连接，懒建、复用、可关闭。
type SFTPManager struct {
	mu    sync.Mutex
	conns map[string]*SFTPConn
}

func NewSFTPManager() *SFTPManager {
	return &SFTPManager{conns: map[string]*SFTPConn{}}
}

// Get 取已缓存连接；不存在则用 target 新建。
func (m *SFTPManager) Get(sessionID string, target SSHTarget, opts ...SSHOptions) (*SFTPConn, error) {
	m.mu.Lock()
	if c, ok := m.conns[sessionID]; ok {
		m.mu.Unlock()
		return c, nil
	}
	m.mu.Unlock()

	client, err := DialSSH(target, opts...)
	if err != nil {
		return nil, err
	}
	sc, err := sftp.NewClient(client)
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	conn := &SFTPConn{ssh: client, Sftp: sc}

	m.mu.Lock()
	// 双检：避免并发重复建立
	if existing, ok := m.conns[sessionID]; ok {
		m.mu.Unlock()
		conn.Close()
		return existing, nil
	}
	m.conns[sessionID] = conn
	m.mu.Unlock()
	return conn, nil
}

// GetOnClient 在已存在的 SSH 客户端上开 SFTP 子系统（免二次拨号，首开更快）。
// 返回的 SFTPConn 不持有 ssh（ssh=nil）：Close 只关 sftp，不影响调用方连接（如终端会话）。
func (m *SFTPManager) GetOnClient(sessionID string, client *ssh.Client) (*SFTPConn, error) {
	m.mu.Lock()
	if c, ok := m.conns[sessionID]; ok {
		m.mu.Unlock()
		return c, nil
	}
	m.mu.Unlock()

	sc, err := sftp.NewClient(client)
	if err != nil {
		return nil, err
	}
	conn := &SFTPConn{ssh: nil, Sftp: sc}

	m.mu.Lock()
	if existing, ok := m.conns[sessionID]; ok { // 双检
		m.mu.Unlock()
		_ = sc.Close()
		return existing, nil
	}
	m.conns[sessionID] = conn
	m.mu.Unlock()
	return conn, nil
}

// Close 关闭并移除某会话的 SFTP 连接。
func (m *SFTPManager) Close(sessionID string) {
	m.mu.Lock()
	c, ok := m.conns[sessionID]
	delete(m.conns, sessionID)
	m.mu.Unlock()
	if ok {
		c.Close()
	}
}
