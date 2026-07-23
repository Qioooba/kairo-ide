// Package search is the workspace text search engine.
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

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
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

	err = walkAndCollect(root, matcher, inc, exc, opts, res)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, fmt.Errorf("walk search root: %w", err)
	}
	if res.TotalMatches >= opts.MaxResults {
		res.Truncated = true
	}
	res.ElapsedMs = time.Since(start).Milliseconds()
	return res, nil
}

// SearchStreaming walks root and calls callback for each batch of matches.
// Each batch contains up to batchSize results. callback receives the batch,
// the batch index (0-based), and the cumulative total matches so far.
// Returns an error if the callback fails or the context is cancelled.
func SearchStreaming(ctx context.Context, root string, opts Options, callback func(batch []Match, batchIndex int, total int) error) error {
	const batchSize = 50
	if root == "" {
		return errors.New("root is empty")
	}
	if opts.Query == "" {
		return nil
	}
	if opts.MaxResults == 0 {
		opts.MaxResults = 100_000
	}
	if opts.Cancel == nil {
		opts.Cancel = ctx
	}
	if opts.ProjectEncoding == "" {
		opts.ProjectEncoding = encoding.UTF8
	}

	matcher, err := buildMatcher(opts)
	if err != nil {
		return err
	}

	inc := compileGlobs(opts.Include)
	exc := compileGlobs(opts.Exclude)

	matchCh := make(chan Match, 100)
	walkErrCh := make(chan error, 1)

	go func() {
		defer close(matchCh)
		walkErrCh <- walkAndCollect(root, matcher, inc, exc, opts, &streamCollector{ch: matchCh, ctx: opts.Cancel})
	}()

	batch := make([]Match, 0, batchSize)
	batchIndex := 0
	total := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case match, ok := <-matchCh:
			if !ok {
				if len(batch) > 0 {
					if err := callback(batch, batchIndex, total); err != nil {
						return err
					}
				}
				select {
				case walkErr := <-walkErrCh:
					if walkErr != nil && !errors.Is(walkErr, context.Canceled) && !errors.Is(walkErr, context.DeadlineExceeded) {
						return walkErr
					}
					return nil
				default:
					return nil
				}
			}
			batch = append(batch, match)
			total++
			if len(batch) >= batchSize {
				if err := callback(batch, batchIndex, total); err != nil {
					return err
				}
				batch = make([]Match, 0, batchSize)
				batchIndex++
			}
		}
	}
}

// streamCollector implements a match collector that sends to a channel.
type streamCollector struct {
	ch  chan<- Match
	ctx context.Context
}

func (sc *streamCollector) addMatch(m Match) {
	select {
	case sc.ch <- m:
	case <-sc.ctx.Done():
	}
}

// matchSink is the interface that both Result and streamCollector implement.
type matchSink interface {
	addMatch(m Match)
}

// walkAndCollect walks the filesystem and collects matches into the sink.
func walkAndCollect(root string, matcher *compiledMatcher, inc, exc *globSet, opts Options, sink matchSink) error {
	matchedCount := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			if path == root {
				return walkErr
			}
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
		if matchedCount >= opts.MaxResults {
			return filepath.SkipAll
		}
		if err := searchFileToSink(path, rel, root, matcher, opts, sink, &matchedCount); err != nil {
			return err
		}
		return nil
	})
	return err
}

func (r *Result) addMatch(m Match) {
	r.Matches = append(r.Matches, m)
	r.TotalMatches++
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

// searchFileToSink reads a file, detects encoding, and sends matches to the sink.
func searchFileToSink(absPath, rel, root string, m *compiledMatcher, opts Options, sink matchSink, matchedCount *int) error {
	if err := opts.Cancel.Err(); err != nil {
		return err
	}
	f, err := os.Open(absPath)
	if err != nil {
		return nil
	}
	defer f.Close()
	// Sniff a small sample to detect encoding.
	head := make([]byte, 4096)
	n, _ := f.Read(head)
	detID, _, _, _ := encoding.Detect(head[:n], opts.ProjectEncoding, opts.EncodingAliases)

	// Re-open and stream line-by-line.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil
	}
	scanner := bufio.NewScanner(f)
	const maxLine = 4 * 1024 * 1024
	scanner.Buffer(make([]byte, 64*1024), maxLine)

	_ = encoding.Encoder(detID, opts.EncodingAliases)

	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil
	}
	if detID == encoding.UTF8 || detID == encoding.UTF8BOM {
		return scanUTF8ToSink(scanner, rel, m, opts, sink, matchedCount)
	}
	if err := opts.Cancel.Err(); err != nil {
		return err
	}
	data, err := readAllContext(opts.Cancel, f)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return nil
	}
	if err := opts.Cancel.Err(); err != nil {
		return err
	}
	decoded, err := encoding.Decode(data, detID, opts.EncodingAliases)
	if err != nil {
		return nil
	}
	if err := opts.Cancel.Err(); err != nil {
		return err
	}
	return scanBytesToSink(decoded, rel, m, opts, sink, matchedCount)
}

// readAllContext bounds cancellation latency for large/non-UTF files to one
// filesystem read chunk. It intentionally avoids a helper goroutine, which
// could leak forever when a network filesystem blocks in Read.
func readAllContext(ctx context.Context, reader io.Reader) ([]byte, error) {
	const chunkSize = 64 * 1024
	var out bytes.Buffer
	chunk := make([]byte, chunkSize)
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		n, err := reader.Read(chunk)
		if n > 0 {
			_, _ = out.Write(chunk[:n])
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return out.Bytes(), nil
			}
			return nil, err
		}
		if n == 0 {
			return nil, io.ErrNoProgress
		}
	}
}

func scanUTF8ToSink(scanner *bufio.Scanner, rel string, m *compiledMatcher, opts Options, sink matchSink, matchedCount *int) error {
	line := 0
	for {
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		if !scanner.Scan() {
			break
		}
		line++
		s := scanner.Text()
		matches := m.re.FindAllStringIndex(s, -1)
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		for _, idx := range matches {
			sink.addMatch(buildMatch(rel, line, idx[0], idx[1], s, m, opts))
			*matchedCount++
		}
	}
	return nil
}

func scanBytesToSink(data []byte, rel string, m *compiledMatcher, opts Options, sink matchSink, matchedCount *int) error {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	const maxLine = 4 * 1024 * 1024
	scanner.Buffer(make([]byte, 64*1024), maxLine)
	line := 0
	for {
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		if !scanner.Scan() {
			break
		}
		line++
		s := scanner.Text()
		matches := m.re.FindAllStringIndex(s, -1)
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		for _, idx := range matches {
			sink.addMatch(buildMatch(rel, line, idx[0], idx[1], s, m, opts))
			*matchedCount++
		}
	}
	return nil
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
