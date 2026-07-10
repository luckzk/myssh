//go:build linux

package gateway

import (
	"fmt"
	"io"
	"os"

	"golang.org/x/sys/unix"
)

// 串口（Serial）终端 Linux 实现：termios 打开本地串口（8N1 + 波特率）。

var baudFlags = map[int]uint32{
	1200: unix.B1200, 2400: unix.B2400, 4800: unix.B4800, 9600: unix.B9600,
	19200: unix.B19200, 38400: unix.B38400, 57600: unix.B57600,
	115200: unix.B115200, 230400: unix.B230400, 460800: unix.B460800, 921600: unix.B921600,
}

type serialSession struct {
	f *os.File
}

func dialSerial(path string, baud int) (TermSession, error) {
	if path == "" {
		return nil, fmt.Errorf("串口设备路径为空")
	}
	if !serialPathAllowed(path) {
		return nil, fmt.Errorf("不允许的串口设备路径：%s", path)
	}
	if baud <= 0 {
		baud = 9600
	}
	speed, ok := baudFlags[baud]
	if !ok {
		return nil, fmt.Errorf("不支持的波特率：%d", baud)
	}
	fd, err := unix.Open(path, unix.O_RDWR|unix.O_NOCTTY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("打开串口失败：%w", err)
	}
	t, err := unix.IoctlGetTermios(fd, unix.TCGETS)
	if err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("读取串口属性失败：%w", err)
	}
	t.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP | unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	t.Oflag &^= unix.OPOST
	t.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	t.Cflag &^= unix.CSIZE | unix.PARENB | unix.CBAUD
	t.Cflag |= unix.CS8 | unix.CREAD | unix.CLOCAL | speed
	t.Ispeed = speed
	t.Ospeed = speed
	t.Cc[unix.VMIN] = 1
	t.Cc[unix.VTIME] = 0
	if err := unix.IoctlSetTermios(fd, unix.TCSETS, t); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("设置串口属性失败：%w", err)
	}
	if flags, e := unix.FcntlInt(uintptr(fd), unix.F_GETFL, 0); e == nil {
		_, _ = unix.FcntlInt(uintptr(fd), unix.F_SETFL, flags&^unix.O_NONBLOCK)
	}
	return &serialSession{f: os.NewFile(uintptr(fd), path)}, nil
}

func (s *serialSession) Stdin() io.Writer            { return s.f }
func (s *serialSession) Stdout() io.Reader           { return s.f }
func (s *serialSession) Stderr() io.Reader           { return nil }
func (s *serialSession) Resize(cols, rows int) error { return nil }
func (s *serialSession) KeepAlive() error            { return nil }
func (s *serialSession) Exec(string) (string, error) { return "", errNotSupported }
func (s *serialSession) Close() error                { return s.f.Close() }
