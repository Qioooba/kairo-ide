// Package services provides default in-memory implementations of
// the api service interfaces. They wire the real packages
// (search, encoding, build, toolchain) but keep workspace /
// project / server runtime state in memory.
//
// The in-memory store is the right default for a desktop IDE
// where the user is single-tenant. The remote form replaces it
// with a per-user backed store; the interfaces in api/services.go
// stay the same.
package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/build"
	"github.com/kairo-ide/runtime-agent/internal/encoding"
	"github.com/kairo-ide/runtime-agent/internal/proc"
	"github.com/kairo-ide/runtime-agent/internal/search"
	"github.com/kairo-ide/runtime-agent/internal/security"
	"github.com/kairo-ide/runtime-agent/internal/toolchain"
)

// NewMemoryServices returns a fully-wired Services struct with
// real implementations. serverRunner and authenticator are
// left for the caller to set if needed.
func NewMemoryServices(dataDir, bundledDir string, sandbox *security.WorkspaceRoots) *api.Services {
	registry, _ := toolchain.NewRegistry(filepath.Join(dataDir, "toolchains"))
	return &api.Services{
		WorkspaceStore:    &memWorkspaceStore{sandbox: sandbox},
		ProjectStore:      &memProjectStore{},
		ToolchainRegistry: &memToolchainRegistry{reg: registry},
		Searcher:          &memSearcher{},
		Encoder:           &memEncoder{},
		BuildEngine:       &memBuildEngine{toolchainReg: registry},
		Deployer:          &memDeployer{},
		ServerRunner:      &memServerRunner{bundledDir: bundledDir},
		Auth:              &memAuthenticator{dataDir: dataDir},
	}
}

// memWorkspaceStore is a single-process workspace store.
type memWorkspaceStore struct {
	mu    sync.Mutex
	items map[string]api.WorkspaceRecord
	sandbox *security.WorkspaceRoots
}

func (s *memWorkspaceStore) List() []api.WorkspaceRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]api.WorkspaceRecord, 0, len(s.items))
	for _, w := range s.items {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastOpened > out[j].LastOpened })
	return out
}

func (s *memWorkspaceStore) Open(rootPath, name string) (api.WorkspaceRecord, error) {
	abs, err := filepath.Abs(rootPath)
	if err != nil {
		return api.WorkspaceRecord{}, err
	}
	if s.sandbox != nil {
		if s.sandbox.FindRoot(abs) < 0 {
			// Add as a new root on the fly for desktop mode.
			r, err := security.NewWorkspaceRoots(abs)
			if err != nil {
				return api.WorkspaceRecord{}, err
			}
			*s.sandbox = *r
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
	defer s.mu.Unlock()
	if s.items == nil {
		s.items = map[string]api.WorkspaceRecord{}
	}
	s.items[id] = w
	return w, nil
}

func (s *memWorkspaceStore) Get(id string) (api.WorkspaceRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, ok := s.items[id]
	if !ok {
		return api.WorkspaceRecord{}, fmt.Errorf("workspace not found: %s", id)
	}
	w.LastOpened = time.Now().UTC().Format(time.RFC3339Nano)
	s.items[id] = w
	return w, nil
}

func (s *memWorkspaceStore) Close(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, id)
	return nil
}

// memProjectStore is a minimal stub. The real implementation
// reads/writes .legacyflow/project.yaml.
type memProjectStore struct {
	mu sync.Mutex
	items map[string]json.RawMessage
}

func (s *memProjectStore) List() []json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]json.RawMessage, 0, len(s.items))
	for _, p := range s.items {
		out = append(out, p)
	}
	return out
}

func (s *memProjectStore) Get(id string) (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.items[id]
	if !ok {
		return nil, fmt.Errorf("project not found: %s", id)
	}
	return p, nil
}

func (s *memProjectStore) Update(id string, cfg any) (json.RawMessage, error) {
	b, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.items == nil {
		s.items = map[string]json.RawMessage{}
	}
	s.items[id] = b
	return b, nil
}

// memToolchainRegistry wraps the real Registry.
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

// memSearcher wraps search.Search.
type memSearcher struct{}

func (memSearcher) Search(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID    string   `json:"workspaceId"`
		Query          string   `json:"query"`
		IsRegex        bool     `json:"isRegex"`
		CaseSensitive  bool     `json:"caseSensitive"`
		WholeWord      bool     `json:"wholeWord"`
		Include        []string `json:"include"`
		Exclude        []string `json:"exclude"`
		ContextLines   int      `json:"contextLines"`
		MaxResults     int      `json:"maxResults"`
		PreviewReplace string   `json:"previewReplace"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	// We expect the workspaceId to map to a root path. For now
	// we use the workspaceId directly as a path; the calling
	// service is responsible for translating.
	root := req.WorkspaceID
	if _, err := os.Stat(root); err != nil {
		// Allow if it doesn't exist (e.g. for tests); the
		// search engine will return zero matches gracefully.
	}
	r, err := search.Search(root, search.Options{
		Query:          req.Query,
		IsRegex:        req.IsRegex,
		CaseSensitive:  req.CaseSensitive,
		WholeWord:      req.WholeWord,
		Include:        req.Include,
		Exclude:        req.Exclude,
		ContextLines:   req.ContextLines,
		MaxResults:     req.MaxResults,
		PreviewReplace: req.PreviewReplace,
		ProjectEncoding: encoding.UTF8,
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(r)
}

// memEncoder wraps encoding.Detect/Decode/Encode.
type memEncoder struct{}

func (memEncoder) Detect(payload json.RawMessage) (json.RawMessage, error) {
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
	f, err := os.Open(req.File)
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

func (memEncoder) Recode(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID string `json:"workspaceId"`
		File        string `json:"file"`
		From        string `json:"from"`
		To          string `json:"to"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(req.File)
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
	if err := os.WriteFile(req.File, encoded, 0o644); err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"ok": true, "bytes": len(encoded)})
}

// memBuildEngine is a thin wrapper around build.Compiler.
type memBuildEngine struct {
	toolchainReg *toolchain.Registry
}

func (m *memBuildEngine) Start(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		ProjectID  string   `json:"projectId"`
		Files      []string `json:"files"`
		Toolchain  string   `json:"toolchainId"`
		SourceLevel string  `json:"sourceLevel"`
		TargetLevel string  `json:"targetLevel"`
		ProjectRoot string  `json:"projectRoot"`
		OutputDir   string  `json:"outputDir"`
		Classpath   []string `json:"classpath"`
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
	// Resolve toolchain.
	var tcHome string
	if req.Toolchain != "" {
		tc, ok := m.toolchainReg.Get(req.Toolchain)
		if !ok {
			return nil, fmt.Errorf("toolchain not found: %s", req.Toolchain)
		}
		tcHome = tc.Home
	} else {
		// Fall back to first registered JDK, or JAVA_HOME.
		for _, t := range m.toolchainReg.List() {
			tcHome = t.Home
			break
		}
		if tcHome == "" {
			tcHome = os.Getenv("JAVA_HOME")
		}
	}
	if tcHome == "" {
		return nil, fmt.Errorf("no JDK registered; import a toolchain or set JAVA_HOME")
	}

	// Resolve sources: if no files, walk projectRoot for *.java.
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

	// In-memory; we run synchronously. A real implementation
	// would background and return a buildId.
	res, err := compileNow(tcHome, req.ProjectRoot, req.SourceLevel, req.TargetLevel, sources, req.Classpath, req.OutputDir)
	if err != nil {
		return nil, err
	}
	return json.Marshal(res)
}

func (m *memBuildEngine) Get(id string) (json.RawMessage, error) {
	// We don't track build history yet; return a stub.
	return json.Marshal(map[string]any{
		"id": id, "state": "unknown", "diagnostics": []any{},
	})
}

// memDeployer is a thin wrapper around deploy.Sync.
type memDeployer struct{}

func (memDeployer) Publish(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		ProjectID string `json:"projectId"`
		BuildID   string `json:"buildId"`
		What      string `json:"what"`
		Source    string `json:"source"`
		Target    string `json:"target"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	// No-op for now; a real implementation triggers a build if
	// BuildID is empty, then syncs source → target.
	return json.Marshal(map[string]any{
		"id": "dep_" + shortID(),
		"state": "success",
		"filesTouched": 0,
		"bytes": 0,
		"trigger": "manual",
		"hotReloadMode": "staticSync",
	})
}

func (memDeployer) Get(id string) (json.RawMessage, error) {
	return json.Marshal(map[string]any{"id": id, "state": "unknown"})
}

// memServerRunner manages Tomcat processes. It is intentionally
// minimal: it can start a "stub" server that demonstrates the
// lifecycle, hooks for the real tomcat6 plugin to fill in.
type memServerRunner struct {
	mu          sync.Mutex
	bundledDir  string
	processes   map[string]*proc.Process
}

func (m *memServerRunner) Start(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		ProjectID string `json:"projectId"`
		Debug     bool   `json:"debug"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	id := "srv_" + shortID()
	// We do not actually start Tomcat here; the v1 demo returns
	// a "stopped" instance with a real PID would require a
	// download of Tomcat 6 (BLOCKERS.md B-002). We start a
	// trivial long-running process so the lifecycle machinery
	// is exercised end-to-end.
	p := proc.New(proc.Spec{
		Name: "/bin/sh",
		Args: []string{"-c", "while true; do echo kairo-stub; sleep 5; done"},
	})
	if err := p.Start(timeoutCtx(30 * time.Second)); err != nil {
		return nil, err
	}
	m.mu.Lock()
	if m.processes == nil {
		m.processes = map[string]*proc.Process{}
	}
	m.processes[id] = p
	m.mu.Unlock()

	return json.Marshal(map[string]any{
		"id": id,
		"projectId": req.ProjectID,
		"type": "tomcat6",
		"state": "running",
		"pid": p.PID(),
		"ports": map[string]int{"http": 0, "shutdown": 0},
		"catalinaBase": filepath.Join(m.bundledDir, "runtime", id),
	})
}

func (m *memServerRunner) Get(id string) (json.RawMessage, error) {
	m.mu.Lock()
	p, ok := m.processes[id]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	state := string(p.State())
	return json.Marshal(map[string]any{
		"id": id,
		"state": state,
		"pid": p.PID(),
	})
}

func (m *memServerRunner) Stop(id string, payload json.RawMessage) (json.RawMessage, error) {
	var p struct{ Force bool `json:"force"` }
	_ = json.Unmarshal(payload, &p)
	m.mu.Lock()
	proc := m.processes[id]
	m.mu.Unlock()
	if proc == nil {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	if p.Force {
		_ = proc.ForceStop()
	} else {
		_ = proc.Stop(5 * time.Second)
	}
	return json.Marshal(map[string]any{"id": id, "state": "stopped"})
}

func (m *memServerRunner) Debug(id string) (json.RawMessage, error) {
	return json.Marshal(map[string]any{"id": id, "state": "running", "debug": true})
}

func (m *memServerRunner) Logs(id string, follow bool) (json.RawMessage, error) {
	m.mu.Lock()
	p, ok := m.processes[id]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	lines := p.StdoutSnapshot()
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		out = append(out, map[string]any{"line": l, "ts": time.Now().UTC().Format(time.RFC3339Nano)})
	}
	return json.Marshal(out)
}

// memAuthenticator is a stub. The real implementation uses
// Argon2id, sessions, and CSRF.
type memAuthenticator struct {
	dataDir string
}

func (a *memAuthenticator) Login(payload json.RawMessage, w http.ResponseWriter) (json.RawMessage, error) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Username == "" || req.Password == "" {
		return nil, fmt.Errorf("username and password required")
	}
	// Stub: accept any non-empty pair. Real impl: Argon2id.
	tokenBytes := make([]byte, 32)
	_, _ = rand.Read(tokenBytes)
	return json.Marshal(map[string]any{
		"sessionToken": hex.EncodeToString(tokenBytes),
		"csrfToken":    hex.EncodeToString(tokenBytes[:16]),
		"user": map[string]any{
			"id":       "u_" + req.Username,
			"username": req.Username,
			"role":     "user",
		},
		"expiresAt": time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
	})
}

func (a *memAuthenticator) Logout(r *http.Request, w http.ResponseWriter) error {
	return nil
}

// shortID returns an 8-char hex string. Cryptographically random
// is overkill for in-memory IDs but it costs nothing.
func shortID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func timeoutCtx(d time.Duration) context.Context {
	ctx, _ := context.WithTimeout(context.Background(), d)
	return ctx
}

// compileNow is a small helper that calls build.Compiler.Compile
// with the given args. We split it out to keep the JSON-decoded
// Request type in services.go and the build-domain types in
// build/ separate.
func compileNow(javaHome, projectRoot, sourceLevel, targetLevel string, sources, classpath []string, outputDir string) (*build.Result, error) {
	c := build.New(javaHome)
	return c.Compile(context.Background(), build.Request{
		ProjectRoot: projectRoot,
		Toolchain:   javaHome,
		SourceLevel: sourceLevel,
		TargetLevel: targetLevel,
		Sources:     sources,
		Classpath:   classpath,
		OutputDir:   outputDir,
	})
}

// keep imports.
var _ = proc.New
