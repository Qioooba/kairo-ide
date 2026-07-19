package deploy

import "os"

func atomicReplace(src, dst string) error {
	return platformAtomicReplace(src, dst)
}

func fsyncFile(f *os.File) error {
	return f.Sync()
}
