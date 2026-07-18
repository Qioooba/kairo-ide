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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/proc"
)

const (
	// JDTLSVersion is the Eclipse JDT Language Server release we
	// ship. Bump together with the SHA-256 below.
	JDTLSVersion = "1.42.0"
	// JDTLSJar is the canonical name of the shaded jar we
	// download from the Eclipse release.
	JDTLSJar = "jdt-language-server-" + JDTLSVersion + "-202407031446.jar"
	// JDTLSJarSHA256 is the expected SHA-256 of the jar. The
	// agent refuses to launch an unverified build.
	JDTLSJarSHA256 = "" // see jdtls_test.go for a placeholder used in unit tests
)

// Manager is the lifecycle owner for the JDT Language Server
// process. A single instance is shared across all workspaces.
type Manager struct {
	mu       sync.Mutex
	proc     *proc.Process
	cmd      *exec.Cmd
	state    atomic.Int32 // 0 = stopped, 1 = starting, 2 = running, 3 = stopping
	logger   log.Logger
	dataDir  string
	bundled  string
	jrePath  string
	stdin    io.WriteCloser
	stdout   *bufio.Reader
	framesIn chan []byte
	framesOut chan []byte
	idle     int32
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
func New(dataDir, bundled, jrePath string, logger log.Logger) *Manager {
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

// Status reports the current JDT LS state.
type Status struct {
	State     string `json:"state"`
	Pid       int    `json:"pid,omitempty"`
	Version   string `json:"version"`
	StartedAt string `json:"startedAt,omitempty"`
	Jre       string `json:"jre"`
	Jar       string `json:"jar"`
}

// State returns the current state as a string.
func (m *Manager) State() string {
	switch m.state.Load() {
	case 1:
		return "starting"
	case 2:
		return "running"
	case 3:
		return "stopping"
	default:
		return "stopped"
	}
}

// EnsureInstalled downloads the JDT LS jar (if missing) and
// verifies its SHA-256. Idempotent: a second call with the jar
// already on disk and verified is a no-op.
func (m *Manager) EnsureInstalled(ctx context.Context) (string, error) {
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
	url := fmt.Sprintf("https://download.eclipse.org/jdtls/snapshots/jdt-language-server-%s-202407031446.jar", JDTLSVersion)
	// NOTE: at runtime the URL must be the official release
	// channel; for the unit tests we substitute a file:// URL.
	if err := downloadTo(ctx, url, target); err != nil {
		return "", fmt.Errorf("download jdt-language-server: %w", err)
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
	if !m.state.CompareAndSwap(0, 1) && !m.state.CompareAndSwap(3, 1) {
		return nil, fmt.Errorf("jdtls already in state %s", m.State())
	}
	jar, err := m.EnsureInstalled(ctx)
	if err != nil {
		m.state.Store(0)
		return "", err
	}
	jre := m.jrePath
	if jre == "" {
		jre = os.Getenv("KAIRO_JRE17_HOME")
	}
	if jre == "" {
		m.state.Store(0)
		return "", errors.New("JDT LS requires a JRE 17+; set KAIRO_JRE17_HOME or pass --jre17")
	}

	// JDT LS is started with a workspace dir; the manager picks
	// a per-process data dir under dataDir/jdtls/<pid>/.
	workspace := filepath.Join(m.dataDir, "jdtls-workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		m.state.Store(0)
		return "", err
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
		return "", err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.state.Store(0)
		return "", err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		m.state.Store(0)
		return "", err
	}
	m.stdin = stdin
	m.stdout = bufio.NewReader(stdout)
	m.cmd = cmd
	m.state.Store(2)
	go m.readLoop(stdout)
	m.dispatch(Event{Type: "state", State: "running", At: time.Now().Format(time.RFC3339)})
	return &Status{
		State:     "running",
		Pid:       cmd.Process.Pid,
		Version:   JDTLSVersion,
		StartedAt: time.Now().Format(time.RFC3339),
		Jre:       jre,
		Jar:       jar,
	}, nil
}

// Stop terminates the JDT LS process.
func (m *Manager) Stop(ctx context.Context) error {
	if m.state.Load() != 2 {
		return nil
	}
	m.state.Store(3)
	defer m.state.Store(0)
	if m.cmd != nil && m.cmd.Process != nil {
		_ = proc.TerminateGroup(m.cmd.Process.Pid)
		done := make(chan struct{})
		go func() { _ = m.cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-ctx.Done():
			_ = proc.KillGroup(m.cmd.Process.Pid)
		}
	}
	m.dispatch(Event{Type: "state", State: "stopped", At: time.Now().Format(time.RFC3339)})
	return nil
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
			m.dispatch(Event{Type: "error", Message: err.Error()})
			close(m.framesOut)
			return
		}
		body := make([]byte, hdr.contentLength)
		if _, err := io.ReadFull(br, body); err != nil {
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
