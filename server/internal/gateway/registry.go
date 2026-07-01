package gateway

import "sync"

// Registry 活跃会话注册表：sessionId → 关闭函数。
// 用于「强制下线」：管理员 disconnect 时真正切断正在桥接的连接。
type Registry struct {
	mu      sync.Mutex
	closers map[string]func()
}

func NewRegistry() *Registry {
	return &Registry{closers: map[string]func(){}}
}

// Add 注册一个活跃会话及其关闭函数。
func (r *Registry) Add(sessionID string, closer func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closers[sessionID] = closer
}

// Remove 注销（会话自然结束时调用）。
func (r *Registry) Remove(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.closers, sessionID)
}

// Kill 触发指定会话的关闭函数（强制下线）。返回是否命中活跃会话。
func (r *Registry) Kill(sessionID string) bool {
	r.mu.Lock()
	closer, ok := r.closers[sessionID]
	r.mu.Unlock()
	if ok && closer != nil {
		closer()
	}
	return ok
}

// Has 会话是否活跃。
func (r *Registry) Has(sessionID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.closers[sessionID]
	return ok
}
