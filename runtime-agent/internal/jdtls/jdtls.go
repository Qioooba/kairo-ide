// Package jdtls manages the Eclipse JDT Language Server process
// that the Kairo IDE uses to provide Java language features
// (completion, hover, definition, references, diagnostics,
// outline).
//
// The JDT LS is distributed as a .tar.gz or .zip by the
// Eclipse Foundation. The distribution installer is in
// distribution.go; this file owns the runtime lifecycle:
//
//   - Start a JDT LS as a child process using the launcher
//     JAR and the host's config_<os>/ directory.
//   - Speak LSP over stdin/stdout using the Content-Length
//     framing the spec requires (NOT raw newline-JSON).
//   - Wait for the LSP `initialize` request to succeed before
//     declaring the LS ready. The Manager never reports
//     `running` and `initializeOk` together until both have
//     happened for real.
//   - Support stop, restart, and crash detection with a
//     bounded number of automatic restarts.
//
// The JDT LS requires a modern JRE (17 or 21). The runtime
// agent keeps this JRE separate from the user's
// `compilerJavaHome` and `tomcatJavaHome` so a JDT LS upgrade
// never touches the legacy project JDK.
package jdtls

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/log"
)

// Manager is the lifecycle owner for the JDT Language Server
// process. A single Manager is shared across all workspaces in
// a single agent process. The Bridge in bridge.go multiplexes
// the per-workspace channels on top of this single process.
type Manager struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	state   atomic.Int32
	logger  *log.Logger
	dataDir string
	bundled string
	jrePath string

	// Stderr capture
	stderrFile *os.File
	stderrPath string

	// Per-workspace data dir (e.g. dataDir/jdtls-workspace/<workspaceID>)
	workspace string

	// Frame channels
	stdin     io.WriteCloser
	stdoutBr  *bufio.Reader
	framesOut chan []byte
	framesIn  chan []byte

	// Lifecycle
	lastErr   string
	lastStart *Status

	// Crash recovery
	autoRestartBudget int
	restartCount      int

	// Listeners
	listeners []func(Event)
}

// Event is sent to listeners on lifecycle changes.
type Event struct {
	Type    string `json:"type"` // "state", "log", "error"
	State   string `json:"state,omitempty"`
	Message string `json:"message,omitempty"`
	Line    string `json:"line,omitempty"`
	At      string `json:"at,omitempty"`
}

// New creates a manager. The agent is not started yet.
func New(dataDir, bundled, jrePath string, logger *log.Logger) *Manager {
	return &Manager{
		logger:            logger,
		dataDir:           dataDir,
		bundled:           bundled,
		jrePath:           jrePath,
		framesOut:         make(chan []byte, 256),
		framesIn:          make(chan []byte, 256),
		autoRestartBudget: 3,
	}
}

// AddListener registers a callback for lifecycle events.
func (m *Manager) AddListener(fn func(Event)) {
	m.mu.Lock()
	m.listeners = append(m.listeners, fn)
	m.mu.Unlock()
}

// SetJREPath overrides the JRE that Start will use. Empty
// string is a no-op (Start then falls back to KAIRO_JRE17_HOME).
func (m *Manager) SetJREPath(p string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.jrePath = p
}

// SetAutoRestartBudget caps how many times the manager will
// auto-restart the JDT LS after a clean Stop. 0 disables
// auto-restart.
func (m *Manager) SetAutoRestartBudget(n int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.autoRestartBudget = n
}

// JREPath returns the JRE the manager will use on the next
// Start. Used by /api/v1/jdtls GET to render the status.
func (m *Manager) JREPath() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.jrePath
}

// LastError returns the most recent error event the manager
// observed. Used to surface crash reasons to the UI.
func (m *Manager) LastError() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastErr
}

// LastStart returns the metadata of the most recent successful
// Start, or nil if Start has not been called.
func (m *Manager) LastStart() *Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastStart == nil {
		return nil
	}
	cp := *m.lastStart
	return &cp
}

// MarkInitialized records that the LSP `initialize` handshake
// has completed. The next Status() call will reflect
// `initializeOk: true`.
func (m *Manager) MarkInitialized() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastStart != nil {
		m.lastStart.InitializeOK = true
	}
}

// SetWorkspace sets the per-workspace data dir used by the
// next Start. Each workspace must have its own data dir so
// Eclipse's .metadata does not get corrupted by overlapping
// indexes.
func (m *Manager) SetWorkspace(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id == "" {
		m.workspace = ""
		return
	}
	m.workspace = filepath.Join(m.dataDir, "jdtls-workspace", sanitizeID(id))
}

// Workspace returns the active workspace data dir.
func (m *Manager) Workspace() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.workspace
}

// sanitizeID is a defensive pass for workspace IDs that might
// contain path separators on disk (the runtime client uses
// ws_<short>, but external agents may pass arbitrary strings).
func sanitizeID(s string) string {
	s = filepath.Clean(s)
	s = strings.ReplaceAll(s, "..", "_")
	s = strings.ReplaceAll(s, string(os.PathSeparator), "_")
	s = strings.ReplaceAll(s, "/", "_")
	s = strings.ReplaceAll(s, `\`, "_")
	return s
}

// Status reports the current JDT LS state.
type Status struct {
	State        string `json:"state"`
	Pid          int    `json:"pid,omitempty"`
	Version      string `json:"version"`
	StartedAt    string `json:"startedAt,omitempty"`
	StoppedAt    string `json:"stoppedAt,omitempty"`
	Jre          string `json:"jre"`
	Jar          string `json:"jar,omitempty"`
	LauncherJAR  string `json:"launcherJar,omitempty"`
	Workspace    string `json:"workspace,omitempty"`
	SourceLevel  string `json:"sourceLevel,omitempty"`
	InitializeOK bool   `json:"initializeOk"`
	LastError    string `json:"lastError,omitempty"`
	RestartCount int    `json:"restartCount"`
}

// State returns the current state as a string. Includes the
// `crashed` terminal state in addition to stopped / starting
// / running / stopping.
func (m *Manager) State() string {
	switch m.state.Load() {
	case 1:
		return "starting"
	case 2:
		return "running"
	case 3:
		return "stopping"
	case 4:
		return "crashed"
	default:
		return "stopped"
	}
}

// EnsureInstalled returns the absolute paths the Manager will
// use to start the JDT LS. It is the public entry point for
// the distribution installer.
func (m *Manager) EnsureInstalled(ctx context.Context) (InstallReport, error) {
	return ensureInstalled(ctx, m.dataDir, m.bundled, m.jrePath, m.logf)
}

func (m *Manager) logf(msg string, fields map[string]any) {
	if m.logger == nil {
		return
	}
	m.logger.Info(msg, log.Fields(fields))
}

// Start launches the JDT LS as a child process. Returns the
// metadata that the UI / API needs to render the status, and
// only after the process is up.
//
// The function does NOT call the LSP `initialize` request
// itself. That handshake is the caller's job (it requires
// per-workspace root URIs and capabilities that the Manager
// should not assume). The Manager exposes `Initialize` for
// the LSP frame; `MarkInitialized` for the manager-level
// bookkeeping.
func (m *Manager) Start(ctx context.Context) (*Status, error) {
	// Accept restart from stopped (0), stopping (3) after a
	// concurrent Stop, and crashed (4). Refuse from starting
	// (1) and running (2).
	for from := int32(0); ; {
		cur := m.state.Load()
		if cur == from && m.state.CompareAndSwap(from, 1) {
			break
		}
		if cur == 1 || cur == 2 {
			return nil, fmt.Errorf("jdtls already in state %s", m.State())
		}
		from = cur
	}

	// Step 1: ensure the distribution is on disk.
	rep, err := m.EnsureInstalled(ctx)
	if err != nil {
		m.state.Store(0)
		return nil, err
	}
	hostCfg, err := hostConfigDir(rep.Home)
	if err != nil {
		m.state.Store(0)
		return nil, err
	}
	if st, err := os.Stat(hostCfg); err != nil || !st.IsDir() {
		m.state.Store(0)
		return nil, fmt.Errorf("jdtls: no config for this OS at %s", hostCfg)
	}

	// Step 2: pick a JRE.
	jre := m.jrePath
	if jre == "" {
		jre = os.Getenv("KAIRO_JRE17_HOME")
	}
	if jre == "" {
		m.state.Store(0)
		return nil, errors.New("JDT LS requires a JRE 17+; set KAIRO_JRE17_HOME or pass --jre17")
	}
	javaBin := filepath.Join(jre, "bin", "java")
	if _, err := os.Stat(javaBin); err != nil {
		m.state.Store(0)
		return nil, fmt.Errorf("JRE 17+ not found at %s", javaBin)
	}

	// Step 3: prepare the per-workspace data dir. If no
	// workspace has been chosen, fall back to a single shared
	// dir under dataDir/jdtls-workspace/default.
	ws := m.workspace
	if ws == "" {
		ws = filepath.Join(m.dataDir, "jdtls-workspace", "default")
	}
	if err := os.MkdirAll(ws, 0o755); err != nil {
		m.state.Store(0)
		return nil, err
	}

	// Step 4: open a per-run stderr capture. The file is
	// appended to so log/history survives a crash; the file
	// name is unique to this pid so a second start that
	// happens to reuse the workspace gets a fresh tail.
	stderrPath := filepath.Join(ws, fmt.Sprintf("jdtls-stderr-%d.log", time.Now().UnixNano()))
	stderrF, err := os.OpenFile(stderrPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		m.state.Store(0)
		return nil, err
	}

	// Step 5: build the launcher command. The Equinox
	// launcher wants -configuration <config_dir> to find the
	// right bundle pool for the host OS; without it, the
	// launcher boots but cannot find the JDT LS bundles.
	args := []string{
		"-Declipse.application=org.eclipse.jdt.ls.core.id1",
		"-Dosgi.bundles.defaultStartLevel=4",
		"-Declipse.product=org.eclipse.jdt.ls.core.product",
		"-Ddata.dir=" + ws,
		"-Dlog.level=ALL",
		"-jar", rep.LauncherJAR,
		"-configuration", hostCfg,
		"-data", ws,
	}
	cmd := exec.CommandContext(ctx, javaBin, args...)
	cmd.Dir = rep.Home
	cmd.Env = append(os.Environ(),
		"JDTLS_WORKSPACE="+ws,
		"JDTLS_HOME="+rep.Home,
	)
	cmd.Stderr = stderrF
	stdin, err := cmd.StdinPipe()
	if err != nil {
		stderrF.Close()
		m.state.Store(0)
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stderrF.Close()
		m.state.Store(0)
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		stderrF.Close()
		m.state.Store(0)
		return nil, err
	}
	m.stdin = stdin
	m.stdoutBr = bufio.NewReader(stdout)
	m.stderrFile = stderrF
	m.stderrPath = stderrPath
	m.cmd = cmd
	m.state.Store(2)
	st := &Status{
		State:       "running",
		Pid:         cmd.Process.Pid,
		Version:     JDTLSVersion,
		StartedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Jre:         jre,
		Jar:         rep.LauncherJAR,
		LauncherJAR: rep.LauncherJAR,
		Workspace:   ws,
	}
	m.mu.Lock()
	m.lastStart = st
	m.lastErr = ""
	m.mu.Unlock()
	go m.readLoop(stdout)
	go m.watchExit(cmd)
	m.dispatch(Event{Type: "state", State: "running", At: st.StartedAt})
	m.logf("jdtls process started", map[string]any{
		"pid":     st.Pid,
		"version": JDTLSVersion,
		"jre":     jre,
		"home":    rep.Home,
	})
	return st, nil
}

// watchExit waits for the JDT LS process to terminate on its
// own and marks the state as `crashed`. A clean Stop() goes
// through the CAS path (state: 2 -> 3 -> 0) and never reaches
// here in the crashed branch; we only set crashed when the
// process exits without us asking.
func (m *Manager) watchExit(cmd *exec.Cmd) {
	state, _ := cmd.Process.Wait()
	if m.state.CompareAndSwap(2, 4) {
		msg := "jdtls exited unexpectedly: " + state.String()
		m.setLastErr(msg)
		m.dispatch(Event{Type: "error", Message: msg})
		m.dispatch(Event{Type: "state", State: "crashed", At: time.Now().UTC().Format(time.RFC3339Nano)})
		m.maybeAutoRestart()
	}
}

// maybeAutoRestart is called from watchExit when the JDT LS
// crashes. If auto-restart is enabled and we have budget left,
// we re-enter Start in the background; otherwise we leave the
// manager in the `crashed` state and let the user click
// "Restart" in the status bar.
func (m *Manager) maybeAutoRestart() {
	m.mu.Lock()
	budget := m.autoRestartBudget
	count := m.restartCount
	m.mu.Unlock()
	if budget <= 0 || count >= budget {
		return
	}
	m.mu.Lock()
	m.restartCount++
	m.mu.Unlock()
	go func() {
		// Brief backoff so a tight crash loop does not pin the CPU.
		time.Sleep(750 * time.Millisecond)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := m.Start(ctx); err != nil {
			m.logf("jdtls auto-restart failed", map[string]any{"err": err.Error()})
		}
	}()
}

// Stop terminates the JDT LS process. On Windows the process
// group is killed via taskkill /T so the JVM (and any worker
// threads it spawned) goes down together. On Unix we signal
// the negative PID to take the process group.
func (m *Manager) Stop(ctx context.Context) error {
	// Acceptable source states: running (2) and crashed (4).
	if s := m.state.Load(); s != 2 && s != 4 {
		return nil
	}
	m.state.Store(3)
	defer m.state.Store(0)
	if m.cmd != nil && m.cmd.Process != nil {
		_ = terminateProcessTree(m.cmd.Process.Pid)
		done := make(chan struct{})
		go func() { _ = m.cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-ctx.Done():
			_ = m.cmd.Process.Kill()
		}
	}
	if m.stderrFile != nil {
		_ = m.stderrFile.Close()
		m.stderrFile = nil
	}
	m.mu.Lock()
	if m.lastStart != nil {
		m.lastStart.InitializeOK = false
	}
	m.mu.Unlock()
	m.dispatch(Event{Type: "state", State: "stopped", At: time.Now().UTC().Format(time.RFC3339Nano)})
	return nil
}

func terminateProcessTree(pid int) error {
	if runtime.GOOS == "windows" {
		// taskkill /T walks the child process tree, /F forces.
		return exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).Run()
	}
	// On Unix, send SIGTERM to the negative PID (process group).
	return exec.Command("kill", "-TERM", "-"+strconv.Itoa(pid)).Run()
}

// Send writes one LSP frame to the JDT LS. Caller is
// responsible for adding the Content-Length header.
func (m *Manager) Send(frame []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stdin == nil {
		return errors.New("jdtls is not running")
	}
	_, err := m.stdin.Write(frame)
	return err
}

// Receive returns the next LSP frame the server emitted. The
// channel is closed when the process exits.
func (m *Manager) Receive() <-chan []byte {
	return m.framesOut
}

// StderrPath returns the absolute path to the per-run stderr
// log. The status bar surfaces this so the user can open it in
// a viewer.
func (m *Manager) StderrPath() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stderrPath
}

func (m *Manager) readLoop(rd io.Reader) {
	br := bufio.NewReader(rd)
	for {
		hdr, err := readHeaders(br)
		if err != nil {
			m.setLastErr(err.Error())
			m.dispatch(Event{Type: "error", Message: err.Error()})
			close(m.framesOut)
			return
		}
		body := make([]byte, hdr.contentLength)
		if _, err := io.ReadFull(br, body); err != nil {
			m.setLastErr(err.Error())
			m.dispatch(Event{Type: "error", Message: err.Error()})
			close(m.framesOut)
			return
		}
		select {
		case m.framesOut <- body:
		default:
			// Drop if downstream is slow; the LSP spec says
			// requests and notifications are independent and
			// the client is allowed to skip.
		}
	}
}

func (m *Manager) setLastErr(msg string) {
	m.mu.Lock()
	m.lastErr = msg
	m.mu.Unlock()
}

type frameHeader struct {
	contentType   string
	contentLength int
}

func readHeaders(br *bufio.Reader) (frameHeader, error) {
	var h frameHeader
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return h, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if h.contentLength == 0 {
				return h, errors.New("missing Content-Length")
			}
			return h, nil
		}
		if strings.HasPrefix(line, "Content-Length:") {
			_, err := fmt.Sscanf(line, "Content-Length: %d", &h.contentLength)
			if err != nil {
				return h, fmt.Errorf("invalid Content-Length: %w", err)
			}
		} else if strings.HasPrefix(line, "Content-Type:") {
			h.contentType = strings.TrimSpace(strings.TrimPrefix(line, "Content-Type:"))
		}
	}
}

func (m *Manager) dispatch(e Event) {
	m.mu.Lock()
	listeners := make([]func(Event), len(m.listeners))
	copy(listeners, m.listeners)
	m.mu.Unlock()
	for _, fn := range listeners {
		fn(e)
	}
}

// Initialize sends the LSP `initialize` request and waits for
// the response. The caller is responsible for `initialized`
// notification.
func (m *Manager) Initialize(ctx context.Context, rootURI string, capabilities json.RawMessage) (json.RawMessage, error) {
	if m.stdin == nil {
		return nil, errors.New("jdtls is not running")
	}
	if capabilities == nil {
		capabilities = json.RawMessage(`{}`)
	}
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]interface{}{
			"processId":    os.Getpid(),
			"rootUri":      rootURI,
			"capabilities": capabilities,
			"workspaceFolders": []map[string]string{
				{"uri": rootURI, "name": "workspace"},
			},
		},
	}
	body, _ := json.Marshal(req)
	hdr := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(body))
	if _, err := m.stdin.Write([]byte(hdr)); err != nil {
		return nil, err
	}
	if _, err := m.stdin.Write(body); err != nil {
		return nil, err
	}
	select {
	case resp := <-m.framesOut:
		return resp, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(60 * time.Second):
		return nil, errors.New("jdtls initialize timed out")
	}
}

// FinalizeShutdown is called by main on agent exit to ensure
// the JDT LS child is reaped even if a Stop was never issued.
func (m *Manager) FinalizeShutdown() {
	if s := m.state.Load(); s == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = m.Stop(ctx)
}
