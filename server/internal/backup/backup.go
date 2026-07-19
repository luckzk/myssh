// Package backup 打包(DB 快照 + 录像) → gzip → 分块 AES-256-GCM 加密 → S3 兼容存储流式上传。
// 兼容 AWS S3 / Cloudflare R2 / Backblaze B2 / MinIO（都填各自 endpoint 即可）。
package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"golang.org/x/crypto/scrypt"
)

// Config S3 兼容目标 + 备份口令。
type Config struct {
	Endpoint  string // 如 s3.amazonaws.com / <acct>.r2.cloudflarestorage.com / minio:9000
	Region    string
	Bucket    string
	Prefix    string // 对象键前缀（目录），可空
	AccessKey string
	SecretKey string
	UseSSL    bool
	Passphrase string // 加密口令（AES-256-GCM，scrypt 派生）
}

const (
	magic     = "NTBK1\n"   // 文件头标识
	chunkSize = 256 * 1024   // 明文分块大小
)

// 加密文件格式：magic | salt(16) | 若干帧[ ctLen(uint32) | nonce(12) | ciphertext ]
// ciphertext 为 gzip(tar(db + recordings/*)) 的分块 GCM 密文。

func deriveKey(passphrase string, salt []byte) ([]byte, error) {
	return scrypt.Key([]byte(passphrase), salt, 1<<15, 8, 1, 32)
}

// encWriter 分块 AES-256-GCM 加密写入器（流式，不整包入内存）。
type encWriter struct {
	w    io.Writer
	gcm  cipher.AEAD
	buf  []byte
	hdr  []byte
	tmp  []byte
}

func newEncWriter(w io.Writer, passphrase string) (*encWriter, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	key, err := deriveKey(passphrase, salt)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if _, err := io.WriteString(w, magic); err != nil {
		return nil, err
	}
	if _, err := w.Write(salt); err != nil {
		return nil, err
	}
	return &encWriter{w: w, gcm: gcm, hdr: make([]byte, 4)}, nil
}

func (e *encWriter) Write(p []byte) (int, error) {
	e.buf = append(e.buf, p...)
	for len(e.buf) >= chunkSize {
		if err := e.flush(chunkSize); err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

func (e *encWriter) flush(n int) error {
	plain := e.buf[:n]
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	ct := e.gcm.Seal(nil, nonce, plain, nil)
	binary.BigEndian.PutUint32(e.hdr, uint32(len(ct)))
	if _, err := e.w.Write(e.hdr); err != nil {
		return err
	}
	if _, err := e.w.Write(nonce); err != nil {
		return err
	}
	if _, err := e.w.Write(ct); err != nil {
		return err
	}
	e.buf = e.buf[n:]
	return nil
}

func (e *encWriter) Close() error {
	if len(e.buf) > 0 {
		return e.flush(len(e.buf))
	}
	return nil
}

// Upload 把 dbFile + recDir 打包加密后流式上传到 S3，返回对象键与上传字节数。
func Upload(ctx context.Context, cfg Config, dbFile, recDir, objectKey string) (int64, error) {
	if cfg.Passphrase == "" {
		return 0, errors.New("缺少备份加密口令")
	}
	cli, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return 0, err
	}
	// bucket 不存在则尝试创建（MinIO/自建方便；R2/B2 一般已建好，创建失败则继续，由 PutObject 报真实错误）
	if ok, _ := cli.BucketExists(ctx, cfg.Bucket); !ok {
		_ = cli.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{Region: cfg.Region})
	}

	pr, pw := io.Pipe()
	go func() {
		err := func() error {
			enc, err := newEncWriter(pw, cfg.Passphrase)
			if err != nil {
				return err
			}
			gz := gzip.NewWriter(enc)
			tw := tar.NewWriter(gz)
			// DB 快照
			if err := addFile(tw, dbFile, "nt.db"); err != nil {
				return err
			}
			// 录像目录（存在才加）
			if recDir != "" {
				if st, e := os.Stat(recDir); e == nil && st.IsDir() {
					if err := addDir(tw, recDir, "recordings"); err != nil {
						return err
					}
				}
			}
			if err := tw.Close(); err != nil {
				return err
			}
			if err := gz.Close(); err != nil {
				return err
			}
			return enc.Close()
		}()
		pw.CloseWithError(err)
	}()

	info, err := cli.PutObject(ctx, cfg.Bucket, objectKey, pr, -1, minio.PutObjectOptions{ContentType: "application/octet-stream"})
	if err != nil {
		return 0, err
	}
	return info.Size, nil
}

func addFile(tw *tar.Writer, path, name string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: st.Size(), ModTime: st.ModTime()}); err != nil {
		return err
	}
	_, err = io.Copy(tw, f)
	return err
}

func addDir(tw *tar.Writer, dir, prefix string) error {
	return filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		return addFile(tw, p, filepath.ToSlash(filepath.Join(prefix, rel)))
	})
}
