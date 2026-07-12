package gateway

import (
	"errors"
	"io"

	"golang.org/x/crypto/ssh"
)

// TermSession 抽象「一个可交互终端连接」，屏蔽 SSH / telnet 差异，供 LiveSession 统一使用。
type TermSession interface {
	Stdin() io.Writer
	Stdout() io.Reader
	Stderr() io.Reader // 可能为 nil（telnet 只有单流）
	Resize(cols, rows int) error
	KeepAlive() error
	Exec(cmd string) (string, error) // 旁路执行一条命令（telnet 不支持）
	Close() error
}

// DialTerminal 按协议建立终端连接。telnet 走自实现的最小客户端，其余按 SSH。
func DialTerminal(t SSHTarget, protocol string, cols, rows int, opts ...SSHOptions) (TermSession, error) {
	switch protocol {
	case "telnet":
		return dialTelnet(t, cols, rows)
	case "serial":
		return dialSerial(t.Host, t.Port) // Host=设备路径, Port=波特率
	case "local":
		return dialLocal(t.User, cols, rows) // User=可选自定义 shell
	default:
		return dialSSHTerminal(t, cols, rows, opts...)
	}
}

// ---- SSH 实现 ----

type sshTermSession struct {
	client *ssh.Client
	sess   *ssh.Session
	stdin  io.WriteCloser
	stdout io.Reader
	stderr io.Reader
}

func dialSSHTerminal(t SSHTarget, cols, rows int, opts ...SSHOptions) (TermSession, error) {
	client, err := DialSSH(t, opts...)
	if err != nil {
		return nil, err
	}
	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, err
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		sess.Close()
		client.Close()
		return nil, err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return nil, err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return nil, err
	}
	stderr, _ := sess.StderrPipe()
	if err := sess.Shell(); err != nil {
		sess.Close()
		client.Close()
		return nil, err
	}
	return &sshTermSession{client: client, sess: sess, stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

func (s *sshTermSession) Stdin() io.Writer  { return s.stdin }
func (s *sshTermSession) Stdout() io.Reader { return s.stdout }
func (s *sshTermSession) Stderr() io.Reader { return s.stderr }
func (s *sshTermSession) Resize(cols, rows int) error {
	return s.sess.WindowChange(rows, cols)
}
func (s *sshTermSession) KeepAlive() error {
	_, _, err := s.client.SendRequest("keepalive@openssh.com", true, nil)
	return err
}
func (s *sshTermSession) Exec(cmd string) (string, error) {
	es, err := s.client.NewSession()
	if err != nil {
		return "", err
	}
	defer es.Close()
	out, err := es.CombinedOutput(cmd)
	return string(out), err
}
func (s *sshTermSession) Close() error {
	if s.sess != nil {
		_ = s.sess.Close()
	}
	if s.client != nil {
		return s.client.Close()
	}
	return nil
}

// SSHClient 暴露底层 SSH 客户端，供复用（如在同一连接上开 SFTP 子系统，免二次拨号）。
func (s *sshTermSession) SSHClient() *ssh.Client { return s.client }

// SSHClientProvider 由持有 *ssh.Client 的 TermSession 实现（仅 SSH）；用于复用底层连接。
type SSHClientProvider interface{ SSHClient() *ssh.Client }

var errNotSupported = errors.New("该操作在当前协议下不支持")
