package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
	mu               sync.Mutex
	dataDir          string
	bundledDir       string
	tomcat6Home      string
	logger           *log.Logger
	instances        map[string]*tomcat6.Instance
	meta             map[string]*serverMeta
	ports            *runtimeplan.DefaultPortAllocator
	defaultHTTPPort  int
	defaultDebugPort int
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
	WasRunning   bool           `json:"wasRunning,omitempty"`
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

func newRealServerRunner(dataDir, bundledDir, tomcat6Home string, logger *log.Logger, defaultHTTPPort, defaultDebugPort int) *realServerRunner {
	r := &realServerRunner{
		dataDir:          dataDir,
		bundledDir:       bundledDir,
		tomcat6Home:      tomcat6Home,
		logger:           logger,
		instances:        map[string]*tomcat6.Instance{},
		meta:             map[string]*serverMeta{},
		ports:            runtimeplan.NewDefaultPortAllocator(runtimeplan.DefaultPortConfig()),
		defaultHTTPPort:  defaultHTTPPort,
		defaultDebugPort: defaultDebugPort,
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
	recoveryCount := 0
	for _, m := range items {
		// On agent restart, every server that was previously
		// persisted as "running" has been orphaned (the agent
		// process died or was forcefully terminated). Mark
		// them as "crashed" so the UI can offer recovery.
		if m.State == "running" || m.State == "starting" {
			m.State = "crashed"
			m.LastError = "Agent was restarted or crashed while server was running"
			m.WasRunning = true
			recoveryCount++
		}
		r.meta[m.ID] = m
	}
	if recoveryCount > 0 {
		r.save()
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

	// A debug port is meaningful only when JDWP is explicitly requested.
	// Accepting an explicit debugPort/suspend flag also opts in for backwards
	// compatibility with advanced callers.
	debugEnabled := req.Debug || req.DebugPort > 0 || req.DebugSuspend
	// KAIRO-RC-WEB-2026-07-26: when the caller does not supply a port,
	// fall back to configured defaults so isolated test environments can
	// pin Tomcat/JDWP to predictable ports (e.g. K4 uses 18302/18303).
	if req.HTTPPort <= 0 && r.defaultHTTPPort > 0 {
		req.HTTPPort = r.defaultHTTPPort
	}
	if debugEnabled && req.DebugPort <= 0 && r.defaultDebugPort > 0 {
		req.DebugPort = r.defaultDebugPort
	}
	lease, err := r.ports.AllocateServer(req.HTTPPort, req.ShutdownPort, req.DebugPort, debugEnabled)
	if err != nil {
		return nil, fmt.Errorf("allocate ports: %w", err)
	}
	// Keep reservations through the blocking startup probe, then release the
	// allocator bookkeeping. Bound listeners provide the authoritative guard
	// afterwards; retaining leases forever would exhaust the finite ranges.
	defer lease.Release()
	req.HTTPPort = lease.HTTPPort
	req.ShutdownPort = lease.ShutdownPort
	req.DebugPort = lease.DebugPort
	if !debugEnabled {
		req.DebugSuspend = false
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
		Env:          req.Env,
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

func (r *realServerRunner) DeploymentTarget(projectID string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.meta {
		if m.ProjectID == projectID && m.State == "running" {
			name := strings.TrimPrefix(m.ContextPath, "/")
			if name == "" { name = "ROOT" }
			return filepath.Join(m.CatalinaBase, "webapps", name), nil
		}
	}
	return "", fmt.Errorf("no running server for project %s", projectID)
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
		lease, err := r.ports.AllocateServer(0, 0, debugPort, debugPort > 0)
		if err != nil {
			return nil, fmt.Errorf("allocate ports: %w", err)
		}
		defer lease.Release()
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

// Recoverable returns servers that were running when the agent
// last exited (crashed or was forcefully terminated). These are
// candidates for the recovery flow.
func (r *realServerRunner) Recoverable() []*api.ServerResponse {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []*api.ServerResponse
	for _, m := range r.meta {
		if m.State == "crashed" && m.WasRunning {
			result = append(result, m.toResponse())
		}
	}
	return result
}

// Recover attempts to re-launch a crashed server by its ID.
// It uses the stored metadata (JavaHome, CatalinaBase, WebappDir,
// ContextPath, etc.) to re-start the server. If the previous ports
// are still bound, fresh ports are allocated.
func (r *realServerRunner) Recover(id string) (*api.ServerResponse, error) {
	r.mu.Lock()
	m, ok := r.meta[id]
	r.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	if m.State != "crashed" {
		return nil, fmt.Errorf("server %s is not in crashed state (current: %s)", id, m.State)
	}
	if m.JavaHome == "" || m.CatalinaBase == "" {
		return nil, errors.New("server is missing recovery metadata")
	}
	if m.Ports == nil {
		return nil, errors.New("server metadata missing ports; cannot recover")
	}

	var httpPort, shutdownPort, debugPort int
	httpPort = m.Ports.HTTP
	shutdownPort = m.Ports.Shutdown
	debugPort = m.Ports.Debug

	// If the old ports are still bound, allocate fresh ones
	if httpPort == 0 || tomcat6.IsPortBound(httpPort) || tomcat6.IsPortBound(shutdownPort) {
		lease, err := r.ports.AllocateServer(0, 0, debugPort, debugPort > 0)
		if err != nil {
			return nil, fmt.Errorf("allocate ports for recovery: %w", err)
		}
		defer lease.Release()
		httpPort = lease.HTTPPort
		shutdownPort = lease.ShutdownPort
		debugPort = lease.DebugPort
	}

	m.WasRunning = false
	inst, err := tomcat6.Start(context.Background(), tomcat6.Spec{
		ID:           id,
		JavaHome:     m.JavaHome,
		CatalinaHome: r.tomcat6Home,
		CatalinaBase: m.CatalinaBase,
		HTTPPort:     httpPort,
		ShutdownPort: shutdownPort,
		DebugPort:    debugPort,
		ContextPath:  m.ContextPath,
		WebappDir:    m.WebappDir,
		Logger:       r.logger,
	})
	if err != nil {
		m.State = "error"
		m.LastError = fmt.Sprintf("recovery failed: %v", err)
		r.mu.Lock()
		r.save()
		r.mu.Unlock()
		return nil, err
	}
	ports := inst.Ports()
	m.PID = inst.PID()
	m.Ports = &ports
	m.State = inst.State()
	m.StartedAt = inst.StartedAt()
	m.LastError = ""
	r.mu.Lock()
	r.instances[id] = inst
	r.save()
	r.mu.Unlock()
	return m.toResponse(), nil
}

// ReloadContext triggers a Tomcat context reload by touching
// WEB-INF/web.xml. The server must be running.
func (r *realServerRunner) ReloadContext(id string) error {
	r.mu.Lock()
	m, ok := r.meta[id]
	r.mu.Unlock()
	if !ok {
		return fmt.Errorf("server not found: %s", id)
	}
	if m.State != "running" {
		return fmt.Errorf("server %s is not running (current: %s)", id, m.State)
	}
	webXML := filepath.Join(m.WebappDir, "WEB-INF", "web.xml")
	now := time.Now()
	if err := os.Chtimes(webXML, now, now); err != nil {
		return fmt.Errorf("touch web.xml for context reload: %w", err)
	}
	return nil
}

// defaultLogTail is the number of lines returned by Logs when the
// caller does not pass an explicit ?tail=N.
const (
	defaultLogTail     = 500
	maxLogTail         = 5000
	maxLogFiles        = 32
	maxLogBytesPerFile = 2 * 1024 * 1024
	maxLogBytesTotal   = 8 * 1024 * 1024
)

// Logs returns the combined tail of regular files in <catalinaBase>/logs.
// Reading the persisted files works for running and stopped servers alike;
// it includes both Tomcat startup output and access-log traffic.
func (r *realServerRunner) Logs(id string, tail int) ([]api.ServerLogEntry, error) {
	if tail <= 0 {
		tail = defaultLogTail
	}
	if tail > maxLogTail {
		tail = maxLogTail
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
	// Tomcat records actual HTTP traffic in localhost_access_log.* rather than
	// stdout. Read only bounded tails of regular, non-symlink files so a long
	// running server cannot force a full multi-gigabyte read or escape logs/.
	type logFile struct {
		name    string
		modTime time.Time
	}
	files := make([]logFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			continue
		}
		files = append(files, logFile{name: entry.Name(), modTime: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].modTime.Equal(files[j].modTime) {
			return files[i].name < files[j].name
		}
		return files[i].modTime.Before(files[j].modTime)
	})
	if len(files) > maxLogFiles {
		files = files[len(files)-maxLogFiles:]
	}
	type logChunk struct {
		name       string
		timestamp  string
		data       []byte
		baseOffset int64
	}
	var chunks []logChunk
	remainingBytes := int64(maxLogBytesTotal)
	for i := len(files) - 1; i >= 0; i-- {
		if remainingBytes <= 0 {
			break
		}
		file := files[i]
		limit := int64(maxLogBytesPerFile)
		if limit > remainingBytes {
			limit = remainingBytes
		}
		data, baseOffset, readErr := readRegularFileTail(filepath.Join(logDir, file.name), limit)
		if readErr != nil {
			continue
		}
		remainingBytes -= int64(len(data))
		chunks = append(chunks, logChunk{name: file.name, timestamp: file.modTime.UTC().Format(time.RFC3339Nano), data: data, baseOffset: baseOffset})
	}
	var all []api.ServerLogEntry
	for i := len(chunks) - 1; i >= 0; i-- {
		chunk := chunks[i]
		for _, persisted := range splitLinesWithOrdinals(chunk.data, chunk.baseOffset) {
			line, stream := normalizePersistedLogLine(persisted.line)
			all = append(all, api.ServerLogEntry{Line: line, TS: chunk.timestamp, Stream: stream, Source: chunk.name, Ordinal: persisted.ordinal})
		}
	}
	if len(all) > tail {
		all = all[len(all)-tail:]
	}
	return all, nil
}

func normalizePersistedLogLine(line string) (string, string) {
	if strings.HasPrefix(line, "[stderr] ") {
		return strings.TrimPrefix(line, "[stderr] "), "stderr"
	}
	if strings.HasPrefix(line, "[stdout] ") {
		return strings.TrimPrefix(line, "[stdout] "), "stdout"
	}
	return line, "stdout"
}

func readRegularFileTail(path string, maxBytes int64) ([]byte, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, 0, fmt.Errorf("not a regular log file")
	}
	start := info.Size() - maxBytes
	if start <= 0 {
		data, readErr := io.ReadAll(io.LimitReader(f, maxBytes))
		return data, 0, readErr
	}
	// Include one preceding byte and discard through the next newline so the
	// returned tail never begins with a partial line.
	if _, err := f.Seek(start-1, io.SeekStart); err != nil {
		return nil, 0, err
	}
	data, err := io.ReadAll(io.LimitReader(f, maxBytes+1))
	if err != nil {
		return nil, 0, err
	}
	if newline := bytes.IndexByte(data, '\n'); newline >= 0 {
		return data[newline+1:], start + int64(newline), nil
	}
	return nil, info.Size(), nil
}

type persistedLogLine struct {
	line    string
	ordinal int64
}

func splitLinesWithOrdinals(data []byte, baseOffset int64) []persistedLogLine {
	var out []persistedLogLine
	start := 0
	for i, b := range data {
		if b == '\n' {
			out = append(out, persistedLogLine{line: string(data[start:i]), ordinal: baseOffset + int64(start)})
			start = i + 1
		}
	}
	if start < len(data) {
		out = append(out, persistedLogLine{line: string(data[start:]), ordinal: baseOffset + int64(start)})
	}
	return out
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
