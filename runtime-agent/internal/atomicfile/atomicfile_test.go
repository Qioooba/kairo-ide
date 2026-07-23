package atomicfile

import (
	"os"
	"path/filepath"
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
