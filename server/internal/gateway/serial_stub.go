//go:build !linux

package gateway

// 非 Linux 平台暂不支持串口（termios 为 Linux 专有实现）。
func dialSerial(path string, baud int) (TermSession, error) {
	return nil, errNotSupported
}
