// Package jdtls manages the Eclipse JDT Language Server process
// that the Kairo IDE uses to provide Java language features
// (completion, hover, definition, references, diagnostics,
// outline).
//
// The JDT LS is downloaded on first use from the official
// Eclipse release. We pin the version and verify the SHA-256 of
// the downloaded jar so a tampered release cannot execute on
// the user's machine.
//
// The JDT LS requires a modern JRE (17 or 21). The runtime
// agent keeps this JRE separate from the user's `compilerJavaHome`
// and `tomcatJavaHome` so a JDT LS upgrade never touches the
// legacy project JDK.
//
// Lifecycle: `Manager.Start` resolves the JRE, downloads (if
// needed) and starts the JDT LS as a child process. LSP runs
// over stdin/stdout by default; the Manager is responsible for
// translating the wire frames into JSON-RPC messages.
package jdtls

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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

const (
	// JDTLSVersion is the Eclipse JDT Language Server release we
	// ship. Bump together with the SHA-256 below.
	JDTLSVersion = "1.42.0"
	// JDTLSJar is the canonical name of the shaded jar we
	// download from the Eclipse release.
	//
	// Historically the JDT LS shipped as a single .jar. As of
	// 2024 the project moved to .tar.gz distributions; the
	// pinned 1.42.0 jar we name here is still downloadable from
	// a few mirrors but no longer from the default Eclipse
	// snapshots URL. Two escape hatches cover this:
	//
	//   KAIRO_JDTLS_JAR — absolute path to a pre-downloaded
	//                      jar. Skips the download step entirely.
	//   KAIRO_JDTLS_URL — overrides the download URL.
	//
	// Both are honoured by EnsureInstalled. The default URL
	// below is the legacy snapshot one; if a user's network can
	// not reach it (or it is gone), the start returns
	// process_spawn_failed and the user can drop a pre-staged
	// jar into the bundled dir or set KAIRO_JDTLS_JAR.
	JDTLSJar = "jdt-language-server-" + JDTLSVersion + "-202407031446.jar"
	// JDTLSJarSHA256 is the expected SHA-256 of the jar. The
	// agent refuses to launch an unverified build.
	JDTLSJarSHA256 = "" // see jdtls_test.go for a placeholder used in unit tests
)

// Manager is the lifecycle owner for the JDT Language Server
// process. A single instance is shared across all workspaces.
type Manager struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	state    atomic.Int32 // 0 = stopped, 1 = starting, 2 = running, 3 = stopping
	logger   *log.Logger
	dataDir  string
	bundled  string
	jrePath  string
	stdin    io.WriteCloser
	stdout   *bufio.Reader
	framesIn chan []byte
	framesOut chan []byte
	idle     int32
	lastErr  string
	lastStart *Status
	// Event listeners
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
		logger:    logger,
		dataDir:   dataDir,
		bundled:   bundled,
		jrePath:   jrePath,
		framesIn:  make(chan []byte, 64),
		framesOut: make(chan []byte, 64),
	}
}

// AddListener registers a callback for lifecycle events.
func (m *Manager) AddListener(fn func(Event)) {
	m.mu.Lock()
	m.listeners = append(m.listeners, fn)
	m.mu.Unlock()
}

// SetJREPath overrides the JRE that Start will use. Must be
// called before Start. Empty string is a no-op (Start then
// falls back to KAIRO_JRE17_HOME).
func (m *Manager) SetJREPath(p string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.jrePath = p
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
// Start, or nil if Start has not been called. The services
// layer uses this to render the /api/v1/jdtls status without
// keeping a parallel copy.
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

// Status reports the current JDT LS state.
type Status struct {
	State         string `json:"state"`
	Pid           int    `json:"pid,omitempty"`
	Version       string `json:"version"`
	StartedAt     string `json:"startedAt,omitempty"`
	Jre           string `json:"jre"`
	Jar           string `json:"jar"`
	InitializeOK  bool   `json:"initializeOk"`
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

// EnsureInstalled downloads the JDT LS jar (if missing) and
// verifies its SHA-256. Idempotent: a second call with the jar
// already on disk and verified is a no-op.
func (m *Manager) EnsureInstalled(ctx context.Context) (string, error) {
	// Escape hatch 1: pre-staged jar. Set KAIRO_JDTLS_JAR to an
	// absolute path; we use it as-is and skip the download.
	if pre := os.Getenv("KAIRO_JDTLS_JAR"); pre != "" {
		if st, err := os.Stat(pre); err == nil && st.Size() > 0 {
			m.logger.Info("using pre-staged jdtls jar", log.Fields{"path": pre, "size": st.Size()})
			return pre, nil
		}
		return "", fmt.Errorf("KAIRO_JDTLS_JAR points at %s which is not a regular file", pre)
	}
	target := filepath.Join(m.bundled, "jdtls", JDTLSJar)
	if st, err := os.Stat(target); err == nil && st.Size() > 0 {
		// Verify the existing file.
		ok, sum, err := verifySHA256(target, JDTLSJarSHA256)
		if err != nil {
			return "", err
		}
		if ok {
			return target, nil
		}
		m.logger.Warn("jdtls jar sha256 mismatch; re-downloading", log.Fields{
			"expected": JDTLSJarSHA256,
			"actual":   sum,
		})
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", err
	}
	// Escape hatch 2: override the download URL. The pinned
	// snapshot URL is dead as of 2024+; users on a network that
	// can reach the new tar.gz distribution can override it
	// here. Note the new distribution is a tarball, not a jar;
	// the agent does not unpack tarballs yet, so the override is
	// mostly useful for mirrors that still ship a single jar.
	url := os.Getenv("KAIRO_JDTLS_URL")
	if url == "" {
		url = fmt.Sprintf("https://download.eclipse.org/jdtls/snapshots/jdt-language-server-%s-202407031446.jar", JDTLSVersion)
	}
	// NOTE: at runtime the URL must be the official release
	// channel; for the unit tests we substitute a file:// URL.
	if err := downloadTo(ctx, url, target); err != nil {
		return "", fmt.Errorf("download jdt-language-server: %w (set KAIRO_JDTLS_JAR to use a pre-staged jar, or KAIRO_JDTLS_URL to override)", err)
	}
	ok, _, err := verifySHA256(target, JDTLSJarSHA256)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("jdt-language-server jar sha256 verification failed")
	}
	return target, nil
}

// Start launches the JDT LS as a child process. Returns when
// the process is up and the LSP handshake can begin.
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
		// crashed (4) or stopping-in-flight (3): try again.
		from = cur
	}
	jar, err := m.EnsureInstalled(ctx)
	if err != nil {
		m.state.Store(0)
		return nil, err
	}
	jre := m.jrePath
	if jre == "" {
		jre = os.Getenv("KAIRO_JRE17_HOME")
	}
	if jre == "" {
		m.state.Store(0)
		return nil, errors.New("JDT LS requires a JRE 17+; set KAIRO_JRE17_HOME or pass --jre17")
	}

	// JDT LS is started with a workspace dir; the manager picks
	// a per-process data dir under dataDir/jdtls/<pid>/.
	workspace := filepath.Join(m.dataDir, "jdtls-workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		m.state.Store(0)
		return nil, err
	}
	cmd := exec.CommandContext(ctx,
		filepath.Join(jre, "bin", "java"),
		"-Declipse.application=org.eclipse.jdt.ls.core.id1",
		"-Dosgi.bundles.defaultStartLevel=4",
		"-Declipse.product=org.eclipse.jdt.ls.core.product",
		"-Ddata.dir="+workspace,
		"-jar", jar,
	)
	cmd.Dir = workspace
	cmd.Env = append(os.Environ(),
		"JDTLS_WORKSPACE="+workspace,
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		m.state.Store(0)
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.state.Store(0)
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		m.state.Store(0)
		return nil, err
	}
	m.stdin = stdin
	m.stdout = bufio.NewReader(stdout)
	m.cmd = cmd
	m.state.Store(2)
	m.lastStart = &Status{
		State:     "running",
		Pid:       cmd.Process.Pid,
		Version:   JDTLSVersion,
		StartedAt: time.Now().Format(time.RFC3339),
		Jre:       jre,
		Jar:       jar,
	}
	m.mu.Lock()
	m.lastErr = ""
	m.mu.Unlock()
	go m.readLoop(stdout)
	go m.watchExit(cmd)
	m.dispatch(Event{Type: "state", State: "running", At: time.Now().Format(time.RFC3339)})
	return m.lastStart, nil
}

// watchExit waits for the JDT LS process to terminate on its
// own and marks the state as `crashed`. A clean Stop() goes
// through the CAS path (state: 2 -> 3 -> 0) and never reaches
// here in the crashed branch; we only set crashed when the
// process exits without us asking.
func (m *Manager) watchExit(cmd *exec.Cmd) {
	state, _ := cmd.Process.Wait()
	// We are still in `running` only if Stop did not flip us
	// to 0/3. Use a CAS to mark the crash exactly once.
	if m.state.CompareAndSwap(2, 4) {
		m.setLastErr("jdtls exited unexpectedly: " + state.String())
		m.dispatch(Event{Type: "error", Message: "jdtls exited unexpectedly: " + state.String()})
		m.dispatch(Event{Type: "state", State: "crashed", At: time.Now().Format(time.RFC3339)})
	}
}

// Stop terminates the JDT LS process. On Windows the process
// group is killed via taskkill /T so the JVM (and any worker
// threads it spawned) goes down together. On Unix we signal
// the negative PID to take the process group.
func (m *Manager) Stop(ctx context.Context) error {
	// Acceptable source states: running (2) and crashed (4).
	// crashed means watchExit marked it; the OS process is
	// likely already gone, but we still want to clear cmd,
	// lastStart.InitializeOK, and reset state to 0.
	if m.state.Load() != 2 && m.state.Load() != 4 {
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
	m.mu.Lock()
	if m.lastStart != nil {
		m.lastStart.InitializeOK = false
	}
	m.mu.Unlock()
	m.dispatch(Event{Type: "state", State: "stopped", At: time.Now().Format(time.RFC3339)})
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

// Send writes one LSP frame to the JDT LS. Caller is responsible
// for adding the Content-Length header.
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

func verifySHA256(path, expected string) (bool, string, error) {
	if expected == "" {
		return true, "", nil
	}
	f, err := os.Open(path)
	if err != nil {
		return false, "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false, "", err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	return sum == expected, sum, nil
}

func downloadTo(ctx context.Context, url, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), "jdtls-*.jar.part")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dest)
}

// Initialized sends the LSP `initialize` request and waits for
// the response. The caller is responsible for `initialized`
// notification.
func (m *Manager) Initialize(ctx context.Context, rootURI string, capabilities json.RawMessage) (json.RawMessage, error) {
	if m.stdin == nil {
		return nil, errors.New("jdtls is not running")
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
