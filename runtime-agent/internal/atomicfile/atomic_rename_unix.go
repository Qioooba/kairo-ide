//go:build !windows

package atomicfile

import "os"

func atomicRename(src, dst string) error {
	return os.Rename(src, dst)
}
