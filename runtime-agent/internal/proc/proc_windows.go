//go:build windows
// +build windows

package proc

import (
	"fmt"
	"os/exec"
	"strconv"
	"syscall"
	"unsafe"
)

var (
	modkernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procGenerateConsoleCtrlEvent = modkernel32.NewProc("GenerateConsoleCtrlEvent")
	procOpenProcess              = modkernel32.NewProc("OpenProcess")
	procGetExitCodeProcess       = modkernel32.NewProc("GetExitCodeProcess")
	procCloseHandle              = modkernel32.NewProc("CloseHandle")
	procTerminateProcess         = modkernel32.NewProc("TerminateProcess")
)

// Windows console control events. CTRL_BREAK_EVENT = 1.
const (
	ctrlBreakEvent   = 1
	processTerminate = 0x0001
	processQueryInfo = 0x0400
	stillActive      = 259 // STATUS_PENDING
)

// sysProcAttrForOS uses CREATE_NEW_PROCESS_GROUP so that
// CTRL_BREAK_EVENT can be delivered for graceful shutdown.
func sysProcAttrForOS() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: 0x00000200, // CREATE_NEW_PROCESS_GROUP
	}
}

// Windows has no real SIGTERM/SIGKILL distinction. We encode
// "terminate" as 1 (CTRL_BREAK_EVENT) and "kill" as -1
// (TerminateProcess) inside a fakeSignal. signalGroup dispatches.
type fakeSignal int

func terminateSignal() syscall.Signal { return syscall.Signal(fakeSignal(ctrlBreakEvent)) }
func killSignal() syscall.Signal      { return syscall.Signal(fakeSignal(-1)) }

func signalGroup(pid int, sig syscall.Signal) error {
	if int(sig) == -1 {
		return killProcessGroup(pid)
	}
	return terminateProcessGroup(pid)
}

// terminateProcessGroup sends CTRL_BREAK_EVENT to the process
// group. Requires CREATE_NEW_PROCESS_GROUP, set in sysProcAttrForOS.
func terminateProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	r1, _, e1 := procGenerateConsoleCtrlEvent.Call(uintptr(ctrlBreakEvent), uintptr(pid))
	if r1 == 0 {
		if e1 != nil && e1 != syscall.Errno(0) {
			return e1
		}
		return syscall.EINVAL
	}
	return nil
}

// killProcessGroup shells out to taskkill /F /T /PID, which walks
// the process tree and force-terminates each node. Falls back to
// TerminateProcess on the root pid if taskkill is unavailable.
func killProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	if out, err := cmd.CombinedOutput(); err == nil {
		return nil
	} else {
		_ = out
	}
	return terminateOne(pid)
}

func terminateOne(pid int) error {
	h, _, e1 := procOpenProcess.Call(uintptr(processTerminate), 0, uintptr(pid))
	if h == 0 {
		if e1 != nil && e1 != syscall.Errno(0) {
			return e1
		}
		return syscall.EINVAL
	}
	defer procCloseHandle.Call(h)
	r1, _, e1 := procTerminateProcess.Call(h, 1)
	if r1 == 0 {
		if e1 != nil && e1 != syscall.Errno(0) {
			return e1
		}
		return syscall.EINVAL
	}
	return nil
}

// isProcessAlive uses OpenProcess + GetExitCodeProcess. We do
// not use os.FindProcess because on Windows it succeeds for any
// PID without confirming the process exists.
func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, _, _ := procOpenProcess.Call(uintptr(processQueryInfo), 0, uintptr(pid))
	if h == 0 {
		return false
	}
	defer procCloseHandle.Call(h)
	var code uint32
	r1, _, _ := procGetExitCodeProcess.Call(h, uintptr(unsafe.Pointer(&code)))
	if r1 == 0 {
		return false
	}
	return code == stillActive
}

// unused, kept to make the imports list explicit.
var _ = fmt.Sprintf
