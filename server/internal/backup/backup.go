// Package backup 打包(DB 快照 + 录像) → gzip → 分块 AES-256-GCM 加密 → 存到「备份目标」。
// 目标可为本地目录，或 S3 兼容存储（AWS S3 / Cloudflare R2 / Backblaze B2 / MinIO）。
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
	"path"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"golang.org/x/crypto/scrypt"
)

// Destination 解密后的备份目标配置（本地或 S3 兼容）。
type Destination struct {
	Type      string // local | s3
	Endpoint  string
	Region    string
	Bucket    string
	Prefix    string
	AccessKey string
	SecretKey string
	UseSSL    bool
	LocalPath string
}

const (
	magic     = "NTBK1\n"     // 文件头标识
	chunkSize = 256 * 1024    // 明文分块大小
)

// 加密文件格式：magic | salt(16) | 若干帧[ ctLen(uint32) | nonce(12) | ciphertext ]
// ciphertext 为 gzip(tar(db + recordings/*)) 的分块 GCM 密文。

func deriveKey(passphrase string, salt []byte) ([]byte, error) {
	return scrypt.Key([]byte(passphrase), salt, 1<<15, 8, 1, 32)
}

// ObjInfo 目标内对象信息。
type ObjInfo struct {
	Key          string `json:"key"`
	Size         int64  `json:"size"`
	LastModified int64  `json:"lastModified"` // 毫秒
}

// ---- 存储后端抽象：打包加密与「存到哪」解耦 ----

// Backend 备份对象的读写后端。key 为完整存储键（s3 含前缀；本地为文件名）。
type Backend interface {
	Put(ctx context.Context, key string, r io.Reader) (int64, error)
	List(ctx context.Context) ([]ObjInfo, error)
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Test(ctx context.Context) error
}

// NewBackend 按目标类型创建后端。
func NewBackend(d Destination) (Backend, error) {
	switch d.Type {
	case "local":
		if strings.TrimSpace(d.LocalPath) == "" {
			return nil, errors.New("本地目标缺少存储路径")
		}
		return &localBackend{dir: d.LocalPath}, nil
	case "s3", "":
		if d.Endpoint == "" || d.Bucket == "" {
			return nil, errors.New("S3 目标缺少 endpoint 或 bucket")
		}
		cli, err := minio.New(d.Endpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(d.AccessKey, d.SecretKey, ""),
			Secure: d.UseSSL,
			Region: d.Region,
		})
		if err != nil {
			return nil, err
		}
		return &s3Backend{cli: cli, bucket: d.Bucket, prefix: d.Prefix, region: d.Region}, nil
	default:
		return nil, errors.New("未知目标类型: " + d.Type)
	}
}

// BuildKey 按目标类型构造一个新备份对象的完整存储键。
func BuildKey(d Destination, filename string) string {
	if d.Type == "local" {
		return filename
	}
	if p := strings.TrimSuffix(d.Prefix, "/"); p != "" {
		return p + "/" + filename
	}
	return filename
}

// s3Backend 包装 minio 客户端。
type s3Backend struct {
	cli    *minio.Client
	bucket string
	prefix string
	region string
}

func (b *s3Backend) ensureBucket(ctx context.Context) {
	if ok, _ := b.cli.BucketExists(ctx, b.bucket); !ok {
		_ = b.cli.MakeBucket(ctx, b.bucket, minio.MakeBucketOptions{Region: b.region})
	}
}

func (b *s3Backend) Put(ctx context.Context, key string, r io.Reader) (int64, error) {
	b.ensureBucket(ctx)
	info, err := b.cli.PutObject(ctx, b.bucket, key, r, -1, minio.PutObjectOptions{ContentType: "application/octet-stream"})
	if err != nil {
		return 0, err
	}
	return info.Size, nil
}

func (b *s3Backend) List(ctx context.Context) ([]ObjInfo, error) {
	var out []ObjInfo
	for o := range b.cli.ListObjects(ctx, b.bucket, minio.ListObjectsOptions{Prefix: b.prefix, Recursive: true}) {
		if o.Err != nil {
			return nil, o.Err
		}
		if strings.HasSuffix(o.Key, ".enc") {
			out = append(out, ObjInfo{Key: o.Key, Size: o.Size, LastModified: o.LastModified.UnixMilli()})
		}
	}
	return out, nil
}

func (b *s3Backend) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := b.cli.GetObject(ctx, b.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}

func (b *s3Backend) Test(ctx context.Context) error {
	b.ensureBucket(ctx)
	if ok, err := b.cli.BucketExists(ctx, b.bucket); err != nil {
		return err
	} else if !ok {
		return errors.New("桶不存在且无法创建")
	}
	return nil
}

// localBackend 写本地目录；key 一律按 basename 存取，忽略前缀路径。
type localBackend struct{ dir string }

func (b *localBackend) Put(ctx context.Context, key string, r io.Reader) (int64, error) {
	if err := os.MkdirAll(b.dir, 0o750); err != nil {
		return 0, err
	}
	dst := filepath.Join(b.dir, filepath.Base(key))
	f, err := os.Create(dst)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	n, err := io.Copy(f, r)
	if err != nil {
		return 0, err
	}
	return n, nil
}

func (b *localBackend) List(ctx context.Context) ([]ObjInfo, error) {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []ObjInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".enc") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, ObjInfo{Key: e.Name(), Size: fi.Size(), LastModified: fi.ModTime().UnixMilli()})
	}
	return out, nil
}

func (b *localBackend) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	return os.Open(filepath.Join(b.dir, filepath.Base(key)))
}

func (b *localBackend) Test(ctx context.Context) error {
	if err := os.MkdirAll(b.dir, 0o750); err != nil {
		return err
	}
	probe := filepath.Join(b.dir, ".nt-write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return err
	}
	return os.Remove(probe)
}

// ---- 打包 / 备份 / 恢复 ----

// encWriter 分块 AES-256-GCM 加密写入器（流式，不整包入内存）。
type encWriter struct {
	w   io.Writer
	gcm cipher.AEAD
	buf []byte
	hdr []byte
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

// Pack 把选定内容打包加密写到 w：gzip(tar(db? + recordings?))。
func Pack(w io.Writer, passphrase, dbFile, recDir string, includeDB, includeRec bool) error {
	if passphrase == "" {
		return errors.New("缺少备份加密口令")
	}
	enc, err := newEncWriter(w, passphrase)
	if err != nil {
		return err
	}
	gz := gzip.NewWriter(enc)
	tw := tar.NewWriter(gz)
	if includeDB && dbFile != "" {
		if err := addFile(tw, dbFile, "nt.db"); err != nil {
			return err
		}
	}
	if includeRec && recDir != "" {
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
}

// RunBackup 打包加密 → 流式存到 backend，返回写入字节数。
func RunBackup(ctx context.Context, be Backend, passphrase, dbFile, recDir string, includeDB, includeRec bool, key string) (int64, error) {
	pr, pw := io.Pipe()
	go func() {
		pw.CloseWithError(Pack(pw, passphrase, dbFile, recDir, includeDB, includeRec))
	}()
	return be.Put(ctx, key, pr)
}

func addFile(tw *tar.Writer, filePath, name string) error {
	f, err := os.Open(filePath)
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
		return addFile(tw, p, path.Join(prefix, filepath.ToSlash(rel)))
	})
}

// decReader 分块 AES-256-GCM 解密读取器（encWriter 的逆）。
type decReader struct {
	r   io.Reader
	gcm cipher.AEAD
	buf []byte
	off int
	eof bool
}

func newDecReader(r io.Reader, passphrase string) (*decReader, error) {
	hdr := make([]byte, len(magic))
	if _, err := io.ReadFull(r, hdr); err != nil {
		return nil, err
	}
	if string(hdr) != magic {
		return nil, errors.New("备份格式不识别（magic 不匹配，可能不是本系统的加密备份）")
	}
	salt := make([]byte, 16)
	if _, err := io.ReadFull(r, salt); err != nil {
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
	return &decReader{r: r, gcm: gcm}, nil
}

func (d *decReader) Read(p []byte) (int, error) {
	for d.off >= len(d.buf) {
		if d.eof {
			return 0, io.EOF
		}
		if err := d.fill(); err != nil {
			return 0, err
		}
	}
	n := copy(p, d.buf[d.off:])
	d.off += n
	return n, nil
}

func (d *decReader) fill() error {
	hdr := make([]byte, 4)
	if _, err := io.ReadFull(d.r, hdr); err != nil {
		if err == io.EOF {
			d.eof = true
			return nil
		}
		return err
	}
	n := binary.BigEndian.Uint32(hdr)
	nonce := make([]byte, d.gcm.NonceSize())
	if _, err := io.ReadFull(d.r, nonce); err != nil {
		return err
	}
	ct := make([]byte, n)
	if _, err := io.ReadFull(d.r, ct); err != nil {
		return err
	}
	pt, err := d.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return errors.New("解密失败：口令错误或备份已损坏")
	}
	d.buf, d.off = pt, 0
	return nil
}

// Restore 从 backend 拉取对象 → 解密 → 解包，把 nt.db 写到 dbDest，recordings/* 写到 recDest 目录。
func Restore(ctx context.Context, be Backend, passphrase, key, dbDest, recDest string) error {
	if passphrase == "" {
		return errors.New("缺少备份加密口令")
	}
	rc, err := be.Get(ctx, key)
	if err != nil {
		return err
	}
	defer rc.Close()
	dr, err := newDecReader(rc, passphrase)
	if err != nil {
		return err
	}
	gz, err := gzip.NewReader(dr)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	_ = os.RemoveAll(recDest)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if h.Name == "nt.db" {
			if err := writeFile(dbDest, tr); err != nil {
				return err
			}
		} else if strings.HasPrefix(h.Name, "recordings/") {
			rel := strings.TrimPrefix(h.Name, "recordings/")
			if err := writeFile(filepath.Join(recDest, rel), tr); err != nil {
				return err
			}
		}
	}
	return nil
}

func writeFile(dst string, r io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return err
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}
