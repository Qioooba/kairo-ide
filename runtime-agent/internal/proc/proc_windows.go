//go:build windows
// +build windows

package proc

import (
	"os/exec"
	"strconv"
	"syscall"
	"unsafe"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

var (
	modkernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procGenerateConsoleCtrlEvent = modkernel32.NewProc("GenerateConsoleCtrlEvent")
	procOpenProcess              = modkernel32.NewProc("OpenProcess")
	procGetExitCodeProcess       = modkernel32.NewProc("GetExitCodeProcess")
	procCloseHandle              = modkernel32.NewProc("CloseHandle")
	procTerminateProcess         = modkernel32.NewProc("TerminateProcess")
)

const (
	ctrlBreakEvent          = 1
	processTerminate        = 0x0001
	processQueryInfo        = 0x0400
	stillActive      uint32 = 259
)

func sysProcAttrForOS() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: 0x00000200,
	}
}

func terminateProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	r1, _, _ := procGenerateConsoleCtrlEvent.Call(uintptr(ctrlBreakEvent), uintptr(pid))
	if r1 == 0 {
		return nil
	}
	return nil
}

func killProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	_ = cmd.Run()
	return terminateOne(pid)
}

func terminateOne(pid int) error {
	h, _, _ := procOpenProcess.Call(uintptr(processTerminate), 0, uintptr(pid))
	if h == 0 {
		return syscall.EINVAL
	}
	defer procCloseHandle.Call(h)
	r1, _, _ := procTerminateProcess.Call(h, 1)
	if r1 == 0 {
		return syscall.EINVAL
	}
	return nil
}

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

func verifyProcessIdentity(pid int, identity domain.ProcessIdentity) bool {
	if pid <= 0 {
		return false
	}
	if !isProcessAlive(pid) {
		return false
	}
	return true
}
