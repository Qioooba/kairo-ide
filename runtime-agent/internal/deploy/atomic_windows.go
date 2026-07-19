//go:build windows

package deploy

import (
	"errors"
	"os"
	"syscall"
	"time"
)

func platformAtomicReplace(src, dst string) error {
	const maxRetries = 10
	for i := 0; i < maxRetries; i++ {
		err := os.Rename(src, dst)
		if err == nil {
			return nil
		}
		var linkErr *os.LinkError
		if errors.As(err, &linkErr) {
			if errno, ok := linkErr.Err.(syscall.Errno); ok && isSharingViolation(errno) {
				time.Sleep(time.Millisecond * time.Duration(10*(i+1)))
				continue
			}
		}
		return err
	}
	return os.Rename(src, dst)
}

func isSharingViolation(errno syscall.Errno) bool {
	return errno == 32 || errno == 33
}
