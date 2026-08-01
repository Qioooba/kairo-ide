package jdkmanager

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

func TestIsTransientError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"connection refused", errors.New("dial tcp 1.2.3.4:80: connect: connection refused"), true},
		{"connection reset", errors.New("read tcp: connection reset by peer"), true},
		{"no such host", errors.New("dial tcp: lookup example.invalid: no such host"), true},
		{"dial tcp", errors.New("dial tcp 10.0.0.1:443: i/o timeout"), true},
		{"i/o timeout", errors.New("dial tcp 10.0.0.1:443: i/o timeout"), true},
		{"client timeout message", errors.New("context deadline exceeded (Client.Timeout exceeded while awaiting headers)"), false},
		{"tls handshake timeout", errors.New("net/http: TLS handshake timeout"), true},
		{"EOF", errors.New("unexpected EOF"), true},
		{"broken pipe", errors.New("write tcp: broken pipe"), true},
		{"HTTP 500", errors.New("HTTP 500 Internal Server Error"), true},
		{"HTTP 503", errors.New("HTTP 503 Service Unavailable"), true},
		{"HTTP 404", errors.New("HTTP 404 Not Found"), false},
		{"HTTP 403", errors.New("HTTP 403 Forbidden"), false},
		{"generic", errors.New("some other error"), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isTransientError(tc.err); got != tc.want {
				t.Errorf("isTransientError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestGuessArchiveExtFromURL(t *testing.T) {
	tests := []struct {
		url  string
		want string
	}{
		{"https://mirror.example.com/jdk-17.tar.gz", ".tar.gz"},
		{"https://mirror.example.com/jdk-17.tgz", ".tar.gz"},
		{"https://mirror.example.com/jdk-17.zip", ".zip"},
		{"https://mirror.example.com/jdk-17.TAR.GZ?token=abc", ".tar.gz"},
		{"https://mirror.example.com/jdk-17", ""},
		{"https://mirror.example.com/jdk-17.exe", ""},
		{"", ""},
	}
	for _, tc := range tests {
		if got := guessArchiveExtFromURL(tc.url); got != tc.want {
			t.Errorf("guessArchiveExtFromURL(%q) = %q, want %q", tc.url, got, tc.want)
		}
	}
}

func TestRedactURL(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"no credentials", "https://mirror.example.com/jdk.zip", "https://mirror.example.com/jdk.zip"},
		{"with credentials", "https://user:secret@mirror.example.com/jdk.zip", "https://user@mirror.example.com/jdk.zip"},
		{"user only", "https://user@mirror.example.com/jdk.zip", "https://user@mirror.example.com/jdk.zip"},
		{"invalid url unchanged", "://bad url", "://bad url"},
		{"plain path", "/local/jdk.zip", "/local/jdk.zip"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := redactURL(tc.in); got != tc.want {
				t.Errorf("redactURL(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestProgressReaderRead(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelError)
	data := bytes.Repeat([]byte("a"), 10)
	pr := &progressReader{reader: bytes.NewReader(data), every: 5, logger: logger}

	buf := make([]byte, 3)
	total := 0
	for {
		n, err := pr.Read(buf)
		total += n
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("Read failed: %v", err)
		}
	}
	if total != 10 {
		t.Errorf("read total = %d, want 10", total)
	}
}

func TestProgressReaderRead_NilLogger(t *testing.T) {
	pr := &progressReader{reader: bytes.NewReader([]byte("hello")), every: 1, logger: nil}
	buf := make([]byte, 2)
	_, err := pr.Read(buf)
	if err != nil {
		t.Fatalf("Read with nil logger failed: %v", err)
	}
}

func TestCopyFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := os.WriteFile(src, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile failed: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "content" {
		t.Errorf("copied content = %q, want content", string(got))
	}
}

func TestCopyFile_MissingSource(t *testing.T) {
	dir := t.TempDir()
	if err := copyFile(filepath.Join(dir, "missing"), filepath.Join(dir, "dst")); err == nil {
		t.Fatal("expected error copying missing source")
	}
}

func TestCopyDir(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	os.MkdirAll(filepath.Join(src, "sub"), 0755)
	os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("b"), 0644)

	dst := filepath.Join(dir, "dst")
	if err := copyDir(src, dst); err != nil {
		t.Fatalf("copyDir failed: %v", err)
	}
	for _, rel := range []string{"a.txt", filepath.Join("sub", "b.txt")} {
		if _, err := os.Stat(filepath.Join(dst, rel)); err != nil {
			t.Errorf("expected %s in destination: %v", rel, err)
		}
	}
}

func TestMoveDirContents(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	os.MkdirAll(src, 0755)
	os.MkdirAll(dst, 0755)
	os.WriteFile(filepath.Join(src, "f1.txt"), []byte("1"), 0644)
	os.MkdirAll(filepath.Join(src, "d1"), 0755)
	os.WriteFile(filepath.Join(src, "d1", "f2.txt"), []byte("2"), 0644)

	if err := moveDirContents(src, dst); err != nil {
		t.Fatalf("moveDirContents failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "f1.txt")); err != nil {
		t.Error("f1.txt not moved")
	}
	if _, err := os.Stat(filepath.Join(dst, "d1", "f2.txt")); err != nil {
		t.Error("d1/f2.txt not moved")
	}
}

func TestMoveDirContents_MissingSource(t *testing.T) {
	dir := t.TempDir()
	if err := moveDirContents(filepath.Join(dir, "missing"), filepath.Join(dir, "dst")); err == nil {
		t.Fatal("expected error with missing source")
	}
}

func TestDownloadWithRetry_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("jdk archive data"))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "out.tgz")
	if err := downloadWithRetry(context.Background(), srv.URL, dest, 3); err != nil {
		t.Fatalf("downloadWithRetry failed: %v", err)
	}
	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "jdk archive data" {
		t.Errorf("downloaded data = %q", string(data))
	}
}

func TestDownloadWithRetry_NonTransientError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "out.tgz")
	err := downloadWithRetry(context.Background(), srv.URL, dest, 3)
	if err == nil {
		t.Fatal("expected error for 404")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("expected 404 in error, got: %v", err)
	}
}

func TestDownloadWithRetry_ContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	dest := filepath.Join(t.TempDir(), "out.tgz")
	if err := downloadWithRetry(ctx, srv.URL, dest, 3); err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestResolveJDKArchive_FromEnv(t *testing.T) {
	envCleanup(t)
	archivePath := writeArchiveFile(t, t.TempDir(), "local-jdk.zip", []byte("zip"))
	t.Setenv("KAIRO_JDK_ARCHIVE", archivePath)

	m := NewManager(t.TempDir())
	got, ext, err := m.resolveJDKArchive(context.Background(), func(int, string) {})
	if err != nil {
		t.Fatalf("resolveJDKArchive failed: %v", err)
	}
	if got != archivePath {
		t.Errorf("resolved path = %q, want %q", got, archivePath)
	}
	if ext != ".zip" {
		t.Errorf("ext = %q, want .zip", ext)
	}
}

func TestResolveJDKArchive_FromEnvMissing(t *testing.T) {
	envCleanup(t)
	t.Setenv("KAIRO_JDK_ARCHIVE", filepath.Join(t.TempDir(), "missing.zip"))
	m := NewManager(t.TempDir())
	if _, _, err := m.resolveJDKArchive(context.Background(), func(int, string) {}); err == nil {
		t.Fatal("expected error for missing archive")
	}
}

func TestResolveJDKArchive_FromEnvBadExtension(t *testing.T) {
	envCleanup(t)
	archivePath := writeArchiveFile(t, t.TempDir(), "jdk.txt", []byte("x"))
	t.Setenv("KAIRO_JDK_ARCHIVE", archivePath)
	m := NewManager(t.TempDir())
	_, _, err := m.resolveJDKArchive(context.Background(), func(int, string) {})
	if err == nil {
		t.Fatal("expected error for unsupported extension")
	}
	if !strings.Contains(err.Error(), "unsupported extension") {
		t.Errorf("expected unsupported extension error, got: %v", err)
	}
}

func TestResolveJDKArchive_FromCachedBundled(t *testing.T) {
	envCleanup(t)
	bundled := t.TempDir()
	writeArchiveFile(t, bundled, "jdk17.tar.gz", []byte("tgz"))
	m := NewManager(bundled)

	got, ext, err := m.resolveJDKArchive(context.Background(), func(int, string) {})
	if err != nil {
		t.Fatalf("resolveJDKArchive failed: %v", err)
	}
	if filepath.Base(got) != "jdk17.tar.gz" {
		t.Errorf("resolved = %q, want cached jdk17.tar.gz", got)
	}
	if ext != ".tar.gz" {
		t.Errorf("ext = %q, want .tar.gz", ext)
	}
}

func TestResolveJDKArchive_FromPlainLocalPath(t *testing.T) {
	envCleanup(t)
	archivePath := writeArchiveFile(t, t.TempDir(), "jdk.zip", []byte("zip"))

	m := NewManager(t.TempDir())
	got, ext, err := m.downloadFromURL(context.Background(), nil, archivePath)
	if err != nil {
		t.Fatalf("downloadFromURL(local path) failed: %v", err)
	}
	if got != archivePath {
		t.Errorf("resolved = %q, want %q", got, archivePath)
	}
	if ext != ".zip" {
		t.Errorf("ext = %q, want .zip", ext)
	}
}

func TestDownloadFromURL_HTTP(t *testing.T) {
	envCleanup(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("archive-bytes"))
	}))
	defer srv.Close()

	m := NewManager(t.TempDir())
	got, ext, err := m.downloadFromURL(context.Background(), nil, srv.URL+"/jdk17.zip")
	if err != nil {
		t.Fatalf("downloadFromURL failed: %v", err)
	}
	if ext != ".zip" {
		t.Errorf("ext = %q, want .zip", ext)
	}
	data, err := os.ReadFile(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "archive-bytes" {
		t.Errorf("downloaded data = %q", string(data))
	}
}

func TestDownloadFromURL_HTTPDownloadFailure(t *testing.T) {
	envCleanup(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusNotFound)
	}))
	defer srv.Close()

	m := NewManager(t.TempDir())
	_, _, err := m.downloadFromURL(context.Background(), nil, srv.URL+"/jdk17.zip")
	if err == nil {
		t.Fatal("expected error for failing download")
	}
}

func TestVerifySHA256_EmptyExpected(t *testing.T) {
	tmp := t.TempDir()
	p := filepath.Join(tmp, "f.bin")
	os.WriteFile(p, []byte("data"), 0644)
	// Empty expected hash means "skip verification" -> no error.
	if err := verifySHA256(p, "  "); err != nil {
		t.Errorf("verifySHA256 with empty expected should pass, got: %v", err)
	}
}

func TestEnsureJDK17_ProgressNil(t *testing.T) {
	// EnsureJDK17 must tolerate a nil progress callback without panicking
	// (the no-archive error path is exercised by an existing test, this one
	// just guards the nil-progress normalization).
	envCleanup(t)
	m := NewManager(t.TempDir())
	_, err := m.EnsureJDK17(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error (no JDK available)")
	}
	_ = fmt.Sprintf("%v", err)
}
