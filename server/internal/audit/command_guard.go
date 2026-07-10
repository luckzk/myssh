package audit

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/google/uuid"
)

// CommandGuard 命令过滤 + 审计：对用户输入做行还原，回车时评估整行命令，
// 命中 block 规则则拦截（吞回车 + 注入 Ctrl-U 清远端行），warn 则放行但标高风险；
// 全屏程序（alt-screen）内不解析、不过滤。取代 live 会话里的 CommandParser 记录。
//
// 已知局限：行还原为近似（Tab 补全/历史/多行粘贴可能漏判误判），拦截为尽力而为。
type CommandGuard struct {
	store *store.Store
	sess  *model.ConnSession

	mu    sync.Mutex
	rules []compiledRule
	line  []rune
	alt   bool
}

type compiledRule struct {
	re     *regexp.Regexp
	action string // block | warn
}

// NewCommandGuard 按会话的用户/资产加载并预编译适用的启用规则。
func NewCommandGuard(s *store.Store, sess *model.ConnSession) *CommandGuard {
	g := &CommandGuard{store: s, sess: sess}
	var filters []model.CommandFilter
	s.DB.Where("enabled = ?", true).Find(&filters)
	applicable := make([]model.CommandFilter, 0, len(filters))
	for _, f := range filters {
		if idMatch(f.UserIDs, sess.UserID) && idMatch(f.AssetIDs, sess.AssetID) {
			applicable = append(applicable, f)
		}
	}
	sort.SliceStable(applicable, func(i, j int) bool { return applicable[i].Priority < applicable[j].Priority })
	for _, f := range applicable {
		re, err := compilePattern(f.Pattern, f.Regex)
		if err != nil {
			continue // 非法正则忽略该规则
		}
		action := f.Action
		if action != "block" {
			action = "warn"
		}
		g.rules = append(g.rules, compiledRule{re: re, action: action})
	}
	return g
}

// idMatch 空列表=全局命中；否则须包含 id。
func idMatch(jsonIDs, id string) bool {
	if strings.TrimSpace(jsonIDs) == "" {
		return true
	}
	var ids []string
	if json.Unmarshal([]byte(jsonIDs), &ids) != nil || len(ids) == 0 {
		return true
	}
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func isWord(b byte) bool {
	return b == '_' || (b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// compilePattern 字面量→带条件词边界的转义式；正则→原样；统一忽略大小写。
func compilePattern(pattern string, isRegex bool) (*regexp.Regexp, error) {
	src := pattern
	if !isRegex {
		q := regexp.QuoteMeta(pattern)
		if len(pattern) > 0 {
			if isWord(pattern[0]) {
				q = `\b` + q
			}
			if isWord(pattern[len(pattern)-1]) {
				q = q + `\b`
			}
		}
		src = q
	}
	return regexp.Compile(`(?i)` + src)
}

// SetAltScreen 由输出侧扫描到 alt-screen 切换时调用。
func (g *CommandGuard) SetAltScreen(on bool) {
	g.mu.Lock()
	g.alt = on
	if on {
		g.line = g.line[:0]
	}
	g.mu.Unlock()
}

// evaluate 返回命中动作：任一 block 命中→block，否则任一 warn 命中→warn，否则 ""。
func (g *CommandGuard) evaluate(cmd string) string {
	warn := false
	for _, r := range g.rules {
		if r.re.MatchString(cmd) {
			if r.action == "block" {
				return "block"
			}
			warn = true
		}
	}
	if warn {
		return "warn"
	}
	return ""
}

// ProcessInput 处理一段用户输入，返回应下发到远端的字节与需回显给终端的提示。
func (g *CommandGuard) ProcessInput(b []byte) (forward []byte, notice string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.alt {
		return b, "" // 全屏程序内透传，不解析
	}
	out := make([]byte, 0, len(b)+2)
	lineStart := 0
	for _, r := range string(b) {
		switch r {
		case '\r', '\n':
			cmd := strings.TrimSpace(string(g.line))
			g.line = g.line[:0]
			act := ""
			if cmd != "" {
				act = g.evaluate(cmd)
			}
			if act == "block" {
				out = out[:lineStart]           // 丢弃本段已键入的该命令
				out = append(out, 0x15)          // Ctrl-U 清空远端当前行
				notice = "\r\n\x1b[31m[命令已拦截] " + cmd + "\x1b[0m\r\n"
				g.log(cmd, "blocked")
				lineStart = len(out)
				continue
			}
			if cmd != "" {
				g.log(cmd, act) // "warn" 或 ""
			}
			out = append(out, byte(r))
			lineStart = len(out)
		case 0x7f, '\b':
			if n := len(g.line); n > 0 {
				g.line = g.line[:n-1]
			}
			out = appendRune(out, r)
		case 0x15, 0x03: // Ctrl-U / Ctrl-C 清行
			g.line = g.line[:0]
			out = appendRune(out, r)
		default:
			if r >= 0x20 {
				g.line = append(g.line, r)
			}
			out = appendRune(out, r)
		}
	}
	return out, notice
}

func appendRune(out []byte, r rune) []byte {
	return append(out, []byte(string(r))...)
}

func (g *CommandGuard) log(cmd, risk string) {
	g.store.DB.Create(&model.ExecCommandLog{
		ID: uuid.NewString(), SessionID: g.sess.ID, UserID: g.sess.UserID,
		AssetID: g.sess.AssetID, Command: cmd, RiskLevel: risk, CreatedAt: model.NowMillis(),
	})
}
