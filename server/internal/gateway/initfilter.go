package gateway

import "bytes"

// 初始化回显过滤：openTerminal 会向 SSH 会话注入一段初始命令（cd 默认目录、用户初始命令、
// 以及设置 PROMPT_COMMAND 输出 OSC7 的 osc7Init）。远端 shell 的行规程会把这些命令原样回显，
// 用户在首连时会看到一串 `export PROMPT_COMMAND=...` 之类的噪声。
//
// 方案：注入前用一对 printf OSC 标记把初始命令包起来（WrapInitCmd）；InitEchoFilter 作用在
// 送往前端/录像/回滚缓冲的「可见流」上，吞掉两个标记之间的全部回显，用户完全无感。
// DirScanner 仍喂原始字节，目录同步不受影响。
const (
	// initBeginCmd 首个注入命令：其回显里含字面 ASCII token（见 initTokBegin），作为抑制起点。
	initBeginCmd = "printf '\\033]1337;NTINITB\\007'\n"
	// initEndCmd 末个注入命令：真正执行时输出真实 OSC（见 initMarkerEnd），作为抑制终点。
	initEndCmd = "printf '\\033]1337;NTINITE\\007'\n"
)

var (
	// initTokBegin 命令回显里的字面 ASCII（`\033` 为字面反斜杠），首次出现即进入抑制区。
	initTokBegin = []byte("NTINITB")
	// initMarkerEnd 末命令 printf 执行时输出的真实 OSC 字节（ESC/BEL 为真实控制字符），
	// 与回显的字面文本不同，可可靠区分「命令回显」与「命令输出」，作为抑制终点。
	initMarkerEnd = []byte("\x1b]1337;NTINITE\x07")
	// initPromptAnchor bash 每次重绘提示符前输出的 bracketed-paste 开启序列，作为「提示符已到达」锚点。
	initPromptAnchor = []byte("\x1b[?2004h")
	// initFilterBudget 兜底：初始化迟迟不结束（非 bash / 无回显 / 标记丢失）时放弃过滤、全量放行，
	// 避免过滤器无限吞字节卡死终端。正常 bash 下标记在首个几百字节内即到达。
	initFilterBudget = 1 << 16
)

// WrapInitCmd 用起止标记 printf 包裹初始命令，供 InitEchoFilter 精确剔除其回显。
func WrapInitCmd(inner string) string { return initBeginCmd + inner + initEndCmd }

// InitEchoFilter 单协程（stdout 泵）状态机：吞掉初始命令回显，只放行标记之外的可见字节。
type InitEchoFilter struct {
	phase        int    // 0=横幅放行/找起点; 1=抑制中/找终点; 2=完成/全量放行; 3=排空尾随提示符(hideTrailing)
	pending      []byte // phase0 暂存半行 / phase1 暂存跨块尾巴
	seen         int
	hideTrailing bool // true：命中终点后连同其后 shell 重绘的提示符一并吞掉
}

// NewInitEchoFilter 新建过滤器（首连注入用）：命中终点后放行其后的首个提示符。
func NewInitEchoFilter() *InitEchoFilter { return &InitEchoFilter{} }

// NewInitEchoFilterHideTrailing 新建过滤器（会话中实时开关注入用）：连注入后 shell 重绘的
// 提示符也吞掉，使切换对用户完全无感（屏幕上原有提示符保持不变，不出现重复提示符）。
func NewInitEchoFilterHideTrailing() *InitEchoFilter { return &InitEchoFilter{hideTrailing: true} }

// Filter 输入一块原始输出，返回应对前端可见的字节；初始命令回显被吞掉。
func (f *InitEchoFilter) Filter(chunk []byte) []byte {
	if f.phase == 2 {
		return chunk
	}
	// phase 3：hideTrailing 专用「排空尾随提示符」——终点标记与 shell 重绘的提示符分处不同
	// PTY 读块时，继续吞后续块，直到命中提示符重绘锚点（bracketed-paste 开）为止，避免残留重复提示符。
	if f.phase == 3 {
		f.seen += len(chunk)
		if f.seen > initFilterBudget || bytes.Contains(chunk, initPromptAnchor) {
			f.phase = 2 // 提示符块整体吞掉即完成；兜底超预算亦放行后续，避免卡死
		}
		return nil
	}
	f.seen += len(chunk)
	f.pending = append(f.pending, chunk...)

	// 兜底：初始化异常，放弃过滤，把暂存与后续全部放行。
	if f.seen > initFilterBudget {
		out := f.pending
		f.pending = nil
		f.phase = 2
		return out
	}

	var out []byte
	if f.phase == 0 {
		i := bytes.Index(f.pending, initTokBegin)
		if i < 0 {
			// 未见起点：放行已完整的行（横幅/MOTD），保留最后半行以兼容跨块的标记/前缀。
			return f.takeCompleteLines()
		}
		// 命中起点：token 所在物理行的行首之前（横幅）放行，行首起（提示符+命令）进入抑制。
		nl := bytes.LastIndexByte(f.pending[:i], '\n')
		out = append(out, f.pending[:nl+1]...) // nl=-1 → 放行空
		f.pending = append(f.pending[:0], f.pending[nl+1:]...)
		f.phase = 1
	}

	// phase == 1：抑制中，找终点真实 OSC。
	j := bytes.Index(f.pending, initMarkerEnd)
	if j < 0 {
		// 未见终点：全部吞掉，仅保留末尾少量字节以兼容跨块拆分的终点标记。
		keep := len(initMarkerEnd) - 1
		if len(f.pending) > keep {
			f.pending = append(f.pending[:0], f.pending[len(f.pending)-keep:]...)
		}
		return out
	}
	// 命中终点：结束过滤。
	if !f.hideTrailing {
		// 首连：其后字节（OSC7 目录 + 干净提示符）放行。
		out = append(out, f.pending[j+len(initMarkerEnd):]...)
		f.pending = nil
		f.phase = 2
		return out
	}
	// 实时开关：终点其后是 shell 重绘的提示符，一并吞掉（屏幕保持原样）；OSC7 目录由
	// DirScanner 从原始流单独处理，不受影响。若提示符已在本块（含锚点）即完成；
	// 否则进入 phase 3 继续排空后续块，直到提示符到达。
	rest := f.pending[j+len(initMarkerEnd):]
	f.pending = nil
	if bytes.Contains(rest, initPromptAnchor) {
		f.phase = 2
	} else {
		f.phase = 3
	}
	return out
}

// takeCompleteLines 放行 pending 中最后一个换行及之前的完整行，剩余半行留存。
func (f *InitEchoFilter) takeCompleteLines() []byte {
	nl := bytes.LastIndexByte(f.pending, '\n')
	if nl < 0 {
		return nil
	}
	out := append([]byte(nil), f.pending[:nl+1]...)
	f.pending = append(f.pending[:0], f.pending[nl+1:]...)
	return out
}
