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
