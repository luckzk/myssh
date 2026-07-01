package gateway

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"time"
)

// GuacParams guacd 连接参数（凭证已解密）。
type GuacParams struct {
	Protocol string // vnc | rdp | telnet ...
	Hostname string
	Port     int
	Username string
	Password string
	Width    int
	Height   int
	DPI      int
	Extra    map[string]string // 额外参数（如 ignore-cert、security、color-depth）
}

// GuacdConn 已完成握手、就绪可桥接的 guacd 连接。
type GuacdConn struct {
	conn   net.Conn
	reader *InstructionReader
	UUID   string // ready 返回的连接 id
}

func (g *GuacdConn) Close() { _ = g.conn.Close() }

// DialAndHandshake 连接 guacd 并完成握手，返回就绪连接。
func DialAndHandshake(guacdAddr string, p GuacParams) (*GuacdConn, error) {
	conn, err := net.DialTimeout("tcp", guacdAddr, 10*time.Second)
	if err != nil {
		return nil, fmt.Errorf("连接 guacd 失败: %w", err)
	}
	br := bufio.NewReader(conn)
	reader := NewInstructionReader(br)

	write := func(s string) error {
		_, e := conn.Write([]byte(s))
		return e
	}

	// 1. select 协议
	if err := write(FormatInstruction("select", p.Protocol)); err != nil {
		conn.Close()
		return nil, err
	}
	// 2. 读 args（首元素为版本，其余为参数名）
	op, args, err := reader.ReadInstruction()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("读取 args 失败: %w", err)
	}
	if op != "args" {
		conn.Close()
		return nil, fmt.Errorf("期望 args，收到 %q", op)
	}

	// 3. size / audio / video / image
	if p.Width <= 0 {
		p.Width = 1024
	}
	if p.Height <= 0 {
		p.Height = 768
	}
	if p.DPI <= 0 {
		p.DPI = 96
	}
	_ = write(FormatInstruction("size", itoa(p.Width), itoa(p.Height), itoa(p.DPI)))
	_ = write(FormatInstruction("audio"))
	_ = write(FormatInstruction("video"))
	_ = write(FormatInstruction("image"))

	// 4. connect：按 args 顺序回每个参数值
	values := buildConnectValues(args, p)
	if err := write(FormatInstruction("connect", values...)); err != nil {
		conn.Close()
		return nil, err
	}

	// 5. 等待 ready
	for {
		op, a, err := reader.ReadInstruction()
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("等待 ready 失败: %w", err)
		}
		switch op {
		case "ready":
			id := ""
			if len(a) > 0 {
				id = a[0]
			}
			return &GuacdConn{conn: conn, reader: reader, UUID: id}, nil
		case "error":
			conn.Close()
			return nil, fmt.Errorf("guacd 错误: %s", strings.Join(a, " "))
		}
		// 其它指令（如 log）忽略，继续等 ready
	}
}

// buildConnectValues 按 guacd 返回的 arg 名称顺序，填入参数值。
func buildConnectValues(argNames []string, p GuacParams) []string {
	m := map[string]string{
		"hostname":     p.Hostname,
		"port":         itoa(p.Port),
		"username":     p.Username,
		"password":     p.Password,
		"width":        itoa(p.Width),
		"height":       itoa(p.Height),
		"dpi":          itoa(p.DPI),
		"ignore-cert":  "true",
		"security":     "any",
		"color-depth":  "24",
		"resize-method": "display-update",
	}
	for k, v := range p.Extra {
		m[k] = v
	}
	values := make([]string, 0, len(argNames))
	for i, name := range argNames {
		// args[0] 通常是版本号（VERSION_x_y_z），connect 也需占位回传
		if i == 0 && strings.HasPrefix(name, "VERSION") {
			values = append(values, name)
			continue
		}
		values = append(values, m[name]) // 未知参数回空串
	}
	return values
}

// ReadRaw 读取下一条 guacd→网关 的原始指令（用于桥接到前端）。
func (g *GuacdConn) ReadRaw() (string, error) { return g.reader.ReadRaw() }

// Write 把前端指令原样写给 guacd。
func (g *GuacdConn) Write(s string) error {
	_, err := g.conn.Write([]byte(s))
	return err
}
