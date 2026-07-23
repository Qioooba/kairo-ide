package jdtls

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// ---------- helpers ----------

func mustMkdir(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
}

func fileSHA256(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// writeTarGzFromDir creates a .tar.gz archive at dst
// containing the directory tree at src, preserving paths
// relative to src.
func writeTarGzFromDir(t *testing.T, dst, src string) {
	t.Helper()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	gw := gzip.NewWriter(out)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()
	err = filepath.WalkDir(src, func(p string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(rel)
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func writeZipFromDir(t *testing.T, dst, src string) {
	t.Helper()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	zw := zip.NewWriter(out)
	defer zw.Close()
	err = filepath.WalkDir(src, func(p string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		hdr, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(rel)
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(w, f)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

// writeMaliciousTarGz writes a tar.gz that contains a
// "../escape.txt" entry to verify the installer rejects it.
func writeMaliciousTarGz(t *testing.T, dst string) {
	t.Helper()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	gw := gzip.NewWriter(out)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()
	body := []byte("pwned")
	hdr := &tar.Header{
		Name:     "../escape.txt",
		Mode:     0o644,
		Size:     int64(len(body)),
		Typeflag: tar.TypeReg,
	}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
}

// makeLayout builds a minimal-but-valid JDT LS layout in a
// temp dir, returning the root path.
func makeLayout(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "plugins"))
	mustMkdir(t, filepath.Join(root, "config_linux"))
	mustMkdir(t, filepath.Join(root, "config_win"))
	mustMkdir(t, filepath.Join(root, "config_mac"))
	launcher := filepath.Join(root, "plugins", "org.eclipse.equinox.launcher_1.6.500.v20230711-1234.jar")
	if err := os.WriteFile(launcher, []byte("placeholder launcher"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config_linux", "config.ini"), []byte("osgi.bundles="), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// pinChecksum replaces the package-level JDTLSArchiveSHA256
// for the duration of one test. The constant is a `const` in
// distribution.go; tests swap it via the package-level
// variable declared in distribution_test.go.
func pinChecksum(t *testing.T, sum string) {
	t.Helper()
	t.Cleanup(func() { jdtlsArchiveSHA256ForTest = "" })
	jdtlsArchiveSHA256ForTest = sum
}

// ---------- tests ----------

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
	m := New(dir, dir, "", false, "", log.New("test"))
	if got := m.State(); got != "stopped" {
		t.Fatalf("expected stopped, got %s", got)
	}
}

func TestManager_AddListener_NoPanic(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	m.AddListener(func(Event) {})
	m.AddListener(func(Event) {})
}

func TestManager_SetWorkspace_AndGet(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	m.SetWorkspace("ws_correlation")
	got := m.Workspace()
	want := filepath.Join(dir, "jdtls-workspace", "ws_correlation")
	if got != want {
		t.Fatalf("Workspace() = %q, want %q", got, want)
	}
	m.SetWorkspace("../../etc/passwd")
	if got := m.Workspace(); strings.Contains(got, "..") {
		t.Fatalf("Workspace() = %q, sanitisation failed", got)
	}
}

func TestManager_EnsureInstalled_NoArchive_NoNetwork(t *testing.T) {
	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE_URL", "http://127.0.0.1:1/does-not-exist.tar.gz")
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	_, err := m.EnsureInstalled(context.Background())
	if err == nil {
		t.Skip("download succeeded; test environment has internet")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "download") &&
		!strings.Contains(err.Error(), "KAIRO_JDTLS_ARCHIVE") {
		t.Fatalf("error %q should mention download or KAIRO_JDTLS_ARCHIVE", err.Error())
	}
}

func TestEnsureInstalled_FromPreStagedArchive_TarGz(t *testing.T) {
	layout := makeLayout(t)
	archiveDir := t.TempDir()
	archivePath := filepath.Join(archiveDir, "jdtls-fixture.tar.gz")
	writeTarGzFromDir(t, archivePath, layout)
	want, _ := fileSHA256(archivePath)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	t.Setenv("KAIRO_JDTLS_ARCHIVE_URL", "")
	pinChecksum(t, want)

	bundled := t.TempDir()
	dataDir := t.TempDir()
	m := New(dataDir, bundled, "", false, "", log.New("test"))
	rep, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatalf("EnsureInstalled: %v", err)
	}
	if rep.LauncherJAR == "" {
		t.Fatal("LauncherJAR empty")
	}
	if filepath.Base(rep.LauncherJAR) != "org.eclipse.equinox.launcher_1.6.500.v20230711-1234.jar" {
		t.Fatalf("LauncherJAR basename = %q, want org.eclipse.equinox.launcher_1.6.500.v20230711-1234.jar",
			filepath.Base(rep.LauncherJAR))
	}
	body, err := os.ReadFile(filepath.Join(dataDir, "bundled", "jdtls", "install.json"))
	if err != nil {
		t.Fatalf("read install.json: %v", err)
	}
	if !strings.Contains(string(body), JDTLSVersion) {
		t.Fatalf("install.json does not mention version: %s", string(body))
	}
}

func TestEnsureInstalled_FromPreStagedArchive_Zip(t *testing.T) {
	layout := makeLayout(t)
	archivePath := filepath.Join(t.TempDir(), "jdtls-fixture.zip")
	writeZipFromDir(t, archivePath, layout)
	want, _ := fileSHA256(archivePath)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	t.Setenv("KAIRO_JDTLS_ARCHIVE_URL", "")
	pinChecksum(t, want)

	m := New(t.TempDir(), t.TempDir(), "", false, "", log.New("test"))
	rep, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatalf("EnsureInstalled: %v", err)
	}
	if rep.LauncherJAR == "" {
		t.Fatal("LauncherJAR empty")
	}
}

func TestEnsureInstalled_AdoptExistingHome(t *testing.T) {
	layout := makeLayout(t)
	t.Setenv("KAIRO_JDTLS_HOME", layout)
	t.Setenv("KAIRO_JDTLS_ARCHIVE", "")

	dataDir := t.TempDir()
	m := New(dataDir, t.TempDir(), "", false, "", log.New("test"))
	rep, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatalf("EnsureInstalled: %v", err)
	}
	if rep.Home == "" {
		t.Fatal("Home empty")
	}
	if filepath.Clean(rep.Home) != filepath.Clean(layout) {
		t.Fatalf("Home = %q, want %q", rep.Home, layout)
	}
}

func TestEnsureInstalled_ChecksumMismatch(t *testing.T) {
	layout := makeLayout(t)
	archivePath := filepath.Join(t.TempDir(), "x.tar.gz")
	writeTarGzFromDir(t, archivePath, layout)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	pinChecksum(t, "0000000000000000000000000000000000000000000000000000000000000000")

	m := New(t.TempDir(), t.TempDir(), "", false, "", log.New("test"))
	_, err := m.EnsureInstalled(context.Background())
	if err == nil {
		t.Fatal("expected checksum mismatch error")
	}
	if !strings.Contains(err.Error(), "sha256") {
		t.Fatalf("error %q should mention sha256", err.Error())
	}
}

func TestEnsureInstalled_RejectsZipSlip(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "evil.tar.gz")
	writeMaliciousTarGz(t, archivePath)
	want, _ := fileSHA256(archivePath)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	pinChecksum(t, want)

	m := New(t.TempDir(), t.TempDir(), "", false, "", log.New("test"))
	_, err := m.EnsureInstalled(context.Background())
	if err == nil {
		t.Fatal("expected path-escape rejection")
	}
	if !strings.Contains(err.Error(), "escape") {
		t.Fatalf("error %q should mention path escape", err.Error())
	}
}

func TestEnsureInstalled_CorruptArchive(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "broken.tar.gz")
	if err := os.WriteFile(archivePath, []byte("not a real tar.gz"), 0o644); err != nil {
		t.Fatal(err)
	}
	want, _ := fileSHA256(archivePath)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	pinChecksum(t, want)

	m := New(t.TempDir(), t.TempDir(), "", false, "", log.New("test"))
	_, err := m.EnsureInstalled(context.Background())
	if err == nil {
		t.Fatal("expected corrupt archive error")
	}
	if !strings.Contains(err.Error(), "corrupt") {
		t.Fatalf("error %q should mention corrupt", err.Error())
	}
}

func TestEnsureInstalled_ReinstallIdempotent(t *testing.T) {
	layout := makeLayout(t)
	archivePath := filepath.Join(t.TempDir(), "jdtls.tar.gz")
	writeTarGzFromDir(t, archivePath, layout)
	want, _ := fileSHA256(archivePath)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	pinChecksum(t, want)

	bundled := t.TempDir()
	dataDir := t.TempDir()
	m := New(dataDir, bundled, "", false, "", log.New("test"))
	rep1, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	rep2, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rep1.LauncherJAR != rep2.LauncherJAR {
		t.Fatalf("re-install produced a different launcher: %q vs %q", rep1.LauncherJAR, rep2.LauncherJAR)
	}
}

func TestEnsureInstalled_PlatformConfig_Selection_Linux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skipf("running on %s, skipping linux-only check", runtime.GOOS)
	}
	layout := t.TempDir()
	mustMkdir(t, filepath.Join(layout, "plugins"))
	mustMkdir(t, filepath.Join(layout, "config_win"))
	mustMkdir(t, filepath.Join(layout, "config_mac"))
	if err := os.WriteFile(filepath.Join(layout, "plugins", "org.eclipse.equinox.launcher_1.6.500.jar"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(t.TempDir(), "x.tar.gz")
	writeTarGzFromDir(t, archivePath, layout)
	want, _ := fileSHA256(archivePath)
	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	pinChecksum(t, want)

	m := New(t.TempDir(), t.TempDir(), "", false, "", log.New("test"))
	_, err := m.EnsureInstalled(context.Background())
	if err == nil {
		t.Fatal("expected an error: no config_linux in this layout")
	}
	if !strings.Contains(err.Error(), "config") {
		t.Fatalf("error %q should mention missing config for this OS", err.Error())
	}
}

// ---------- existing readHeaders test (kept) ----------

func TestReadHeaders_ParsesContentLength(t *testing.T) {
	raw := "Content-Length: 5\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\nhello"
	br := bytes.NewReader([]byte(raw))
	h, err := readHeaders(bufio.NewReader(br))
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

// ---------- Manager lifecycle tests ----------

func TestManager_SetJREPath(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	m.SetJREPath("/custom/jre")
	if got := m.JREPath(); got != "/custom/jre" {
		t.Fatalf("JREPath() = %q, want /custom/jre", got)
	}
}

func TestManager_SetAutoRestartBudget(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	m.SetAutoRestartBudget(5)
	// Verify no panic — budget is internal
	m.SetAutoRestartBudget(0)
}

func TestManager_LastError(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	if got := m.LastError(); got != "" {
		t.Fatalf("LastError() = %q, want empty", got)
	}
}

func TestManager_DataDir_BundledDir_HomedDir(t *testing.T) {
	dataDir := t.TempDir()
	bundled := t.TempDir()
	m := New(dataDir, bundled, "", false, "", log.New("test"))
	if got := m.DataDir(); got != dataDir {
		t.Fatalf("DataDir() = %q, want %q", got, dataDir)
	}
	if got := m.BundledDir(); got != bundled {
		t.Fatalf("BundledDir() = %q, want %q", got, bundled)
	}
	wantHome := filepath.Join(bundled, "jdtls")
	if got := m.HomedDir(); got != wantHome {
		t.Fatalf("HomedDir() = %q, want %q", got, wantHome)
	}
}

func TestManager_LastStart_Nil(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	if got := m.LastStart(); got != nil {
		t.Fatalf("LastStart() = %v, want nil", got)
	}
}

func TestManager_IsPrepared_NoInstall(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	if m.IsPrepared() {
		t.Fatal("expected IsPrepared() false when no install exists")
	}
}

func TestManager_IsPrepared_WithInstall(t *testing.T) {
	layout := makeLayout(t)
	archivePath := filepath.Join(t.TempDir(), "jdtls.tar.gz")
	writeTarGzFromDir(t, archivePath, layout)
	want, _ := fileSHA256(archivePath)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	pinChecksum(t, want)

	bundled := t.TempDir()
	dataDir := t.TempDir()
	m := New(dataDir, bundled, "", false, "", log.New("test"))
	_, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatalf("EnsureInstalled: %v", err)
	}
	if !m.IsPrepared() {
		t.Fatal("expected IsPrepared() true after install")
	}
}

func TestManager_StderrPath(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	if got := m.StderrPath(); got != "" {
		t.Fatalf("StderrPath() = %q, want empty before start", got)
	}
}

func TestManager_BuildLaunchDescriptor_NoJRE(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	t.Setenv("KAIRO_JRE17_HOME", "")
	_, err := m.BuildLaunchDescriptor(dir)
	if err == nil {
		t.Fatal("expected error without JRE")
	}
	if !strings.Contains(err.Error(), "JRE 17") {
		t.Fatalf("error %q should mention JRE 17", err.Error())
	}
}

func TestManager_BuildLaunchDescriptor_JRENotFound(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	t.Setenv("KAIRO_JRE17_HOME", "/nonexistent/jre/path")
	_, err := m.BuildLaunchDescriptor(dir)
	if err == nil {
		t.Fatal("expected error for nonexistent JRE")
	}
}

func TestManager_BuildLaunchDescriptor_NoInstall(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	// Use a real JDK path so the JRE check passes
	t.Setenv("KAIRO_JRE17_HOME", dir)
	// Create a fake java binary
	binDir := filepath.Join(dir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "java"), []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := m.BuildLaunchDescriptor(dir)
	if err == nil {
		t.Fatal("expected error without install")
	}
	if !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("error %q should mention not installed", err.Error())
	}
}

func TestManager_BuildLaunchDescriptor_WithInstall(t *testing.T) {
	layout := makeLayout(t)
	archivePath := filepath.Join(t.TempDir(), "jdtls.tar.gz")
	writeTarGzFromDir(t, archivePath, layout)
	want, _ := fileSHA256(archivePath)

	t.Setenv("KAIRO_JDTLS_HOME", "")
	t.Setenv("KAIRO_JDTLS_ARCHIVE", archivePath)
	pinChecksum(t, want)

	bundled := t.TempDir()
	dataDir := t.TempDir()
	m := New(dataDir, bundled, "", false, "", log.New("test"))
	_, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatalf("EnsureInstalled: %v", err)
	}

	// Use the bundled dir as fake JRE root
	jreDir := filepath.Join(bundled, "fake-jre")
	binDir := filepath.Join(jreDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "java"), []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	m.SetJREPath(jreDir)
	m.SetWorkspace("test-ws")
	desc, err := m.BuildLaunchDescriptor(dataDir)
	if err != nil {
		t.Fatalf("BuildLaunchDescriptor: %v", err)
	}
	if desc.Command == "" {
		t.Fatal("Command empty")
	}
	if len(desc.Args) == 0 {
		t.Fatal("Args empty")
	}
	if desc.WorkingDir != dataDir {
		t.Fatalf("WorkingDir = %q, want %q", desc.WorkingDir, dataDir)
	}
	if len(desc.EnvAllowlist) == 0 {
		t.Fatal("EnvAllowlist empty")
	}
}

func TestManager_FinalizeShutdown_Stopped(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	// Should not panic when already stopped
	m.FinalizeShutdown()
}

func TestManager_SetWorkspace_Empty(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	m.SetWorkspace("test-ws")
	if got := m.Workspace(); got == "" {
		t.Fatal("Workspace() empty after SetWorkspace")
	}
	m.SetWorkspace("")
	if got := m.Workspace(); got != "" {
		t.Fatalf("Workspace() = %q, want empty after clearing", got)
	}
}

func TestManager_Dispatch(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))
	received := make(chan Event, 1)
	m.AddListener(func(e Event) {
		received <- e
	})
	m.dispatch(Event{Type: "state", State: "running"})
	select {
	case ev := <-received:
		if ev.Type != "state" || ev.State != "running" {
			t.Fatalf("unexpected event: %+v", ev)
		}
	default:
		t.Fatal("expected event to be dispatched")
	}
}

// ---------- jdtlsMaxHeapMB tests ----------

func TestJdtlsMaxHeapMB_Default(t *testing.T) {
	t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", "")
	if got := jdtlsMaxHeapMB(); got != 768 {
		t.Fatalf("jdtlsMaxHeapMB() = %d, want 768", got)
	}
}

func TestJdtlsMaxHeapMB_Custom(t *testing.T) {
	t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", "1024")
	if got := jdtlsMaxHeapMB(); got != 1024 {
		t.Fatalf("jdtlsMaxHeapMB() = %d, want 1024", got)
	}
}

func TestJdtlsMaxHeapMB_TooLow(t *testing.T) {
	t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", "128")
	if got := jdtlsMaxHeapMB(); got != 768 {
		t.Fatalf("jdtlsMaxHeapMB() = %d, want 768 (clamped)", got)
	}
}

func TestJdtlsMaxHeapMB_TooHigh(t *testing.T) {
	t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", "8192")
	if got := jdtlsMaxHeapMB(); got != 768 {
		t.Fatalf("jdtlsMaxHeapMB() = %d, want 768 (clamped)", got)
	}
}

func TestJdtlsMaxHeapMB_Invalid(t *testing.T) {
	t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", "not-a-number")
	if got := jdtlsMaxHeapMB(); got != 768 {
		t.Fatalf("jdtlsMaxHeapMB() = %d, want 768 (default)", got)
	}
}

// ---------- Distribution helper tests ----------

func TestSafeJoin(t *testing.T) {
	dir := t.TempDir()
	tests := []struct {
		name    string
		entry   string
		wantErr bool
		skipOS  string // skip on this OS
	}{
		{"normal file", "plugins/foo.jar", false, ""},
		{"deep path", "config_linux/config.ini", false, ""},
		{"empty entry", "", true, ""},
		{"absolute entry", "/etc/passwd", true, ""},
		{"parent traversal", "../escape.txt", true, ""},
		{"deep traversal", "foo/../../escape.txt", true, ""},
		{"windows absolute", `C:\Windows\System32`, true, "!windows"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.skipOS == "!windows" && runtime.GOOS != "windows" {
				t.Skip("Windows-specific test")
			}
			_, err := safeJoin(dir, tc.entry)
			if tc.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestHasParentTraversal(t *testing.T) {
	tests := []struct {
		entry string
		want  bool
	}{
		{"normal/file.txt", false},
		{"../escape.txt", true},
		{"foo/../bar", true},
		{"foo\\..\\bar", true},
		{"foo/bar/../baz", true},
		{"foo/bar/baz", false},
		{"..", true},
		{"", false},
	}
	for _, tc := range tests {
		t.Run(tc.entry, func(t *testing.T) {
			if got := hasParentTraversal(tc.entry); got != tc.want {
				t.Errorf("hasParentTraversal(%q) = %v, want %v", tc.entry, got, tc.want)
			}
		})
	}
}

func TestLauncherVersionFromFilename(t *testing.T) {
	tests := []struct {
		filename string
		want     string
	}{
		{"org.eclipse.equinox.launcher_1.6.500.v20230711-1234.jar", "1.6.500.v20230711-1234"},
		{"org.eclipse.equinox.launcher_1.6.400.jar", "1.6.400"},
		{"not-a-launcher.jar", ""},
		{"org.eclipse.equinox.launcher_1.0", ""},
		{"", ""},
	}
	for _, tc := range tests {
		t.Run(tc.filename, func(t *testing.T) {
			if got := launcherVersionFromFilename(tc.filename); got != tc.want {
				t.Errorf("launcherVersionFromFilename(%q) = %q, want %q", tc.filename, got, tc.want)
			}
		})
	}
}

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"1.6.500", "1.6.400", 1},
		{"1.6.400", "1.6.500", -1},
		{"1.6.500", "1.6.500", 0},
		{"1.7.0", "1.6.999", 1},
		{"2.0.0", "1.9.9", 1},
		{"1.6", "1.6.0", 0},
		{"1.6.0", "1.6", 0},
		{"", "1.0.0", -1},
		{"1.0.0", "", 1},
	}
	for _, tc := range tests {
		t.Run(tc.a+"_vs_"+tc.b, func(t *testing.T) {
			if got := compareVersions(tc.a, tc.b); got != tc.want {
				t.Errorf("compareVersions(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestHostConfigDir(t *testing.T) {
	dir := t.TempDir()
	got, err := hostConfigDir(dir)
	if err != nil {
		t.Fatalf("hostConfigDir: %v", err)
	}
	switch runtime.GOOS {
	case "linux":
		if !strings.HasSuffix(got, "config_linux") {
			t.Errorf("expected config_linux, got %q", got)
		}
	case "darwin":
		if !strings.HasSuffix(got, "config_mac") {
			t.Errorf("expected config_mac, got %q", got)
		}
	case "windows":
		if !strings.HasSuffix(got, "config_win") {
			t.Errorf("expected config_win, got %q", got)
		}
	}
}

func TestEffectiveArchiveSHA256(t *testing.T) {
	// Default: production constant
	if got := effectiveArchiveSHA256(); got != JDTLSExpectedSHA256 {
		t.Fatalf("effectiveArchiveSHA256() = %q, want %q", got, JDTLSExpectedSHA256)
	}
	// With test override
	jdtlsArchiveSHA256ForTest = "test-override-hash"
	defer func() { jdtlsArchiveSHA256ForTest = "" }()
	if got := effectiveArchiveSHA256(); got != "test-override-hash" {
		t.Fatalf("effectiveArchiveSHA256() = %q, want test-override-hash", got)
	}
}

func TestReadInstallReport_Nonexistent(t *testing.T) {
	rep, err := readInstallReport(t.TempDir())
	if err != nil {
		t.Fatalf("readInstallReport: %v", err)
	}
	if rep != nil {
		t.Fatal("expected nil for nonexistent report")
	}
}

func TestWriteAndReadInstallReport(t *testing.T) {
	dir := t.TempDir()
	rep := &InstallReport{
		Version:       "1.0.0",
		Home:          "/tmp/jdtls",
		LauncherJAR:   "/tmp/jdtls/plugins/launcher.jar",
		LayoutVersion: 1,
	}
	if err := writeInstallReport(dir, rep); err != nil {
		t.Fatalf("writeInstallReport: %v", err)
	}
	got, err := readInstallReport(dir)
	if err != nil {
		t.Fatalf("readInstallReport: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil report")
	}
	if got.Version != rep.Version {
		t.Fatalf("Version = %q, want %q", got.Version, rep.Version)
	}
	if got.LauncherJAR != rep.LauncherJAR {
		t.Fatalf("LauncherJAR = %q, want %q", got.LauncherJAR, rep.LauncherJAR)
	}
}

func TestReadHeaders_MissingContentLength(t *testing.T) {
	raw := "Content-Type: application/json\r\n\r\n"
	br := bytes.NewReader([]byte(raw))
	_, err := readHeaders(bufio.NewReader(br))
	if err == nil {
		t.Fatal("expected error for missing Content-Length")
	}
}

func TestReadHeaders_InvalidContentLength(t *testing.T) {
	raw := "Content-Length: abc\r\nContent-Type: text/plain\r\n\r\n"
	br := bytes.NewReader([]byte(raw))
	_, err := readHeaders(bufio.NewReader(br))
	if err == nil {
		t.Fatal("expected error for invalid Content-Length")
	}
}

func TestReadHeaders_Empty(t *testing.T) {
	raw := "\r\n"
	br := bytes.NewReader([]byte(raw))
	_, err := readHeaders(bufio.NewReader(br))
	if err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestSanitizeID(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"normal", "normal"},
		{"path/with/slashes", "path_with_slashes"},
		{"path\\with\\backslashes", "path_with_backslashes"},
		{"../../etc/passwd", "____etc_passwd"},
		{"..hidden", "_hidden"},
		{"", "."},
	}
	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			if got := sanitizeID(tc.input); got != tc.want {
				t.Errorf("sanitizeID(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestDistributionStatus(t *testing.T) {
	ds := DistributionStatus{
		Installed:   true,
		Version:     "1.0.0",
		Home:        "/tmp/jdtls",
		LauncherJAR: "/tmp/jdtls/plugins/launcher.jar",
		Source:      "archive",
	}
	if !ds.Installed {
		t.Error("expected Installed true")
	}
}

func TestInstallReport(t *testing.T) {
	rep := InstallReport{
		Version:       "1.0.0",
		BuildTag:      "20260113",
		ArchiveName:   "jdtls.tar.gz",
		ArchiveSHA256: "abc123",
		InstalledAt:   "2026-01-13T00:00:00Z",
		Home:          "/tmp/jdtls",
		LauncherJAR:   "/tmp/jdtls/plugins/launcher.jar",
		LayoutVersion: 1,
	}
	if rep.LayoutVersion < LayoutMinSupp {
		t.Error("LayoutVersion below minimum")
	}
}

func TestEvent(t *testing.T) {
	ev := Event{
		Type:    "state",
		State:   "running",
		Message: "started",
		Line:    "line 1",
		At:      "2026-01-13T00:00:00Z",
	}
	if ev.Type != "state" {
		t.Errorf("Type = %q, want state", ev.Type)
	}
}

func TestStatus(t *testing.T) {
	st := Status{
		State:        "running",
		Pid:          12345,
		Version:      "1.55.0",
		StartedAt:    "2026-01-13T00:00:00Z",
		Jre:          "/usr/lib/jvm/java-17",
		LauncherJAR:  "/tmp/jdtls/plugins/launcher.jar",
		Workspace:    "/tmp/workspace",
		RestartCount: 0,
	}
	if st.State != "running" {
		t.Errorf("State = %q, want running", st.State)
	}
}

func TestLaunchDescriptor(t *testing.T) {
	ld := LaunchDescriptor{
		Command:      "/usr/bin/java",
		Args:         []string{"-jar", "launcher.jar"},
		WorkingDir:   "/tmp/project",
		EnvAllowlist: []string{"PATH=/usr/bin", "JAVA_HOME=/usr/lib/jvm/java-17"},
	}
	if ld.Command == "" {
		t.Error("Command empty")
	}
	if len(ld.Args) != 2 {
		t.Errorf("expected 2 args, got %d", len(ld.Args))
	}
}

func TestProgressReader(t *testing.T) {
	data := make([]byte, 300)
	for i := range data {
		data[i] = byte('a' + (i % 26))
	}
	logged := false
	pr := &progressReader{
		inner:  bytes.NewReader(data),
		total:  int64(len(data)),
		next:   10 * 1024 * 1024, // won't trigger
		logger: func(msg string, fields map[string]any) {
			logged = true
		},
	}
	buf := make([]byte, 100)
	for {
		_, err := pr.Read(buf)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if logged {
		t.Error("should not log for small data")
	}
}

func TestProgressReader_LogsAtThreshold(t *testing.T) {
	logged := false
	pr := &progressReader{
		inner:  bytes.NewReader([]byte("hello")),
		total:  5,
		next:   0, // immediate
		logger: func(msg string, fields map[string]any) {
			logged = true
		},
	}
	buf := make([]byte, 10)
	_, _ = pr.Read(buf)
	if !logged {
		t.Error("expected log at threshold")
	}
}

func TestLayout_LayoutVersion(t *testing.T) {
	l := &layout{}
	if v := l.layoutVersion(); v != LayoutVersion {
		t.Errorf("layoutVersion() = %d, want %d", v, LayoutVersion)
	}
}

func TestDiscoverLayout_NoPlugins(t *testing.T) {
	dir := t.TempDir()
	_, err := discoverLayout(dir)
	if err == nil {
		t.Fatal("expected error for missing plugins/")
	}
	if !strings.Contains(err.Error(), "plugins") {
		t.Fatalf("error %q should mention plugins", err.Error())
	}
}

func TestDiscoverLayout_NoLauncher(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "plugins"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "config_linux"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "config_mac"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "config_win"), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := discoverLayout(dir)
	if err == nil {
		t.Fatal("expected error for missing launcher JAR")
	}
	if !strings.Contains(err.Error(), "launcher") {
		t.Fatalf("error %q should mention launcher", err.Error())
	}
}

// KAIRO-RC-WEB-241: the cached archive lives INSIDE home
// (home/JDTLSArchiveFile). Before the fix, installFromFile wiped
// home — deleting the archive itself — so every install failed
// and the next run re-downloaded.
func TestEnsureInstalled_CachedArchiveInsideHomeSurvivesWipe(t *testing.T) {
	layout := makeLayout(t)
	bundled := t.TempDir()
	dataDir := t.TempDir()
	home := filepath.Join(bundled, "jdtls")
	mustMkdir(t, home)
	archivePath := filepath.Join(home, JDTLSArchiveFile)
	writeTarGzFromDir(t, archivePath, layout)
	want, _ := fileSHA256(archivePath)
	pinChecksum(t, want)

	m := New(dataDir, bundled, "", false, "", log.New("test"))
	rep, err := m.EnsureInstalled(context.Background())
	if err != nil {
		t.Fatalf("EnsureInstalled with cached archive inside home: %v", err)
	}
	if rep.LauncherJAR == "" {
		t.Fatal("LauncherJAR empty")
	}
	if _, err := os.Stat(archivePath); err != nil {
		t.Fatalf("cached archive must survive the layout wipe: %v", err)
	}
}

func TestManager_State(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))

	// Default: stopped
	if got := m.State(); got != "stopped" {
		t.Fatalf("State() = %q, want stopped", got)
	}

	// starting
	m.state.Store(1)
	if got := m.State(); got != "starting" {
		t.Fatalf("State() = %q, want starting", got)
	}

	// running
	m.state.Store(2)
	if got := m.State(); got != "running" {
		t.Fatalf("State() = %q, want running", got)
	}

	// stopping
	m.state.Store(3)
	if got := m.State(); got != "stopping" {
		t.Fatalf("State() = %q, want stopping", got)
	}

	// crashed
	m.state.Store(4)
	if got := m.State(); got != "crashed" {
		t.Fatalf("State() = %q, want crashed", got)
	}
}

func TestManager_SetLastErr(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))

	if got := m.LastError(); got != "" {
		t.Fatalf("LastError() = %q, want empty", got)
	}

	m.setLastErr("something went wrong")
	if got := m.LastError(); got != "something went wrong" {
		t.Fatalf("LastError() = %q, want 'something went wrong'", got)
	}

	// Overwrite
	m.setLastErr("another error")
	if got := m.LastError(); got != "another error" {
		t.Fatalf("LastError() = %q, want 'another error'", got)
	}
}

func TestManager_FinalizeShutdown_AllStates(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, dir, "", false, "", log.New("test"))

	// Should not panic in any state
	for _, s := range []int32{0, 1, 2, 3, 4} {
		m.state.Store(s)
		m.FinalizeShutdown()
	}
}
