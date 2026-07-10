package gateway

import (
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHPool 复用 SSH 客户端跑短命令，避免每次 REST 轮询都重新拨号（对高延迟远程主机尤其明显）。
// 按 key（通常 userID:assetID）缓存一个 *ssh.Client；空闲超时后回收。NewSession 失败视为连接失效，重拨一次。
// 仅用于短命令（docker ps/stats/inspect 等）；长连接流（logs/exec）仍各自独立拨号。
type SSHPool struct {
	mu    sync.Mutex
	conns map[string]*pooledClient
	ttl   time.Duration
}

type pooledClient struct {
	client   *ssh.Client
	lastUsed time.Time
}

func NewSSHPool(ttl time.Duration) *SSHPool {
	if ttl <= 0 {
		ttl = 3 * time.Minute
	}
	p := &SSHPool{conns: map[string]*pooledClient{}, ttl: ttl}
	go p.reap()
	return p
}

// Run 在池化连接上执行一条命令，返回合并的 stdout+stderr。dialFn 在缺连接时拨号。
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
	p.conns[key] = &pooledClient{client: client, lastUsed: time.Now()}
	p.mu.Unlock()
	return client, true, nil
}

func (p *SSHPool) drop(key string, client *ssh.Client) {
	p.mu.Lock()
	if pc := p.conns[key]; pc != nil && pc.client == client {
		delete(p.conns, key)
	}
	p.mu.Unlock()
	_ = client.Close()
}

func (p *SSHPool) reap() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for range t.C {
		now := time.Now()
		p.mu.Lock()
		for k, pc := range p.conns {
			if now.Sub(pc.lastUsed) > p.ttl {
				_ = pc.client.Close()
				delete(p.conns, k)
			}
		}
		p.mu.Unlock()
	}
}
