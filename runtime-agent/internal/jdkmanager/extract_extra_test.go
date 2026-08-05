package jdkmanager

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

// TestExtractTarGz_OnAllPlatforms exercises extractTarGz directly. The
// existing TestExtractTarGz_Basic skips on Windows, which left the
// extraction loop uncovered on this platform.
func TestExtractTarGz_OnAllPlatforms(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "fixture.tar.gz")
	if err := os.WriteFile(archivePath, createFakeTarGz(t, false), 0644); err != nil {
		t.Fatal(err)
	}

	destDir := filepath.Join(dir, "out")
	if err := extractTarGz(archivePath, destDir); err != nil {
		t.Fatalf("extractTarGz failed: %v", err)
	}

	entries, err := os.ReadDir(destDir)
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

// TestExtractTarGz_Corrupt verifies the error path for an invalid gzip stream.
func TestExtractTarGz_Corrupt(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "bad.tar.gz")
	if err := os.WriteFile(archivePath, []byte("not a gzip file"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := extractTarGz(archivePath, filepath.Join(dir, "out")); err == nil {
		t.Fatal("expected error for corrupt tar.gz")
	}
}

// TestExtractTarGz_SymlinkEscape verifies escaping symlinks are skipped (GO-P2-3).
func TestExtractTarGz_SymlinkEscape(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "symlink-escape.tar.gz")

	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	if err := tw.WriteHeader(&tar.Header{
		Name:     "jdk-safe/",
		Mode:     0755,
		Typeflag: tar.TypeDir,
	}); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{
		Name:     "jdk-safe/escape",
		Mode:     0777,
		Typeflag: tar.TypeSymlink,
		Linkname: "/etc/passwd",
	}); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{
		Name:     "jdk-safe/rel-escape",
		Mode:     0777,
		Typeflag: tar.TypeSymlink,
		Linkname: "../../outside.txt",
	}); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archivePath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	destDir := filepath.Join(dir, "out")
	if err := extractTarGz(archivePath, destDir); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(destDir, "jdk-safe", "escape")); !os.IsNotExist(err) {
		t.Fatalf("absolute symlink escape should be skipped, err=%v", err)
	}
	if _, err := os.Lstat(filepath.Join(destDir, "jdk-safe", "rel-escape")); !os.IsNotExist(err) {
		t.Fatalf("relative symlink escape should be skipped, err=%v", err)
	}
}

// TestExtractAndMove_RoundTrip verifies extractAndMove with a tar.gz fixture.
func TestExtractAndMove_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "jdk17.tar.gz")
	if err := os.WriteFile(archivePath, createFakeTarGz(t, false), 0644); err != nil {
		t.Fatal(err)
	}

	targetDir := filepath.Join(dir, "target")
	m := NewManager(dir)
	if err := m.extractAndMove(archivePath, ".tar.gz", targetDir); err != nil {
		t.Fatalf("extractAndMove failed: %v", err)
	}

	javaPath := filepath.Join(targetDir, "bin", "java")
	if _, err := os.Stat(javaPath); err != nil {
		t.Errorf("java not extracted at %s: %v", javaPath, err)
	}
}
