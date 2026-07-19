// Package security implements the path sandbox and request
// authentication primitives. See docs/security.md and
// docs/adr/0008-security-remote-workspace.md.
package security

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var (
	volumePatternLex = regexp.MustCompile(`^[A-Za-z]:[\\/]`)
	uncPatternLex    = regexp.MustCompile(`^[/\\]{2}`)
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
//
// All fields are guarded by mu because AddRoot can be called at
// runtime (when a user opens a new workspace) while Authorize*
// are concurrently invoked by HTTP handlers.
type WorkspaceRoots struct {
	mu    sync.RWMutex
	roots []string
	// readonly are paths that may be read but not written.
	// These are always relative to the DataDir (e.g. bundled/, audit/).
	readonly []string
}

// NewWorkspaceRoots builds a roots set. Input paths are
// canonicalized and symlinks are resolved using nearest-existing-
// ancestor algorithm. A non-existent root is allowed (the agent
// may not have created it yet).
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

// resolveRoot canonicalizes and resolves symlinks using the
// nearest-existing-ancestor algorithm. Starting from the path,
// walk up until we find an ancestor that exists; EvalSymlinks
// that ancestor; then re-append the non-existent segments.
func resolveRoot(p string) (string, error) {
	return evalSymlinksNearest(p)
}

// evalSymlinksNearest resolves symlinks using the nearest-existing-
// ancestor algorithm:
// 1. Try EvalSymlinks on the full path
// 2. If not found, walk up directories until we find one that exists
// 3. EvalSymlinks that ancestor
// 4. Re-append the non-existent suffix segments
func evalSymlinksNearest(target string) (string, error) {
	abs, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	cleaned := filepath.Clean(abs)

	if real, err := filepath.EvalSymlinks(cleaned); err == nil {
		return filepath.Clean(real), nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	current := cleaned
	var parts []string
	for {
		parent := filepath.Dir(current)
		base := filepath.Base(current)
		if parent == current {
			return cleaned, nil
		}
		parts = append([]string{base}, parts...)
		if real, err := filepath.EvalSymlinks(parent); err == nil {
			realClean := filepath.Clean(real)
			joined := filepath.Join(append([]string{realClean}, parts...)...)
			return filepath.Clean(joined), nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		current = parent
	}
}

// WithReadOnly adds extra paths that may be read but not written.
func (w *WorkspaceRoots) WithReadOnly(paths ...string) *WorkspaceRoots {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, p := range paths {
		if cr, err := resolveRoot(p); err == nil {
			w.readonly = append(w.readonly, cr)
		}
	}
	return w
}

// AddRoot registers an additional workspace root at runtime. Used
// when a user opens a new workspace folder — that folder must
// become authorized before any file operations inside it can
// succeed. Safe to call concurrently with Authorize*.
func (w *WorkspaceRoots) AddRoot(p string) error {
	cr, err := resolveRoot(p)
	if err != nil {
		return fmt.Errorf("canonicalize root %q: %w", p, err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, existing := range w.roots {
		if existing == cr {
			return nil
		}
	}
	w.roots = append(w.roots, cr)
	return nil
}

// Roots returns a copy of the canonical root paths.
func (w *WorkspaceRoots) Roots() []string {
	w.mu.RLock()
	defer w.mu.RUnlock()
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
	w.mu.RLock()
	if rootIdx < 0 || rootIdx >= len(w.roots) {
		w.mu.RUnlock()
		return "", fmt.Errorf("root index out of range: %d", rootIdx)
	}
	root := w.roots[rootIdx]
	w.mu.RUnlock()
	return joinAndCheck(root, rel, true)
}

// AuthorizeWrite checks that a workspace-relative path resolves
// to a real file under one of the roots, *and* is not under a
// read-only path. It returns the absolute canonical path.
func (w *WorkspaceRoots) AuthorizeWrite(rootIdx int, rel string) (string, error) {
	w.mu.RLock()
	if rootIdx < 0 || rootIdx >= len(w.roots) {
		w.mu.RUnlock()
		return "", fmt.Errorf("root index out of range: %d", rootIdx)
	}
	root := w.roots[rootIdx]
	readonly := append([]string(nil), w.readonly...)
	w.mu.RUnlock()
	abs, err := joinAndCheck(root, rel, false)
	if err != nil {
		return "", err
	}
	for _, ro := range readonly {
		if isUnder(abs, ro) {
			return "", ErrPathReadOnly
		}
	}
	return abs, nil
}

// AuthorizeReadAbs checks that an absolute path is under one of
// the roots. Used for path-accepting endpoints that genuinely
// need an absolute path (rare). Symlinks are followed so that a
// symlink inside the workspace that points outside is rejected.
func (w *WorkspaceRoots) AuthorizeReadAbs(abs string) (string, error) {
	w.mu.RLock()
	roots := append([]string(nil), w.roots...)
	w.mu.RUnlock()
	return authorizeAbs(roots, abs, true)
}

// AuthorizeWriteAbs is the write counterpart.
func (w *WorkspaceRoots) AuthorizeWriteAbs(abs string) (string, error) {
	w.mu.RLock()
	roots := append([]string(nil), w.roots...)
	readonly := append([]string(nil), w.readonly...)
	w.mu.RUnlock()
	resolved, err := authorizeAbs(roots, abs, true)
	if err != nil {
		return "", err
	}
	for _, ro := range readonly {
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
	w.mu.RLock()
	defer w.mu.RUnlock()
	for i, r := range w.roots {
		if isUnder(canon, r) {
			return i
		}
	}
	return -1
}

// joinAndCheck joins a root with a workspace-relative path and
// checks the result is under the root. Uses platform-neutral
// lexical validation (rejects backslashes, volume prefixes, UNC).
//
// If followLinks is false, only the textual path is checked
// (good for write). If followLinks is true, the result is
// resolved through any symlinks using nearest-existing-ancestor
// and re-checked.
func joinAndCheck(root, rel string, followLinks bool) (string, error) {
	if rel == "" {
		return "", errors.New("empty relative path")
	}

	if strings.ContainsRune(rel, 0) {
		return "", ErrPathForbidden
	}
	if strings.Contains(rel, "\\") {
		return "", ErrPathForbidden
	}
	if volumePatternLex.MatchString(rel) || uncPatternLex.MatchString(rel) {
		return "", ErrPathForbidden
	}
	if strings.HasPrefix(rel, "/") {
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
	real, err := evalSymlinksNearest(canon)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
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
	canon, err := resolveRoot(abs)
	if err != nil {
		return "", err
	}
	for _, r := range roots {
		if isUnder(canon, r) {
			return canon, nil
		}
	}
	return "", ErrPathForbidden
}

// canonical returns a clean, lexically-absolute path. It does not
// resolve symlinks (use evalSymlinksNearest for that).
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
	if rel == ".." {
		return false
	}
	sep := string(os.PathSeparator)
	if strings.HasPrefix(rel, ".."+sep) {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}
