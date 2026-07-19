//go:build !windows

package repository

import "os"

func atomicRename(src, dst string) error {
	return os.Rename(src, dst)
}
