package gateway

import (
	"io"
	"os"
	"runtime"
	"strings"

	"github.com/aymanbagabas/go-pty"
)

// 本地终端：给"运行后端的这台机器"开一个 shell（跨平台，经 go-pty：Unix PTY / Windows ConPTY）。
// 极敏感——是否放行由 access 层的开关 + 管理员校验决定，本文件只负责起 shell。

type localSession struct {
	pty pty.Pty
	cmd *pty.Cmd
}

// resolveShell 选定 shell（可自定义，支持 "bash -l" 之类带参数）；空则按平台默认。
func resolveShell(shell string) (string, []string) {
	if s := strings.TrimSpace(shell); s != "" {
		parts := strings.Fields(s)
		return parts[0], parts[1:]
	}
	if runtime.GOOS == "windows" {
		return "powershell.exe", nil
	}
	if s := os.Getenv("SHELL"); s != "" {
		return s, nil
	}
	if _, err := os.Stat("/bin/bash"); err == nil {
		return "/bin/bash", nil
	}
	return "/bin/sh", nil
}

func dialLocal(shell string, cols, rows int) (TermSession, error) {
	p, err := pty.New()
	if err != nil {
		return nil, err
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	name, args := resolveShell(shell)
	cmd := p.Command(name, args...)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	_ = p.Resize(cols, rows)
	if err := cmd.Start(); err != nil {
		_ = p.Close()
		return nil, err
	}
	go func() { _ = cmd.Wait() }() // 回收进程，避免僵尸
	return &localSession{pty: p, cmd: cmd}, nil
}

func (s *localSession) Stdin() io.Writer            { return s.pty }
func (s *localSession) Stdout() io.Reader           { return s.pty }
func (s *localSession) Stderr() io.Reader           { return nil }
func (s *localSession) Resize(cols, rows int) error { return s.pty.Resize(cols, rows) }
func (s *localSession) KeepAlive() error            { return nil }
func (s *localSession) Exec(string) (string, error) { return "", errNotSupported }
func (s *localSession) Close() error {
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return s.pty.Close()
}
