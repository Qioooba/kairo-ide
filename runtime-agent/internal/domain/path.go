package domain

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// WorkspacePath is a path relative to the workspace root that has been
// validated against path traversal and injection attacks.
type WorkspacePath string

// CanonicalPath is an absolute, resolved path that has been validated
// to be under an authorized workspace root.
type CanonicalPath string

// String returns the string representation.
func (p WorkspacePath) String() string { return string(p) }

// String returns the string representation.
func (p CanonicalPath) String() string { return string(p) }

// ErrPathEscape is returned when a path attempts to escape the workspace root.
var ErrPathEscape = errors.New("path escapes workspace root")

// ValidateWorkspacePath checks that a relative path does not contain
// path traversal (..), absolute path prefixes, or null bytes.
func ValidateWorkspacePath(rel string) (WorkspacePath, error) {
	if rel == "" {
		return "", errors.New("empty path")
	}
	if strings.ContainsRune(rel, 0) {
		return "", ErrPathEscape
	}
	if strings.Contains(rel, "\\") {
		return "", ErrPathEscape
	}
	if strings.HasPrefix(rel, "/") {
		return "", ErrPathEscape
	}
	cleaned := filepath.Clean(rel)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(os.PathSeparator)) {
		return "", ErrPathEscape
	}
	return WorkspacePath(cleaned), nil
}

// ResolveCanonicalPath resolves a workspace path against a root and
// validates that the result is under the root.
func ResolveCanonicalPath(root string, rel WorkspacePath) (CanonicalPath, error) {
	abs, err := filepath.Abs(filepath.Join(root, rel.String()))
	if err != nil {
		return "", err
	}
	cleaned := filepath.Clean(abs)
	rootCleaned := filepath.Clean(root)

	if !isUnder(cleaned, rootCleaned) {
		return "", ErrPathEscape
	}
	return CanonicalPath(cleaned), nil
}

// isUnder reports whether child is equal to or under parent.
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
