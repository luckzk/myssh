package gateway

import (
	"strings"
	"testing"
)

// buildStream 构造一段贴近真实的首连输出：登录横幅 + 注入命令的原始回显 +
// shell 逐条执行时的提示符回显/真实 OSC 输出，末尾是干净提示符。
func buildStream() string {
	banner := "Last login: Fri Jul 10 12:02:20 2026 from 127.0.0.1\r\r\n"
	// 行规程一次性原始回显（\033 为字面反斜杠，token NTINITB/NTINITE 以字面 ASCII 出现）
	rawEcho := `printf '\033]1337;NTINITB\007'` + "\r\n" +
		`export PROMPT_COMMAND='printf "\033]7;file://%s%s\007" "$HOSTNAME" "$PWD"'` + "\r\n" +
		`printf '\033]1337;NTINITE\007'` + "\r\n"
	prompt := "\x1b]0;title\x07\x1b[?2004h[nttest@h ~]$ "
	// 逐条执行：提示符重绘命令 + 真实 OSC 输出
	exec := prompt + `printf '\033]1337;NTINITB\007'` + "\r\n\x1b[?2004l\r" +
		"\x1b]1337;NTINITB\x07" + // 真实起点 OSC（被吞）
		prompt + "export PROMPT_COMMAND=...\r\n\x1b[?2004l\r" +
		"\x1b]7;file://h/home/nttest\x07" + // 中途 PROMPT_COMMAND 触发的 OSC7（被吞）
		prompt + `printf '\033]1337;NTINITE\007'` + "\r\n\x1b[?2004l\r" +
		"\x1b]1337;NTINITE\x07" + // 真实终点 OSC —— 抑制到此为止
		"\x1b]7;file://h/home/nttest\x07" + // 终点后的 OSC7（保留）
		prompt // 干净提示符（保留）
	return banner + rawEcho + exec
}

func TestInitEchoFilterSuppressesEcho(t *testing.T) {
	stream := buildStream()
	f := NewInitEchoFilter()
	out := string(f.Filter([]byte(stream)))

	if !strings.HasPrefix(out, "Last login:") {
		t.Fatalf("登录横幅应保留，实际输出: %q", out)
	}
	if strings.Contains(out, "PROMPT_COMMAND") || strings.Contains(out, "NTINITB") {
		t.Fatalf("注入命令回显应被吞掉，实际输出仍含噪声: %q", out)
	}
	if !strings.HasSuffix(out, "[nttest@h ~]$ ") {
		t.Fatalf("末尾应是干净提示符，实际输出: %q", out)
	}
	if !strings.Contains(out, "\x1b]7;file://h/home/nttest\x07") {
		t.Fatalf("终点后的 OSC7 目录序列应保留，实际输出: %q", out)
	}
}

// 分块投喂（每 7 字节一块）应得到与整块一致的结果，验证跨块标记/半行处理。
func TestInitEchoFilterChunked(t *testing.T) {
	stream := buildStream()
	whole := string(NewInitEchoFilter().Filter([]byte(stream)))

	f := NewInitEchoFilter()
	var b strings.Builder
	for i := 0; i < len(stream); i += 7 {
		j := i + 7
		if j > len(stream) {
			j = len(stream)
		}
		b.Write(f.Filter([]byte(stream[i:j])))
	}
	if b.String() != whole {
		t.Fatalf("分块结果与整块不一致\n分块: %q\n整块: %q", b.String(), whole)
	}
}

// 实时开关模式：命中终点后连同其后重绘的提示符一并吞掉，切换后无任何可见输出。
func TestInitEchoFilterHideTrailing(t *testing.T) {
	prompt := "\x1b]0;title\x07\x1b[?2004h[nttest@h ~]$ "
	// 会话中切换：无横幅，首字节即为注入命令的回显，末尾是 shell 重绘的提示符。
	stream := prompt + `printf '\033]1337;NTINITB\007'` + "\r\n\x1b[?2004l\r" +
		"\x1b]1337;NTINITB\x07" +
		prompt + "unset PROMPT_COMMAND\r\n\x1b[?2004l\r" +
		prompt + `printf '\033]1337;NTINITE\007'` + "\r\n\x1b[?2004l\r" +
		"\x1b]1337;NTINITE\x07" + prompt // 终点 + 尾随提示符
	out := string(NewInitEchoFilterHideTrailing().Filter([]byte(stream)))
	if out != "" {
		t.Fatalf("实时开关应无任何可见输出，实际: %q", out)
	}

	// 跨块：终点标记与尾随提示符分处两个 PTY 读块，也不得残留重复提示符。
	head := prompt + `printf '\033]1337;NTINITB\007'` + "\r\n\x1b[?2004l\r" +
		"\x1b]1337;NTINITB\x07" +
		prompt + "unset PROMPT_COMMAND\r\n\x1b[?2004l\r" +
		prompt + `printf '\033]1337;NTINITE\007'` + "\r\n\x1b[?2004l\r" +
		"\x1b]1337;NTINITE\x07" // 到终点标记为止是第一块
	tail := prompt // 尾随提示符在第二块
	f := NewInitEchoFilterHideTrailing()
	got := string(f.Filter([]byte(head))) + string(f.Filter([]byte(tail)))
	if got != "" {
		t.Fatalf("跨块实时开关应无任何可见输出，实际: %q", got)
	}
	// 排空结束后，后续真实输出应正常放行。
	if s := string(f.Filter([]byte("hello"))); s != "hello" {
		t.Fatalf("排空后应恢复放行，实际: %q", s)
	}
}

// 兜底：迟迟不出现终点标记时，超预算即全量放行，不得无限吞字节。
func TestInitEchoFilterBudgetFallback(t *testing.T) {
	f := NewInitEchoFilter()
	// 触发起点进入抑制，但永不给终点标记。
	_ = f.Filter([]byte("banner\n" + `printf '\033]1337;NTINITB\007'` + "\r\n"))
	big := strings.Repeat("x", initFilterBudget+16)
	out := string(f.Filter([]byte(big)))
	if !strings.Contains(out, "xxxx") {
		t.Fatalf("超预算后应全量放行，实际输出: %q", out)
	}
	if f.phase != 2 {
		t.Fatalf("超预算后应进入 phase 2（完成），实际 phase=%d", f.phase)
	}
}
