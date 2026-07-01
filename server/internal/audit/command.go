package audit

import (
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/google/uuid"
)

// CommandParser 对用户输入做行缓冲，遇回车切分为一条命令写日志。
// 已知局限：仅近似还原（处理可见字符与退格），交互式/全屏程序内的输入无法逐命令审计。
type CommandParser struct {
	store *store.Store
	sess  *model.ConnSession
	buf   []rune
}

func NewCommandParser(s *store.Store, sess *model.ConnSession) *CommandParser {
	return &CommandParser{store: s, sess: sess}
}

// Feed 喂入一段用户输入字节。
func (p *CommandParser) Feed(b []byte) {
	for _, r := range string(b) {
		switch r {
		case '\r', '\n':
			p.flush()
		case 0x7f, '\b': // 退格
			if len(p.buf) > 0 {
				p.buf = p.buf[:len(p.buf)-1]
			}
		case 0x03: // Ctrl-C，丢弃当前行
			p.buf = p.buf[:0]
		default:
			if r >= 0x20 { // 可见字符
				p.buf = append(p.buf, r)
			}
		}
	}
}

func (p *CommandParser) flush() {
	cmd := strings.TrimSpace(string(p.buf))
	p.buf = p.buf[:0]
	if cmd == "" {
		return
	}
	p.store.DB.Create(&model.ExecCommandLog{
		ID: uuid.NewString(), SessionID: p.sess.ID, UserID: p.sess.UserID,
		AssetID: p.sess.AssetID, Command: cmd, CreatedAt: model.NowMillis(),
	})
}
