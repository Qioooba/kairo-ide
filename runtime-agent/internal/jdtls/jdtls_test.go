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
