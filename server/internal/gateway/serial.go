package gateway

import (
	"strings"
	"sync"
)

// 串口设备路径白名单（跨平台通用；实际打开逻辑见 serial_linux.go / serial_stub.go）。

var (
	serialMu    sync.RWMutex
	serialAllow = []string{"/dev/tty", "/dev/serial/"}
)

// SetSerialAllow 由启动时注入允许的设备路径前缀（config.SerialAllow）。
func SetSerialAllow(prefixes []string) {
	serialMu.Lock()
	defer serialMu.Unlock()
	if len(prefixes) > 0 {
		serialAllow = prefixes
	}
}

func serialPathAllowed(path string) bool {
	serialMu.RLock()
	defer serialMu.RUnlock()
	for _, p := range serialAllow {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}
