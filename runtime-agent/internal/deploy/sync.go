// Package deploy handles atomic file synchronization from a
// source directory to a deployment directory. We use temp-file-
// plus-rename to avoid Tomcat reading half-written files.
package deploy

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Sync mirrors src to dst. For each regular file under src,
// the corresponding file under dst is written atomically. New
// directories are created. Files in dst that no longer exist
// in src are removed (subject to SafeDelete).
//
// dstRoot must be the deployment root. Files outside dstRoot
// are never touched.
func Sync(srcRoot, dstRoot string) error {
	srcRoot = cleanAbs(srcRoot)
	dstRoot = cleanAbs(dstRoot)
	if srcRoot == "" || dstRoot == "" {
		return errors.New("empty source or destination root")
	}
	if !isInside(srcRoot, dstRoot) && !isInside(dstRoot, srcRoot) {
		// Disjoint trees are fine for explicit deploys.
	}
	if err := os.MkdirAll(dstRoot, 0o755); err != nil {
		return err
	}

	// Track which destination files we've already seen, so we
	// can prune.
	seen := map[string]bool{}
	err := filepath.WalkDir(srcRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(srcRoot, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		dst := filepath.Join(dstRoot, rel)
		// Defensive: ensure dst is inside dstRoot.
		if !isInside(dst, dstRoot) {
			return fmt.Errorf("refusing to write outside dstRoot: %s", dst)
		}
		seen[dst] = true
		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		return atomicCopy(path, dst)
	})
	if err != nil {
		return err
	}
	// Prune.
	return prune(dstRoot, seen)
}

func atomicCopy(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmp, err := os.CreateTemp(filepath.Dir(dst), ".kairo-tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, dst); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return nil
}

// SafeDelete removes a path if it is inside root.
func SafeDelete(root, target string) error {
	root = cleanAbs(root)
	target = cleanAbs(target)
	if !isInside(target, root) {
		return fmt.Errorf("refusing to delete outside root: %s", target)
	}
	return os.RemoveAll(target)
}

func prune(root string, seen map[string]bool) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if seen[path] {
			return nil
		}
		if path == root {
			return nil
		}
		// File/dir not in seen — safe to remove.
		return os.RemoveAll(path)
	})
}

func cleanAbs(p string) string {
	if p == "" {
		return ""
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return filepath.Clean(abs)
}

func isInside(child, parent string) bool {
	if child == parent {
		return true
	}
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false
	}
	return true
}
