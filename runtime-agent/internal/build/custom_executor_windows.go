//go:build windows
// +build windows

package build

import (
	"errors"
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
	if pid <= 0 {
		return nil
	}
	// Use taskkill /F /T to kill the entire process tree on Windows
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	if err := cmd.Run(); err != nil {
		// Exit code 128 indicates the process does not exist / already exited (equivalent to ESRCH)
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 128 {
			return nil
		}
		// Fallback: try to kill just the process
		if p, errFind := os.FindProcess(pid); errFind == nil {
			if killErr := p.Kill(); killErr == nil || errors.Is(killErr, os.ErrProcessDone) {
				return nil
			} else {
				return killErr
			}
		}
		return err
	}
	return nil
}
