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
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/runtimeplan"
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
	ports       *runtimeplan.DefaultPortAllocator
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
		ports:       runtimeplan.NewDefaultPortAllocator(runtimeplan.DefaultPortConfig()),
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

	// KAIRO-RC-WEB-246: auto-allocate ports when the caller does not
	// pin them — the UI sends only {projectId}, and failing with
	// "http port is required" is useless to a user who never heard
	// of ports.
	if req.HTTPPort == 0 {
		lease, err := r.ports.Allocate(0, req.ShutdownPort, req.DebugPort)
		if err != nil {
			return nil, fmt.Errorf("allocate ports: %w", err)
		}
		req.HTTPPort = lease.HTTPPort
		req.ShutdownPort = lease.ShutdownPort
		req.DebugPort = lease.DebugPort
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

// Restart stops the server (gracefully, falling back to a force
// stop) and starts it again with the same stored parameters
// (projectId, webappDir, contextPath, javaHome, catalinaBase).
// The previous ports are reused when they are free after the
// stop; if the old HTTP or shutdown port is still bound, fresh
// ports are taken from the allocator instead.
func (r *realServerRunner) Restart(id string) (*api.ServerResponse, error) {
	r.mu.Lock()
	inst := r.instances[id]
	m := r.meta[id]
	r.mu.Unlock()
	if m == nil {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	if m.JavaHome == "" || m.CatalinaBase == "" {
		return nil, errors.New("server is missing restart metadata")
	}
	if inst != nil {
		if err := inst.Stop(15 * time.Second); err != nil {
			if ferr := inst.ForceStop(); ferr != nil {
				m.State = "error"
				m.LastError = ferr.Error()
				r.mu.Lock()
				r.save()
				r.mu.Unlock()
				return nil, fmt.Errorf("stop server %s: %w (force stop: %v)", id, err, ferr)
			}
		}
		r.mu.Lock()
		delete(r.instances, id)
		r.mu.Unlock()
	}
	var httpPort, shutdownPort, ajpPort, debugPort int
	if m.Ports != nil {
		httpPort = m.Ports.HTTP
		shutdownPort = m.Ports.Shutdown
		ajpPort = m.Ports.AJP
		debugPort = m.Ports.Debug
	}
	if httpPort == 0 || tomcat6.IsPortBound(httpPort) || tomcat6.IsPortBound(shutdownPort) {
		lease, err := r.ports.Allocate(0, 0, 0)
		if err != nil {
			return nil, fmt.Errorf("allocate ports: %w", err)
		}
		httpPort = lease.HTTPPort
		shutdownPort = lease.ShutdownPort
		debugPort = lease.DebugPort
		ajpPort = 0
	} else if debugPort != 0 && tomcat6.IsPortBound(debugPort) {
		if p, err := pickFreePort(); err == nil {
			debugPort = p
		} else {
			debugPort = 0
		}
	}
	newInst, err := tomcat6.Start(context.Background(), tomcat6.Spec{
		ID:           id,
		JavaHome:     m.JavaHome,
		CatalinaHome: r.tomcat6Home,
		CatalinaBase: m.CatalinaBase,
		HTTPPort:     httpPort,
		ShutdownPort: shutdownPort,
		AJPPort:      ajpPort,
		DebugPort:    debugPort,
		ContextPath:  m.ContextPath,
		WebappDir:    m.WebappDir,
		Logger:       r.logger,
	})
	if err != nil {
		m.State = "error"
		m.LastError = err.Error()
		r.mu.Lock()
		r.save()
		r.mu.Unlock()
		return nil, err
	}
	ports := newInst.Ports()
	m.PID = newInst.PID()
	m.Ports = &ports
	m.State = newInst.State()
	m.StartedAt = newInst.StartedAt()
	m.LastError = ""
	r.mu.Lock()
	r.instances[id] = newInst
	r.save()
	r.mu.Unlock()
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

// defaultLogTail is the number of lines returned by Logs when the
// caller does not pass an explicit ?tail=N.
const defaultLogTail = 500

// Logs returns the combined tail of regular files in <catalinaBase>/logs.
// Reading the persisted files works for running and stopped servers alike;
// it includes both Tomcat startup output and access-log traffic.
func (r *realServerRunner) Logs(id string, tail int) ([]api.ServerLogEntry, error) {
	if tail <= 0 {
		tail = defaultLogTail
	}
	r.mu.Lock()
	m, ok := r.meta[id]
	r.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	logDir := filepath.Join(m.CatalinaBase, "logs")
	entries, err := os.ReadDir(logDir)
	if err != nil {
		return []api.ServerLogEntry{}, nil
	}
	// Tomcat records actual HTTP traffic in localhost_access_log.* rather
	// than stdout. Combine regular log files so the live viewer contains both
	// startup output and requests made after the server is ready.
	var all []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(logDir, entry.Name()))
		if readErr == nil {
			all = append(all, splitLines(string(data), 0)...)
		}
	}
	if len(all) > tail {
		all = all[len(all)-tail:]
	}
	lines := all
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
	if max > 0 && len(out) > max {
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
