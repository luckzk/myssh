package hostkey

import (
	"encoding/base64"
	"fmt"
	"net"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

// Callback 构造 SSH HostKey 回调。TOFU 模式下首次连接自动信任；
// 指纹变化时写入 pending 记录并拒绝连接，等待管理员确认。
func Callback(s *store.Store, policy, userID string) (ssh.HostKeyCallback, error) {
	switch strings.ToLower(policy) {
	case "", "tofu":
		return tofuCallback(s, userID), nil
	case "insecure":
		return ssh.InsecureIgnoreHostKey(), nil
	case "known_hosts":
		return nil, fmt.Errorf("known_hosts callback should be created by gateway package")
	default:
		return nil, fmt.Errorf("unsupported SSH host key policy: %s", policy)
	}
}

func tofuCallback(s *store.Store, userID string) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		host, port := normalizeHostPort(hostname, remote)
		fp := ssh.FingerprintSHA256(key)
		now := model.NowMillis()

		var trusted model.TrustedHostKey
		err := s.DB.Where("host = ? AND port = ? AND status = ?", host, port, "trusted").First(&trusted).Error
		if err == gorm.ErrRecordNotFound {
			rec := model.TrustedHostKey{
				ID:          uuid.NewString(),
				Host:        host,
				Port:        port,
				KeyType:     key.Type(),
				Fingerprint: fp,
				PublicKey:   strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key))),
				Status:      "trusted",
				CreatedBy:   userID,
				CreatedAt:   now,
				UpdatedAt:   now,
				LastSeenAt:  now,
			}
			return s.DB.Create(&rec).Error
		}
		if err != nil {
			return err
		}
		if trusted.Fingerprint != fp {
			writePending(s, trusted, key, fp, userID, now)
			return fmt.Errorf("SSH HostKey 指纹变更：%s:%d 原=%s 新=%s，已阻断连接，请管理员确认", host, port, trusted.Fingerprint, fp)
		}
		return s.DB.Model(&model.TrustedHostKey{}).Where("id = ?", trusted.ID).Updates(map[string]any{
			"last_seen_at": now,
			"updated_at":   now,
		}).Error
	}
}

func writePending(s *store.Store, trusted model.TrustedHostKey, key ssh.PublicKey, fp, userID string, now int64) {
	var pending model.TrustedHostKey
	err := s.DB.Where("host = ? AND port = ? AND fingerprint = ? AND status = ?", trusted.Host, trusted.Port, fp, "pending").First(&pending).Error
	if err == nil {
		s.DB.Model(&model.TrustedHostKey{}).Where("id = ?", pending.ID).Updates(map[string]any{
			"last_seen_at": now,
			"updated_at":   now,
			"created_by":   userID,
		})
		return
	}
	rec := model.TrustedHostKey{
		ID:                  uuid.NewString(),
		Host:                trusted.Host,
		Port:                trusted.Port,
		KeyType:             key.Type(),
		Fingerprint:         fp,
		PublicKey:           strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key))),
		PreviousFingerprint: trusted.Fingerprint,
		Status:              "pending",
		CreatedBy:           userID,
		CreatedAt:           now,
		UpdatedAt:           now,
		LastSeenAt:           now,
	}
	_ = s.DB.Create(&rec).Error
}

func normalizeHostPort(hostname string, remote net.Addr) (string, int) {
	host := hostname
	port := 22
	if h, p, err := net.SplitHostPort(hostname); err == nil {
		host = h
		if n, e := parsePort(p); e == nil {
			port = n
		}
	}
	host = strings.Trim(host, "[]")
	if host == "" && remote != nil {
		if h, p, err := net.SplitHostPort(remote.String()); err == nil {
			host = strings.Trim(h, "[]")
			if n, e := parsePort(p); e == nil {
				port = n
			}
		}
	}
	return host, port
}

func parsePort(s string) (int, error) {
	n := 0
	if s == "" {
		return 0, fmt.Errorf("empty port")
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("invalid port")
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}

// KeyShort 返回公钥短文本，供 UI 显示时避免过长。
func KeyShort(publicKey string) string {
	parts := strings.Fields(publicKey)
	if len(parts) < 2 {
		return publicKey
	}
	raw, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil || len(raw) <= 8 {
		return publicKey
	}
	return parts[0] + " " + base64.StdEncoding.EncodeToString(raw[:8]) + "..."
}
