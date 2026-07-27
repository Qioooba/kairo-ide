//go:build windows
// +build windows

package build

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
)

func sysProcAttrForBuild() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: createNewProcessGroup,
	}
}

func killProcessTree(pid int) error {
	// Use taskkill /F /T to kill the entire process tree on Windows
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	if err := cmd.Run(); err != nil {
		// Fallback: try to kill just the process
		if p, err := os.FindProcess(pid); err == nil {
			return p.Kill()
		}
		return err
	}
	return nil
}
