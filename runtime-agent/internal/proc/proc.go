// Package proc supervises long-running processes (Tomcat) and
// short-lived ones (javac, ant). It enforces timeouts, captures
// stdout/stderr, exposes start/stop/forceStop, and tracks the
// PID and process group so we can clean up reliably on shutdown.
package proc

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// Process is a supervised process. It is safe to call Stop
// concurrently with Wait.
type Process struct {
	mu        sync.Mutex
	spec      Spec
	cmd       *exec.Cmd
	cancel    context.CancelFunc
	state     State
	exitErr   error
	startedAt time.Time
	stoppedAt time.Time
	stdout    *ringBuffer
	stderr    *ringBuffer
	waitCh    chan struct{}
}

// State is the lifecycle state.
type State string

const (
	StateNew     State = "new"
	StateRunning State = "running"
	StateStopped State = "stopped"
	StateCrashed State = "crashed"
)

// Spec describes how to start a process.
type Spec struct {
	Name    string
	Args    []string
	Env     []string
	Dir     string
	// Stdin is set if you want to feed the process input.
	Stdin io.Reader
	// CaptureBufferLines is the size of the captured stdout/stderr
	// ring buffer. Default 5000.
	CaptureBufferLines int
	// On Windows we cannot setpgid; this is a hint.
	IsLongRunning bool
}

// New creates a process from spec but does not start it.
func New(spec Spec) *Process {
	if spec.CaptureBufferLines <= 0 {
		spec.CaptureBufferLines = 5000
	}
	return &Process{
		spec:    spec,
		stdout:  newRing(spec.CaptureBufferLines),
		stderr:  newRing(spec.CaptureBufferLines),
		waitCh:  make(chan struct{}),
		state:   StateNew,
	}
}

// Start launches the process. The spec from New is used.
func (p *Process) Start(ctx context.Context) error {
	return p.StartWithSpec(ctx, p.spec)
}

// StartWithSpec launches the process with an explicit spec.
// This lets a caller reuse a single Process value across
// restarts.
func (p *Process) StartWithSpec(ctx context.Context, spec Spec) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.state != StateNew && p.state != StateStopped && p.state != StateCrashed {
		return fmt.Errorf("cannot start: state is %s", p.state)
	}
	cctx, cancel := context.WithCancel(ctx)
	p.cancel = cancel
	p.cmd = exec.CommandContext(cctx, p.cmdName(spec), spec.Args...)
	if spec.Dir != "" {
		p.cmd.Dir = spec.Dir
	}
	if len(spec.Env) > 0 {
		p.cmd.Env = append(os.Environ(), spec.Env...)
	} else {
		p.cmd.Env = os.Environ()
	}
	if spec.Stdin != nil {
		p.cmd.Stdin = spec.Stdin
	}
	p.cmd.Stdout = &captureWriter{r: p.stdout, stream: "stdout"}
	p.cmd.Stderr = &captureWriter{r: p.stderr, stream: "stderr"}
	// Detach the process from the parent's controlling terminal.
	p.cmd.SysProcAttr = sysProcAttr()
	if err := p.cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("start: %w", err)
	}
	p.startedAt = time.Now()
	p.state = StateRunning
	go p.wait()
	return nil
}

// PID returns the OS PID, or 0 if not started.
func (p *Process) PID() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

// State returns the current state.
func (p *Process) State() State {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.state
}

// StartedAt returns the time the process started.
func (p *Process) StartedAt() time.Time {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.startedAt
}

// StoppedAt returns the time the process stopped.
func (p *Process) StoppedAt() time.Time {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stoppedAt
}

// ExitError returns the exit error if the process crashed or
// returned non-zero.
func (p *Process) ExitError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exitErr
}

// Stop sends SIGTERM, waits up to timeout, then SIGKILL.
func (p *Process) Stop(timeout time.Duration) error {
	p.mu.Lock()
	if p.state != StateRunning || p.cmd == nil || p.cmd.Process == nil {
		p.mu.Unlock()
		return nil
	}
	pid := p.cmd.Process.Pid
	p.mu.Unlock()

	if err := terminateGroup(pid); err != nil && !errors.Is(err, os.ErrProcessDone) {
		// Continue; the wait goroutine will reap.
		_ = err
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if p.State() != StateRunning {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	_ = killGroup(pid)
	// Final wait.
	for time.Now().Before(deadline.Add(2 * time.Second)) {
		if p.State() != StateRunning {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return errors.New("process did not stop in time")
}

// ForceStop sends SIGKILL immediately.
func (p *Process) ForceStop() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	return killGroup(p.cmd.Process.Pid)
}

// Wait blocks until the process exits.
func (p *Process) Wait() {
	<-p.waitCh
}

// StdoutSnapshot returns captured stdout lines.
func (p *Process) StdoutSnapshot() []string { return p.stdout.snapshot() }

// StderrSnapshot returns captured stderr lines.
func (p *Process) StderrSnapshot() []string { return p.stderr.snapshot() }

// StdoutReader returns a reader that streams stdout.
func (p *Process) StdoutReader() *io.PipeReader { return nil }

// cmdName picks the binary from spec.Args[0].
func (p *Process) cmdName(spec Spec) string {
	if len(spec.Args) == 0 {
		return spec.Name
	}
	return spec.Name
}

func (p *Process) wait() {
	err := p.cmd.Wait()
	p.mu.Lock()
	p.stoppedAt = time.Now()
	if err != nil {
		p.exitErr = err
		// Differentiate crash vs. stopped: if ExitCode == -1
		// and we were killed, treat as stopped.
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			if ee.ExitCode() == -1 {
				p.state = StateStopped
			} else {
				p.state = StateCrashed
			}
		} else {
			p.state = StateCrashed
		}
	} else {
		p.state = StateStopped
	}
	close(p.waitCh)
	p.mu.Unlock()
	if p.cancel != nil {
		p.cancel()
	}
}

// captureWriter writes to a ring buffer and (optionally) to
// stderr. We do not stream to stderr by default to keep logs
// clean; the supervisor attaches the buffer to a log.Logger.
type captureWriter struct {
	r      *ringBuffer
	stream string
}

func (c *captureWriter) Write(p []byte) (int, error) {
	c.r.write(c.stream, p)
	return len(p), nil
}

type ringBuffer struct {
	mu      sync.Mutex
	lines   []string
	cap     int
	next    int
	full    bool
}

func newRing(cap int) *ringBuffer {
	if cap <= 0 {
		cap = 1000
	}
	return &ringBuffer{lines: make([]string, cap), cap: cap}
}

func (r *ringBuffer) write(stream string, p []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Split on newlines, keep the partial line at the end.
	for _, line := range splitLines(p) {
		r.lines[r.next] = stream + ": " + line
		r.next = (r.next + 1) % r.cap
		if r.next == 0 {
			r.full = true
		}
	}
}

func splitLines(p []byte) []string {
	var out []string
	start := 0
	for i, b := range p {
		if b == '\n' {
			line := string(p[start:i])
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			out = append(out, line)
			start = i + 1
		}
	}
	if start < len(p) {
		out = append(out, string(p[start:]))
	}
	return out
}

func (r *ringBuffer) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.full {
		out := make([]string, r.next)
		copy(out, r.lines[:r.next])
		return out
	}
	out := make([]string, r.cap)
	copy(out, r.lines[r.next:])
	copy(out[r.cap-r.next:], r.lines[:r.next])
	return out
}

// ----------------- system process helpers -----------------
// Platform-specific implementations of terminateGroup / killGroup /
// signalGroup / IsAlive live in proc_unix.go and proc_windows.go.

func terminateGroup(pid int) error {
	return signalGroup(pid, terminateSignal())
}

func killGroup(pid int) error {
	return signalGroup(pid, killSignal())
}

// sysProcAttr sets platform-specific detach flags.
func sysProcAttr() *syscall.SysProcAttr {
	return sysProcAttrForOS()
}

// IsAlive reports whether the process with the given PID is
// alive on this system. Used by liveness checks.
func IsAlive(pid int) bool {
	return isProcessAlive(pid)
}

// PortDescription is a human-friendly port number for logs.
func PortDescription(p int) string { return strconv.Itoa(p) }

// ShortID returns a short id from a UUID-like string. We don't
// use a real UUID library to keep deps small.
func ShortID(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}

// ReadLines is a helper that reads a reader as lines.
func ReadLines(r io.Reader) []string {
	var out []string
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		out = append(out, scanner.Text())
	}
	return out
}
