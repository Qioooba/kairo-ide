//go:build !windows

package atomicfile

import (
	"fmt"
	"os"
)

func atomicRename(src, dst string) error {
	return os.Rename(src, dst)
}

func syncDir(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("open parent dir %s for sync: %w", dir, err)
	}
	defer f.Close()
	if err := f.Sync(); err != nil {
		return fmt.Errorf("sync parent dir %s: %w", dir, err)
	}
	return nil
}
