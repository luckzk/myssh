package gateway

import (
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHPool 复用 SSH 客户端跑短命令，避免每次 REST 轮询都重新拨号（对高延迟远程主机尤其明显）。
// 按 key（通常 userID@host:port）缓存一个 *ssh.Client；空闲超时后回收；后台 keepalive 保温并探活。
// 仅用于短命令（docker ps/stats/inspect、主机监控等）；长连接流（logs/exec）仍各自独立拨号。
type SSHPool struct {
	mu    sync.Mutex
	conns map[string]*pooledClient
	ttl   time.Duration
}

type pooledClient struct {
	client   *ssh.Client
	lastUsed time.Time
	stop     chan struct{} // 关闭以停止其 keepalive 协程
}

func NewSSHPool(ttl time.Duration) *SSHPool {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	p := &SSHPool{conns: map[string]*pooledClient{}, ttl: ttl}
	go p.reap()
	return p
}

// Run 在池化连接上执行一条命令，返回合并的 stdout+stderr。缺连接时拨号。
func (p *SSHPool) Run(key string, target SSHTarget, cmd string, opts ...SSHOptions) (string, error) {
	client, fresh, err := p.get(key, target, opts)
	if err != nil {
		return "", err
	}
	sess, err := client.NewSession()
	if err != nil {
		// 连接可能已失效：丢弃后，非新建连接则重拨一次。
		p.drop(key, client)
		if fresh {
			return "", err
		}
		if client, _, err = p.get(key, target, opts); err != nil {
			return "", err
		}
		if sess, err = client.NewSession(); err != nil {
			return "", err
		}
	}
	defer sess.Close()
	out, runErr := sess.CombinedOutput(cmd)
	return string(out), runErr
}

func (p *SSHPool) get(key string, target SSHTarget, opts []SSHOptions) (*ssh.Client, bool, error) {
	p.mu.Lock()
	if pc := p.conns[key]; pc != nil {
		pc.lastUsed = time.Now()
		c := pc.client
		p.mu.Unlock()
		return c, false, nil
	}
	p.mu.Unlock()
	// 拨号在锁外（慢操作）
	client, err := DialSSH(target, opts...)
	if err != nil {
		return nil, false, err
	}
	p.mu.Lock()
	if pc := p.conns[key]; pc != nil { // 竞态：别的 goroutine 已拨号
		p.mu.Unlock()
		_ = client.Close()
		return pc.client, false, nil
	}
	pc := &pooledClient{client: client, lastUsed: time.Now(), stop: make(chan struct{})}
	p.conns[key] = pc
	go p.keepAlive(key, pc)
	p.mu.Unlock()
	return client, true, nil
}

// drop 移除并关闭指定连接（若仍是当前 key 对应的那条）。
func (p *SSHPool) drop(key string, client *ssh.Client) {
	p.mu.Lock()
	pc := p.conns[key]
	if pc != nil && pc.client == client {
		delete(p.conns, key)
		close(pc.stop)
		p.mu.Unlock()
		_ = client.Close()
		return
	}
	p.mu.Unlock()
	_ = client.Close()
}

// keepAlive 每 60s 发一次 keepalive 保持连接热/探活；失败即剔除。
func (p *SSHPool) keepAlive(key string, pc *pooledClient) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-pc.stop:
			return
		case <-t.C:
			if _, _, err := pc.client.SendRequest("keepalive@openssh.com", true, nil); err != nil {
				p.drop(key, pc.client)
				return
			}
		}
	}
}

func (p *SSHPool) reap() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for range t.C {
		now := time.Now()
		p.mu.Lock()
		for k, pc := range p.conns {
			if now.Sub(pc.lastUsed) > p.ttl {
				close(pc.stop)
				_ = pc.client.Close()
				delete(p.conns, k)
			}
		}
		p.mu.Unlock()
	}
}
