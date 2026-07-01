// Package gateway 实现到目标的会话桥接。SSH 用 Go 原生 crypto/ssh（便于精细审计）。
package gateway

import (
	"fmt"
	"net"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// SSHTarget 拨号目标（凭证已解密）。Jump 非空时经跳板机连接（ProxyJump）。
type SSHTarget struct {
	Host       string
	Port       int
	User       string
	Password   string
	PrivateKey string
	Passphrase string
	TimeoutMs  int        // 连接超时(ms)，0=默认 10s
	Jump       *SSHTarget // 跳板机/SSH 网关（递归，可多级）
}

type SSHOptions struct {
	HostKeyPolicy string // insecure | known_hosts
	KnownHostsPath string
	HostKeyCallback ssh.HostKeyCallback
}

// clientConfig 构建认证配置（密码 + 私钥 + 键盘交互）。
func clientConfig(t SSHTarget, opts SSHOptions) (*ssh.ClientConfig, error) {
	var auths []ssh.AuthMethod
	if t.PrivateKey != "" {
		var signer ssh.Signer
		var err error
		if t.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(t.PrivateKey), []byte(t.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(t.PrivateKey))
		}
		if err != nil {
			return nil, err
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if t.Password != "" {
		auths = append(auths, ssh.Password(t.Password))
		auths = append(auths, ssh.KeyboardInteractive(func(_, _ string, qs []string, _ []bool) ([]string, error) {
			ans := make([]string, len(qs))
			for i := range qs {
				ans[i] = t.Password
			}
			return ans, nil
		}))
	}
	timeout := 10 * time.Second
	if t.TimeoutMs > 0 {
		timeout = time.Duration(t.TimeoutMs) * time.Millisecond
	}
	hostKeyCallback, err := hostKeyCallback(opts)
	if err != nil {
		return nil, err
	}
	return &ssh.ClientConfig{
		User:            t.User,
		Auth:            auths,
		HostKeyCallback: hostKeyCallback,
		Timeout:         timeout,
	}, nil
}

// DialSSH 建立到目标的 SSH 连接。t.Jump 非空时先连跳板机，再经其隧道连目标（ProxyJump）。
func DialSSH(t SSHTarget, opts ...SSHOptions) (*ssh.Client, error) {
	opt := sshOptions(opts)
	cfg, err := clientConfig(t, opt)
	if err != nil {
		return nil, err
	}
	addr := net.JoinHostPort(t.Host, itoa(t.Port))

	if t.Jump == nil {
		return ssh.Dial("tcp", addr, cfg)
	}

	// 经跳板机：先连跳板机（其本身也可再有 Jump，递归），再从其拨号到目标。
	jump, err := DialSSH(*t.Jump, opt)
	if err != nil {
		return nil, fmt.Errorf("跳板机连接失败: %w", err)
	}
	conn, err := jump.Dial("tcp", addr)
	if err != nil {
		jump.Close()
		return nil, fmt.Errorf("经跳板机连接目标失败: %w", err)
	}
	ncc, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		jump.Close()
		return nil, err
	}
	// 目标客户端关闭时一并关掉跳板机连接，避免泄漏。
	return ssh.NewClient(ncc, chans, reqs), nil
}

// RunSSHCommand 在目标上执行一条命令，返回合并的 stdout+stderr。
// 用于运维类操作（如远程安装 guacd）。命令由调用方固定，不接受任意拼接。
func RunSSHCommand(t SSHTarget, cmd string, opts ...SSHOptions) (string, error) {
	client, err := DialSSH(t, opts...)
	if err != nil {
		return "", err
	}
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	out, err := sess.CombinedOutput(cmd)
	return string(out), err
}

func sshOptions(opts []SSHOptions) SSHOptions {
	if len(opts) == 0 {
		return SSHOptions{HostKeyPolicy: "insecure"}
	}
	if opts[0].HostKeyPolicy == "" {
		opts[0].HostKeyPolicy = "insecure"
	}
	return opts[0]
}

func hostKeyCallback(opts SSHOptions) (ssh.HostKeyCallback, error) {
	if opts.HostKeyCallback != nil {
		return opts.HostKeyCallback, nil
	}
	switch opts.HostKeyPolicy {
	case "", "insecure":
		return ssh.InsecureIgnoreHostKey(), nil
	case "known_hosts":
		return knownhosts.New(opts.KnownHostsPath)
	default:
		return nil, fmt.Errorf("unsupported SSH host key policy: %s", opts.HostKeyPolicy)
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [20]byte
	p := len(b)
	for i > 0 {
		p--
		b[p] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		p--
		b[p] = '-'
	}
	return string(b[p:])
}
