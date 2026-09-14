package pathpolicy

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var (
	ErrEmptyPath      = errors.New("path is empty")
	ErrAbsolutePath   = errors.New("path is absolute")
	ErrPathTraversal  = errors.New("path contains traversal")
	ErrVolumeName     = errors.New("path contains volume name")
	ErrNULCharacter   = errors.New("path contains NUL character")
	ErrBackslash      = errors.New("path contains backslash (use forward slash)")
	ErrOutsideRoot    = errors.New("path resolves outside root")
	ErrSymlinkEscape  = errors.New("symlink resolves outside root")
	ErrNotRegularFile = errors.New("not a regular file")
	ErrSourceNotFound = errors.New("source not found")
)

var (
	volumePatternLex = regexp.MustCompile(`^[A-Za-z]:[\\/]`)
	uncPatternLex    = regexp.MustCompile(`^[/\\]{2}`)
)

type PathAuthorizer interface {
	ValidateRelativeConfigPath(value string, allowEmpty bool) error
	ResolveWithin(root, relative string) (string, error)
	ResolveWithinNoFollow(root, relative string) (string, error)
}

type DefaultPathPolicy struct{}

func NewDefaultPathPolicy() *DefaultPathPolicy {
	return &DefaultPathPolicy{}
}

func (p *DefaultPathPolicy) ValidateRelativeConfigPath(value string, allowEmpty bool) error {
	return validateRelativeConfigPath(value, allowEmpty)
}

func validateRelativeConfigPath(value string, allowEmpty bool) error {
	if value == "" {
		if allowEmpty {
			return nil
		}
		return ErrEmptyPath
	}

	if strings.ContainsRune(value, 0) {
		return ErrNULCharacter
	}

	if strings.Contains(value, "\\") {
		return ErrBackslash
	}

	if hasVolumeNameLexical(value) {
		return ErrVolumeName
	}

	if strings.HasPrefix(value, "/") {
		return ErrAbsolutePath
	}

	segments := strings.Split(value, "/")
	for _, seg := range segments {
		if seg == ".." {
			return ErrPathTraversal
		}
	}

	return nil
}

func hasVolumeNameLexical(p string) bool {
	if volumePatternLex.MatchString(p) {
		return true
	}
	if uncPatternLex.MatchString(p) {
		return true
	}
	return false
}

func (p *DefaultPathPolicy) ResolveWithin(root, relative string) (string, error) {
	return resolveWithinInternal(root, relative, true)
}

func (p *DefaultPathPolicy) ResolveWithinNoFollow(root, relative string) (string, error) {
	return resolveWithinInternal(root, relative, false)
}

func resolveWithinInternal(root, relative string, followSymlinks bool) (string, error) {
	if err := validateRelativeConfigPath(relative, false); err != nil {
		return "", err
	}

	rootCanon, err := canonicalizeAbs(root)
	if err != nil {
		return "", fmt.Errorf("canonicalize root: %w", err)
	}

	if followSymlinks {
		rootReal, err := evalSymlinksNearest(rootCanon)
		if err == nil {
			rootCanon = rootReal
		}
	}

	joined := filepath.Join(rootCanon, filepath.FromSlash(relative))
	canon, err := canonicalizeAbs(joined)
	if err != nil {
		return "", fmt.Errorf("canonicalize joined: %w", err)
	}

	if !isLexicallyUnder(canon, rootCanon) {
		return "", ErrOutsideRoot
	}

	if followSymlinks {
		real, err := evalSymlinksNearest(canon)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				return "", fmt.Errorf("eval symlinks: %w", err)
			}
			real = canon
		}
		if !isLexicallyUnder(real, rootCanon) {
			return "", ErrSymlinkEscape
		}
		return real, nil
	}

	return canon, nil
}

func evalSymlinksNearest(target string) (string, error) {
	if real, err := filepath.EvalSymlinks(target); err == nil {
		realClean := filepath.Clean(real)
		return realClean, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	current := target
	var parts []string
	for {
		parent := filepath.Dir(current)
		base := filepath.Base(current)
		if parent == current {
			abs, err := canonicalizeAbs(current)
			if err != nil {
				return "", err
			}
			return abs, nil
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

func canonicalizeAbs(p string) (string, error) {
	if p == "" {
		return "", ErrEmptyPath
	}
	// filepath.Abs already calls Clean internally, so the
	// additional filepath.Clean is redundant.
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return abs, nil
}

func isLexicallyUnder(child, parent string) bool {
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
	sep := string(os.PathSeparator)
	if rel == ".." || strings.HasPrefix(rel, ".."+sep) {
		return false
	}
	return true
}

// IsLexicallyUnder reports whether child is equal to parent or a sub-path under parent.
func IsLexicallyUnder(child, parent string) bool {
	return isLexicallyUnder(child, parent)
}

// ResolveURIOrPath converts a file URI (file://...) or a raw file path
// into a normalized native filesystem path, handling percent-encoding,
// Windows drive letters, UNC hosts, and rejecting non-file schemes and traversal.
// PR02 (F02 / T05, T07, T08).
func ResolveURIOrPath(input string) (string, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", ErrEmptyPath
	}
	if strings.ContainsRune(input, 0) {
		return "", ErrNULCharacter
	}

	var nativePath string
	if strings.HasPrefix(input, "file://") || strings.HasPrefix(input, "file:") {
		u, err := url.Parse(input)
		if err != nil {
			return "", fmt.Errorf("invalid file URI: %w", err)
		}
		if u.Scheme != "file" {
			return "", fmt.Errorf("unsupported URI scheme: %q", u.Scheme)
		}

		rawPath := u.Path
		pathPart, err := url.PathUnescape(rawPath)
		if err != nil {
			pathPart = rawPath
		}

		// Handle UNC path: file://hostname/share/path
		if u.Host != "" && u.Host != "localhost" {
			nativePath = `\\` + u.Host + filepath.FromSlash(pathPart)
		} else {
			// On Windows: /C:/path -> C:/path
			if runtime.GOOS == "windows" {
				if len(pathPart) >= 3 && pathPart[0] == '/' && isDriveLetter(pathPart[1]) && pathPart[2] == ':' {
					pathPart = pathPart[1:]
				}
			}
			nativePath = filepath.Clean(filepath.FromSlash(pathPart))
		}
	} else if strings.Contains(input, "://") {
		// Check if it's a Windows drive path with double slash, e.g. C://path
		if len(input) >= 3 && isDriveLetter(input[0]) && strings.HasPrefix(input[1:], "://") {
			nativePath = filepath.Clean(string(input[0]) + ":/" + strings.TrimLeft(input[3:], "/"))
		} else {
			// Non-file scheme, e.g. http://, git://
			return "", fmt.Errorf("unsupported URI scheme: %s", input)
		}
	} else {
		// Plain filesystem path
		nativePath = filepath.Clean(input)
	}

	abs, err := filepath.Abs(nativePath)
	if err != nil {
		return "", fmt.Errorf("resolve absolute path: %w", err)
	}
	return filepath.Clean(abs), nil
}

func isDriveLetter(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

func ValidateDeployTarget(target string) error {
	if target == "" {
		return ErrEmptyPath
	}
	if strings.ContainsRune(target, 0) {
		return ErrNULCharacter
	}
	if strings.Contains(target, "\\") {
		return ErrBackslash
	}
	if hasVolumeNameLexical(target) {
		return ErrVolumeName
	}
	if strings.HasPrefix(target, "/") {
		return ErrAbsolutePath
	}
	segments := strings.Split(target, "/")
	for i, seg := range segments {
		if seg == ".." {
			return ErrPathTraversal
		}
		if seg == "." && len(segments) > 1 {
			return fmt.Errorf("invalid dot segment in target")
		}
		if i > 0 && seg == "." {
			return fmt.Errorf("invalid dot segment in target")
		}
	}
	return nil
}

func AtomicRename(src, dst string) error {
	return os.Rename(src, dst)
}
