//go:build windows

package atomicfile

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// TestAtomicRename_SharingViolationRetry exercises the retry loop in
// atomicRename on Windows. By opening the source file without FILE_SHARE_DELETE,
// MoveFileExW (which needs DELETE access on the source) fails with
// ERROR_SHARING_VIOLATION, which triggers the retry/backoff/deadline logic.
func TestAtomicRename_SharingViolationRetry(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")

	// Create source and destination files
	if err := os.WriteFile(src, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	// Open src with no sharing to prevent MoveFileExW from acquiring
	// DELETE access on the source, causing ERROR_SHARING_VIOLATION.
	srcPtr, err := syscall.UTF16PtrFromString(src)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := syscall.CreateFile(
		srcPtr,
		syscall.GENERIC_READ,
		syscall.FILE_SHARE_READ, // allow read sharing but NOT delete
		nil,
		syscall.OPEN_EXISTING,
		syscall.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.CloseHandle(handle)

	// atomicRename should retry and eventually timeout (~500ms deadline)
	err = atomicRename(src, dst)
	if err == nil {
		t.Fatal("expected timeout error due to sharing violation")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("expected timeout error, got: %v", err)
	}

	// dst should still have old content (rename failed)
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "old" {
		t.Errorf("dst should be unchanged, got %q", string(data))
	}
}