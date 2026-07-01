// Package audit 旁路审计：终端录像（asciinema v2）与命令解析。
package audit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Recorder 录像工厂，持有存储目录。
type Recorder struct {
	dir string
}

func NewRecorder(dir string) *Recorder {
	_ = os.MkdirAll(dir, 0o750)
	return &Recorder{dir: dir}
}

// Recording 单次会话录像，asciinema v2 格式（首行 header，其后逐帧 [偏移秒,"o",数据]）。
type Recording struct {
	mu    sync.Mutex
	f     *os.File
	path  string
	start time.Time
}

// Start 创建录像文件并写入 header。
func (r *Recorder) Start(sessionID string, cols, rows int) *Recording {
	path := filepath.Join(r.dir, sessionID+".cast")
	f, err := os.Create(path)
	if err != nil {
		return &Recording{} // 降级：录像失败不阻断会话
	}
	header := map[string]any{
		"version": 2, "width": cols, "height": rows,
		"timestamp": time.Now().Unix(), "env": map[string]string{"TERM": "xterm-256color"},
	}
	b, _ := json.Marshal(header)
	_, _ = f.Write(append(b, '\n'))
	return &Recording{f: f, path: path, start: time.Now()}
}

// WriteOutput 追加一帧终端输出。
func (rec *Recording) WriteOutput(data []byte) {
	if rec.f == nil {
		return
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	offset := time.Since(rec.start).Seconds()
	frame, _ := json.Marshal([]any{offset, "o", string(data)})
	_, _ = rec.f.Write(append(frame, '\n'))
}

// Close 关闭录像并返回存储路径（用于落 session.recording_path）。
func (rec *Recording) Close() string {
	if rec.f == nil {
		return ""
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	_ = rec.f.Close()
	return rec.path
}
