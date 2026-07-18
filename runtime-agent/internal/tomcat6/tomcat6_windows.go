//go:build windows
// +build windows

package tomcat6

import "syscall"

// sysProcAttrForOS uses CREATE_NEW_PROCESS_GROUP so that
// CTRL_BREAK_EVENT can be delivered for graceful shutdown.
func sysProcAttrForOS() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: 0x00000200, // CREATE_NEW_PROCESS_GROUP
	}
}

// signalProcGroup on Windows: signal the single PID. Windows
// does not have POSIX process groups; CREATE_NEW_PROCESS_GROUP
// above is for console-event delivery, not for kill-tree
// semantics. A more thorough fix would walk the process tree
// via the toolhelp32 snapshot, but for the Tomcat use case the
// JVM does not spawn persistent children.
func signalProcGroup(pid int, sig syscall.Signal) error {
	if p, err := syscall.OpenProcess(syscall.PROCESS_TERMINATE, false, uint32(pid)); err == nil {
		defer syscall.CloseHandle(p)
		if sig == syscall.SIGKILL {
			return syscall.TerminateProcess(p, 1)
		}
	}
	return nil
}

// isAlive on Windows: find the process handle and check.
func isAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := syscall.OpenProcess(syscall.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)
	var code uint32
	if err := syscall.GetExitCodeProcess(h, &code); err != nil {
		return false
	}
	return code == 259 // STILL_ACTIVE
}
