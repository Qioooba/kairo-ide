package atomicfile

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// WriteFile writes data to the file at path atomically using the
// write-to-temp + fsync + rename pattern. On crash, either the
// old content or the new content will be present — never a
// partial write.
//
// On Windows, the rename step uses MoveFileExW with
// MOVEFILE_REPLACE_EXISTING and retries on sharing violations.
// On Unix, it uses os.Rename which is atomic when source and
// destination are on the same filesystem.
func WriteFile(path string, data []byte, perm fs.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()

	cleanup := func() {
		os.Remove(tmpPath)
	}

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		cleanup()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return fmt.Errorf("sync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		cleanup()
		return fmt.Errorf("chmod: %w", err)
	}
	if err := atomicRename(tmpPath, path); err != nil {
		cleanup()
		return fmt.Errorf("rename: %w", err)
	}
	return syncDir(dir)
}

// Rename atomically renames src to dst. On Windows it uses
// MoveFileExW with MOVEFILE_REPLACE_EXISTING and retries on
// sharing violations. On Unix it uses os.Rename.
//
// Callers that need an atomic write-from-scratch should prefer
// WriteFile. Rename is for cases where the caller has already
// created and written a temp file and just needs the final
// rename step.
func Rename(src, dst string) error {
	return atomicRename(src, dst)
}

// SyncDir fsyncs the directory at dir so that renames within it
// are durable. Exported for callers that need it independently.
func SyncDir(dir string) error {
	return syncDir(dir)
}
