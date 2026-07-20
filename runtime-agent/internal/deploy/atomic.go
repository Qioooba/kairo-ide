package deploy

import (
	"os"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
)

func atomicReplace(src, dst string) error {
	return atomicfile.Rename(src, dst)
}

func fsyncFile(f *os.File) error {
	return f.Sync()
}
