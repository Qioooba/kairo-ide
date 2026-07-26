package jdkmanager

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func envCleanup(t *testing.T) {
	t.Helper()
	origPath := os.Getenv("PATH")
	origHome := os.Getenv("JAVA_HOME")
	origJre := os.Getenv("KAIRO_JDT_LS_JRE")
	origCommonPaths := commonJDKPaths
	os.Unsetenv("JAVA_HOME")
	os.Unsetenv("KAIRO_JDT_LS_JRE")
	emptyDir := t.TempDir()
	t.Setenv("PATH", emptyDir)
	commonJDKPaths = func() []string { return nil }
	t.Cleanup(func() {
		os.Setenv("PATH", origPath)
		os.Setenv("JAVA_HOME", origHome)
		os.Setenv("KAIRO_JDT_LS_JRE", origJre)
		commonJDKPaths = origCommonPaths
	})
}

func createFakeJavaContent() string {
	if runtime.GOOS == "windows" {
		return "@echo off\r\necho openjdk version \"17.0.9\" 2023-10-17 1>&2\r\nexit /b 0\r\n"
	}
	return "#!/bin/sh\necho 'openjdk version \"17.0.9\" 2023-10-17' >&2\nexit 0\n"
}

func createFakeTarGz(t *testing.T, macLayout bool) []byte {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	javaScript := createFakeJavaContent()

	topDir := "jdk-17.0.9+9"
	if macLayout {
		topDir = "jdk-17.0.9+9"
	}

	dirs := []string{topDir + "/"}
	if macLayout {
		dirs = append(dirs, topDir+"/Contents/")
		dirs = append(dirs, topDir+"/Contents/Home/")
		dirs = append(dirs, topDir+"/Contents/Home/bin/")
	} else {
		dirs = append(dirs, topDir+"/bin/")
	}

	for _, d := range dirs {
		if err := tw.WriteHeader(&tar.Header{
			Name:     d,
			Mode:     0755,
			Typeflag: tar.TypeDir,
		}); err != nil {
			t.Fatal(err)
		}
	}

	var javaPath string
	if macLayout {
		javaPath = topDir + "/Contents/Home/bin/java"
	} else {
		javaPath = topDir + "/bin/java"
	}

	hdr := &tar.Header{
		Name: javaPath,
		Mode: 0755,
		Size: int64(len(javaScript)),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte(javaScript)); err != nil {
		t.Fatal(err)
	}

	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func createFakeZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	batchScript := createFakeJavaContent()
	topDir := "jdk-17.0.9+9"

	dirs := []string{
		topDir + "/",
		topDir + "/bin/",
	}

	for _, d := range dirs {
		if _, err := zw.Create(d); err != nil {
			t.Fatal(err)
		}
	}

	w, err := zw.Create(topDir + "/bin/java.exe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(batchScript)); err != nil {
		t.Fatal(err)
	}

	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestDownload_TarGz(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("tar.gz test on non-Windows platforms")
	}

	envCleanup(t)

	origBase := adoptiumBase
	origClient := httpClient
	defer func() {
		adoptiumBase = origBase
		httpClient = origClient
	}()

	archiveData := createFakeTarGz(t, false)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(archiveData)))
		w.WriteHeader(http.StatusOK)
		w.Write(archiveData)
	}))
	defer ts.Close()

	adoptiumBase = ts.URL
	httpClient = ts.Client()

	tmpDir := t.TempDir()
	m := NewManager(tmpDir)

	if !m.NeedsDownload() {
		t.Fatal("expected NeedsDownload to be true before download")
	}

	progressCalls := 0
	var lastPercent int
	progress := func(pct int, msg string) {
		progressCalls++
		lastPercent = pct
		if pct < 0 || pct > 100 {
			t.Errorf("progress percent out of range: %d", pct)
		}
	}

	ctx := context.Background()
	jdk, err := m.EnsureJDK17(ctx, progress)
	if err != nil {
		t.Fatalf("EnsureJDK17 failed: %v", err)
	}

	if jdk == nil {
		t.Fatal("expected non-nil JDK")
	}
	if jdk.Major != 17 {
		t.Errorf("expected major version 17, got %d (version: %s, path: %s)", jdk.Major, jdk.Version, jdk.Path)
	}

	javaPath := filepath.Join(tmpDir, "jdk17", "bin", "java")
	if _, err := os.Stat(javaPath); err != nil {
		t.Errorf("java binary not found at %s: %v", javaPath, err)
	}

	if lastPercent != 100 {
		t.Errorf("expected last progress to be 100, got %d", lastPercent)
	}
	if progressCalls == 0 {
		t.Error("expected progress callback to be called at least once")
	}

	if m.NeedsDownload() {
		t.Error("expected NeedsDownload to be false after successful download")
	}
}

func TestDownload_MacLayout(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("mac layout test only on darwin")
	}

	envCleanup(t)

	origBase := adoptiumBase
	origClient := httpClient
	defer func() {
		adoptiumBase = origBase
		httpClient = origClient
	}()

	archiveData := createFakeTarGz(t, true)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(archiveData)))
		w.WriteHeader(http.StatusOK)
		w.Write(archiveData)
	}))
	defer ts.Close()

	adoptiumBase = ts.URL
	httpClient = ts.Client()

	tmpDir := t.TempDir()
	m := NewManager(tmpDir)

	jdk, err := m.EnsureJDK17(context.Background(), nil)
	if err != nil {
		t.Fatalf("EnsureJDK17 failed: %v", err)
	}

	if jdk.Major != 17 {
		t.Errorf("expected major version 17, got %d", jdk.Major)
	}

	javaPath := filepath.Join(tmpDir, "jdk17", "bin", "java")
	if _, err := os.Stat(javaPath); err != nil {
		t.Errorf("java binary not found at %s: %v", javaPath, err)
	}
}

func TestDownload_AlreadyAvailable(t *testing.T) {
	tmpDir := t.TempDir()
	jdk17Dir := filepath.Join(tmpDir, "jdk17", "bin")
	if err := os.MkdirAll(jdk17Dir, 0755); err != nil {
		t.Fatal(err)
	}

	javaPath := filepath.Join(jdk17Dir, "java")
	if runtime.GOOS == "windows" {
		javaPath = filepath.Join(jdk17Dir, "java.exe")
	}

	if err := os.WriteFile(javaPath, []byte(createFakeJavaContent()), 0755); err != nil {
		t.Fatal(err)
	}

	m := NewManager(tmpDir)

	downloadCalled := false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloadCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	origBase := adoptiumBase
	adoptiumBase = ts.URL
	defer func() { adoptiumBase = origBase }()

	jdk, err := m.EnsureJDK17(context.Background(), nil)
	if err != nil {
		t.Fatalf("EnsureJDK17 failed: %v", err)
	}

	if downloadCalled {
		t.Error("should not have called download server when JDK already available")
	}

	if jdk.Major != 17 {
		t.Errorf("expected major version 17, got %d", jdk.Major)
	}
}

func TestDownload_Cancellation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("cancellation test")
	}

	envCleanup(t)

	origBase := adoptiumBase
	origClient := httpClient
	defer func() {
		adoptiumBase = origBase
		httpClient = origClient
	}()

	started := make(chan struct{})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100000")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			return
		}
		close(started)
		for i := 0; i < 1000; i++ {
			select {
			case <-r.Context().Done():
				return
			default:
			}
			w.Write([]byte("dummy data\n"))
			flusher.Flush()
		}
	}))
	defer ts.Close()

	adoptiumBase = ts.URL
	httpClient = ts.Client()

	tmpDir := t.TempDir()
	m := NewManager(tmpDir)

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		_, err := m.EnsureJDK17(ctx, func(pct int, msg string) {})
		errCh <- err
	}()

	<-started
	cancel()

	err := <-errCh
	if err == nil {
		t.Error("expected error due to cancelled context")
	}
}

func TestNeedsDownload(t *testing.T) {
	envCleanup(t)

	tmpDir := t.TempDir()
	m := NewManager(tmpDir)

	if !m.NeedsDownload() {
		t.Error("expected NeedsDownload to return true when no JDK present")
	}

	jdk17Bin := filepath.Join(tmpDir, "jdk17", "bin")
	os.MkdirAll(jdk17Bin, 0755)
	javaPath := filepath.Join(jdk17Bin, "java")
	if runtime.GOOS == "windows" {
		javaPath = filepath.Join(jdk17Bin, "java.exe")
	}
	os.WriteFile(javaPath, []byte(createFakeJavaContent()), 0755)

	if m.NeedsDownload() {
		t.Error("expected NeedsDownload to return false when JDK is present")
	}
}

func TestDownloadURL(t *testing.T) {
	m := NewManager("/tmp")
	url, ext := m.downloadURL()

	if url == "" {
		t.Error("expected non-empty URL")
	}

	switch runtime.GOOS {
	case "darwin", "linux":
		if ext != ".tar.gz" {
			t.Errorf("expected .tar.gz extension on %s, got %s", runtime.GOOS, ext)
		}
	case "windows":
		if ext != ".zip" {
			t.Errorf("expected .zip extension on windows, got %s", ext)
		}
	}

	expectedOS := map[string]string{
		"darwin":  "mac",
		"linux":   "linux",
		"windows": "windows",
	}
	expectedArch := map[string]string{
		"amd64": "x64",
		"arm64": "aarch64",
	}
	if eos, ok := expectedOS[runtime.GOOS]; ok {
		expected := fmt.Sprintf("%s/%s/%s", adoptiumBase, eos, expectedArch[runtime.GOARCH])
		expected += "/jdk/hotspot/normal/eclipse"
		if url != expected {
			t.Errorf("URL mismatch:\n  got:  %s\n  want: %s", url, expected)
		}
	}
}

func TestExtractZip_Basic(t *testing.T) {
	zipData := createFakeZip(t)
	tmpZip, err := os.CreateTemp("", "test-*.zip")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpZip.Name())
	if _, err := tmpZip.Write(zipData); err != nil {
		t.Fatal(err)
	}
	tmpZip.Close()

	tmpDir := t.TempDir()
	if err := extractZip(tmpZip.Name(), tmpDir); err != nil {
		t.Fatalf("extractZip failed: %v", err)
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.IsDir() && e.Name() == "jdk-17.0.9+9" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected jdk-17.0.9+9 directory in extraction, got entries: %v", entries)
	}
}

func TestProgressReader(t *testing.T) {
	data := bytes.Repeat([]byte("x"), 1000)
	var lastPct int

	ctx := context.Background()
	pr := &progressReader{
		reader: bytes.NewReader(data),
		total:  1000,
		progress: func(pct int, msg string) {
			lastPct = pct
		},
		ctx: ctx,
	}

	_, err := io.Copy(io.Discard, pr)
	if err != nil {
		t.Fatal(err)
	}

	if lastPct < 50 {
		t.Errorf("expected progress > 50%%, got %d", lastPct)
	}
}

func TestFindJDKContentDir_Mac(t *testing.T) {
	tmp := t.TempDir()
	top := filepath.Join(tmp, "jdk-17+35")
	home := filepath.Join(top, "Contents", "Home")
	bin := filepath.Join(home, "bin")
	os.MkdirAll(bin, 0755)
	os.WriteFile(filepath.Join(bin, "java"), []byte("#!/bin/sh\necho ok\n"), 0755)

	dir, err := findJDKContentDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if dir != home {
		t.Errorf("findJDKContentDir returned %s, want %s", dir, home)
	}
}

func TestFindJDKContentDir_Plain(t *testing.T) {
	tmp := t.TempDir()
	top := filepath.Join(tmp, "jdk-17.0.9")
	bin := filepath.Join(top, "bin")
	os.MkdirAll(bin, 0755)
	os.WriteFile(filepath.Join(bin, "java"), []byte("#!/bin/sh\necho ok\n"), 0755)

	dir, err := findJDKContentDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if dir != top {
		t.Errorf("findJDKContentDir returned %s, want %s", dir, top)
	}
}
