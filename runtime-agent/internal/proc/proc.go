package proc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

const (
	MaxLogLines = 10000
	MaxLogBytes = 1024 * 1024
)

type ProcessSpec struct {
	Executable   string
	Args         []string
	Dir          string
	Env          []string
	LogDir       string
	CatalinaBase string
	MarkerToken  string
}

type ProcessObservation struct {
	PID              int
	Identity         domain.ProcessIdentity
	Running          bool
	ExitCode         *int
	IdentityMismatch bool
	Children         []int
}

type LogListener func(line domain.LogLine)

type Disposable interface {
	Dispose()
}

type ManagedProcess interface {
	Start(ctx context.Context, spec ProcessSpec) (ProcessObservation, error)
	GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error
	ForceStop(ctx context.Context, identity domain.ProcessIdentity) error
	Inspect(ctx context.Context, identity domain.ProcessIdentity) (ProcessObservation, error)
	ChildProcesses(ctx context.Context, identity domain.ProcessIdentity) ([]int, error)
	SubscribeLogs(listener LogListener) Disposable
	Wait()
}

type procState int32

const (
	stateIdle procState = iota
	stateStarting
	stateRunning
	stateStopping
	stateStopped
)

type realOSProcess struct {
	mu sync.Mutex

	state       procState
	cmd         *exec.Cmd
	cancel      context.CancelFunc
	startedAt   time.Time
	stoppedAt   time.Time
	exitCode    *int
	exitErr     error
	identity    domain.ProcessIdentity
	waitCh      chan struct{}
	waitClosed  sync.Once
	logBuf      *ringLogBuffer
	listeners   map[uint64]LogListener
	listenerSeq uint64
	generation  uint64
}

func New() ManagedProcess {
	p := &realOSProcess{
		state:     stateIdle,
		waitCh:    make(chan struct{}),
		logBuf:    newRingLogBuffer(MaxLogLines, MaxLogBytes),
		listeners: make(map[uint64]LogListener),
	}
	closeWaitCh(p)
	return p
}

func (p *realOSProcess) Wait() {
	<-p.waitCh
}

func (p *realOSProcess) Start(ctx context.Context, spec ProcessSpec) (ProcessObservation, error) {
	p.mu.Lock()
	if p.state != stateIdle && p.state != stateStopped {
		p.mu.Unlock()
		return ProcessObservation{}, fmt.Errorf("cannot start: process already running or in transition")
	}

	generation := p.generation + 1
	p.generation = generation
	p.waitCh = make(chan struct{})
	p.waitClosed = sync.Once{}
	p.state = stateStarting
	p.exitCode = nil
	p.exitErr = nil
	p.logBuf = newRingLogBuffer(MaxLogLines, MaxLogBytes)
	// KAIRO-RC-WEB-245: do NOT reset p.listeners here — both
	// production call sites (build compiler, tomcat provider)
	// subscribe BEFORE Start, and wiping the map silently killed
	// all log capture (empty build output, filesCompiled=0,
	// missing server logs). The log buffer still resets per
	// generation; subscribers live as long as the process object.

	exePath, err := filepath.EvalSymlinks(spec.Executable)
	if err != nil {
		exePath = spec.Executable
	}

	markerToken := spec.MarkerToken
	if markerToken == "" {
		markerToken = generateMarkerToken()
	}
	env := append([]string{}, spec.Env...)
	env = append(env, "KAIRO_PROCESS_MARKER="+markerToken)

	cctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel

	cmd := exec.CommandContext(cctx, spec.Executable, spec.Args...)
	if spec.Dir != "" {
		cmd.Dir = spec.Dir
	}
	cmd.Env = append(os.Environ(), env...)
	cmd.SysProcAttr = sysProcAttrForOS()

	stdoutw := &captureWriter{
		buf:        p.logBuf,
		stream:     domain.LogStreamStdout,
		generation: generation,
		onLine:     p.dispatchLine,
	}
	stderrw := &captureWriter{
		buf:        p.logBuf,
		stream:     domain.LogStreamStderr,
		generation: generation,
		onLine:     p.dispatchLine,
	}
	cmd.Stdout = stdoutw
	cmd.Stderr = stderrw

	if err := cmd.Start(); err != nil {
		cancel()
		p.state = stateStopped
		p.stoppedAt = time.Now()
		p.mu.Unlock()
		closeWaitCh(p)
		return ProcessObservation{}, fmt.Errorf("start: %w", err)
	}

	p.cmd = cmd
	p.startedAt = time.Now()
	p.identity = domain.ProcessIdentity{
		PID:          cmd.Process.Pid,
		Executable:   exePath,
		StartTime:    p.startedAt,
		CatalinaBase: spec.CatalinaBase,
		MarkerToken:  markerToken,
	}
	p.state = stateRunning
	obs := ProcessObservation{
		PID:      cmd.Process.Pid,
		Identity: p.identity,
		Running:  true,
	}
	p.mu.Unlock()

	// afterStartHook performs platform-specific bookkeeping that must
	// happen after the process has been launched. On Windows it assigns
	// the new process to the agent-wide Job Object so that the OS kills
	// it automatically if the Agent exits. On Unix this is a no-op (we
	// rely on the process group created via SysProcAttr and on the
	// Agent's explicit Shutdown stopping all servers).
	if err := afterStartHook(cmd.Process.Pid); err != nil {
		// Failing to register with the Job Object is not fatal for the
		// process itself, but it weakens the kill-on-exit guarantee.
		// Force-stop the process we just started and return the error
		// so the caller knows the lifecycle tracking is incomplete.
		_ = killProcessGroup(cmd.Process.Pid)
		p.mu.Lock()
		p.state = stateStopped
		p.stoppedAt = time.Now()
		p.exitErr = fmt.Errorf("afterStartHook: %w", err)
		code := -1
		p.exitCode = &code
		p.mu.Unlock()
		closeWaitCh(p)
		return ProcessObservation{}, fmt.Errorf("register process with job: %w", err)
	}

	go p.waitExit(generation, stdoutw, stderrw)

	return obs, nil
}

func (p *realOSProcess) waitExit(generation uint64, stdoutw, stderrw *captureWriter) {
	err := p.cmd.Wait()
	_ = stdoutw.Close()
	_ = stderrw.Close()

	p.mu.Lock()
	if p.generation != generation {
		p.mu.Unlock()
		return
	}
	p.stoppedAt = time.Now()
	if err != nil {
		p.exitErr = err
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code := ee.ExitCode()
			p.exitCode = &code
		} else {
			code := -1
			p.exitCode = &code
		}
	} else {
		code := 0
		p.exitCode = &code
	}
	p.state = stateStopped
	if p.cancel != nil {
		p.cancel()
	}
	p.mu.Unlock()

	closeWaitCh(p)
}

func closeWaitCh(p *realOSProcess) {
	p.waitClosed.Do(func() {
		close(p.waitCh)
	})
}

func (p *realOSProcess) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	p.mu.Lock()
	if p.state != stateRunning || p.cmd == nil || p.cmd.Process == nil {
		p.mu.Unlock()
		return nil
	}
	currentIdentity := p.identity
	pid := p.cmd.Process.Pid
	p.state = stateStopping
	p.mu.Unlock()

	if !identityMatches(currentIdentity, identity) {
		return domain.ErrProcessIdentityMismatch
	}

	if !verifyProcessIdentity(pid, currentIdentity) {
		return domain.ErrProcessIdentityMismatch
	}

	_ = terminateProcessGroup(pid)

	done := make(chan struct{})
	go func() {
		select {
		case <-p.waitCh:
			close(done)
		case <-ctx.Done():
			close(done)
		}
	}()
	<-done

	if ctx.Err() != nil {
		return p.ForceStop(context.Background(), identity)
	}
	return nil
}

func (p *realOSProcess) ForceStop(ctx context.Context, identity domain.ProcessIdentity) error {
	p.mu.Lock()
	if p.cmd == nil || p.cmd.Process == nil || p.state == stateStopped {
		p.mu.Unlock()
		return nil
	}
	pid := p.cmd.Process.Pid
	currentIdentity := p.identity
	p.state = stateStopping
	p.mu.Unlock()

	if !identityMatches(currentIdentity, identity) {
		return domain.ErrProcessIdentityMismatch
	}

	if !verifyProcessIdentity(pid, currentIdentity) {
		return domain.ErrProcessIdentityMismatch
	}

	_ = killProcessGroup(pid)

	select {
	case <-p.waitCh:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *realOSProcess) Inspect(ctx context.Context, identity domain.ProcessIdentity) (ProcessObservation, error) {
	p.mu.Lock()
	if p.state == stateIdle {
		p.mu.Unlock()
		return ProcessObservation{Running: false}, nil
	}
	currentIdentity := p.identity
	pid := 0
	var exitCode *int
	running := false
	if p.cmd != nil && p.cmd.Process != nil {
		pid = p.cmd.Process.Pid
	}
	if p.state == stateRunning || p.state == stateStarting || p.state == stateStopping {
		running = isProcessAlive(pid)
	}
	if p.state == stateStopped {
		exitCode = p.exitCode
		running = false
	}
	p.mu.Unlock()

	mismatch := false
	if running && pid > 0 {
		if !identityMatches(currentIdentity, identity) {
			mismatch = true
		} else if !verifyProcessIdentity(pid, currentIdentity) {
			mismatch = true
		}
	}

	children := findChildProcesses(pid)

	return ProcessObservation{
		PID:              pid,
		Identity:         currentIdentity,
		Running:          running,
		ExitCode:         exitCode,
		IdentityMismatch: mismatch,
		Children:         children,
	}, nil
}

func (p *realOSProcess) ChildProcesses(ctx context.Context, identity domain.ProcessIdentity) ([]int, error) {
	p.mu.Lock()
	if p.cmd == nil || p.cmd.Process == nil {
		p.mu.Unlock()
		return nil, nil
	}
	pid := p.cmd.Process.Pid
	currentIdentity := p.identity
	p.mu.Unlock()

	if !identityMatches(currentIdentity, identity) {
		return nil, domain.ErrProcessIdentityMismatch
	}
	if !verifyProcessIdentity(pid, currentIdentity) {
		return nil, domain.ErrProcessIdentityMismatch
	}

	return findChildProcesses(pid), nil
}

func (p *realOSProcess) SubscribeLogs(listener LogListener) Disposable {
	p.mu.Lock()
	id := p.listenerSeq
	p.listenerSeq++
	p.listeners[id] = listener
	existing := p.logBuf.snapshot()
	p.mu.Unlock()

	for _, line := range existing {
		listener(line)
	}

	return &subscription{p: p, id: id}
}

func (p *realOSProcess) dispatchLine(line domain.LogLine) {
	p.mu.Lock()
	var ls []LogListener
	for _, l := range p.listeners {
		ls = append(ls, l)
	}
	p.mu.Unlock()
	for _, l := range ls {
		l(line)
	}
}

func (p *realOSProcess) removeListener(id uint64) {
	p.mu.Lock()
	delete(p.listeners, id)
	p.mu.Unlock()
}

type subscription struct {
	p  *realOSProcess
	id uint64
}

func (s *subscription) Dispose() {
	s.p.removeListener(s.id)
}

func identityMatches(a, b domain.ProcessIdentity) bool {
	if a.PID != b.PID {
		return false
	}
	if a.MarkerToken != "" && b.MarkerToken != "" && a.MarkerToken != b.MarkerToken {
		return false
	}
	return true
}

type captureWriter struct {
	mu         sync.Mutex
	buf        *ringLogBuffer
	stream     domain.LogStream
	generation uint64
	onLine     func(domain.LogLine)
	partial    []byte
	closed     bool
}

func (w *captureWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return len(p), nil
	}
	data := append(w.partial, p...)
	lines := splitLinesInPlace(data, &w.partial)
	for _, line := range lines {
		ll := domain.LogLine{
			Stream:     w.stream,
			Time:       time.Now(),
			Text:       line,
			Generation: w.generation,
		}
		w.buf.append(ll)
		if w.onLine != nil {
			w.onLine(ll)
		}
	}
	return len(p), nil
}

func (w *captureWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	w.closed = true
	if len(w.partial) > 0 {
		ll := domain.LogLine{
			Stream:     w.stream,
			Time:       time.Now(),
			Text:       string(w.partial),
			Generation: w.generation,
		}
		w.buf.append(ll)
		if w.onLine != nil {
			w.onLine(ll)
		}
		w.partial = nil
	}
	return nil
}

func splitLinesInPlace(data []byte, leftover *[]byte) []string {
	var lines []string
	start := 0
	for i := 0; i < len(data); i++ {
		if data[i] == '\n' {
			line := data[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, string(line))
			start = i + 1
		}
	}
	if start < len(data) {
		*leftover = append((*leftover)[:0], data[start:]...)
	} else {
		*leftover = (*leftover)[:0]
	}
	return lines
}

type ringLogBuffer struct {
	mu       sync.Mutex
	lines    []domain.LogLine
	cap      int
	maxBytes int
	bytes    int
	start    int
	count    int
	seq      uint64
}

func newRingLogBuffer(maxLines, maxBytes int) *ringLogBuffer {
	if maxLines <= 0 {
		maxLines = MaxLogLines
	}
	if maxBytes <= 0 {
		maxBytes = MaxLogBytes
	}
	return &ringLogBuffer{
		lines:    make([]domain.LogLine, maxLines),
		cap:      maxLines,
		maxBytes: maxBytes,
	}
}

func (r *ringLogBuffer) append(line domain.LogLine) {
	r.mu.Lock()
	defer r.mu.Unlock()
	line.Sequence = r.seq
	r.seq++
	lineBytes := len(line.Text)

	for r.count > 0 && (r.bytes+lineBytes > r.maxBytes || r.count == r.cap) {
		old := r.lines[r.start]
		r.bytes -= len(old.Text)
		r.lines[r.start] = domain.LogLine{}
		r.start = (r.start + 1) % r.cap
		r.count--
	}

	idx := (r.start + r.count) % r.cap
	r.lines[idx] = line
	r.bytes += lineBytes
	r.count++
}

func (r *ringLogBuffer) snapshot() []domain.LogLine {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.count == 0 {
		return nil
	}
	out := make([]domain.LogLine, r.count)
	for i := 0; i < r.count; i++ {
		out[i] = r.lines[(r.start+i)%r.cap]
	}
	return out
}

func (r *ringLogBuffer) lineCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.count
}

func (r *ringLogBuffer) byteCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.bytes
}

func generateMarkerToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

var _ io.Closer = (*captureWriter)(nil)
