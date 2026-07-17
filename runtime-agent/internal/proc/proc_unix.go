//go:build !windows
// +build !windows

package proc

import "syscall"

// sysProcAttrForOS sets the process group so we can kill the
// whole tree, and detaches from the controlling terminal.
func sysProcAttrForOS() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
		Pgid:    0,
	}
}
