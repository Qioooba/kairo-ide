//go:build !windows
// +build !windows

package tomcat6

import "syscall"

// sysProcAttrForOS sets the process group so we can kill the
// whole tree, and detaches from the controlling terminal.
func sysProcAttrForOS() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
	}
}

// isAlive reports whether the OS process with the given PID
// exists.
func isAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	if err := syscall.Kill(pid, 0); err == nil {
		return true
	}
	return false
}
