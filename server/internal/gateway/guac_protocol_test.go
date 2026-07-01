package gateway

import (
	"bufio"
	"strings"
	"testing"
)

func TestFormatInstruction(t *testing.T) {
	got := FormatInstruction("size", "1024", "768", "96")
	want := "4.size,4.1024,3.768,2.96;"
	if got != want {
		t.Fatalf("FormatInstruction = %q, want %q", got, want)
	}
	// 含多字节字符：长度按 rune 计
	got2 := FormatInstruction("error", "中文", "1000")
	want2 := "5.error,2.中文,4.1000;"
	if got2 != want2 {
		t.Fatalf("FormatInstruction(utf8) = %q, want %q", got2, want2)
	}
}

func TestReadInstruction(t *testing.T) {
	stream := "4.size,4.1024,3.768,2.96;5.ready,3.abc;"
	ir := NewInstructionReader(bufio.NewReader(strings.NewReader(stream)))

	op, args, err := ir.ReadInstruction()
	if err != nil {
		t.Fatal(err)
	}
	if op != "size" || len(args) != 3 || args[0] != "1024" || args[2] != "96" {
		t.Fatalf("first inst parsed wrong: op=%q args=%v", op, args)
	}
	op2, args2, err := ir.ReadInstruction()
	if err != nil {
		t.Fatal(err)
	}
	if op2 != "ready" || len(args2) != 1 || args2[0] != "abc" {
		t.Fatalf("second inst parsed wrong: op=%q args=%v", op2, args2)
	}
}

func TestRoundTrip(t *testing.T) {
	raw := FormatInstruction("connect", "VERSION_1_5_0", "127.0.0.1", "5900", "secret中")
	ir := NewInstructionReader(bufio.NewReader(strings.NewReader(raw)))
	op, args, err := ir.ReadInstruction()
	if err != nil {
		t.Fatal(err)
	}
	if op != "connect" || args[0] != "VERSION_1_5_0" || args[1] != "127.0.0.1" || args[3] != "secret中" {
		t.Fatalf("roundtrip mismatch: op=%q args=%v", op, args)
	}
}
