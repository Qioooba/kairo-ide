// Package services provides default in-memory + disk-backed
// implementations of the api service interfaces. The agent
// stores workspace, project, server, build, and deployment
// records on disk so they survive an agent restart.
//
// The runtime, search, encoding, build, and Tomcat 6 components
// are real (no mocks, no stubs). The server runner launches the
// real Apache Tomcat 6 Bootstrap via java -classpath.
package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/build"
	"github.com/kairo-ide/runtime-agent/internal/encoding"
	"github.com/kairo-ide/runtime-agent/internal/jdtls"
	"github.com/kairo-ide/runtime-agent/internal/jdtproject"
	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/search"
	"github.com/kairo-ide/runtime-agent/internal/security"
	"github.com/kairo-ide/runtime-agent/internal/tomcat6"
	"github.com/kairo-ide/runtime-agent/internal/toolchain"
)

const (
	srvRunning  = "running"
	srvStarting = "starting"
	srvStopping = "stopping"
	srvStopped  = "stopped"
	srvError    = "error"
	srvCrashed  = "crashed"
)

// Config bundles the data directory, bundled directory, and a
// logger for the service factory.
type Config struct {
	DataDir     string
	BundledDir  string
	Logger      *log.Logger
	Tomcat6Home string
}

// NewMemoryServices returns a fully-wired Services struct with
// real implementations. The sandbox is enforced by services that
// accept caller-supplied paths (encoder, searcher, deployer, …);
// previously it was passed in but never stored, leaving every
// path-accepting endpoint able to read/write arbitrary files.
func NewMemoryServices(cfg Config, sandbox *security.WorkspaceRoots) *api.Services {
	registry, _ := toolchain.NewRegistry(filepath.Join(cfg.DataDir, "toolchains"))
	tomcat6Home := cfg.Tomcat6Home
	if tomcat6Home == "" {
		home, err := tomcat6.FetchCatalinaHomeOrDownload(cfg.BundledDir)
		if err == nil {
			tomcat6Home = home
		} else {
			cfg.Logger.Warn("tomcat6 not available", log.Fields{"err": err.Error()})
		}
	}
	return &api.Services{
		WorkspaceStore:    newDiskWorkspaceStore(cfg.DataDir, sandbox),
		ProjectStore:      newDiskProjectStore(cfg.DataDir),
		ToolchainRegistry: &memToolchainRegistry{reg: registry},
		Searcher:          &memSearcher{sandbox: sandbox},
		Encoder:           &memEncoder{sandbox: sandbox},
		BuildEngine:       newAsyncBuildEngine(cfg.DataDir, registry, cfg.Logger),
		Deployer:          newDiskDeployer(cfg.DataDir, cfg.Logger),
		ServerRunner:      newRealServerRunner(cfg.DataDir, cfg.BundledDir, tomcat6Home, cfg.Logger),
		Auth:              newDiskAuthenticator(cfg.DataDir, cfg.Logger),
		JDTLS:             newJDTLSService(cfg.DataDir, cfg.BundledDir, cfg.Logger),
		JDTProjectGenerator: newJDTProjectService(cfg.DataDir, cfg.BundledDir, cfg.Logger),
	}
}

// ----------------- WorkspaceStore (disk) -----------------

type diskWorkspaceStore struct {
	mu      sync.Mutex
	dir     string
	data    map[string]api.WorkspaceRecord
	sandbox *security.WorkspaceRoots
}

func newDiskWorkspaceStore(dataDir string, sandbox *security.WorkspaceRoots) *diskWorkspaceStore {
	dir := filepath.Join(dataDir, "workspaces")
	_ = os.MkdirAll(dir, 0o755)
	ws := &diskWorkspaceStore{dir: dir, data: map[string]api.WorkspaceRecord{}, sandbox: sandbox}
	ws.load()
	return ws
}

func (s *diskWorkspaceStore) load() {
	p := filepath.Join(s.dir, "workspaces.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items []api.WorkspaceRecord
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for _, w := range items {
		s.data[w.ID] = w
	}
}

func (s *diskWorkspaceStore) save() {
	items := make([]api.WorkspaceRecord, 0, len(s.data))
	for _, w := range s.data {
		items = append(items, w)
	}
	data, _ := json.MarshalIndent(items, "", "  ")
	_ = os.WriteFile(filepath.Join(s.dir, "workspaces.json"), data, 0o600)
}

func (s *diskWorkspaceStore) List() []api.WorkspaceRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]api.WorkspaceRecord, 0, len(s.data))
	for _, w := range s.data {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastOpened > out[j].LastOpened })
	return out
}

func (s *diskWorkspaceStore) Open(rootPath, name string) (api.WorkspaceRecord, error) {
	abs, err := filepath.Abs(rootPath)
	if err != nil {
		return api.WorkspaceRecord{}, err
	}
	if _, err := os.Stat(abs); err != nil {
		return api.WorkspaceRecord{}, fmt.Errorf("path not accessible: %w", err)
	}
	// Register the new workspace root with the sandbox so that
	// subsequent file operations inside it pass authorization.
	if s.sandbox != nil {
		if err := s.sandbox.AddRoot(abs); err != nil {
			return api.WorkspaceRecord{}, fmt.Errorf("authorize workspace root: %w", err)
		}
	}
	id := "ws_" + shortID()
	if name == "" {
		name = filepath.Base(abs)
	}
	w := api.WorkspaceRecord{
		ID:         id,
		Name:       name,
		RootPath:   abs,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		LastOpened: time.Now().UTC().Format(time.RFC3339Nano),
		UserID:     "local",
	}
	s.mu.Lock()
	s.data[id] = w
	s.save()
	s.mu.Unlock()
	return w, nil
}

func (s *diskWorkspaceStore) Get(id string) (api.WorkspaceRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, ok := s.data[id]
	if !ok {
		return api.WorkspaceRecord{}, fmt.Errorf("workspace not found: %s", id)
	}
	w.LastOpened = time.Now().UTC().Format(time.RFC3339Nano)
	s.data[id] = w
	s.save()
	return w, nil
}

func (s *diskWorkspaceStore) Close(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
	s.save()
	return nil
}

// ----------------- ProjectStore (disk) -----------------

type diskProjectStore struct {
	mu   sync.Mutex
	dir  string
	data map[string]json.RawMessage
}

func newDiskProjectStore(dataDir string) *diskProjectStore {
	dir := filepath.Join(dataDir, "projects")
	_ = os.MkdirAll(dir, 0o755)
	ps := &diskProjectStore{dir: dir, data: map[string]json.RawMessage{}}
	ps.load()
	return ps
}

func (s *diskProjectStore) load() {
	p := filepath.Join(s.dir, "projects.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items map[string]json.RawMessage
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for k, v := range items {
		s.data[k] = v
	}
}

func (s *diskProjectStore) save() {
	data, _ := json.MarshalIndent(s.data, "", "  ")
	_ = os.WriteFile(filepath.Join(s.dir, "projects.json"), data, 0o600)
}

func (s *diskProjectStore) List() []json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]json.RawMessage, 0, len(s.data))
	for _, p := range s.data {
		out = append(out, p)
	}
	return out
}

func (s *diskProjectStore) Get(id string) (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.data[id]
	if !ok {
		return nil, fmt.Errorf("project not found: %s", id)
	}
	return p, nil
}

func (s *diskProjectStore) Update(id string, cfg any) (json.RawMessage, error) {
	b, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.data[id] = b
	s.save()
	s.mu.Unlock()
	return b, nil
}

// ----------------- ToolchainRegistry -----------------

type memToolchainRegistry struct {
	reg *toolchain.Registry
}

func (m *memToolchainRegistry) List() []json.RawMessage {
	out := []json.RawMessage{}
	for _, t := range m.reg.List() {
		b, _ := json.Marshal(t)
		out = append(out, b)
	}
	return out
}

func (m *memToolchainRegistry) Import(path, label string) (json.RawMessage, error) {
	t, err := toolchain.Detect(path)
	if err != nil {
		return nil, err
	}
	if label != "" {
		t.Vendor = label + " (" + t.Vendor + ")"
	}
	if err := m.reg.Add(t); err != nil {
		return nil, err
	}
	return json.Marshal(t)
}

// ----------------- Searcher -----------------

type memSearcher struct {
	sandbox *security.WorkspaceRoots
}

func (m *memSearcher) Search(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID     string   `json:"workspaceId"`
		Query           string   `json:"query"`
		IsRegex         bool     `json:"isRegex"`
		CaseSensitive   bool     `json:"caseSensitive"`
		WholeWord       bool     `json:"wholeWord"`
		Include         []string `json:"include"`
		Exclude         []string `json:"exclude"`
		ContextLines    int      `json:"contextLines"`
		MaxResults      int      `json:"maxResults"`
		PreviewReplace  string   `json:"previewReplace"`
		ProjectEncoding string   `json:"projectEncoding"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	// The "workspaceId" field is actually used as a filesystem root
	// by search.Search. Authorize it before walking it, otherwise
	// the endpoint lists files in any directory the agent can read.
	root := req.WorkspaceID
	if m != nil && m.sandbox != nil {
		authorized, err := m.sandbox.AuthorizeReadAbs(root)
		if err != nil {
			return nil, err
		}
		root = authorized
	}
	r, err := search.Search(root, search.Options{
		Query:           req.Query,
		IsRegex:         req.IsRegex,
		CaseSensitive:   req.CaseSensitive,
		WholeWord:       req.WholeWord,
		Include:         req.Include,
		Exclude:         req.Exclude,
		ContextLines:    req.ContextLines,
		MaxResults:      req.MaxResults,
		PreviewReplace:  req.PreviewReplace,
		ProjectEncoding: encoding.ID(req.ProjectEncoding),
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(r)
}

// ----------------- Encoder -----------------

type memEncoder struct {
	sandbox *security.WorkspaceRoots
}

func (m *memEncoder) Detect(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID string `json:"workspaceId"`
		File        string `json:"file"`
		SampleBytes int    `json:"sampleBytes"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.SampleBytes == 0 {
		req.SampleBytes = 64 * 1024
	}
	// Reject paths outside the sandbox. Without this check the
	// endpoint could be used to read arbitrary files (~/.ssh,
	// /etc/passwd, …) by anyone who can reach the agent.
	path, err := m.resolveRead(req.File)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, req.SampleBytes)
	n, _ := f.Read(buf)
	id, conf, hasBom, eol := encoding.Detect(buf[:n], encoding.UTF8, encoding.Aliases{})
	return json.Marshal(map[string]any{
		"file":       req.File,
		"encoding":   id,
		"confidence": conf,
		"candidates": []string{id},
		"hasBom":     hasBom,
		"eol":        eol,
	})
}

func (m *memEncoder) Recode(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID string `json:"workspaceId"`
		File        string `json:"file"`
		From        string `json:"from"`
		To          string `json:"to"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	// Recode reads AND writes the same path. Both directions must
	// pass the sandbox or the endpoint lets a caller overwrite
	// arbitrary files.
	path, err := m.resolveWrite(req.File)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	decoded, err := encoding.Decode(data, req.From, encoding.Aliases{})
	if err != nil {
		return nil, err
	}
	encoded, err := encoding.Encode(decoded, req.To, encoding.Aliases{})
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"ok": true, "bytes": len(encoded)})
}

// resolveRead authorizes a caller-supplied read path. If a sandbox
// is configured the path must be under one of the workspace roots
// (or a read-only bundled path). When no sandbox is configured
// (legacy callers / tests) we fall through with the original path.
func (m *memEncoder) resolveRead(p string) (string, error) {
	if m == nil || m.sandbox == nil {
		return p, nil
	}
	return m.sandbox.AuthorizeReadAbs(p)
}

func (m *memEncoder) resolveWrite(p string) (string, error) {
	if m == nil || m.sandbox == nil {
		return p, nil
	}
	return m.sandbox.AuthorizeWriteAbs(p)
}

// ----------------- BuildEngine (async, disk) -----------------

type buildState struct {
	ID           string              `json:"id"`
	State        string              `json:"state"`
	StartedAt    string              `json:"startedAt"`
	FinishedAt   string              `json:"finishedAt,omitempty"`
	ProjectID    string              `json:"projectId"`
	Toolchain    string              `json:"toolchainId"`
	SourceLevel  string              `json:"sourceLevel"`
	TargetLevel  string              `json:"targetLevel"`
	OutputDir    string              `json:"outputDir"`
	Diagnostics  []build.Diagnostic  `json:"diagnostics"`
	FilesCompiled int                `json:"filesCompiled"`
	ElapsedMs    int64               `json:"elapsedMs"`
	Output       string              `json:"output"`
	Error        string              `json:"error,omitempty"`
	ExitCode     int                 `json:"exitCode"`
}

type asyncBuildEngine struct {
	mu       sync.Mutex
	dir      string
	running  map[string]context.CancelFunc
	finished map[string]*buildState
	logger   *log.Logger
	registry *toolchain.Registry
}

func newAsyncBuildEngine(dataDir string, reg *toolchain.Registry, logger *log.Logger) *asyncBuildEngine {
	dir := filepath.Join(dataDir, "builds")
	_ = os.MkdirAll(dir, 0o755)
	b := &asyncBuildEngine{
		dir:      dir,
		running:  map[string]context.CancelFunc{},
		finished: map[string]*buildState{},
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
	var items []*buildState
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for _, bs := range items {
		b.finished[bs.ID] = bs
	}
}

func (b *asyncBuildEngine) saveFinished() {
	items := make([]*buildState, 0, len(b.finished))
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
	_ = os.WriteFile(filepath.Join(b.dir, "finished.json"), data, 0o600)
}

func (b *asyncBuildEngine) Start(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		ProjectID   string   `json:"projectId"`
		Files       []string `json:"files"`
		Toolchain   string   `json:"toolchainId"`
		SourceLevel string   `json:"sourceLevel"`
		TargetLevel string   `json:"targetLevel"`
		ProjectRoot string   `json:"projectRoot"`
		OutputDir   string   `json:"outputDir"`
		Classpath   []string `json:"classpath"`
		Clean       bool     `json:"clean"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
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
	bs := &buildState{
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

	return json.Marshal(map[string]any{
		"id":    id,
		"state": "queued",
	})
}

func (b *asyncBuildEngine) run(ctx context.Context, id string, bs *buildState, req build.Request) {
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

func (b *asyncBuildEngine) Get(id string) (json.RawMessage, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if bs, ok := b.finished[id]; ok {
		return json.Marshal(bs)
	}
	return nil, fmt.Errorf("build not found: %s", id)
}

// ----------------- Deployer (disk, real) -----------------

type deployRecord struct {
	ID            string    `json:"id"`
	State         string    `json:"state"`
	StartedAt     time.Time `json:"startedAt"`
	FinishedAt    time.Time `json:"finishedAt"`
	ProjectID     string    `json:"projectId"`
	BuildID       string    `json:"buildId"`
	What          string    `json:"what"`
	Source        string    `json:"source"`
	Target        string    `json:"target"`
	FilesTouched  int       `json:"filesTouched"`
	Bytes         int64     `json:"bytes"`
	FilesAdded    int       `json:"filesAdded"`
	FilesModified int       `json:"filesModified"`
	FilesDeleted  int       `json:"filesDeleted"`
	Trigger       string    `json:"trigger"`
	HotReloadMode string    `json:"hotReloadMode"`
	Error         string    `json:"error,omitempty"`
}

type diskDeployer struct {
	mu     sync.Mutex
	dir    string
	logger *log.Logger
	items  map[string]*deployRecord
}

func newDiskDeployer(dataDir string, logger *log.Logger) *diskDeployer {
	dir := filepath.Join(dataDir, "deployments")
	_ = os.MkdirAll(dir, 0o755)
	d := &diskDeployer{
		dir:    dir,
		logger: logger,
		items:  map[string]*deployRecord{},
	}
	d.load()
	return d
}

func (d *diskDeployer) load() {
	p := filepath.Join(d.dir, "deployments.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items []*deployRecord
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for _, r := range items {
		d.items[r.ID] = r
	}
}

func (d *diskDeployer) save() {
	items := make([]*deployRecord, 0, len(d.items))
	for _, r := range d.items {
		items = append(items, r)
	}
	data, _ := json.MarshalIndent(items, "", "  ")
	_ = os.WriteFile(filepath.Join(d.dir, "deployments.json"), data, 0o600)
}

func (d *diskDeployer) Publish(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		ProjectID string `json:"projectId"`
		BuildID   string `json:"buildId"`
		What      string `json:"what"`
		Source    string `json:"source"`
		Target    string `json:"target"`
		Trigger   string `json:"trigger"`
		// Mode controls how syncDir reconciles src into dst.
		//   "merge"  (default): copy each file under src to its
		//                       corresponding path under dst; do NOT
		//                       delete anything already in dst. This
		//                       is the right behavior for incremental
		//                       IDE deploys where multiple sources
		//                       (WebRoot, build-out, resources, lib)
		//                       all target the same webapp tree.
		//   "mirror": copy src into dst and delete any entry under
		//                       dst that is not under src. Use this
		//                       when src is the authoritative copy
		//                       (e.g. replacing build-out entirely).
		Mode string `json:"mode"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.What == "" {
		req.What = "all"
	}
	if req.Trigger == "" {
		req.Trigger = "manual"
	}
	if req.Mode == "" {
		req.Mode = "merge"
	}
	if req.Mode != "merge" && req.Mode != "mirror" {
		return nil, fmt.Errorf("mode must be 'merge' or 'mirror'")
	}
	if req.Source == "" {
		return nil, errors.New("source is required")
	}
	if req.Target == "" {
		return nil, errors.New("target is required")
	}
	if _, err := os.Stat(req.Source); err != nil {
		return nil, fmt.Errorf("source not found: %w", err)
	}

	id := "dep_" + shortID()
	rec := &deployRecord{
		ID:            id,
		State:         "running",
		StartedAt:     time.Now(),
		ProjectID:     req.ProjectID,
		BuildID:       req.BuildID,
		What:          req.What,
		Source:        req.Source,
		Target:        req.Target,
		HotReloadMode: "staticSync",
		Trigger:       req.Trigger,
	}
	d.mu.Lock()
	d.items[id] = rec
	d.save()
	d.mu.Unlock()

	filesAdded, filesModified, filesDeleted, bytes, err := syncDir(req.Source, req.Target, req.Mode == "mirror")
	rec.FinishedAt = time.Now()
	if err != nil {
		rec.State = "failed"
		rec.Error = err.Error()
	} else {
		rec.State = "success"
		rec.FilesTouched = filesAdded + filesModified + filesDeleted
		rec.FilesAdded = filesAdded
		rec.FilesModified = filesModified
		rec.FilesDeleted = filesDeleted
		rec.Bytes = bytes
	}
	d.mu.Lock()
	d.save()
	d.mu.Unlock()
	return json.Marshal(rec)
}

func (d *diskDeployer) Get(id string) (json.RawMessage, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	r, ok := d.items[id]
	if !ok {
		return nil, fmt.Errorf("deployment not found: %s", id)
	}
	return json.Marshal(r)
}

// syncDir copies the file tree at src into dst using atomic copies.
// src may be a file or a directory. For a single file, dst is
// treated as the target file path. If dst ends in a directory
// separator or exists as a dir, the file is placed inside that
// directory using src's basename.
//
// When prune is true, any entry under dst that does not exist
// under src is removed (mirror semantics); when prune is false,
// only additions and updates are performed (merge semantics, the
// default for IDE deploys where multiple sources share a target).
// Returns (added, modified, deleted, bytes, err).
func syncDir(src, dst string, prune bool) (added, modified, deleted int, bytes int64, err error) {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)
	srcInfo, err := os.Stat(src)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	if !srcInfo.IsDir() {
		dstInfo, _ := os.Stat(dst)
		if dstInfo != nil && dstInfo.IsDir() {
			dst = filepath.Join(dst, filepath.Base(src))
		} else {
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return 0, 0, 0, 0, err
			}
		}
		a, m, b, e := copyOneFile(src, dst)
		return a, m, 0, b, e
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return 0, 0, 0, 0, err
	}
	seen := map[string]bool{}
	walkErr := filepath.WalkDir(src, func(path string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		rel, e := filepath.Rel(src, path)
		if e != nil {
			return e
		}
		if rel == "." {
			return nil
		}
		dp := filepath.Join(dst, rel)
		seen[dp] = true
		if d.IsDir() {
			return os.MkdirAll(dp, 0o755)
		}
		a, m, b, e := copyOneFile(path, dp)
		added += a
		modified += m
		bytes += b
		return e
	})
	if walkErr != nil {
		return added, modified, deleted, bytes, walkErr
	}
	if prune {
		if err := pruneUnseen(dst, seen, &deleted); err != nil {
			return added, modified, deleted, bytes, err
		}
	}
	return added, modified, deleted, bytes, nil
}

// pruneUnseen walks root with an explicit stack (NOT filepath.WalkDir)
// and removes anything not in seen.
//
// filepath.WalkDir is a DFS that reads a directory's entries, then
// recurses into each subdir. If the closure deletes a subdir that
// WalkDir has already cached as "a directory to recurse into",
// WalkDir then fails with a werr of the form
//
//	open <subdir>: no such file or directory
//
// because the dir was just removed. That werr surfaces to the caller
// as a spurious sync failure even though every file was copied and
// every stale entry was deleted. Doing the traversal by hand with
// os.ReadDir keeps the recursion in our control so a successful
// RemoveAll is never reported as a failure.
func pruneUnseen(root string, seen map[string]bool, deleted *int) error {
	type frame struct {
		path    string
		entries []os.DirEntry
		idx     int
	}
	rd, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	stack := []frame{{path: root, entries: rd}}
	for len(stack) > 0 {
		top := &stack[len(stack)-1]
		if top.idx >= len(top.entries) {
			stack = stack[:len(stack)-1]
			continue
		}
		entry := top.entries[top.idx]
		top.idx++
		child := filepath.Join(top.path, entry.Name())
		if !seen[child] {
			if err := os.RemoveAll(child); err != nil {
				return err
			}
			if !entry.IsDir() {
				*deleted++
			}
			// Do NOT descend into the removed child.
			continue
		}
		if entry.IsDir() {
			cd, err := os.ReadDir(child)
			if err != nil {
				if os.IsNotExist(err) {
					// Removed between seen-check and readdir; skip.
					continue
				}
				return err
			}
			stack = append(stack, frame{path: child, entries: cd})
		}
	}
	return nil
}

// copyOneFile copies src to dst atomically (temp + rename).
// Returns (added, modified, bytes) where added=1 if dst did not
// exist before and modified=1 if it existed.
func copyOneFile(src, dst string) (added, modified int, bytes int64, err error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return 0, 0, 0, err
	}
	srcInfo, err := os.Stat(src)
	if err != nil {
		return 0, 0, 0, err
	}
	existing, _ := os.Stat(dst)
	in, err := os.Open(src)
	if err != nil {
		return 0, 0, 0, err
	}
	defer in.Close()
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".kairo-tmp-*")
	if err != nil {
		return 0, 0, 0, err
	}
	tmpPath := tmp.Name()
	n, err := io.Copy(tmp, in)
	if err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	// Preserve source permissions (especially the executable bit
	// for .sh/.bat/.cmd shipped under WebRoot/bin).
	if err := os.Chmod(tmpPath, srcInfo.Mode()); err != nil {
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	if err := os.Rename(tmpPath, dst); err != nil {
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	if existing == nil {
		added = 1
	} else {
		modified = 1
	}
	return added, modified, n, nil
}

// ----------------- ServerRunner (real Tomcat 6) -----------------

type realServerRunner struct {
	mu          sync.Mutex
	dataDir     string
	bundledDir  string
	tomcat6Home string
	logger      *log.Logger
	instances   map[string]*tomcat6.Instance
	meta        map[string]*serverMeta
}

type serverMeta struct {
	ID           string         `json:"id"`
	ProjectID    string         `json:"projectId"`
	Type         string         `json:"type"`
	State        string         `json:"state"`
	PID          int            `json:"pid"`
	Ports        *tomcat6.Ports `json:"ports"`
	StartedAt    time.Time      `json:"startedAt"`
	JavaHome     string         `json:"javaHome"`
	ContextPath  string         `json:"contextPath"`
	WebappDir    string         `json:"webappDir"`
	CatalinaBase string         `json:"catalinaBase"`
	LastError    string         `json:"lastError,omitempty"`
}

func newRealServerRunner(dataDir, bundledDir, tomcat6Home string, logger *log.Logger) *realServerRunner {
	r := &realServerRunner{
		dataDir:     dataDir,
		bundledDir:  bundledDir,
		tomcat6Home: tomcat6Home,
		logger:      logger,
		instances:   map[string]*tomcat6.Instance{},
		meta:        map[string]*serverMeta{},
	}
	r.load()
	return r
}

func (r *realServerRunner) load() {
	p := filepath.Join(r.dataDir, "servers.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items []*serverMeta
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for _, m := range items {
		r.meta[m.ID] = m
	}
}

func (r *realServerRunner) save() {
	items := make([]*serverMeta, 0, len(r.meta))
	for _, m := range r.meta {
		items = append(items, m)
	}
	data, _ := json.MarshalIndent(items, "", "  ")
	_ = os.WriteFile(filepath.Join(r.dataDir, "servers.json"), data, 0o600)
}

func (r *realServerRunner) Start(payload json.RawMessage) (json.RawMessage, error) {
	if r.tomcat6Home == "" {
		return nil, errors.New("Tomcat 6 not bundled; set KAIRO_TOMCAT6_HOME or run scripts/fetch-tomcat6.sh")
	}
	var req struct {
		ProjectID    string   `json:"projectId"`
		JavaHome     string   `json:"javaHome"`
		WebappDir    string   `json:"webappDir"`
		ContextPath  string   `json:"contextPath"`
		HTTPPort     int      `json:"httpPort"`
		ShutdownPort int      `json:"shutdownPort"`
		AJPPort      int      `json:"ajpPort"`
		DebugPort    int      `json:"debugPort"`
		DebugSuspend bool     `json:"debugSuspend"`
		JVMOptions   []string `json:"jvmOptions"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.WebappDir == "" {
		return nil, errors.New("webappDir is required")
	}
	if req.JavaHome == "" {
		req.JavaHome = os.Getenv("JAVA_HOME")
	}
	if req.JavaHome == "" {
		return nil, errors.New("javaHome is required (or set JAVA_HOME)")
	}
	if _, err := os.Stat(req.WebappDir); err != nil {
		return nil, fmt.Errorf("webappDir not found: %w", err)
	}

	id := "srv_" + shortID()
	base := filepath.Join(r.dataDir, "runtime", id)
	if err := os.MkdirAll(base, 0o755); err != nil {
		return nil, err
	}
	inst, err := tomcat6.Start(context.Background(), tomcat6.Spec{
		ID:            id,
		JavaHome:      req.JavaHome,
		CatalinaHome:  r.tomcat6Home,
		CatalinaBase:  base,
		HTTPPort:      req.HTTPPort,
		ShutdownPort:  req.ShutdownPort,
		AJPPort:       req.AJPPort,
		DebugPort:     req.DebugPort,
		DebugSuspend:  req.DebugSuspend,
		ContextPath:   req.ContextPath,
		WebappDir:     req.WebappDir,
		JVMOptions:    req.JVMOptions,
		Logger:        r.logger,
	})
	if err != nil {
		return nil, err
	}
	ports := inst.Ports()
	meta := &serverMeta{
		ID:           id,
		ProjectID:    req.ProjectID,
		Type:         "tomcat6",
		State:        inst.State(),
		PID:          inst.PID(),
		Ports:        &ports,
		StartedAt:    inst.StartedAt(),
		JavaHome:     req.JavaHome,
		ContextPath:  req.ContextPath,
		WebappDir:    req.WebappDir,
		CatalinaBase: base,
	}
	r.mu.Lock()
	r.instances[id] = inst
	r.meta[id] = meta
	r.save()
	r.mu.Unlock()
	return json.Marshal(meta)
}

func (r *realServerRunner) Get(id string) (json.RawMessage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.meta[id]
	if !ok {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	if inst, ok := r.instances[id]; ok {
		m.State = inst.State()
		m.PID = inst.PID()
		ports := inst.Ports()
		m.Ports = &ports
	}
	return json.Marshal(m)
}

func (r *realServerRunner) Stop(id string, payload json.RawMessage) (json.RawMessage, error) {
	var p struct {
		Force bool `json:"force"`
	}
	_ = json.Unmarshal(payload, &p)
	r.mu.Lock()
	inst := r.instances[id]
	m := r.meta[id]
	r.mu.Unlock()
	if inst == nil {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	// Propagate stop errors so the caller knows the process may
	// still be alive. Previously the error was swallowed and the
	// meta marked "stopped" while the OS process kept running,
	// leaking ports and memory.
	var stopErr error
	if p.Force {
		stopErr = inst.ForceStop()
	} else {
		stopErr = inst.Stop(15 * time.Second)
	}
	if stopErr != nil {
		if m != nil {
			m.State = "error"
			m.LastError = stopErr.Error()
		}
		r.mu.Lock()
		r.save()
		r.mu.Unlock()
		return nil, fmt.Errorf("stop server %s: %w", id, stopErr)
	}
	if m != nil {
		m.State = "stopped"
	}
	r.mu.Lock()
	delete(r.instances, id)
	r.save()
	r.mu.Unlock()
	if m == nil {
		return json.Marshal(map[string]any{"id": id, "state": "stopped"})
	}
	return json.Marshal(m)
}

func (r *realServerRunner) Debug(id string) (json.RawMessage, error) {
	r.mu.Lock()
	m, ok := r.meta[id]
	r.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	if m.JavaHome == "" || m.CatalinaBase == "" {
		return nil, errors.New("server is missing restart metadata")
	}
	// Persisted metadata may legitimately lack Ports (older record
	// or null JSON). Guard before dereferencing m.Ports.HTTP below.
	if m.Ports == nil {
		return nil, errors.New("server metadata missing ports; start the server first")
	}
	if inst, ok := r.instances[id]; ok {
		_ = inst.Stop(10 * time.Second)
	}
	debugPort, err := pickFreePort()
	if err != nil {
		return nil, err
	}
	inst, err := tomcat6.Start(context.Background(), tomcat6.Spec{
		ID:            id,
		JavaHome:      m.JavaHome,
		CatalinaHome:  r.tomcat6Home,
		CatalinaBase:  m.CatalinaBase,
		HTTPPort:      m.Ports.HTTP,
		ShutdownPort:  m.Ports.Shutdown,
		AJPPort:       m.Ports.AJP,
		DebugPort:     debugPort,
		ContextPath:   m.ContextPath,
		WebappDir:     m.WebappDir,
		Logger:        r.logger,
	})
	if err != nil {
		return nil, err
	}
	ports := inst.Ports()
	m.PID = inst.PID()
	m.Ports = &ports
	m.State = inst.State()
	r.mu.Lock()
	r.instances[id] = inst
	r.save()
	r.mu.Unlock()
	return json.Marshal(m)
}

func (r *realServerRunner) Logs(id string, follow bool) (json.RawMessage, error) {
	r.mu.Lock()
	inst, ok := r.instances[id]
	r.mu.Unlock()
	if !ok {
		m, ok2 := r.meta[id]
		if !ok2 {
			return nil, fmt.Errorf("server not found: %s", id)
		}
		logPath := filepath.Join(m.CatalinaBase, "logs", "kairo-stdout.log")
		data, err := os.ReadFile(logPath)
		if err != nil {
			return json.Marshal([]map[string]any{})
		}
		lines := splitLines(string(data), 200)
		out := make([]map[string]any, 0, len(lines))
		for _, l := range lines {
			out = append(out, map[string]any{"line": l, "ts": time.Now().UTC().Format(time.RFC3339Nano)})
		}
		return json.Marshal(out)
	}
	lines, err := inst.TailLog(200)
	if err != nil {
		return json.Marshal([]map[string]any{})
	}
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		out = append(out, map[string]any{"line": l, "ts": time.Now().UTC().Format(time.RFC3339Nano)})
	}
	return json.Marshal(out)
}

func splitLines(s string, max int) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	if len(out) > max {
		out = out[len(out)-max:]
	}
	return out
}

func pickFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	addr, ok := l.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("unexpected listener address")
	}
	return addr.Port, nil
}

// ----------------- Authenticator (disk) -----------------

type diskAuthenticator struct {
	mu     sync.Mutex
	dir    string
	logger *log.Logger
}

func newDiskAuthenticator(dataDir string, logger *log.Logger) *diskAuthenticator {
	dir := filepath.Join(dataDir, "auth")
	_ = os.MkdirAll(dir, 0o755)
	return &diskAuthenticator{dir: dir, logger: logger}
}

func (a *diskAuthenticator) Login(payload json.RawMessage, w http.ResponseWriter) (json.RawMessage, error) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Username == "" || req.Password == "" {
		return nil, errors.New("username and password required")
	}
	// Trusted-local mode: accept any non-empty pair. Real password
	// hashing is deferred (see DELIVERY.md P2-2). Until real auth
	// exists, this agent MUST NOT be exposed beyond trusted
	// loopback; RequireAuth only gates the login endpoint.
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("generate session token: %w", err)
	}
	csrf := make([]byte, 16)
	if _, err := rand.Read(csrf); err != nil {
		return nil, fmt.Errorf("generate csrf token: %w", err)
	}
	return json.Marshal(map[string]any{
		"sessionToken": hex.EncodeToString(tokenBytes),
		"csrfToken":    hex.EncodeToString(csrf),
		"user": map[string]any{
			"id":       "u_" + req.Username,
			"username": req.Username,
			"role":     "user",
		},
		"expiresAt": time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
	})
}

func (a *diskAuthenticator) Logout(r *http.Request, w http.ResponseWriter) error {
	return nil
}

// ----------------- JDTLS (jdt-language-server lifecycle) -----------------
//
// jdtlsService wraps jdtls.Manager and exposes the
// /api/v1/jdtls endpoint contract. The state machine is:
//
//   stopped  --Start()--> starting --LSP initialize ok--> running
//   running  --Stop()---> stopping --> stopped
//   any      --crash----> crashed   (lastError set)
//
// Start() is synchronous w.r.t. the user-visible state: it
// does not return until either the JDT LS has answered the LSP
// `initialize` request, or a hard timeout fires. There is no
// "we promise it's starting, ask again later" promise. If
// Start returns nil, the process is up AND initialized.
//
// We deliberately do NOT call Initialize on every Start; the
// caller may have just Stopped and restarted with a new root
// URI, in which case we issue the LSP `initialize` request
// during Start. On the very first Start after agent boot, the
// payload's `initializeRootURI` is what gets sent to the LS.

type jdtlsService struct {
	mu        sync.Mutex
	mgr       *jdtls.Manager
	bridge    *jdtls.FrameBridge
	logger    *log.Logger
	sourceLvl string
}

func newJDTLSService(dataDir, bundled string, logger *log.Logger) *jdtlsService {
	mgr := jdtls.New(dataDir, bundled, os.Getenv("KAIRO_JRE17_HOME"), logger)
	return &jdtlsService{
		mgr:       mgr,
		bridge:    jdtls.NewFrameBridge(mgr, logger),
		logger:    logger,
		sourceLvl: "1.6",
	}
}

// SetWorkspace is the API-side hook used by the LSP bridge
// handler: the Theia Browser sends a X-Kairo-Workspace-Id
// header with the upgrade request, and we forward it to the
// Manager before the bridge accepts frames.
func (s *jdtlsService) SetWorkspace(workspaceID string) {
	s.mgr.SetWorkspace(workspaceID)
}

// Bridge returns the WebSocket handler for the LSP frame
// bridge. The handler upgrades the HTTP request and runs the
// proxy loop until either side closes.
func (s *jdtlsService) Bridge() http.Handler {
	return s.bridge
}

// ----------------- JDTProjectGenerator (project model) -----------------
//
// The JDT LS needs an Eclipse-shaped project model on disk
// to produce Java language features. The Generator below
// reads .legacyflow/project.yaml and writes the model under
// the runtime data dir. See internal/jdtproject for the
// schema and the XML/INI renderers.

type jdtprojectService struct {
	gen *jdtproject.Generator
}

func newJDTProjectService(dataDir, bundled string, logger *log.Logger) *jdtprojectService {
	g := jdtproject.NewGenerator(dataDir, bundled)
	g.Logger = func(msg string, fields map[string]any) {
		if logger != nil {
			logger.Info(msg, log.Fields(fields))
		}
	}
	return &jdtprojectService{gen: g}
}

func (s *jdtprojectService) Generate(payload json.RawMessage) (json.RawMessage, error) {
	res, err := s.gen.Generate(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(res)
}

func (s *jdtprojectService) Status(workspaceID string) (json.RawMessage, error) {
	st, err := s.gen.Status(workspaceID)
	if err != nil {
		return nil, err
	}
	return json.Marshal(st)
}

// jdtlsStatus is the JSON shape /api/v1/jdtls GET returns. We
// keep the field set small and stable so the UI can rely on it.
type jdtlsStatus struct {
	State        string `json:"state"` // stopped|starting|running|stopping|crashed
	Pid          int    `json:"pid,omitempty"`
	Version      string `json:"version,omitempty"`
	StartedAt    string `json:"startedAt,omitempty"`
	StoppedAt    string `json:"stoppedAt,omitempty"`
	JRE          string `json:"jre,omitempty"`
	Jar          string `json:"jar,omitempty"`
	SourceLevel  string `json:"sourceLevel,omitempty"`
	LastError    string `json:"lastError,omitempty"`
	InitializeOK bool   `json:"initializeOk"`
}

func (s *jdtlsService) Status() (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := jdtlsStatus{
		State:       s.mgr.State(),
		Version:     jdtls.JDTLSVersion,
		JRE:         s.mgr.JREPath(),
		SourceLevel: s.sourceLvl,
		LastError:   s.mgr.LastError(),
	}
	if last := s.mgr.LastStart(); last != nil {
		st.Pid = last.Pid
		st.StartedAt = last.StartedAt
		st.Jar = last.Jar
		st.InitializeOK = last.InitializeOK
	}
	return json.Marshal(st)
}

func (s *jdtlsService) Start(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		JREPath           string `json:"jrePath"`
		SourceLevel       string `json:"sourceLevel"`
		InitializeRootURI string `json:"initializeRootURI"`
		TimeoutMs         int    `json:"timeoutMs"`
	}
	if len(payload) > 0 {
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid start payload: %w", err)
		}
	}
	if req.SourceLevel == "" {
		req.SourceLevel = s.sourceLvl
	}
	timeout := 30 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	s.mu.Lock()
	if req.JREPath != "" {
		s.mgr.SetJREPath(req.JREPath)
	}
	s.sourceLvl = req.SourceLevel
	mu := s.mgr // keep a ref for after the unlock
	s.mu.Unlock()

	st, err := mu.Start(ctx)
	if err != nil {
		return nil, err
	}
	// Send the LSP `initialize` request. The response is the
	// signal the UI waits for: only after we get it back do we
	// claim the LS is `running` and ready for documents.
	caps := json.RawMessage(`{}`)
	if req.InitializeRootURI != "" {
		initResp, ierr := mu.Initialize(ctx, req.InitializeRootURI, caps)
		_ = initResp // body not used here; presence of a non-error response is the signal
		if ierr != nil {
			// Initialize failed. Tear the process down so the
			// agent's state is honest: either it is "ready" with
			// an initialized LS, or it is "stopped" again. We
			// refuse to leave it in a half-initialized "running"
			// state, because the UI would then think
			// completion/hover work when they actually do not.
			_ = mu.Stop(ctx)
			return nil, fmt.Errorf("jdtls initialize failed: %w", ierr)
		}
		mu.MarkInitialized()
	}
	out := jdtlsStatus{
		State:        mu.State(),
		Pid:          st.Pid,
		Version:      st.Version,
		StartedAt:    st.StartedAt,
		JRE:          st.Jre,
		Jar:          st.Jar,
		SourceLevel:  s.sourceLvl,
		InitializeOK: req.InitializeRootURI != "",
	}
	return json.Marshal(out)
}

func (s *jdtlsService) Stop() (json.RawMessage, error) {
	s.mu.Lock()
	mu := s.mgr
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := mu.Stop(ctx); err != nil {
		return nil, err
	}
	return json.Marshal(jdtlsStatus{
		State:     mu.State(),
		Version:   jdtls.JDTLSVersion,
		StoppedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// ----------------- helpers -----------------

func shortID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

var _ = exec.Command
var _ = strconv.Itoa
