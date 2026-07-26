package atomicfile

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestWriteFile_CleanupTempOnRenameFailure verifies that the temporary
// file is cleaned up when atomicRename fails inside WriteFile.
func TestWriteFile_CleanupTempOnRenameFailure(t *testing.T) {
	dir := t.TempDir()
	// WriteFile to the temp dir itself (which is a directory) will fail at rename
	parent := filepath.Dir(dir)

	// Count .tmp-* files in parent before the call
	beforeEntries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	beforeCount := 0
	for _, e := range beforeEntries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			beforeCount++
		}
	}

	err = WriteFile(dir, []byte("data"), 0644)
	if err == nil {
		t.Fatal("expected error writing to a directory path")
	}

	// Count .tmp-* files in parent after the call — should be same as before
	afterEntries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	afterCount := 0
	for _, e := range afterEntries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			afterCount++
		}
	}
	if afterCount != beforeCount {
		t.Errorf("temp file leaked: before=%d, after=%d", beforeCount, afterCount)
	}
}

// TestWriteFile_NoTempLeakOnError is a simpler version that checks
// no temp files remain in the target directory after a failed write.
func TestWriteFile_NoTempLeakOnError(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "subdir")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}

	// WriteFile to subDir (a directory) — will fail at rename
	err := WriteFile(subDir, []byte("data"), 0644)
	if err == nil {
		t.Fatal("expected error")
	}

	// Verify no temp files remain in the parent directory
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			t.Errorf("temp file leaked: %s", e.Name())
		}
	}
}

// TestRename_CrossDevice exercises the error path when source and
// destination are on different filesystems (not applicable on Windows
// with MoveFileExW, but exercises the error handling).
func TestRename_NonExistentSourceDir(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "nonexistent", "src.txt")
	dst := filepath.Join(dir, "dst.txt")

	err := Rename(src, dst)
	if err == nil {
		t.Fatal("expected error renaming from non-existent directory")
	}
}

// TestWriteFile_WriteToRootOwned tests that WriteFile returns an error
// when trying to write to a path where the parent directory cannot be
// created (e.g., a file blocks the path).
func TestWriteFile_FileBlocksParentPath(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// Try to write to blocker/sub/file.txt — blocker is a file, not a directory
	path := filepath.Join(blocker, "sub", "file.txt")
	err := WriteFile(path, []byte("data"), 0644)
	if err == nil {
		t.Fatal("expected error when parent component is a file")
	}
}

// TestSyncDir_EmptyString tests SyncDir with an empty string path.
func TestSyncDir_EmptyString(t *testing.T) {
	if runtime.GOOS == "windows" {
		// syncDir is a no-op on Windows, always returns nil
		if err := SyncDir(""); err != nil {
			t.Errorf("SyncDir on Windows should be no-op, got %v", err)
		}
		return
	}
	// On Unix, syncing an empty string should fail
	if err := SyncDir(""); err == nil {
		t.Fatal("expected error for empty path on Unix")
	}
}

// TestWriteFile_WithSpecialFilePath tests WriteFile with edge-case paths.
func TestWriteFile_WithSpecialFilePath(t *testing.T) {
	dir := t.TempDir()

	tests := []struct {
		name string
		path string
	}{
		{"dot in dirname", filepath.Join(dir, "v1.0", "file.txt")},
		{"dash prefix", filepath.Join(dir, "-dash", "file.txt")},
		{"underscore", filepath.Join(dir, "_underscore", "file.txt")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := WriteFile(tt.path, []byte(tt.name), 0644); err != nil {
				t.Fatalf("WriteFile %s failed: %v", tt.name, err)
			}
			data, err := os.ReadFile(tt.path)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != tt.name {
				t.Errorf("got %q, want %q", string(data), tt.name)
			}
		})
	}
}