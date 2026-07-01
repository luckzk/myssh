package gateway

import (
	"bufio"
	"strings"
	"testing"
)

func TestReadSocksAddrDomain(t *testing.T) {
	r := bufio.NewReader(strings.NewReader("\vexample.com"))
	got, err := readSocksAddr(r, 0x03)
	if err != nil {
		t.Fatal(err)
	}
	if got != "example.com" {
		t.Fatalf("readSocksAddr = %q", got)
	}
}

func TestHostAndPortFromAddr(t *testing.T) {
	if got := HostFromAddr("[::1]:8080", "fallback"); got != "::1" {
		t.Fatalf("hostFromAddr = %q", got)
	}
	if got := PortFromAddr("127.0.0.1:0", 22); got != 0 {
		t.Fatalf("portFromAddr = %d", got)
	}
}
