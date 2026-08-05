// Package jdtls manages the Eclipse JDT Language Server
// distribution and lifecycle for the Kairo IDE.
//
// The JDT LS is distributed as a .tar.gz or .zip by the
// Eclipse Foundation. The distribution installer is in
// distribution.go; this file owns the runtime lifecycle:
//
//   - Start a JDT LS as a child process using the launcher
//     JAR and the host's config_<os>/ directory.
//   - Support stop, restart, and crash detection.
//
// DEPRECATED: As of Phase 4, the Theia backend owns the JDT LS
// process lifecycle and LSP communication. The Go Agent only
// provides the launch descriptor (see
// internal/app/jdtls_descriptor.go). The Manager's Start/Stop
// methods are kept for backward compatibility but are no longer
// called by the production code path. The Theia backend owns
// the JDT LS process lifecycle, and the Go Agent only provides
// the launch descriptor. The Initialize/MarkInitialized LSP handshake
// methods have been removed.
//
// The JDT LS host runtime must be JDK/JRE 21+ for the pinned
// 1.55.0 distribution (osgi.ee JavaSE 21). That host JRE is kept
// separate from the project's compilerJavaHome / tomcatJavaHome
// so a JDT LS upgrade never forces the legacy project onto JDK 21.
package jdtls

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// Manager is the lifecycle owner for the JDT Language Server
// process. A single Manager is shared across all workspaces in
// a single agent process.
//
// DEPRECATED: The LSP frame channels and Initialize/MarkInitialized
// methods have been removed. The Theia backend now owns the JDT LS
// process lifecycle. The Manager is kept for distribution
// management (EnsureInstalled) and backward compatibility.
type Manager struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	state   atomic.Int32
	logger  *log.Logger
	dataDir string
	bundled string
	jrePath string

	// Distribution configuration
	skipSHAVerify bool
	customURL     string

	// Stderr capture
	stderrFile *os.File
	stderrPath string

	// Per-workspace data dir (e.g. dataDir/jdtls-workspace/<workspaceID>)
	workspace string

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
// skipSHAVerify: when true, SHA-256 verification is skipped (development only).
// customURL: when non-empty, overrides the default JDT LS download URL.
func New(dataDir, bundled, jrePath string, skipSHAVerify bool, customURL string, logger *log.Logger) *Manager {
	return &Manager{
		logger:            logger,
		dataDir:           dataDir,
		bundled:           bundled,
		jrePath:           jrePath,
		skipSHAVerify:     skipSHAVerify || os.Getenv("KAIRO_SKIP_SHA_VERIFY") == "true",
		customURL:         customURL,
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
// string is a no-op (Start then falls back to KAIRO_JDT_LS_JRE /
// KAIRO_JRE17_HOME).
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

// DataDir returns the agent data directory.
func (m *Manager) DataDir() string {
	return m.dataDir
}

// BundledDir returns the bundled binaries directory.
func (m *Manager) BundledDir() string {
	return m.bundled
}

// HomedDir returns the JDT LS installation directory.
func (m *Manager) HomedDir() string {
	return filepath.Join(m.bundled, "jdtls")
}

// IsPrepared returns true if the JDT LS distribution is
// already installed on disk (install.json exists and
// launcher jar is present).
func (m *Manager) IsPrepared() bool {
	rep, err := readInstallReport(m.dataDir)
	if err != nil || rep == nil {
		return false
	}
	if rep.LauncherJAR == "" {
		return false
	}
	if _, err := os.Stat(rep.LauncherJAR); err != nil {
		return false
	}
	return true
}

// DistributionStatus returns the installation status of the
// JDT LS distribution (GET /api/v1/jdtls/distribution).
func (m *Manager) DistributionStatus() DistributionStatus {
	home := m.HomedDir()
	rep, err := readInstallReport(m.dataDir)
	if err != nil || rep == nil {
		return DistributionStatus{
			Installed: false,
			Version:   JDTLSVersion,
			Home:      home,
			Source:    "none",
			Message:   "JDT LS distribution is not installed",
		}
	}
	installed := m.IsPrepared()
	source := "install-report"
	switch {
	case rep.ArchiveName == "(pre-bundled)":
		source = "pre-bundled"
	case os.Getenv("KAIRO_JDTLS_HOME") != "":
		source = "KAIRO_JDTLS_HOME"
	case rep.ArchiveName != "" && rep.ArchiveName != "(pre-bundled)":
		source = "archive"
	}
	msg := ""
	if !installed {
		msg = "install report present but launcher is missing or unreadable"
	}
	version := rep.Version
	if version == "" {
		version = JDTLSVersion
	}
	repHome := rep.Home
	if repHome == "" {
		repHome = home
	}
	return DistributionStatus{
		Installed:   installed,
		Version:     version,
		Home:        repHome,
		LauncherJAR: rep.LauncherJAR,
		Source:      source,
		Message:     msg,
	}
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

// LaunchDescriptor describes how the Theia backend should
// spawn the JDT LS process. It is returned by the Go Agent
// over HTTP and consumed by the Theia backend contribution.
// The descriptor MUST NOT include os.Environ() — only the
// minimal allowlist of environment variables needed by the
// JVM and the JDT LS.
type LaunchDescriptor struct {
	Command      string   `json:"command"`      // java or javaw executable
	Args         []string `json:"args"`         // JVM and JDT LS arguments
	WorkingDir   string   `json:"workingDir"`   // canonical project root from repository
	EnvAllowlist []string `json:"envAllowlist"` // PATH, JAVA_HOME and minimal env vars; never os.Environ()
}

// BuildLaunchDescriptor constructs a secure LaunchDescriptor
// from the current installation state. It only exposes PATH,
// JAVA_HOME, and the minimal environment needed by the JVM.
// It does NOT return os.Environ().
func (m *Manager) BuildLaunchDescriptor(workingDir string) (*LaunchDescriptor, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	jre, err := resolveHostJRE(m.jrePath, m.bundled)
	if err != nil {
		return nil, err
	}
	javaBin := filepath.Join(jre, "bin", "java")
	if runtime.GOOS == "windows" {
		javaBin += ".exe"
	}
	if _, err := os.Stat(javaBin); err != nil {
		return nil, fmt.Errorf("JDT LS host JRE %d+ not found at %s", JDTLSRequiredJREMajor, javaBin)
	}

	rep, err := readInstallReport(m.dataDir)
	if err != nil || rep == nil {
		return nil, fmt.Errorf("JDT LS not installed; run prepare first")
	}
	hostCfg, err := hostConfigDir(rep.Home)
	if err != nil {
		return nil, err
	}

	ws := m.workspace
	if ws == "" {
		ws = filepath.Join(m.dataDir, "jdtls-workspace", "default")
	} else if !filepath.IsAbs(ws) {
		// A relative workspace name would resolve against the
		// (arbitrary) server CWD, leaking stale Eclipse state
		// across runs and machines — JDT LS then failed with
		// "Resource '/jdt.ls-java-project/src/com' already
		// exists" on every completion (KAIRO-RC-WEB-251).
		ws = filepath.Join(m.dataDir, "jdtls-workspace", ws)
	}

	heapMB := jdtlsMaxHeapMB()
	args := []string{
		"-Declipse.application=org.eclipse.jdt.ls.core.id1",
		"-Dosgi.bundles.defaultStartLevel=4",
		"-Declipse.product=org.eclipse.jdt.ls.core.product",
		"-Dlog.protocol=false",
		"-Dlog.level=WARN",
		"-Xms128m",
		"-Xmx" + fmt.Sprintf("%dm", heapMB),
		"-XX:+UseG1GC",
		"-XX:MaxGCPauseMillis=200",
		"-jar", rep.LauncherJAR,
		"-configuration", hostCfg,
		"-data", ws,
	}

	// Build the minimal environment allowlist.
	// Only pass PATH, JAVA_HOME, and essential JVM variables.
	// Never expose the full os.Environ() to the caller.
	envAllowlist := []string{
		"PATH=" + os.Getenv("PATH"),
		"JAVA_HOME=" + jre,
		"JDTLS_WORKSPACE=" + ws,
		"JDTLS_HOME=" + rep.Home,
		"HOME=" + os.Getenv("HOME"),
	}
	if runtime.GOOS == "windows" {
		envAllowlist = append(envAllowlist,
			"SystemRoot="+os.Getenv("SystemRoot"),
			"TEMP="+os.Getenv("TEMP"),
			"TMP="+os.Getenv("TMP"),
		)
	}

	return &LaunchDescriptor{
		Command:      javaBin,
		Args:         args,
		WorkingDir:   workingDir,
		EnvAllowlist: envAllowlist,
	}, nil
}

// jdtlsMaxHeapMB returns the JDT LS heap size in MB. The
// default is 768 MB; the user can override it with
// KAIRO_JDTLS_MAX_HEAP_MB. The value is clamped to [256, 4096].
func jdtlsMaxHeapMB() int {
	const envName = "KAIRO_JDTLS_MAX_HEAP_MB"
	const defaultMB = 768
	const minMB = 256
	const maxMB = 4096
	raw := os.Getenv(envName)
	if raw == "" {
		return defaultMB
	}
	val, err := strconv.Atoi(raw)
	if err != nil || val < minMB || val > maxMB {
		return defaultMB
	}
	return val
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
	return ensureInstalled(ctx, m.dataDir, m.bundled, m.jrePath, m.skipSHAVerify, m.customURL, m.logf)
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

	// Step 2: pick a host JRE that satisfies JDT LS (JDK 21+).
	jre, err := resolveHostJRE(m.jrePath, m.bundled)
	if err != nil {
		m.state.Store(0)
		return nil, err
	}
	javaBin := filepath.Join(jre, "bin", "java")
	if runtime.GOOS == "windows" {
		javaBin += ".exe"
	}
	if _, err := os.Stat(javaBin); err != nil {
		m.state.Store(0)
		return nil, fmt.Errorf("JDT LS host JRE %d+ not found at %s", JDTLSRequiredJREMajor, javaBin)
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
	// Only pass the minimal environment needed by the JVM.
	// Never expose the full os.Environ() to the child process.
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"JAVA_HOME=" + jre,
		"JDTLS_WORKSPACE=" + ws,
		"JDTLS_HOME=" + rep.Home,
		"HOME=" + os.Getenv("HOME"),
	}
	if runtime.GOOS == "windows" {
		cmd.Env = append(cmd.Env,
			"SystemRoot="+os.Getenv("SystemRoot"),
			"TEMP="+os.Getenv("TEMP"),
			"TMP="+os.Getenv("TMP"),
		)
	}
	cmd.Stderr = stderrF
	stdin, err := cmd.StdinPipe()
	if err != nil {
		stderrF.Close()
		m.state.Store(0)
		return nil, err
	}
	_ = stdin // stdin is kept for the pipe to stay open; Theia backend owns stdio now
	if _, err := cmd.StdoutPipe(); err != nil {
		stderrF.Close()
		m.state.Store(0)
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		stderrF.Close()
		m.state.Store(0)
		return nil, err
	}
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
	m.dispatch(Event{Type: "state", State: "stopped", At: time.Now().UTC().Format(time.RFC3339Nano)})
	return nil
}

func terminateProcessTree(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("invalid pid: %d", pid)
	}
	if runtime.GOOS == "windows" {
		// taskkill /T walks the child process tree, /F forces.
		return exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).Run()
	}
	// On Unix, send SIGTERM to the negative PID (process group).
	return exec.Command("kill", "-TERM", "-"+strconv.Itoa(pid)).Run()
}

// StderrPath returns the absolute path to the per-run stderr
// log. The status bar surfaces this so the user can open it in
// a viewer.
func (m *Manager) StderrPath() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stderrPath
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
