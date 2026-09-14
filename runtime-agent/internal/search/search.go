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
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
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

// excludedDirSet is a map-based lookup for O(1) excluded dir checks.
var excludedDirSet = func() map[string]bool {
	m := make(map[string]bool, len(DefaultExcludes))
	for _, d := range DefaultExcludes {
		m[d] = true
	}
	return m
}()

// scannerBufPool reuses 64KB buffers for bufio.Scanner.
var scannerBufPool = sync.Pool{
	New: func() any {
		buf := make([]byte, 64*1024)
		return &buf
	},
}

// chunkBufPool reuses 64KB chunk buffers for readAllContext.
var chunkBufPool = sync.Pool{
	New: func() any {
		buf := make([]byte, 64*1024)
		return &buf
	},
}

// headBufPool reuses 4KB buffers for encoding detection in searchFileToSink.
var headBufPool = sync.Pool{
	New: func() any {
		buf := make([]byte, 4096)
		return &buf
	},
}

// errFileTooLarge is reported when a file exceeds MaxFileBytes.
var errFileTooLarge = errors.New("file exceeds size limit; skipped")

// defaultMaxFileBytes caps per-file memory during search (10 MB). Files
// larger than this are skipped and reported instead of being fully
// buffered and decoded.
const defaultMaxFileBytes = 10 << 20

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
	// Workers overrides the parallel reader count. 0 = auto (NumCPU, clamped).
	Workers int
	// MaxFileBytes skips files larger than this many bytes (reported via
	// ErroredFiles). 0 = default (10 MB); negative = unlimited.
	MaxFileBytes int
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
	Matches       []Match       `json:"matches"`
	TotalMatches  int           `json:"totalMatches"`
	FilesSearched int           `json:"filesSearched,omitempty"`
	Truncated     bool          `json:"truncated"`
	ElapsedMs     int64         `json:"elapsedMs"`
	ErroredFiles  []ErroredFile `json:"erroredFiles"`
	allDecoders   map[string]func() ([]byte, error)
	mu            sync.Mutex
}

// ErroredFile records a file we could not read.
type ErroredFile struct {
	File   string `json:"file"`
	Reason string `json:"reason"`
}

// FileEntry is a workspace-relative file path for filename search.
type FileEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// ListOptions configures a filename listing walk.
type ListOptions struct {
	Include  []string
	Exclude  []string
	MaxFiles int
	Cancel   context.Context
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
	if opts.MaxFileBytes == 0 {
		opts.MaxFileBytes = defaultMaxFileBytes
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

// StreamStats captures aggregated execution metadata for a streaming search (F13 / T29).
type StreamStats struct {
	TotalMatches  int   `json:"totalMatches"`
	FilesSearched int   `json:"filesSearched"`
	SkippedFiles  int   `json:"skippedFiles"`
	Truncated     bool  `json:"truncated"`
	Cancelled     bool  `json:"cancelled"`
	DurationMs    int64 `json:"durationMs"`
}

// SearchStreaming walks root and calls callback for each batch of matches.
// Backward-compatible wrapper around SearchStreamingWithStats.
func SearchStreaming(ctx context.Context, root string, opts Options, callback func(batch []Match, batchIndex int, total int) error) error {
	_, err := SearchStreamingWithStats(ctx, root, opts, callback)
	return err
}

// SearchStreamingWithStats walks root and streams batches of matches to callback,
// returning aggregated metadata (files searched, skipped, truncated, cancelled, duration).
// It owns the execution context, guarantees all worker goroutines are terminated (joined)
// before returning, and propagates cancellation bidirectionally (F13 / T28 ~ T30).
func SearchStreamingWithStats(ctx context.Context, root string, opts Options, callback func(batch []Match, batchIndex int, total int) error) (StreamStats, error) {
	start := time.Now()
	var stats StreamStats

	const batchSize = 50
	if root == "" {
		return stats, errors.New("root is empty")
	}
	if opts.Query == "" {
		return stats, nil
	}
	if opts.MaxResults == 0 {
		opts.MaxResults = 100_000
	}
	if opts.MaxFileBytes == 0 {
		opts.MaxFileBytes = defaultMaxFileBytes
	}
	if opts.ProjectEncoding == "" {
		opts.ProjectEncoding = encoding.UTF8
	}

	// 1. Converge all cancellation sources into a single owned context (F13 / T28)
	baseCtx := ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	searchCtx, searchCancel := context.WithCancel(baseCtx)
	defer searchCancel()

	// If a separate opts.Cancel was provided, link it
	if opts.Cancel != nil && opts.Cancel != ctx {
		cancelWatcherDone := make(chan struct{})
		defer close(cancelWatcherDone)
		go func() {
			select {
			case <-opts.Cancel.Done():
				searchCancel()
			case <-searchCtx.Done():
			case <-cancelWatcherDone:
			}
		}()
	}

	searchOpts := opts
	searchOpts.Cancel = searchCtx

	matcher, err := buildMatcher(searchOpts)
	if err != nil {
		return stats, err
	}

	inc := compileGlobs(searchOpts.Include)
	exc := compileGlobs(searchOpts.Exclude)

	matchCh := make(chan Match, 256)
	walkErrCh := make(chan error, 1)

	collector := &streamCollector{
		ch:  matchCh,
		ctx: searchCtx,
	}

	// 2. Launch producer in a goroutine tracked by sync.WaitGroup for deterministic join
	var producerWg sync.WaitGroup
	producerWg.Add(1)
	go func() {
		defer producerWg.Done()
		defer close(matchCh)
		walkErrCh <- walkAndCollect(root, matcher, inc, exc, searchOpts, collector)
	}()

	batch := make([]Match, 0, batchSize)
	batchIndex := 0
	total := 0
	var consumerErr error

	// 3. Consumer loop
consumeLoop:
	for {
		select {
		case <-searchCtx.Done():
			consumerErr = searchCtx.Err()
			break consumeLoop
		case match, ok := <-matchCh:
			if !ok {
				break consumeLoop
			}
			batch = append(batch, match)
			total++
			if len(batch) >= batchSize {
				if err := callback(batch, batchIndex, total); err != nil {
					consumerErr = err
					searchCancel() // CANCEL PRODUCER IMMEDIATELY! (F13 / T28)
					break consumeLoop
				}
				batch = make([]Match, 0, batchSize)
				batchIndex++
			}
		}
	}

	// 4. Teardown: cancel producer if consumer aborted or errored, and drain channel to prevent producer deadlock
	searchCancel()

	// Drain any in-flight matches so producer workers never block on send
	go func() {
		for range matchCh {
		}
	}()

	// 5. Join all producer goroutines before returning (F13 / T28)
	producerWg.Wait()

	// 6. Final batch delivery (only if no consumer error occurred and context was not cancelled)
	if consumerErr == nil && len(batch) > 0 {
		if err := callback(batch, batchIndex, total); err != nil {
			consumerErr = err
		}
	}

	// 7. Collect producer error
	var walkErr error
	select {
	case walkErr = <-walkErrCh:
	default:
	}

	// 8. Populate stats metadata (F13 / T29)
	stats.TotalMatches = total
	stats.FilesSearched = int(collector.filesCount.Load())
	stats.SkippedFiles = int(collector.skippedCount.Load())
	stats.DurationMs = time.Since(start).Milliseconds()

	if total >= searchOpts.MaxResults {
		stats.Truncated = true
	}
	if errors.Is(baseCtx.Err(), context.Canceled) || (opts.Cancel != nil && errors.Is(opts.Cancel.Err(), context.Canceled)) || errors.Is(consumerErr, context.Canceled) || (walkErr != nil && errors.Is(walkErr, context.Canceled)) {
		stats.Cancelled = true
	}

	if consumerErr != nil && !errors.Is(consumerErr, context.Canceled) {
		return stats, consumerErr
	}
	if baseCtx.Err() != nil {
		return stats, baseCtx.Err()
	}
	if opts.Cancel != nil && opts.Cancel.Err() != nil {
		return stats, opts.Cancel.Err()
	}
	if walkErr != nil && !errors.Is(walkErr, context.Canceled) && !errors.Is(walkErr, context.DeadlineExceeded) {
		return stats, walkErr
	}
	return stats, nil
}

// ListFiles walks root and returns relative file paths (for Find File / Search Everywhere).
// Uses a single-threaded metadata walk — no file content reads — which is much
// cheaper than content search on 4K-random-read-bound disks.
func ListFiles(root string, opts ListOptions) ([]FileEntry, error) {
	if root == "" {
		return nil, errors.New("root is empty")
	}
	if opts.MaxFiles == 0 {
		opts.MaxFiles = 50_000
	}
	if opts.Cancel == nil {
		opts.Cancel = context.Background()
	}
	inc := compileGlobs(opts.Include)
	exc := compileGlobs(opts.Exclude)
	out := make([]FileEntry, 0, 1024)

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
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		if rel == "." {
			return nil
		}
		relSlash := filepath.ToSlash(rel)
		if d.IsDir() {
			if isExcludedDir(relSlash) {
				return filepath.SkipDir
			}
			if exc != nil && exc.matchAny(relSlash) {
				return filepath.SkipDir
			}
			return nil
		}
		if len(out) >= opts.MaxFiles {
			return filepath.SkipAll
		}
		if inc != nil && !inc.matchAny(relSlash) {
			return nil
		}
		if exc != nil && exc.matchAny(relSlash) {
			return nil
		}
		if isLikelyBinary(path) {
			return nil
		}
		out = append(out, FileEntry{Path: relSlash, Name: filepath.Base(relSlash)})
		return nil
	})
	if err != nil && !errors.Is(err, filepath.SkipAll) {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, fmt.Errorf("list files: %w", err)
	}
	return out, nil
}

// streamCollector implements a match collector that sends to a channel.
type streamCollector struct {
	ch           chan<- Match
	ctx          context.Context
	skippedCount atomic.Int64
	filesCount   atomic.Int64
}

func (sc *streamCollector) addMatch(m Match) {
	select {
	case sc.ch <- m:
	case <-sc.ctx.Done():
	}
}

func (sc *streamCollector) recordError(path string, err error) {
	sc.skippedCount.Add(1)
}

func (sc *streamCollector) recordFileSearched() {
	sc.filesCount.Add(1)
}

// matchSink is the interface that both Result and streamCollector implement.
type matchSink interface {
	addMatch(m Match)
}

type fileJob struct {
	abs string
	rel string
}

// walkAndCollect walks the filesystem and collects matches into the sink.
// Metadata walk is single-threaded; content reads use a worker pool so
// 4K-random-I/O-bound disks can keep multiple opens in flight.
func walkAndCollect(root string, matcher *compiledMatcher, inc, exc *globSet, opts Options, sink matchSink) error {
	workers := opts.Workers
	if workers <= 0 {
		workers = runtime.NumCPU()
		if workers < 4 {
			workers = 4
		}
		if workers > 16 {
			workers = 16
		}
	}

	jobs := make(chan fileJob, workers*8)
	var matchedCount atomic.Int64
	var stop atomic.Bool
	var walkErr atomic.Value // error
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				if stop.Load() {
					continue
				}
				if err := opts.Cancel.Err(); err != nil {
					walkErr.Store(err)
					stop.Store(true)
					continue
				}
				if matchedCount.Load() >= int64(opts.MaxResults) {
					stop.Store(true)
					continue
				}
				local := int(matchedCount.Load())
				_ = searchFileToSink(job.abs, job.rel, root, matcher, opts, sink, &local, &matchedCount, opts.MaxResults, &stop)
			}
		}()
	}

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, wErr error) error {
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		if stop.Load() {
			return filepath.SkipAll
		}
		if wErr != nil {
			if path == root {
				return wErr
			}
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		if rel == "." {
			// Allow searching a single file passed as root.
			if !d.IsDir() {
				relSlash := filepath.Base(path)
				select {
				case jobs <- fileJob{abs: path, rel: relSlash}:
				case <-opts.Cancel.Done():
					return opts.Cancel.Err()
				}
			}
			return nil
		}
		relSlash := filepath.ToSlash(rel)
		if d.IsDir() {
			if isExcludedDir(relSlash) {
				return filepath.SkipDir
			}
			if exc != nil && exc.matchAny(relSlash) {
				return filepath.SkipDir
			}
			return nil
		}
		if inc != nil && !inc.matchAny(relSlash) {
			return nil
		}
		if exc != nil && exc.matchAny(relSlash) {
			return nil
		}
		if isLikelyBinary(path) {
			return nil
		}
		if matchedCount.Load() >= int64(opts.MaxResults) {
			stop.Store(true)
			return filepath.SkipAll
		}
		select {
		case jobs <- fileJob{abs: path, rel: relSlash}:
			return nil
		case <-opts.Cancel.Done():
			return opts.Cancel.Err()
		}
	})

	close(jobs)
	wg.Wait()

	if err != nil && !errors.Is(err, filepath.SkipAll) {
		return err
	}
	if v := walkErr.Load(); v != nil {
		return v.(error)
	}
	if err := opts.Cancel.Err(); err != nil {
		return err
	}
	return nil
}

func (r *Result) addMatch(m Match) {
	r.mu.Lock()
	r.Matches = append(r.Matches, m)
	r.TotalMatches++
	r.mu.Unlock()
}

func (r *Result) recordError(path string, err error) {
	r.mu.Lock()
	r.ErroredFiles = append(r.ErroredFiles, ErroredFile{File: path, Reason: err.Error()})
	r.mu.Unlock()
}

func (r *Result) recordFileSearched() {
	r.mu.Lock()
	r.FilesSearched++
	r.mu.Unlock()
}

func isExcludedDir(rel string) bool {
	base := filepath.Base(rel)
	return excludedDirSet[base]
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

// errorReporter is optionally implemented by match sinks to record
// per-file problems (oversized files, over-long lines, read errors).
type errorReporter interface {
	recordError(path string, err error)
}

// reportFileError records err against rel when the sink supports it.
func reportFileError(sink matchSink, rel string, err error) {
	if rep, ok := sink.(errorReporter); ok {
		rep.recordError(rel, err)
	}
}

// searchFileToSink reads a file, detects encoding, and sends matches to the sink.
func searchFileToSink(
	absPath, rel, root string,
	m *compiledMatcher,
	opts Options,
	sink matchSink,
	_ *int,
	matchedCount *atomic.Int64,
	maxResults int,
	stop *atomic.Bool,
) error {
	if stop != nil && stop.Load() {
		return nil
	}
	if err := opts.Cancel.Err(); err != nil {
		return err
	}
	f, err := os.Open(absPath)
	if err != nil {
		reportFileError(sink, rel, fmt.Errorf("open file: %w", err))
		return nil
	}
	defer f.Close()

	if reporter, ok := sink.(interface{ recordFileSearched() }); ok {
		reporter.recordFileSearched()
	}

	// Skip oversized files instead of buffering them in memory.
	if opts.MaxFileBytes > 0 {
		if fi, statErr := f.Stat(); statErr == nil && fi.Size() > int64(opts.MaxFileBytes) {
			reportFileError(sink, rel, fmt.Errorf("%s (%d bytes > %d limit)", errFileTooLarge, fi.Size(), opts.MaxFileBytes))
			return nil
		}
	}

	// Sniff a small sample to detect encoding using a pooled buffer.
	headPtr := headBufPool.Get().(*[]byte)
	head := *headPtr
	n, _ := f.Read(head)
	detID, confidence, _, _ := encoding.Detect(head[:n], opts.ProjectEncoding, opts.EncodingAliases)

	// ASCII fast path: when Detect could only fall back to the project
	// default (low confidence) but the sample is pure ASCII, the file is
	// indistinguishable from UTF-8/GBK — prefer the zero-copy streaming
	// path. ASCII is a subset of both encodings, so raw-byte line matching
	// keeps queries correct without a full-file decode buffer.
	if n > 0 && confidence <= 0.55 && isAllASCII(head[:n]) {
		detID = encoding.UTF8
	}
	headBufPool.Put(headPtr)

	// Seek back to start for line-by-line scanning.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil
	}

	if detID == encoding.UTF8 || detID == encoding.UTF8BOM {
		scanner, cleanup := newPooledScanner(f)
		defer cleanup()
		err := scanUTF8ToSink(scanner, rel, m, opts, sink, emitFor(sink, matchedCount, maxResults, stop))
		if serr := scanner.Err(); serr != nil {
			reportFileError(sink, rel, fmt.Errorf("line scan aborted: %w", serr))
		}
		return err
	}
	if err := opts.Cancel.Err(); err != nil {
		return err
	}
	data, err := readAllContext(opts.Cancel, f, int64(opts.MaxFileBytes))
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		if errors.Is(err, errFileTooLarge) {
			reportFileError(sink, rel, err)
			return nil
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
	return scanBytesToSink(decoded, rel, m, opts, sink, emitFor(sink, matchedCount, maxResults, stop))
}

// emitFor builds the bounded emit callback shared by both scan paths.
func emitFor(sink matchSink, matchedCount *atomic.Int64, maxResults int, stop *atomic.Bool) emitFn {
	return func(match Match) bool {
		if matchedCount != nil {
			n := matchedCount.Add(1)
			if n > int64(maxResults) {
				matchedCount.Add(-1)
				if stop != nil {
					stop.Store(true)
				}
				return false
			}
		}
		sink.addMatch(match)
		return true
	}
}

// newPooledScanner wraps r with a bufio.Scanner backed by a pooled buffer.
func newPooledScanner(r io.Reader) (*bufio.Scanner, func()) {
	scanner := bufio.NewScanner(r)
	const maxLine = 4 * 1024 * 1024
	bufPtr := scannerBufPool.Get().(*[]byte)
	scanner.Buffer(*bufPtr, maxLine)
	return scanner, func() {
		scannerBufPool.Put(bufPtr)
	}
}

// readAllContext bounds cancellation latency for large/non-UTF files to one
// filesystem read chunk. It intentionally avoids a helper goroutine, which
// could leak forever when a network filesystem blocks in Read.
// maxBytes bounds the accumulated buffer; exceeding it fails with
// errFileTooLarge instead of growing without limit.
func readAllContext(ctx context.Context, reader io.Reader, maxBytes int64) ([]byte, error) {
	var out bytes.Buffer
	chunkPtr := chunkBufPool.Get().(*[]byte)
	chunk := *chunkPtr
	defer chunkBufPool.Put(chunkPtr)
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		n, err := reader.Read(chunk)
		if n > 0 {
			if maxBytes > 0 && int64(out.Len())+int64(n) > maxBytes {
				return nil, errFileTooLarge
			}
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

// isAllASCII reports whether b contains only ASCII bytes.
func isAllASCII(b []byte) bool {
	for _, c := range b {
		if c > 0x7F {
			return false
		}
	}
	return true
}

type emitFn func(Match) bool

func scanUTF8ToSink(scanner *bufio.Scanner, rel string, m *compiledMatcher, opts Options, sink matchSink, emit emitFn) error {
	return scanWithContext(func() ([]byte, bool) {
		if !scanner.Scan() {
			return nil, false
		}
		// Copy bytes — scanner reuses the buffer on the next Scan.
		b := scanner.Bytes()
		cp := make([]byte, len(b))
		copy(cp, b)
		return cp, true
	}, rel, m, opts, emit)
}

func scanBytesToSink(data []byte, rel string, m *compiledMatcher, opts Options, sink matchSink, emit emitFn) error {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	const maxLine = 4 * 1024 * 1024
	bufPtr := scannerBufPool.Get().(*[]byte)
	scanner.Buffer(*bufPtr, maxLine)
	defer scannerBufPool.Put(bufPtr)
	err := scanWithContext(func() ([]byte, bool) {
		if !scanner.Scan() {
			return nil, false
		}
		b := scanner.Bytes()
		cp := make([]byte, len(b))
		copy(cp, b)
		return cp, true
	}, rel, m, opts, emit)
	if err == nil {
		if serr := scanner.Err(); serr != nil {
			reportFileError(sink, rel, fmt.Errorf("line scan aborted: %w", serr))
		}
	}
	return err
}

func scanWithContext(next func() ([]byte, bool), rel string, m *compiledMatcher, opts Options, emit emitFn) error {
	contextLines := opts.ContextLines
	if contextLines < 0 {
		contextLines = 0
	}
	beforeRing := make([]string, 0, contextLines)
	type pending struct {
		match Match
		need  int
	}
	var pendingAfter []pending
	line := 0

	flushPending := func(lineText string) {
		if len(pendingAfter) == 0 {
			return
		}
		still := pendingAfter[:0]
		for _, p := range pendingAfter {
			p.match.ContextAfter = p.match.ContextAfter + "\n" + lineText
			p.need--
			if p.need <= 0 {
				if !emit(p.match) {
					pendingAfter = nil
					return
				}
			} else {
				still = append(still, p)
			}
		}
		pendingAfter = still
	}

	for {
		if err := opts.Cancel.Err(); err != nil {
			return err
		}
		b, ok := next()
		if !ok {
			break
		}
		line++
		lineText := string(b)
		if contextLines > 0 {
			flushPending(lineText)
		}

		matches := m.re.FindAllIndex(b, -1)
		for _, idx := range matches {
			match := buildMatchBytes(rel, line, idx[0], idx[1], b, m, opts)
			if contextLines > 0 && len(beforeRing) > 0 {
				match.ContextBefore = strings.Join(beforeRing, "\n") + "\n" + match.ContextBefore
			}
			if contextLines > 0 {
				pendingAfter = append(pendingAfter, pending{match: match, need: contextLines})
			} else {
				if !emit(match) {
					return nil
				}
			}
		}

		if contextLines > 0 {
			beforeRing = append(beforeRing, lineText)
			if len(beforeRing) > contextLines {
				beforeRing = beforeRing[1:]
			}
		}
	}

	for _, p := range pendingAfter {
		if !emit(p.match) {
			return nil
		}
	}
	return nil
}

func buildMatchBytes(rel string, line, start, end int, b []byte, m *compiledMatcher, opts Options) Match {
	col := utf8.RuneCount(b[:start]) + 1
	// Same-line context (IDEA / VS Code style preview).
	before := string(b[:start])
	after := string(b[end:])
	const maxSide = 120
	if len(before) > maxSide {
		before = "…" + before[len(before)-maxSide:]
	}
	if len(after) > maxSide {
		after = after[:maxSide] + "…"
	}
	_ = opts
	match := Match{
		File:          rel,
		Line:          line,
		Column:        col,
		MatchText:     string(b[start:end]),
		ContextBefore: before,
		ContextAfter:  after,
	}
	if m.preview != "" {
		match.Replacement = m.re.ReplaceAllString(string(b[start:end]), m.preview)
	}
	return match
}

// buildMatch is kept for backward compatibility with existing callers.
func buildMatch(rel string, line, start, end int, s string, m *compiledMatcher, opts Options) Match {
	return buildMatchBytes(rel, line, start, end, []byte(s), m, opts)
}
