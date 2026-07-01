package gateway

import (
	"bufio"
	"strconv"
	"strings"
)

// guacamole 协议编解码。
// 指令格式：每个元素 `<字节长度>.<值>`，逗号分隔，分号结尾。
// 例：`4.size,4.1024,3.768,2.96;`

// FormatInstruction 把 opcode + 参数编码为一条 guacamole 指令。
func FormatInstruction(opcode string, args ...string) string {
	var b strings.Builder
	writeElem(&b, opcode)
	for _, a := range args {
		b.WriteByte(',')
		writeElem(&b, a)
	}
	b.WriteByte(';')
	return b.String()
}

func writeElem(b *strings.Builder, s string) {
	// 长度按 UTF-8 码点数（guacamole 用字符数，非字节数）。
	b.WriteString(strconv.Itoa(len([]rune(s))))
	b.WriteByte('.')
	b.WriteString(s)
}

// InstructionReader 从流中逐条读取 guacamole 指令。
type InstructionReader struct {
	r *bufio.Reader
}

func NewInstructionReader(r *bufio.Reader) *InstructionReader {
	return &InstructionReader{r: r}
}

// ReadRaw 读取一条完整指令（含结尾分号）的原始文本。
func (ir *InstructionReader) ReadRaw() (string, error) {
	var sb strings.Builder
	for {
		// 读长度数字
		lenStr, err := ir.readUntil('.')
		if err != nil {
			return "", err
		}
		sb.WriteString(lenStr)
		sb.WriteByte('.')
		n, err := strconv.Atoi(strings.TrimSpace(lenStr))
		if err != nil {
			return "", err
		}
		// 读 n 个字符（rune）
		val := make([]rune, 0, n)
		for i := 0; i < n; i++ {
			ch, _, err := ir.r.ReadRune()
			if err != nil {
				return "", err
			}
			val = append(val, ch)
		}
		sb.WriteString(string(val))
		// 分隔符：',' 继续，';' 结束
		sep, _, err := ir.r.ReadRune()
		if err != nil {
			return "", err
		}
		sb.WriteRune(sep)
		if sep == ';' {
			return sb.String(), nil
		}
	}
}

// ReadInstruction 读取并解析为 (opcode, args)。
func (ir *InstructionReader) ReadInstruction() (string, []string, error) {
	raw, err := ir.ReadRaw()
	if err != nil {
		return "", nil, err
	}
	elems := parseElements(raw)
	if len(elems) == 0 {
		return "", nil, nil
	}
	return elems[0], elems[1:], nil
}

func (ir *InstructionReader) readUntil(delim byte) (string, error) {
	var sb strings.Builder
	for {
		ch, err := ir.r.ReadByte()
		if err != nil {
			return "", err
		}
		if ch == delim {
			return sb.String(), nil
		}
		sb.WriteByte(ch)
	}
}

// parseElements 解析 `len.val,len.val;` → 值数组。
func parseElements(raw string) []string {
	var out []string
	i := 0
	for i < len(raw) {
		// 读长度
		dot := strings.IndexByte(raw[i:], '.')
		if dot < 0 {
			break
		}
		n, err := strconv.Atoi(raw[i : i+dot])
		if err != nil {
			break
		}
		i += dot + 1
		runes := []rune(raw[i:])
		if n > len(runes) {
			n = len(runes)
		}
		val := string(runes[:n])
		out = append(out, val)
		i += len(val)
		if i < len(raw) && (raw[i] == ',' || raw[i] == ';') {
			i++
		}
	}
	return out
}
