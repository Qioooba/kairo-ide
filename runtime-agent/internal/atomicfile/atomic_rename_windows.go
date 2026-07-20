//go:build windows

package atomicfile

import (
	"errors"
	"fmt"
	"math/rand"
	"os"
	"syscall"
	"time"
	"unsafe"
)

const (
	movefileReplaceExisting = 0x00000001
	movefileWriteThrough    = 0x00000008
)

var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	procMoveFileExW = kernel32.NewProc("MoveFileExW")
)

const (
	ERROR_SHARING_VIOLATION syscall.Errno = 32
	ERROR_LOCK_VIOLATION    syscall.Errno = 33
)

func isRetryableErrno(errno syscall.Errno) bool {
	return errno == ERROR_SHARING_VIOLATION || errno == ERROR_LOCK_VIOLATION
}

func moveFileEx(src, dst string, flags uint32) error {
	srcPtr, err := syscall.UTF16PtrFromString(src)
	if err != nil {
		return fmt.Errorf("convert src path: %w", err)
	}
	dstPtr, err := syscall.UTF16PtrFromString(dst)
	if err != nil {
		return fmt.Errorf("convert dst path: %w", err)
	}
	ret, _, callErr := procMoveFileExW.Call(
		uintptr(unsafe.Pointer(srcPtr)),
		uintptr(unsafe.Pointer(dstPtr)),
		uintptr(flags),
	)
	if ret == 0 {
		return callErr
	}
	return nil
}

func atomicRename(src, dst string) error {
	deadline := time.Now().Add(500 * time.Millisecond)
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	for {
		err := moveFileEx(src, dst, movefileReplaceExisting|movefileWriteThrough)
		if err == nil {
			return nil
		}

		var errno syscall.Errno
		var linkErr *os.LinkError
		switch {
		case errors.As(err, &linkErr):
			if e, ok := linkErr.Err.(syscall.Errno); ok {
				errno = e
			}
		default:
			if e, ok := err.(syscall.Errno); ok {
				errno = e
			}
		}

		if errno != 0 && isRetryableErrno(errno) {
			if time.Now().After(deadline) {
				return fmt.Errorf("atomic rename timed out after retry deadline: %w", err)
			}
			jitter := time.Duration(rng.Intn(30)) * time.Millisecond
			backoff := 10*time.Millisecond + jitter
			time.Sleep(backoff)
			continue
		}

		return err
	}
}

// syncDir is a no-op on Windows. The POSIX `os.Open(dir).Sync()` pattern
// is not supported on Windows (returns ERROR_ACCESS_DENIED on most
// directory handles; the OS does not expose a real directory-fsync
// equivalent). The atomicity guarantee we need is already provided by
// MoveFileExW + MOVEFILE_WRITE_THROUGH in atomicRename above.
func syncDir(dir string) error {
	_ = dir
	return nil
}
