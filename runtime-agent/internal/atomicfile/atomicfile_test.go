package atomicfile

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWriteFile_CreatesFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")

	if err := WriteFile(path, []byte("hello"), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != "hello" {
		t.Errorf("got %q, want %q", string(data), "hello")
	}
}

func TestWriteFile_CreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "deep", "test.txt")

	if err := WriteFile(path, []byte("deep"), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != "deep" {
		t.Errorf("got %q, want %q", string(data), "deep")
	}
}

func TestWriteFile_ReplacesExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")

	if err := WriteFile(path, []byte("old"), 0644); err != nil {
		t.Fatalf("first WriteFile failed: %v", err)
	}
	if err := WriteFile(path, []byte("new"), 0644); err != nil {
		t.Fatalf("second WriteFile failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != "new" {
		t.Errorf("got %q, want %q", string(data), "new")
	}
}

func TestWriteFile_ReplacesExistingUnderUnicodeAndSpacePath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Kairo 项目", "配置 目录")
	path := filepath.Join(dir, "服务器 配置.json")

	if err := WriteFile(path, []byte("旧配置"), 0644); err != nil {
		t.Fatalf("first WriteFile failed: %v", err)
	}
	if err := WriteFile(path, []byte("新配置"), 0644); err != nil {
		t.Fatalf("replacement WriteFile failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if got, want := string(data), "新配置"; got != want {
		t.Fatalf("content = %q, want %q", got, want)
	}
}

func TestWriteFile_PreservesPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.Chmod does not preserve Unix-style permission bits on Windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")

	if err := WriteFile(path, []byte("perm"), 0755); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat failed: %v", err)
	}
	perm := info.Mode().Perm()
	if perm != 0755 {
		t.Errorf("got permissions %o, want %o", perm, 0755)
	}
}

func TestWriteFile_NoTempLeak(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")

	if err := WriteFile(path, []byte("clean"), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir failed: %v", err)
	}
	for _, e := range entries {
		if e.Name() != "test.txt" {
			t.Errorf("unexpected file in dir: %s", e.Name())
		}
	}
}

func TestWriteFile_ConcurrentWrites(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("concurrent file writes are not atomic on Windows due to file locking")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")

	const writers = 10
	done := make(chan error, writers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			done <- WriteFile(path, []byte("writer"), 0644)
		}(i)
	}
	for i := 0; i < writers; i++ {
		if err := <-done; err != nil {
			t.Errorf("writer %d: %v", i, err)
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != "writer" {
		t.Errorf("got %q, want %q", string(data), "writer")
	}
}

func TestRename(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")

	if err := os.WriteFile(src, []byte("rename"), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	if err := Rename(src, dst); err != nil {
		t.Fatalf("Rename failed: %v", err)
	}

	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != "rename" {
		t.Errorf("got %q, want %q", string(data), "rename")
	}
}

func TestSyncDir(t *testing.T) {
	dir := t.TempDir()
	if err := SyncDir(dir); err != nil {
		t.Fatalf("SyncDir failed: %v", err)
	}
}

func TestWriteFile_EmptyData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")

	if err := WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatalf("WriteFile with empty data failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if len(data) != 0 {
		t.Errorf("expected empty file, got %d bytes", len(data))
	}
}

func TestWriteFile_BinaryData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "binary.bin")
	data := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD}
	if err := WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("WriteFile with binary data: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(data) {
		t.Fatalf("len = %d, want %d", len(got), len(data))
	}
	for i := range data {
		if got[i] != data[i] {
			t.Fatalf("byte[%d] = %02x, want %02x", i, got[i], data[i])
		}
	}
}

func TestWriteFile_LargeData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "large.bin")
	data := make([]byte, 1024*1024) // 1 MB
	for i := range data {
		data[i] = byte(i % 256)
	}
	if err := WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("WriteFile with large data: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(data) {
		t.Fatalf("len = %d, want %d", len(got), len(data))
	}
	if got[0] != 0 || got[1023] != 0xFF {
		t.Fatal("data corruption detected")
	}
}

func TestWriteFile_ReadOnlyDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.Mkdir with 0555 does not create a truly read-only directory on Windows")
	}
	dir := t.TempDir()
	readOnly := filepath.Join(dir, "readonly")
	if err := os.Mkdir(readOnly, 0o555); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(readOnly, 0o755)
	path := filepath.Join(readOnly, "test.txt")
	if err := WriteFile(path, []byte("hello"), 0o644); err == nil {
		t.Fatal("expected error writing to read-only directory")
	}
}

func TestWriteFile_ReplaceWithDifferentPerms(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.Chmod does not preserve Unix-style permission bits on Windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	if err := WriteFile(path, []byte("first"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(path, []byte("second"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("perm = %o, want 0600", info.Mode().Perm())
	}
}

func TestWriteFile_DeepNestedDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a", "b", "c", "d", "e", "deep.txt")
	if err := WriteFile(path, []byte("deep"), 0o644); err != nil {
		t.Fatalf("WriteFile deep nested: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "deep" {
		t.Fatalf("got %q, want deep", string(got))
	}
}

func TestRename_SourceNotFound(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "nonexistent")
	dst := filepath.Join(dir, "dest")
	if err := Rename(src, dst); err == nil {
		t.Fatal("expected error for nonexistent source")
	}
}

func TestSyncDir_Nonexistent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("syncDir is a no-op on Windows and never returns an error")
	}
	dir := t.TempDir()
	nonexistent := filepath.Join(dir, "nonexistent")
	if err := SyncDir(nonexistent); err == nil {
		t.Fatal("expected error for nonexistent directory")
	}
}

func TestWriteFile_DirectoryPath(t *testing.T) {
	dir := t.TempDir()
	// Try to write to a path that is already a directory
	if err := WriteFile(dir, []byte("data"), 0o644); err == nil {
		t.Fatal("expected error when writing to a directory path")
	}
}

// =============================================================================
// Rename edge cases
// =============================================================================

func TestRename_OverwriteExisting(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")

	if err := os.WriteFile(src, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := Rename(src, dst); err != nil {
		t.Fatalf("Rename failed: %v", err)
	}

	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new" {
		t.Errorf("got %q, want new", string(data))
	}
}

func TestRename_DstNotFound(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "nonexistent", "dst.txt")

	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	err := Rename(src, dst)
	if err == nil {
		t.Fatal("expected error renaming to nonexistent directory")
	}
}

// =============================================================================
// SyncDir on Windows is a no-op
// =============================================================================

func TestSyncDir_WindowsNoOp(t *testing.T) {
	// syncDir on Windows should always return nil
	if err := SyncDir(""); err != nil {
		t.Errorf("SyncDir on Windows should be no-op, got %v", err)
	}
}

// =============================================================================
// Windows atomic rename with unicode paths
// =============================================================================

func TestWriteFile_UnicodeSpacesWindows(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "测试 项目", "配置 目录")
	path := filepath.Join(dir, "文件.txt")
	if err := WriteFile(path, []byte("unicode"), 0644); err != nil {
		t.Fatalf("WriteFile with unicode path failed: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "unicode" {
		t.Errorf("got %q, want unicode", string(data))
	}
}

// =============================================================================
// WriteFile with special Windows paths
// =============================================================================

func TestWriteFile_LongPath(t *testing.T) {
	dir := t.TempDir()
	// Create a path that is nearly 200 chars
	longName := filepath.Join(dir, "very_long_directory_name_"+strings.Repeat("x", 50))
	path := filepath.Join(longName, "file.txt")
	if err := WriteFile(path, []byte("long"), 0644); err != nil {
		t.Fatalf("WriteFile with long path failed: %v", err)
	}
}

func TestWriteFile_MultipleReplacements(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "multi.txt")
	for i := 0; i < 10; i++ {
		data := []byte(fmt.Sprintf("iteration-%d", i))
		if err := WriteFile(path, data, 0644); err != nil {
			t.Fatalf("WriteFile iteration %d failed: %v", i, err)
		}
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "iteration-9" {
		t.Errorf("got %q, want iteration-9", string(got))
	}
}

// =============================================================================
// WriteFile nil data
// =============================================================================

func TestWriteFile_NilData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nil.txt")
	if err := WriteFile(path, nil, 0644); err != nil {
		t.Fatalf("WriteFile with nil data failed: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 0 {
		t.Errorf("expected empty file, got %d bytes", len(data))
	}
}

// =============================================================================
// WriteFile error paths
// =============================================================================

func TestWriteFile_ParentIsFile(t *testing.T) {
	dir := t.TempDir()
	// Create a file where a directory should be
	parentFile := filepath.Join(dir, "parent")
	if err := os.WriteFile(parentFile, []byte("block"), 0644); err != nil {
		t.Fatal(err)
	}
	// Try to write to parentFile/subdir/file.txt — MkdirAll should fail
	path := filepath.Join(parentFile, "sub", "file.txt")
	if err := WriteFile(path, []byte("data"), 0644); err == nil {
		t.Fatal("expected error when parent is a file, not a directory")
	}
}

func TestWriteFile_RenameToDirectory(t *testing.T) {
	dir := t.TempDir()
	// Create a subdirectory
	subDir := filepath.Join(dir, "subdir")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	// WriteFile to subDir (which is a directory) — atomicRename should fail
	if err := WriteFile(subDir, []byte("data"), 0644); err == nil {
		t.Fatal("expected error when renaming to a directory path")
	}
}

func TestRename_SameFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "same.txt")
	if err := os.WriteFile(path, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	// Rename to self — on Windows MoveFileExW with same src/dst is a no-op
	err := Rename(path, path)
	// On Unix, os.Rename with same path is a no-op
	// On Windows, MoveFileExW with same src/dst returns success
	if err != nil {
		t.Logf("Rename to self returned error (expected on some platforms): %v", err)
	}
	// Verify data is intact
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "data" {
		t.Errorf("got %q, want data", string(data))
	}
}

func TestRename_EmptyPaths(t *testing.T) {
	// Rename with empty paths should fail
	if err := Rename("", "dst"); err == nil {
		t.Fatal("expected error for empty src")
	}
	if err := Rename("src", ""); err == nil {
		t.Fatal("expected error for empty dst")
	}
}

func TestSyncDir_FileInsteadOfDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("syncDir is a no-op on Windows")
	}
	dir := t.TempDir()
	filePath := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(filePath, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	// Syncing a file instead of a directory should fail on Unix
	if err := SyncDir(filePath); err == nil {
		t.Fatal("expected error syncing a file path")
	}
}

func TestWriteFile_ZeroPerm(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "zero.txt")
	if err := WriteFile(path, []byte("data"), 0000); err != nil {
		t.Fatalf("WriteFile with zero perm: %v", err)
	}
	// Verify file exists and has content
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "data" {
		t.Errorf("got %q, want data", string(data))
	}
}

func TestWriteFile_SpecialChars(t *testing.T) {
	dir := t.TempDir()
	names := []string{
		"file (1).txt",
		"file [copy].txt",
		"file {backup}.txt",
		"file;test.txt",
		"file,test.txt",
		"file&test.txt",
		"file'test.txt",
		"file#1.txt",
		"file@2.txt",
		"file!ok.txt",
		"file$dollar.txt",
		"file%percent.txt",
		"file^caret.txt",
		"file+plus.txt",
		"file=equal.txt",
		"file~tilde.txt",
		"file`backtick.txt",
	}
	for _, name := range names {
		path := filepath.Join(dir, name)
		if err := WriteFile(path, []byte(name), 0644); err != nil {
			t.Errorf("WriteFile with special char name %q failed: %v", name, err)
		}
	}
	// Verify all files exist
	for _, name := range names {
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			t.Errorf("ReadFile %q: %v", name, err)
		}
		if string(data) != name {
			t.Errorf("content mismatch for %q", name)
		}
	}
}

func TestWriteFile_ConcurrentDifferentFiles(t *testing.T) {
	dir := t.TempDir()
	const writers = 20
	done := make(chan error, writers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			path := filepath.Join(dir, fmt.Sprintf("file-%d.txt", i))
			done <- WriteFile(path, []byte(fmt.Sprintf("data-%d", i)), 0644)
		}(i)
	}
	for i := 0; i < writers; i++ {
		if err := <-done; err != nil {
			t.Errorf("writer %d: %v", i, err)
		}
	}
	// Verify all files
	for i := 0; i < writers; i++ {
		path := filepath.Join(dir, fmt.Sprintf("file-%d.txt", i))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Errorf("ReadFile %d: %v", i, err)
		}
		expected := fmt.Sprintf("data-%d", i)
		if string(data) != expected {
			t.Errorf("content mismatch for %d: got %q, want %q", i, string(data), expected)
		}
	}
}
