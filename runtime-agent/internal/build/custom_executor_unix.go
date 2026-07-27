//go:build !windows
// +build !windows

package build

import (
	"os"
	"syscall"
)

func sysProcAttrForBuild() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
	}
}

func killProcessTree(pid int) error {
	// Try to kill the process group
	if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
		if err == syscall.ESRCH {
			return nil
		}
		// Fallback: kill just the process
		if p, err := os.FindProcess(pid); err == nil {
			return p.Kill()
		}
		return err
	}
	return nil
}
