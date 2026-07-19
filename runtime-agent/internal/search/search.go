// Package search is the workspace text search engine.
//
// We do not shell out to ripgrep. The Theia frontend already
// shows a search UI; the agent owns the actual file walk and
// match. We use a small line-based regex/glob matcher to keep
// the dependency surface small and the binary portable.
package search

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kairo-ide/runtime-agent/internal/encoding"
)

// DefaultExcludes are directories we never descend into.
var DefaultExcludes = []string{
	".git", ".svn", ".hg",
	"node_modules", ".pnpm-store",
	"target", "build", "dist", "out",
	"logs",
	"work", "temp", // Tomcat
	".legacyflow", ".kairo", // runtime state
}

// Options configures a search.
type Options struct {
	Query           string
	IsRegex         bool
	CaseSensitive   bool
	WholeWord       bool
	Include         []string // glob patterns
	Exclude         []string // glob patterns
	MaxResults      int      // 0 = unlimited
	ContextLines    int      // lines before/after
	PreviewReplace  string   // if set, also return replacement preview
	ProjectEncoding encoding.ID
	EncodingAliases encoding.Aliases
	// Cancel is checked periodically; if it returns Done, walk aborts.
	Cancel context.Context
}

// Match is one match.
type Match struct {
	File          string `json:"file"`
	Line          int    `json:"line"`
	Column        int    `json:"column"`
	MatchText     string `json:"matchText"`
	ContextBefore string `json:"contextBefore"`
	ContextAfter  string `json:"contextAfter"`
	Replacement   string `json:"replacement,omitempty"`
}

// Result is the result of a search.
type Result struct {
	Matches      []Match       `json:"matches"`
	TotalMatches int           `json:"totalMatches"`
	Truncated    bool          `json:"truncated"`
	ElapsedMs    int64         `json:"elapsedMs"`
	ErroredFiles []ErroredFile `json:"erroredFiles"`
	allDecoders  map[string]func() ([]byte, error)
}

// ErroredFile records a file we could not read.
type ErroredFile struct {
	File   string `json:"file"`
	Reason string `json:"reason"`
}

// Search walks root and returns matches.
func Search(root string, opts Options) (*Result, error) {
	if root == "" {
		return nil, errors.New("root is empty")
	}
	if opts.Query == "" {
		return &Result{}, nil
	}
	if opts.MaxResults == 0 {
		opts.MaxResults = 100_000
	}
	if opts.Cancel == nil {
		opts.Cancel = context.Background()
	}
	if opts.ProjectEncoding == "" {
		opts.ProjectEncoding = encoding.UTF8
	}

	start := time.Now()
	res := &Result{allDecoders: map[string]func() ([]byte, error){}}
	matcher, err := buildMatcher(opts)
	if err != nil {
		return nil, err
	}

	inc := compileGlobs(opts.Include)
	exc := compileGlobs(opts.Exclude)

	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			res.recordError(path, walkErr)
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			if isExcludedDir(rel) {
				return filepath.SkipDir
			}
			if exc != nil && exc.matchAny(rel) {
				return filepath.SkipDir
			}
			return nil
		}
		if inc != nil && !inc.matchAny(rel) {
			return nil
		}
		if exc != nil && exc.matchAny(rel) {
			return nil
		}
		if isLikelyBinary(path) {
			return nil
		}
		if res.TotalMatches >= opts.MaxResults {
			res.Truncated = true
			return filepath.SkipAll
		}
		searchFile(path, rel, root, matcher, opts, res)
		return nil
	})
	_ = err
	res.ElapsedMs = time.Since(start).Milliseconds()
	return res, nil
}

func (r *Result) recordError(path string, err error) {
	r.ErroredFiles = append(r.ErroredFiles, ErroredFile{File: path, Reason: err.Error()})
}

func isExcludedDir(rel string) bool {
	base := filepath.Base(rel)
	for _, e := range DefaultExcludes {
		if base == e {
			return true
		}
	}
	return false
}

// isLikelyBinary returns true if the file has a known binary
// extension. We deliberately err on the side of including files
// when in doubt.
func isLikelyBinary(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".class", ".jar", ".war", ".ear", ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
		".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
		".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
		".so", ".dll", ".dylib", ".exe", ".bin",
		".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".ogg":
		return true
	}
	return false
}

type compiledMatcher struct {
	pattern  string
	re       *regexp.Regexp
	whole    bool
	caseSens bool
	preview  string
}

func buildMatcher(opts Options) (*compiledMatcher, error) {
	pat := opts.Query
	flags := ""
	if !opts.CaseSensitive {
		flags = "(?i)"
	}
	if !opts.IsRegex {
		pat = regexp.QuoteMeta(pat)
	}
	if opts.WholeWord {
		pat = `\b` + pat + `\b`
	}
	re, err := regexp.Compile(flags + pat)
	if err != nil {
		return nil, fmt.Errorf("compile pattern: %w", err)
	}
	return &compiledMatcher{
		pattern:  opts.Query,
		re:       re,
		whole:    opts.WholeWord,
		caseSens: opts.CaseSensitive,
		preview:  opts.PreviewReplace,
	}, nil
}

func searchFile(absPath, rel, root string, m *compiledMatcher, opts Options, res *Result) {
	f, err := os.Open(absPath)
	if err != nil {
		res.recordError(rel, err)
		return
	}
	defer f.Close()
	// Sniff a small sample to detect encoding.
	head := make([]byte, 4096)
	n, _ := f.Read(head)
	detID, _, hasBom, _ := encoding.Detect(head[:n], opts.ProjectEncoding, opts.EncodingAliases)
	if hasBom {
		// Already accounted for in detector; we will Decode later
		// which will strip the BOM.
		_ = detID
	}

	// Re-open and stream line-by-line. The file may be large; we
	// use bufio.Scanner with a large buffer.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		res.recordError(rel, err)
		return
	}
	scanner := bufio.NewScanner(f)
	const maxLine = 4 * 1024 * 1024
	scanner.Buffer(make([]byte, 64*1024), maxLine)

	// We need to convert each line from its detected encoding to
	// UTF-8 for matching. A pre-bound transform saves allocation.
	_ = encoding.Encoder(detID, opts.EncodingAliases)
	// We don't actually need a per-line transform: for UTF-8 we
	// stream; for non-UTF-8 we decode the whole file below.

	// For GBK / GB18030 / ISO-8859-1 etc, we read bytes and
	// decode the entire file in memory. For UTF-8 we can stream.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		res.recordError(rel, err)
		return
	}
	if detID == encoding.UTF8 || detID == encoding.UTF8BOM {
		scanUTF8(scanner, rel, m, opts, res)
	} else {
		data, err := os.ReadFile(absPath)
		if err != nil {
			res.recordError(rel, err)
			return
		}
		decoded, err := encoding.Decode(data, detID, opts.EncodingAliases)
		if err != nil {
			res.recordError(rel, err)
			return
		}
		scanBytes(decoded, rel, m, opts, res)
	}
}

func scanUTF8(scanner *bufio.Scanner, rel string, m *compiledMatcher, opts Options, res *Result) {
	line := 0
	for scanner.Scan() {
		line++
		s := scanner.Text()
		matches := m.re.FindAllStringIndex(s, -1)
		for _, idx := range matches {
			if res.TotalMatches >= opts.MaxResults {
				res.Truncated = true
				return
			}
			res.Matches = append(res.Matches, buildMatch(rel, line, idx[0], idx[1], s, m, opts))
			res.TotalMatches++
		}
	}
	// bufio.Scanner stops early on lines longer than the buffer
	// or on I/O errors; surface that instead of silently returning
	// partial matches.
	if err := scanner.Err(); err != nil {
		res.recordError(rel, err)
	}
}

func scanBytes(data []byte, rel string, m *compiledMatcher, opts Options, res *Result) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	const maxLine = 4 * 1024 * 1024
	scanner.Buffer(make([]byte, 64*1024), maxLine)
	line := 0
	for scanner.Scan() {
		line++
		s := scanner.Text()
		matches := m.re.FindAllStringIndex(s, -1)
		for _, idx := range matches {
			if res.TotalMatches >= opts.MaxResults {
				res.Truncated = true
				return
			}
			res.Matches = append(res.Matches, buildMatch(rel, line, idx[0], idx[1], s, m, opts))
			res.TotalMatches++
		}
	}
	if err := scanner.Err(); err != nil {
		res.recordError(rel, err)
	}
}

func buildMatch(rel string, line, start, end int, s string, m *compiledMatcher, opts Options) Match {
	// IDEs expect a rune-based column, but FindAllStringIndex
	// returns byte offsets. Convert bytes-to-runes for the prefix
	// so non-ASCII text gets the right column.
	col := utf8.RuneCountInString(s[:start]) + 1
	before := ""
	after := ""
	if opts.ContextLines > 0 {
		// The caller is responsible for filling context. We
		// pass empty here and let the API layer add it.
		_ = before
		_ = after
	}
	match := Match{
		File:          rel,
		Line:          line,
		Column:        col,
		MatchText:     s[start:end],
		ContextBefore: before,
		ContextAfter:  after,
	}
	if m.preview != "" {
		match.Replacement = m.re.ReplaceAllString(s[start:end], m.preview)
	}
	return match
}

// globSet is a small wrapper around a list of compiled globs.
type globSet struct{ globs []*regexp.Regexp }

func compileGlobs(patterns []string) *globSet {
	if len(patterns) == 0 {
		return nil
	}
	out := &globSet{}
	for _, p := range patterns {
		re := globToRegexp(p)
		if re != nil {
			out.globs = append(out.globs, re)
		}
	}
	return out
}

func (g *globSet) matchAny(s string) bool {
	if g == nil {
		return false
	}
	for _, re := range g.globs {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}

// globToRegexp compiles a glob pattern into a regular expression.
// Only `*`, `**`, `?` and `.` carry glob semantics; every other
// regex metacharacter (+, (, ), [, ], {, }, |, ^, $, \) is escaped
// via regexp.QuoteMeta so it matches literally. Without escaping,
// `file(1).txt` would compile as a regex group and silently match
// (or fail to compile, dropping the glob entirely).
func globToRegexp(p string) *regexp.Regexp {
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(p); i++ {
		switch p[i] {
		case '*':
			if i+1 < len(p) && p[i+1] == '*' {
				b.WriteString(".*")
				i++
			} else {
				b.WriteString("[^/]*")
			}
		case '?':
			b.WriteString("[^/]")
		default:
			// QuoteMeta is a no-op for non-metacharacters, so we
			// can run it byte-by-byte; for multibyte UTF-8 bytes
			// the result is still valid because QuoteMeta preserves
			// them as-is.
			b.WriteString(regexp.QuoteMeta(string(p[i])))
		}
	}
	b.WriteString("$")
	re, err := regexp.Compile(b.String())
	if err != nil {
		return nil
	}
	return re
}
