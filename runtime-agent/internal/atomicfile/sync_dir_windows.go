//go:build windows

package atomicfile

// Windows does not expose a portable equivalent of fsync for a directory
// handle. The file itself is flushed before MoveFileExW is called with
// MOVEFILE_WRITE_THROUGH, so there is no additional directory operation to
// perform here. In particular, os.File.Sync on a directory must not turn an
// otherwise successful atomic replacement into an error.
func syncDir(string) error {
	return nil
}
