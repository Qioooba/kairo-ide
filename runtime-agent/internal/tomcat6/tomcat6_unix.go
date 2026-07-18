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
// signalProcGroup sends sig to the process group led by pid.
// Setpgid:true in sysProcAttrForOS makes the JVM its own group
// leader, so -pid targets the whole group including any
// subprocesses spawned via Runtime.exec.
func signalProcGroup(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err == nil {
		return nil
	}
	// Fall back to direct PID for the case where Setpgid didn't
	// take effect (e.g. the process was reparented).
	return syscall.Kill(pid, sig)
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
