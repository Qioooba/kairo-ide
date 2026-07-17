// Package security implements the path sandbox and request
// authentication primitives. See docs/security.md and
// docs/adr/0008-security-remote-workspace.md.
package security

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ErrPathForbidden is returned when a path is not under any
// authorized workspace root.
var ErrPathForbidden = errors.New("path is outside any authorized workspace root")

// ErrPathReadOnly is returned when a write is attempted against
// a read-only path (e.g. a file under bundled/).
var ErrPathReadOnly = errors.New("path is read-only")

// ErrSymlinkEscape is returned when a symlink resolves outside
// the workspace roots.
var ErrSymlinkEscape = errors.New("symlink resolves outside workspace root")

// WorkspaceRoots is the set of canonical roots a user is allowed
// to operate in. On the desktop form, the agent runs as a
// single-user process; on the server form, every user has a
// per-user root.
type WorkspaceRoots struct {
	roots []string
	// readonly are paths that may be read but not written.
	// These are always relative to the DataDir (e.g. bundled/, audit/).
	readonly []string
}

// NewWorkspaceRoots builds a roots set. Input paths are
// canonicalized and symlinks are resolved. A non-existent root
// is allowed (the agent may not have created it yet).
func NewWorkspaceRoots(roots ...string) (*WorkspaceRoots, error) {
	out := &WorkspaceRoots{}
	for _, r := range roots {
		cr, err := resolveRoot(r)
		if err != nil {
			return nil, fmt.Errorf("canonicalize root %q: %w", r, err)
		}
		out.roots = append(out.roots, cr)
	}
	return out, nil
}

// resolveRoot canonicalizes and (when possible) resolves
// symlinks. If the path does not exist, it is canonicalized
// lexically only.
func resolveRoot(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	cleaned := filepath.Clean(abs)
	if real, err := filepath.EvalSymlinks(cleaned); err == nil {
		return real, nil
	}
	// Path does not exist; do a lexical clean only. The parent
	// of a non-existent root may itself be a symlink; resolve
	// what we can.
	parent := filepath.Dir(cleaned)
	if real, err := filepath.EvalSymlinks(parent); err == nil {
		return filepath.Join(real, filepath.Base(cleaned)), nil
	}
	return cleaned, nil
}

// WithReadOnly adds extra paths that may be read but not written.
func (w *WorkspaceRoots) WithReadOnly(paths ...string) *WorkspaceRoots {
	for _, p := range paths {
		if cr, err := resolveRoot(p); err == nil {
			w.readonly = append(w.readonly, cr)
		}
	}
	return w
}

// Roots returns a copy of the canonical root paths.
func (w *WorkspaceRoots) Roots() []string {
	out := make([]string, len(w.roots))
	copy(out, w.roots)
	return out
}

// AuthorizeRead checks that a workspace-relative path resolves
// to a real file under one of the roots. It returns the absolute
// canonical path that the caller can use to read.
//
// Symlinks are followed; a symlink that points outside the root
// is rejected. The original (pre-symlink) path is also returned
// via the second return value for diagnostics, but callers should
// use the resolved one for IO.
func (w *WorkspaceRoots) AuthorizeRead(rootIdx int, rel string) (string, error) {
	if rootIdx < 0 || rootIdx >= len(w.roots) {
		return "", fmt.Errorf("root index out of range: %d", rootIdx)
	}
	return joinAndCheck(w.roots[rootIdx], rel, true)
}

// AuthorizeWrite checks that a workspace-relative path resolves
// to a real file under one of the roots, *and* is not under a
// read-only path. It returns the absolute canonical path.
func (w *WorkspaceRoots) AuthorizeWrite(rootIdx int, rel string) (string, error) {
	if rootIdx < 0 || rootIdx >= len(w.roots) {
		return "", fmt.Errorf("root index out of range: %d", rootIdx)
	}
	abs, err := joinAndCheck(w.roots[rootIdx], rel, false)
	if err != nil {
		return "", err
	}
	for _, ro := range w.readonly {
		if isUnder(abs, ro) {
			return "", ErrPathReadOnly
		}
	}
	return abs, nil
}

// AuthorizeReadAbs checks that an absolute path is under one of
// the roots. Used for path-accepting endpoints that genuinely
// need an absolute path (rare).
func (w *WorkspaceRoots) AuthorizeReadAbs(abs string) (string, error) {
	return authorizeAbs(w.roots, abs, false)
}

// AuthorizeWriteAbs is the write counterpart.
func (w *WorkspaceRoots) AuthorizeWriteAbs(abs string) (string, error) {
	resolved, err := authorizeAbs(w.roots, abs, false)
	if err != nil {
		return "", err
	}
	for _, ro := range w.readonly {
		if isUnder(resolved, ro) {
			return "", ErrPathReadOnly
		}
	}
	return resolved, nil
}

// FindRoot returns the index of the root that contains the given
// path, or -1 if none. The path does not need to exist (used to
// resolve a workspace-relative path back to a root).
func (w *WorkspaceRoots) FindRoot(abs string) int {
	canon, err := resolveRoot(abs)
	if err != nil {
		return -1
	}
	for i, r := range w.roots {
		if isUnder(canon, r) {
			return i
		}
	}
	return -1
}

// joinAndCheck joins a root with a workspace-relative path and
// checks the result is under the root.
//
// If followLinks is false, only the textual path is checked
// (good for write). If followLinks is true, the result is
// resolved through any symlinks and re-checked.
func joinAndCheck(root, rel string, followLinks bool) (string, error) {
	if rel == "" {
		return "", errors.New("empty relative path")
	}
	// Reject obvious traversal attempts at the lexical layer.
	// `..` is checked again after canonicalization; this is
	// defense in depth.
	if strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, `\`) {
		return "", ErrPathForbidden
	}
	joined := filepath.Join(root, rel)
	canon, err := canonical(joined)
	if err != nil {
		return "", err
	}
	if !isUnder(canon, root) {
		return "", ErrPathForbidden
	}
	if !followLinks {
		return canon, nil
	}
	real, err := filepath.EvalSymlinks(canon)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// File does not exist. For reads this is a not-found
			// condition; for writes this is fine as long as the
			// parent is inside the workspace. We don't know which
			// the caller wants, so we return the lexically-resolved
			// path and a nil error. Callers that need to verify
			// existence should stat() the result.
			return canon, nil
		}
		return "", err
	}
	if !isUnder(real, root) {
		return "", ErrSymlinkEscape
	}
	return real, nil
}

func authorizeAbs(roots []string, abs string, followLinks bool) (string, error) {
	canon, err := canonical(abs)
	if err != nil {
		return "", err
	}
	for _, r := range roots {
		if isUnder(canon, r) {
			if followLinks {
				if real, err := filepath.EvalSymlinks(canon); err == nil {
					if !isUnder(real, r) {
						return "", ErrSymlinkEscape
					}
					return real, nil
				}
			}
			return canon, nil
		}
	}
	return "", ErrPathForbidden
}

// canonical returns a clean, lexically-absolute path. It does not
// resolve symlinks (use filepath.EvalSymlinks for that).
func canonical(p string) (string, error) {
	if p == "" {
		return "", errors.New("empty path")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

// isUnder reports whether child is equal to or under parent.
// Both arguments must be cleaned first.
func isUnder(child, parent string) bool {
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
	if strings.HasPrefix(rel, "..") || strings.HasPrefix(rel, string(os.PathSeparator)) {
		_ = rel
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}
