package jdkmanager

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func envCleanup(t *testing.T) {
	t.Helper()
	origPath := os.Getenv("PATH")
	origHome := os.Getenv("JAVA_HOME")
	origJre := os.Getenv("KAIRO_JDT_LS_JRE")
	origJdkHome := os.Getenv("KAIRO_JDK_HOME")
	origJdkArchive := os.Getenv("KAIRO_JDK_ARCHIVE")
	origJdkHash := os.Getenv("KAIRO_JDK_SHA256")
	origCommonPaths := commonJDKPaths
	os.Unsetenv("JAVA_HOME")
	os.Unsetenv("KAIRO_JDT_LS_JRE")
	os.Unsetenv("KAIRO_JDK_HOME")
	os.Unsetenv("KAIRO_JDK_ARCHIVE")
	os.Unsetenv("KAIRO_JDK_SHA256")
	emptyDir := t.TempDir()
	t.Setenv("PATH", emptyDir)
	t.Setenv("KAIRO_DATA_DIR", emptyDir)
	t.Setenv("KAIRO_JDK_CONFIG", filepath.Join(emptyDir, "missing.json"))
	commonJDKPaths = func() []string { return nil }
	t.Cleanup(func() {
		os.Setenv("PATH", origPath)
		os.Setenv("JAVA_HOME", origHome)
		os.Setenv("KAIRO_JDT_LS_JRE", origJre)
		os.Setenv("KAIRO_JDK_HOME", origJdkHome)
		os.Setenv("KAIRO_JDK_ARCHIVE", origJdkArchive)
		os.Setenv("KAIRO_JDK_SHA256", origJdkHash)
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

func writeArchiveFile(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestEnsureJDK17_FromBundledArchive_TarGz(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("tar.gz test on non-Windows platforms")
	}

	envCleanup(t)

	archiveData := createFakeTarGz(t, false)
	tmpDir := t.TempDir()
	writeArchiveFile(t, tmpDir, "jdk17.tar.gz", archiveData)

	m := NewManager(tmpDir)

	if !m.NeedsDownload() {
		t.Fatal("expected NeedsDownload to be true before extraction")
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
		t.Error("expected NeedsDownload to be false after successful extraction")
	}
}

func TestEnsureJDK17_FromKAIROJDKArchive(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("tar.gz test on non-Windows platforms")
	}

	envCleanup(t)

	archiveData := createFakeTarGz(t, false)
	archiveDir := t.TempDir()
	archivePath := writeArchiveFile(t, archiveDir, "custom-jdk.tar.gz", archiveData)
	t.Setenv("KAIRO_JDK_ARCHIVE", archivePath)

	installDir := t.TempDir()
	m := NewManager(installDir)

	if !m.NeedsDownload() {
		t.Fatal("expected NeedsDownload to be true before extraction")
	}

	jdk, err := m.EnsureJDK17(context.Background(), nil)
	if err != nil {
		t.Fatalf("EnsureJDK17 failed: %v", err)
	}

	if jdk.Major != 17 {
		t.Errorf("expected major version 17, got %d", jdk.Major)
	}

	javaPath := filepath.Join(installDir, "jdk17", "bin", "java")
	if _, err := os.Stat(javaPath); err != nil {
		t.Errorf("java binary not found at %s: %v", javaPath, err)
	}
}

func TestEnsureJDK17_FromKAIROJDKHome(t *testing.T) {
	envCleanup(t)

	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}
	jdkHomeDir := t.TempDir()
	binDir := filepath.Join(jdkHomeDir, "bin")
	os.MkdirAll(binDir, 0755)
	javaPath := filepath.Join(binDir, javaExe)
	os.WriteFile(javaPath, []byte(createFakeJavaContent()), 0755)

	t.Setenv("KAIRO_JDK_HOME", jdkHomeDir)

	installDir := t.TempDir()
	m := NewManager(installDir)

	if !m.Detect().Available {
		t.Fatal("expected JDK to be detected via KAIRO_JDK_HOME")
	}

	jdk, err := m.EnsureJDK17(context.Background(), nil)
	if err != nil {
		t.Fatalf("EnsureJDK17 failed: %v", err)
	}

	if jdk.Major != 17 {
		t.Errorf("expected major version 17, got %d", jdk.Major)
	}
}

func TestEnsureJDK17_FromZip_Bundled(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("zip test on Windows platforms")
	}

	envCleanup(t)

	archiveData := createFakeZip(t)
	tmpDir := t.TempDir()
	writeArchiveFile(t, tmpDir, "jdk17.zip", archiveData)

	m := NewManager(tmpDir)

	jdk, err := m.EnsureJDK17(context.Background(), nil)
	if err != nil {
		t.Fatalf("EnsureJDK17 failed: %v", err)
	}

	if jdk.Major != 17 {
		t.Errorf("expected major version 17, got %d", jdk.Major)
	}

	javaPath := filepath.Join(tmpDir, "jdk17", "bin", "java.exe")
	if _, err := os.Stat(javaPath); err != nil {
		t.Errorf("java.exe not found at %s: %v", javaPath, err)
	}
}

func TestEnsureJDK17_MacLayout(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("mac layout test only on darwin")
	}

	envCleanup(t)

	archiveData := createFakeTarGz(t, true)
	tmpDir := t.TempDir()
	writeArchiveFile(t, tmpDir, "jdk17.tar.gz", archiveData)

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

func TestEnsureJDK17_AlreadyAvailable(t *testing.T) {
	envCleanup(t)
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

	jdk, err := m.EnsureJDK17(context.Background(), nil)
	if err != nil {
		t.Fatalf("EnsureJDK17 failed: %v", err)
	}

	if jdk.Major != 17 {
		t.Errorf("expected major version 17, got %d", jdk.Major)
	}
}

func TestEnsureJDK17_NoArchive_ReturnsError(t *testing.T) {
	envCleanup(t)

	tmpDir := t.TempDir()
	m := NewManager(tmpDir)

	_, err := m.EnsureJDK17(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error when no JDK available and no archive")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "no JDK 17 found") && !strings.Contains(errStr, "KAIRO_JDK_HOME") {
		t.Errorf("expected helpful offline error message, got: %s", errStr)
	}
}

func TestEnsureJDK17_InvalidArchive_ReturnsError(t *testing.T) {
	envCleanup(t)

	tmpDir := t.TempDir()
	badArchive := writeArchiveFile(t, tmpDir, "jdk17.tar.gz", []byte("this is not a tar.gz"))

	m := NewManager(tmpDir)

	_, err := m.EnsureJDK17(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error with invalid archive")
	}
	_ = badArchive
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

func TestArchiveTypeFromPath(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"jdk.tar.gz", ".tar.gz"},
		{"jdk.tgz", ".tar.gz"},
		{"jdk.zip", ".zip"},
		{"jdk.txt", ""},
		{"/path/to/JDK17.TAR.GZ", ".tar.gz"},
		{"C:\\path\\jdk17.ZIP", ".zip"},
	}
	for _, c := range cases {
		got := archiveTypeFromPath(c.path)
		if got != c.want {
			t.Errorf("archiveTypeFromPath(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}

func TestVerifySHA256(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.bin")
	testData := []byte("hello world")
	if err := os.WriteFile(testFile, testData, 0644); err != nil {
		t.Fatal(err)
	}

	if err := verifySHA256(testFile, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"); err != nil {
		t.Errorf("expected valid sha256 to pass, got: %v", err)
	}

	if err := verifySHA256(testFile, "0000000000000000000000000000000000000000000000000000000000000000"); err == nil {
		t.Error("expected invalid sha256 to fail")
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

func TestExtractTarGz_Basic(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("tar.gz test on non-Windows platforms")
	}

	tgzData := createFakeTarGz(t, false)
	tmpGz, err := os.CreateTemp("", "test-*.tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpGz.Name())
	if _, err := tmpGz.Write(tgzData); err != nil {
		t.Fatal(err)
	}
	tmpGz.Close()

	tmpDir := t.TempDir()
	if err := extractTarGz(tmpGz.Name(), tmpDir); err != nil {
		t.Fatalf("extractTarGz failed: %v", err)
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


