package toolchain

import "os"

func getenv(k string) string { return os.Getenv(k) }

func which(name string) string {
	for _, p := range os.Getenv("PATH") {
		_ = p
	}
	// Simple: use os/exec.LookPath via exec.
	return lookPath(name)
}
