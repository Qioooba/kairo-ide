//go:build !windows
// +build !windows

package proc

import (
	"errors"
	"os"
	"syscall"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

func sysProcAttrForOS() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
		Pgid:    0,
	}
}

func terminateProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	pgid := -pid
	if err := syscall.Kill(pgid, syscall.SIGTERM); err != nil {
		if err == syscall.ESRCH {
			return nil
		}
		return syscall.Kill(pid, syscall.SIGTERM)
	}
	return nil
}

func killProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	pgid := -pid
	if err := syscall.Kill(pgid, syscall.SIGKILL); err != nil {
		if err == syscall.ESRCH {
			return nil
		}
		return syscall.Kill(pid, syscall.SIGKILL)
	}
	return nil
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if err := p.Signal(syscall.Signal(0)); err != nil {
		if errors.Is(err, os.ErrProcessDone) {
			return false
		}
		if err == syscall.ESRCH {
			return false
		}
		return false
	}
	return true
}

func verifyProcessIdentity(pid int, identity domain.ProcessIdentity) bool {
	if pid <= 0 {
		return false
	}
	if !isProcessAlive(pid) {
		return false
	}
	return true
}
