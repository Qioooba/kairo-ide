package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/toolchain"
)

// ----------------- BuildEngine (async, disk) -----------------

type asyncBuildEngine struct {
	mu       sync.Mutex
	dir      string
	running  map[string]*runningBuild
	finished map[string]*api.BuildResult
	logger   *log.Logger
	registry *toolchain.Registry
	compile  func(context.Context, build.Request) (*build.Result, error)
}

type runningBuild struct {
	cancel context.CancelFunc
	done   chan struct{}
}

const (
	buildCancelTimeout  = 10 * time.Second
	maxBuildSourceFiles = 100000
	maxBuildOutputBytes = 512 * 1024
	maxBuildErrorBytes  = 16 * 1024
)

var buildSecretAssignmentPattern = regexp.MustCompile(`(?i)\b(password|passwd|token|secret|api[_-]?key)\s*=\s*[^\s]+`)

// cloneBuildResult returns a detached snapshot that callers may safely encode
// or inspect after the engine lock has been released. BuildResult instances in
// finished are mutated by the asynchronous compiler goroutine and must never
// escape directly.
func cloneBuildResult(src *api.BuildResult) *api.BuildResult {
	if src == nil {
		return nil
	}
	dst := *src
	dst.Diagnostics = append([]build.Diagnostic(nil), src.Diagnostics...)
	return &dst
}

func newAsyncBuildEngine(dataDir string, reg *toolchain.Registry, logger *log.Logger) *asyncBuildEngine {
	dir := filepath.Join(dataDir, "builds")
	_ = os.MkdirAll(dir, 0o755)
	b := &asyncBuildEngine{
		dir:      dir,
		running:  map[string]*runningBuild{},
		finished: map[string]*api.BuildResult{},
		logger:   logger,
		registry: reg,
	}
	b.loadFinished()
	return b
}

func (b *asyncBuildEngine) loadFinished() {
	p := filepath.Join(b.dir, "finished.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items []*api.BuildResult
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for _, bs := range items {
		if bs.State == "failed" {
			bs.State = "failure"
		}
		b.finished[bs.ID] = bs
	}
}

func (b *asyncBuildEngine) saveFinished() {
	items := make([]*api.BuildResult, 0, len(b.finished))
	for _, bs := range b.finished {
		items = append(items, bs)
	}
	// Trim the persisted list to the most-recent 200 builds...
	sort.Slice(items, func(i, j int) bool {
		return items[i].StartedAt < items[j].StartedAt
	})
	if len(items) > 200 {
		items = items[len(items)-200:]
	}
	// ...and evict the same keys from the in-memory map, which
	// previously grew without bound over the agent's lifetime.
	keep := make(map[string]struct{}, len(items))
	for _, bs := range items {
		keep[bs.ID] = struct{}{}
	}
	for id := range b.finished {
		if _, ok := keep[id]; !ok {
			delete(b.finished, id)
		}
	}
	data, _ := json.MarshalIndent(items, "", "  ")
	_ = atomicfile.WriteFile(filepath.Join(b.dir, "finished.json"), data, 0o600)
}

func (b *asyncBuildEngine) Start(req api.BuildRequest) (*api.BuildResult, error) {
	if err := validateTrustedBuildRequest(&req); err != nil {
		return nil, err
	}
	if req.SourceLevel == "" {
		req.SourceLevel = "1.6"
	}
	if req.TargetLevel == "" {
		req.TargetLevel = "1.6"
	}
	var tcHome string
	if req.Toolchain != "" {
		if b.registry == nil {
			return nil, errors.New("toolchain registry is not configured")
		}
		tc, ok := b.registry.Get(req.Toolchain)
		if !ok {
			return nil, fmt.Errorf("toolchain not found: %s", req.Toolchain)
		}
		tcHome = tc.Home
	} else {
		if b.registry != nil {
			for _, t := range b.registry.List() {
				tcHome = t.Home
				break
			}
		}
		if tcHome == "" {
			tcHome = os.Getenv("JAVA_HOME")
		}
	}
	if tcHome == "" {
		return nil, errors.New("no JDK registered; import a toolchain or set JAVA_HOME")
	}

	sources := req.Files
	if len(sources) == 0 && req.ProjectRoot != "" {
		var err error
		sources, err = collectAuthorizedJavaSources(req.ProjectRoot, req.OutputDir)
		if err != nil {
			return nil, err
		}
	}
	if len(sources) == 0 {
		return nil, errors.New("no Java source files found; build was not started")
	}
	if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
		return nil, err
	}
	if req.Clean {
		if err := os.RemoveAll(req.OutputDir); err != nil {
			return nil, fmt.Errorf("clean output directory: %w", err)
		}
		if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
			return nil, fmt.Errorf("recreate output directory: %w", err)
		}
	}

	id := "build_" + shortID()
	bs := &api.BuildResult{
		ID:          id,
		State:       "queued",
		StartedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		ProjectID:   req.ProjectID,
		Toolchain:   req.Toolchain,
		SourceLevel: req.SourceLevel,
		TargetLevel: req.TargetLevel,
		OutputDir:   req.OutputDir,
		TraceID:     req.TraceID,
	}
	b.mu.Lock()
	b.finished[id] = bs
	b.saveFinished()
	b.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	running := &runningBuild{cancel: cancel, done: make(chan struct{})}
	b.mu.Lock()
	b.running[id] = running
	b.mu.Unlock()
	if b.logger != nil {
		b.logger.Info("build queued", log.Fields{"buildId": id, "projectId": req.ProjectID, "traceId": req.TraceID})
	}

	go b.run(ctx, id, bs, running, build.Request{
		ProjectRoot: req.ProjectRoot,
		Toolchain:   tcHome,
		SourceLevel: req.SourceLevel,
		TargetLevel: req.TargetLevel,
		Sources:     sources,
		Classpath:   req.Classpath,
		Encoding:    req.Encoding,
		OutputDir:   req.OutputDir,
		WebappDir:   req.WebappDir,
	})

	b.mu.Lock()
	snapshot := cloneBuildResult(bs)
	b.mu.Unlock()
	return snapshot, nil
}

func (b *asyncBuildEngine) run(ctx context.Context, id string, bs *api.BuildResult, running *runningBuild, req build.Request) {
	defer func() {
		b.mu.Lock()
		delete(b.running, id)
		b.mu.Unlock()
		close(running.done)
	}()
	b.mu.Lock()
	bs.State = "running"
	b.saveFinished()
	b.mu.Unlock()

	compile := b.compile
	if compile == nil {
		compile = build.New(req.Toolchain).Compile
	}
	res, err := compile(ctx, req)
	b.mu.Lock()
	defer b.mu.Unlock()
	if ctx.Err() != nil {
		bs.State = "cancelled"
		bs.Error = ""
		bs.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		b.saveFinished()
		if b.logger != nil {
			b.logger.Warn("build finished", log.Fields{"buildId": id, "projectId": bs.ProjectID, "traceId": bs.TraceID, "state": bs.State})
		}
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled), errors.Is(ctx.Err(), context.Canceled):
			bs.State = "cancelled"
			bs.Error = ""
		case errors.Is(err, context.DeadlineExceeded):
			bs.State = "failure"
			bs.Error = "build timed out"
		default:
			bs.State = "failure"
			bs.Error = sanitizeBuildText(err.Error(), req.ProjectRoot, req.Toolchain, maxBuildErrorBytes)
		}
		bs.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		b.saveFinished()
		if b.logger != nil {
			b.logger.Warn("build finished", log.Fields{"buildId": id, "projectId": bs.ProjectID, "traceId": bs.TraceID, "state": bs.State})
		}
		return
	}
	bs.Output = sanitizeBuildText(res.Output, req.ProjectRoot, req.Toolchain, maxBuildOutputBytes)
	bs.Diagnostics = normalizeBuildDiagnostics(res.Diagnostics, req.ProjectRoot, req.Toolchain)
	bs.FilesCompiled = res.FilesCompiled
	bs.ElapsedMs = res.ElapsedMs
	bs.ExitCode = res.ExitCode
	if res.Success {
		bs.State = "success"
		// KAIRO-RC-WEB-2026-07-26-15: for webapp projects, mirror the
		// freshly compiled classes into WEB-INF/classes so the embedded
		// Tomcat serves them without requiring a separate package step.
		// This keeps direct-javac builds consistent with the Ant
		// build.xml compile target that copies build/classes.
		if req.WebappDir != "" {
			webappClasses := filepath.Join(req.WebappDir, "WEB-INF", "classes")
			if _, _, _, _, copyErr := syncDir(req.OutputDir, webappClasses, false); copyErr != nil {
				bs.State = "failure"
				bs.Error = sanitizeBuildText(fmt.Sprintf("compiled but failed to copy classes to webapp: %v", copyErr), req.ProjectRoot, req.Toolchain, maxBuildErrorBytes)
			}
		}
	} else {
		bs.State = "failure"
	}
	bs.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	b.saveFinished()
	if b.logger != nil {
		b.logger.Info("build finished", log.Fields{"buildId": id, "projectId": bs.ProjectID, "traceId": bs.TraceID, "state": bs.State, "exitCode": bs.ExitCode})
	}
}

func (b *asyncBuildEngine) Get(id string) (*api.BuildResult, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if bs, ok := b.finished[id]; ok {
		return cloneBuildResult(bs), nil
	}
	return nil, fmt.Errorf("%w: %s", api.ErrBuildNotFound, id)
}

func (b *asyncBuildEngine) List() []*api.BuildResult {
	b.mu.Lock()
	defer b.mu.Unlock()
	items := make([]*api.BuildResult, 0, len(b.finished))
	for _, bs := range b.finished {
		items = append(items, cloneBuildResult(bs))
	}
	return items
}

// Cancel is idempotent. Cancelling a terminal build returns its unchanged
// snapshot; cancelling a queued/running build waits for the compiler process
// tree to exit and for the terminal state to be persisted.
func (b *asyncBuildEngine) Cancel(ctx context.Context, id string) (*api.BuildResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	b.mu.Lock()
	bs, exists := b.finished[id]
	if !exists {
		b.mu.Unlock()
		return nil, fmt.Errorf("%w: %s", api.ErrBuildNotFound, id)
	}
	running := b.running[id]
	if running == nil {
		snapshot := cloneBuildResult(bs)
		b.mu.Unlock()
		return snapshot, nil
	}
	running.cancel()
	done := running.done
	b.mu.Unlock()

	timer := time.NewTimer(buildCancelTimeout)
	defer timer.Stop()
	select {
	case <-done:
		return b.Get(id)
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, fmt.Errorf("%w after %s", api.ErrBuildCancelTimeout, buildCancelTimeout)
	}
}

func validateTrustedBuildRequest(req *api.BuildRequest) error {
	if req.ProjectID == "" {
		return errors.New("projectId is required")
	}
	if req.ProjectRoot == "" {
		return errors.New("trusted project root is required")
	}
	root, err := filepath.Abs(req.ProjectRoot)
	if err != nil {
		return fmt.Errorf("resolve project root: %w", err)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("canonicalize project root: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("stat project root: %w", err)
	}
	if !info.IsDir() {
		return errors.New("project root is not a directory")
	}
	req.ProjectRoot = root
	if req.OutputDir == "" {
		return errors.New("trusted output directory is required")
	}
	output, err := authorizeAbsoluteWithin(root, req.OutputDir)
	if err != nil {
		return fmt.Errorf("invalid output directory: %w", err)
	}
	if filepath.Clean(output) == filepath.Clean(root) {
		return errors.New("output directory must not be the project root")
	}
	req.OutputDir = output
	for i, source := range req.Files {
		resolved, err := authorizeAbsoluteWithin(root, source)
		if err != nil {
			return fmt.Errorf("invalid source file: %w", err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return fmt.Errorf("stat source file: %w", err)
		}
		if !info.Mode().IsRegular() || !strings.EqualFold(filepath.Ext(resolved), ".java") {
			return fmt.Errorf("source is not a regular .java file: %s", source)
		}
		req.Files[i] = resolved
	}
	for i, entry := range req.Classpath {
		resolved, err := authorizeAbsoluteWithin(root, entry)
		if err != nil {
			return fmt.Errorf("invalid classpath entry: %w", err)
		}
		req.Classpath[i] = resolved
	}
	return nil
}

func authorizeAbsoluteWithin(root, candidate string) (string, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	abs, err = evalSymlinksNearestBuildPath(abs)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(root, abs)
	if err != nil {
		return "", pathpolicy.ErrOutsideRoot
	}
	return pathpolicy.NewDefaultPathPolicy().ResolveWithin(root, filepath.ToSlash(relative))
}

func evalSymlinksNearestBuildPath(candidate string) (string, error) {
	current := candidate
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(current)
		if err == nil {
			parts := append([]string{resolved}, suffix...)
			return filepath.Clean(filepath.Join(parts...)), nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		suffix = append([]string{filepath.Base(current)}, suffix...)
		current = parent
	}
}

func collectAuthorizedJavaSources(root, outputDir string) ([]string, error) {
	excludedDirectories := map[string]struct{}{
		".git": {}, ".legacyflow": {}, "node_modules": {}, "target": {},
	}
	var sources []string
	err := filepath.WalkDir(root, func(candidate string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if filepath.Clean(candidate) == filepath.Clean(outputDir) {
				return filepath.SkipDir
			}
			if candidate != root {
				if _, excluded := excludedDirectories[entry.Name()]; excluded {
					return filepath.SkipDir
				}
			}
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".java") {
			return nil
		}
		resolved, err := authorizeAbsoluteWithin(root, candidate)
		if err != nil {
			return fmt.Errorf("authorize Java source %q: %w", candidate, err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("Java source is not a regular file: %s", candidate)
		}
		sources = append(sources, resolved)
		if len(sources) > maxBuildSourceFiles {
			return fmt.Errorf("Java source count exceeds %d", maxBuildSourceFiles)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("collect Java sources: %w", err)
	}
	sort.Strings(sources)
	return sources, nil
}

func normalizeBuildDiagnostics(diagnostics []build.Diagnostic, projectRoot, toolchain string) []build.Diagnostic {
	canonicalRoot, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		canonicalRoot = filepath.Clean(projectRoot)
	}
	normalized := make([]build.Diagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		diagnostic.Message = sanitizeBuildText(diagnostic.Message, projectRoot, toolchain, maxBuildErrorBytes)
		if diagnostic.File != "" {
			resolved, err := authorizeAbsoluteWithin(canonicalRoot, diagnostic.File)
			if err != nil {
				diagnostic.File = ""
			} else if relative, err := filepath.Rel(canonicalRoot, resolved); err == nil {
				diagnostic.File = filepath.ToSlash(relative)
			} else {
				diagnostic.File = ""
			}
		}
		normalized = append(normalized, diagnostic)
	}
	return normalized
}

func sanitizeBuildText(value, projectRoot, toolchain string, maxBytes int) string {
	replacements := []struct {
		value       string
		placeholder string
	}{
		{value: projectRoot, placeholder: "<workspace>"},
		{value: toolchain, placeholder: "<jdk>"},
	}
	for _, replacement := range replacements {
		if replacement.value == "" {
			continue
		}
		variants := []string{
			filepath.Clean(replacement.value),
			filepath.ToSlash(filepath.Clean(replacement.value)),
			strings.ReplaceAll(filepath.Clean(replacement.value), "/", `\`),
		}
		seen := map[string]struct{}{}
		for _, variant := range variants {
			if variant == "" {
				continue
			}
			if _, duplicate := seen[variant]; duplicate {
				continue
			}
			seen[variant] = struct{}{}
			pattern, err := regexp.Compile(`(?i)` + regexp.QuoteMeta(variant))
			if err == nil {
				value = pattern.ReplaceAllString(value, replacement.placeholder)
			}
		}
	}
	value = buildSecretAssignmentPattern.ReplaceAllStringFunc(value, func(match string) string {
		if index := strings.Index(match, "="); index >= 0 {
			return strings.TrimSpace(match[:index]) + "=[REDACTED]"
		}
		return "[REDACTED]"
	})
	if maxBytes <= 0 || len(value) <= maxBytes {
		return value
	}
	truncated := value[:maxBytes]
	for !utf8.ValidString(truncated) && len(truncated) > 0 {
		truncated = truncated[:len(truncated)-1]
	}
	return truncated + "\n...[truncated]"
}
