package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/tomcat6"
)

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

// toResponse maps the persisted serverMeta to the safe API
// response shape. Sensitive fields are dropped by construction.
func (m *serverMeta) toResponse() *api.ServerResponse {
	if m == nil {
		return nil
	}
	resp := &api.ServerResponse{
		ID:          m.ID,
		ProjectID:   m.ProjectID,
		Type:        m.Type,
		State:       m.State,
		PID:         m.PID,
		StartedAt:   m.StartedAt,
		ContextPath: m.ContextPath,
		LastError:   m.LastError,
	}
	if m.Ports != nil {
		resp.Ports = &api.ServerPorts{
			HTTP:  m.Ports.HTTP,
			Debug: m.Ports.Debug,
		}
		if m.Ports.HTTP > 0 {
			resp.URL = fmt.Sprintf("http://localhost:%d%s",
				m.Ports.HTTP, m.ContextPath)
		}
	}
	return resp
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

// CatalinaHome implements api.ServerRunner.
func (r *realServerRunner) CatalinaHome() string { return r.tomcat6Home }

func (r *realServerRunner) save() {
	items := make([]*serverMeta, 0, len(r.meta))
	for _, m := range r.meta {
		items = append(items, m)
	}
	data, _ := json.MarshalIndent(items, "", "  ")
	_ = atomicfile.WriteFile(filepath.Join(r.dataDir, "servers.json"), data, 0o600)
}

func (r *realServerRunner) Start(req api.StartServerRequest) (*api.ServerResponse, error) {
	if r.tomcat6Home == "" {
		return nil, errors.New("Tomcat 6 not bundled; set KAIRO_TOMCAT6_HOME or run scripts/fetch-tomcat6.sh")
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
		ID:           id,
		JavaHome:     req.JavaHome,
		CatalinaHome: r.tomcat6Home,
		CatalinaBase: base,
		HTTPPort:     req.HTTPPort,
		ShutdownPort: req.ShutdownPort,
		AJPPort:      req.AJPPort,
		DebugPort:    req.DebugPort,
		DebugSuspend: req.DebugSuspend,
		ContextPath:  req.ContextPath,
		WebappDir:    req.WebappDir,
		JVMOptions:   req.JVMOptions,
		Logger:       r.logger,
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
	return meta.toResponse(), nil
}

func (r *realServerRunner) Get(id string) (*api.ServerResponse, error) {
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
	return m.toResponse(), nil
}

func (r *realServerRunner) List() []*api.ServerResponse {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]*api.ServerResponse, 0, len(r.meta))
	for _, m := range r.meta {
		if inst, ok := r.instances[m.ID]; ok {
			m.State = inst.State()
			m.PID = inst.PID()
		}
		items = append(items, m.toResponse())
	}
	return items
}

func (r *realServerRunner) Stop(id string, force bool) (*api.ServerResponse, error) {
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
	if force {
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
		return &api.ServerResponse{ID: id, State: "stopped"}, nil
	}
	return m.toResponse(), nil
}

func (r *realServerRunner) Debug(id string) (*api.ServerResponse, error) {
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
		ID:           id,
		JavaHome:     m.JavaHome,
		CatalinaHome: r.tomcat6Home,
		CatalinaBase: m.CatalinaBase,
		HTTPPort:     m.Ports.HTTP,
		ShutdownPort: m.Ports.Shutdown,
		AJPPort:      m.Ports.AJP,
		DebugPort:    debugPort,
		ContextPath:  m.ContextPath,
		WebappDir:    m.WebappDir,
		Logger:       r.logger,
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
	return m.toResponse(), nil
}

func (r *realServerRunner) Logs(id string, follow bool) ([]api.ServerLogEntry, error) {
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
			return []api.ServerLogEntry{}, nil
		}
		lines := splitLines(string(data), 200)
		out := make([]api.ServerLogEntry, 0, len(lines))
		now := time.Now().UTC().Format(time.RFC3339Nano)
		for _, l := range lines {
			out = append(out, api.ServerLogEntry{Line: l, TS: now})
		}
		return out, nil
	}
	lines, err := inst.TailLog(200)
	if err != nil {
		return []api.ServerLogEntry{}, nil
	}
	out := make([]api.ServerLogEntry, 0, len(lines))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, l := range lines {
		out = append(out, api.ServerLogEntry{Line: l, TS: now})
	}
	return out, nil
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
