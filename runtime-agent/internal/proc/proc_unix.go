//go:build !windows
// +build !windows

package proc

import (
	"errors"
	"os"
	"syscall"
)

// sysProcAttrForOS sets the process group so we can kill the
// whole tree, and detaches from the controlling terminal.
func sysProcAttrForOS() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
		Pgid:    0,
	}
}

// terminateSignal / killSignal return the platform "please go away"
// and "die now" signals. On POSIX these are SIGTERM / SIGKILL.
func terminateSignal() syscall.Signal { return syscall.SIGTERM }
func killSignal() syscall.Signal      { return syscall.SIGKILL }

// signalGroup delivers a signal to the process group rooted at
// pid. A negative pid means "send to the process group whose
// pgid is |pid|". Falls back to the direct PID if the group
// signal is not supported (e.g. the process is not a group leader).
func signalGroup(pid int, sig syscall.Signal) error {
	pgid := -pid
	if err := syscall.Kill(pgid, sig); err == nil {
		return nil
	}
	return syscall.Kill(pid, sig)
}

// isProcessAlive uses signal 0, the POSIX liveness probe.
func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if err := p.Signal(syscall.Signal(0)); err != nil {
		return !errors.Is(err, os.ErrProcessDone)
	}
	return true
}
