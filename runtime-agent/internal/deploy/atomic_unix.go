//go:build !windows

package deploy

import "os"

func platformAtomicReplace(src, dst string) error {
	return os.Rename(src, dst)
}
