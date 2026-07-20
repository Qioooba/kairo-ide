package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/toolchain"
)

// ----------------- BuildEngine (async, disk) -----------------

type asyncBuildEngine struct {
	mu       sync.Mutex
	dir      string
	running  map[string]context.CancelFunc
	finished map[string]*api.BuildResult
	logger   *log.Logger
	registry *toolchain.Registry
}

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
		running:  map[string]context.CancelFunc{},
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
	if req.SourceLevel == "" {
		req.SourceLevel = "1.6"
	}
	if req.TargetLevel == "" {
		req.TargetLevel = "1.6"
	}
	var tcHome string
	if req.Toolchain != "" {
		tc, ok := b.registry.Get(req.Toolchain)
		if !ok {
			return nil, fmt.Errorf("toolchain not found: %s", req.Toolchain)
		}
		tcHome = tc.Home
	} else {
		for _, t := range b.registry.List() {
			tcHome = t.Home
			break
		}
		if tcHome == "" {
			tcHome = os.Getenv("JAVA_HOME")
		}
	}
	if tcHome == "" {
		return nil, errors.New("no JDK registered; import a toolchain or set JAVA_HOME")
	}

	if req.OutputDir == "" {
		req.OutputDir = filepath.Join(b.dir, "out")
	}
	if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
		return nil, err
	}
	if req.Clean {
		_ = os.RemoveAll(req.OutputDir)
		_ = os.MkdirAll(req.OutputDir, 0o755)
	}

	sources := req.Files
	if len(sources) == 0 && req.ProjectRoot != "" {
		_ = filepath.WalkDir(req.ProjectRoot, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if filepath.Ext(p) == ".java" {
				sources = append(sources, p)
			}
			return nil
		})
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
	}
	b.mu.Lock()
	b.finished[id] = bs
	b.saveFinished()
	b.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	b.mu.Lock()
	b.running[id] = cancel
	b.mu.Unlock()

	go b.run(ctx, id, bs, build.Request{
		ProjectRoot: req.ProjectRoot,
		Toolchain:   tcHome,
		SourceLevel: req.SourceLevel,
		TargetLevel: req.TargetLevel,
		Sources:     sources,
		Classpath:   req.Classpath,
		OutputDir:   req.OutputDir,
	})

	b.mu.Lock()
	snapshot := cloneBuildResult(bs)
	b.mu.Unlock()
	return snapshot, nil
}

func (b *asyncBuildEngine) run(ctx context.Context, id string, bs *api.BuildResult, req build.Request) {
	defer func() {
		b.mu.Lock()
		delete(b.running, id)
		b.mu.Unlock()
	}()
	b.mu.Lock()
	bs.State = "running"
	b.saveFinished()
	b.mu.Unlock()

	compiler := build.New(req.Toolchain)
	res, err := compiler.Compile(ctx, req)
	b.mu.Lock()
	defer b.mu.Unlock()
	if err != nil {
		bs.State = "failed"
		bs.Error = err.Error()
		bs.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		b.saveFinished()
		return
	}
	bs.Output = res.Output
	bs.Diagnostics = res.Diagnostics
	bs.FilesCompiled = res.FilesCompiled
	bs.ElapsedMs = res.ElapsedMs
	bs.ExitCode = res.ExitCode
	if res.Success {
		bs.State = "success"
	} else {
		bs.State = "failed"
	}
	bs.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	b.saveFinished()
}

func (b *asyncBuildEngine) Get(id string) (*api.BuildResult, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if bs, ok := b.finished[id]; ok {
		return cloneBuildResult(bs), nil
	}
	return nil, fmt.Errorf("build not found: %s", id)
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
