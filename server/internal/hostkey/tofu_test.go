package hostkey

import (
	"crypto/rand"
	"crypto/rsa"
	"net"
	"testing"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"golang.org/x/crypto/ssh"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTOFUTrustsFirstSeenKey(t *testing.T) {
	s := testStore(t)
	key := testPublicKey(t)
	cb := tofuCallback(s, "user-1")
	if err := cb("example.com:22", &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 22}, key); err != nil {
		t.Fatal(err)
	}
	var count int64
	s.DB.Model(&model.TrustedHostKey{}).Where("host = ? AND port = ? AND status = ?", "example.com", 22, "trusted").Count(&count)
	if count != 1 {
		t.Fatalf("trusted count = %d", count)
	}
}

func TestTOFURejectsChangedKeyAndWritesPending(t *testing.T) {
	s := testStore(t)
	key1 := testPublicKey(t)
	key2 := testPublicKey(t)
	cb := tofuCallback(s, "user-1")
	if err := cb("example.com:22", nil, key1); err != nil {
		t.Fatal(err)
	}
	if err := cb("example.com:22", nil, key2); err == nil {
		t.Fatal("expected changed key to be rejected")
	}
	var pending int64
	s.DB.Model(&model.TrustedHostKey{}).Where("host = ? AND port = ? AND status = ?", "example.com", 22, "pending").Count(&pending)
	if pending != 1 {
		t.Fatalf("pending count = %d", pending)
	}
}

func testStore(t *testing.T) *store.Store {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.TrustedHostKey{}); err != nil {
		t.Fatal(err)
	}
	return &store.Store{DB: db}
}

func testPublicKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := ssh.NewPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return pub
}
