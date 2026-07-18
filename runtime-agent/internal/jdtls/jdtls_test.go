package jdtls

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/log"
)

func TestVerifySHA256_Match(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "blob.bin")
	body := []byte("hello world")
	if err := os.WriteFile(p, body, 0o644); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	hexsum := hex.EncodeToString(sum[:])
	ok, got, err := verifySHA256(p, hexsum)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatalf("expected match, got %s", got)
	}
	if got != hexsum {
		t.Fatalf("sha256 returned wrong value")
	}
}

func TestVerifySHA256_Mismatch(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "blob.bin")
	if err := os.WriteFile(p, []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}
	ok, _, err := verifySHA256(p, "deadbeef")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected mismatch")
	}
}

func TestVerifySHA256_EmptyExpected(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "blob.bin")
	if err := os.WriteFile(p, []byte("anything"), 0o644); err != nil {
		t.Fatal(err)
	}
	ok, _, err := verifySHA256(p, "")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("empty expected should pass")
	}
}

func TestNew_NotStarted(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", quietLogger())
	if got := m.State(); got != "stopped" {
		t.Fatalf("expected stopped, got %s", got)
	}
}

func TestManager_AddListener_NoPanic(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", quietLogger())
	m.AddListener(func(Event) {})
	m.AddListener(func(Event) {})
}

func TestEnsureInstalled_AlreadyVerified(t *testing.T) {
	dir := t.TempDir()
	bundled := filepath.Join(dir, "bundled")
	if err := os.MkdirAll(filepath.Join(bundled, "jdtls"), 0o755); err != nil {
		t.Fatal(err)
	}
	jar := filepath.Join(bundled, "jdtls", JDTLSJar)
	if err := os.WriteFile(jar, []byte("placeholder"), 0o644); err != nil {
		t.Fatal(err)
	}
	m := New(dir, bundled, "", quietLogger())
	got, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != jar {
		t.Fatalf("expected %s, got %s", jar, got)
	}
}

func TestEnsureInstalled_Missing(t *testing.T) {
	// Without a real download source the manager will fall
	// through to the HTTPS URL, which the test environment
	// may not be able to reach. We only assert that the call
	// does not panic and returns a meaningful error.
	dir := t.TempDir()
	m := New(dir, dir, "", quietLogger())
	_, err := m.EnsureInstalled(context.Background())
	if err == nil {
		t.Skip("download succeeded; HTTPS available in this env")
	}
}

func TestReadHeaders_ParsesContentLength(t *testing.T) {
	raw := "Content-Length: 5\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\nhello"
	br := bytes.NewReader([]byte(raw))
	h, err := readHeaders(bufioNewReader(br))
	if err != nil {
		t.Fatal(err)
	}
	if h.contentLength != 5 {
		t.Fatalf("content-length want 5 got %d", h.contentLength)
	}
	if h.contentType == "" {
		t.Fatal("content-type should be set")
	}
}

func quietLogger() *log.Logger {
	var buf bytes.Buffer
	l := log.New("test")
	_ = buf
	return l
}
