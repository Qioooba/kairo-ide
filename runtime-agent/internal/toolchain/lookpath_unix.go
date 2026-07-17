//go:build !windows
// +build !windows

package toolchain

import "os/exec"

func lookPath(name string) string {
	p, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return p
}
