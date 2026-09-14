package build

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

// CustomBuildConfig defines a custom build execution.
type CustomBuildConfig struct {
	BuildID     string            `json:"buildId"`
	ProjectRoot string            `json:"projectRoot"`
	Command     string            `json:"command"`
	WorkingDir  string            `json:"workingDir"`
	Env         map[string]string `json:"env"`
	// TimeoutMs overrides the default 30-minute custom-build deadline.
	// Zero keeps the default. Used by tests and callers that need a shorter cap.
	TimeoutMs int64 `json:"timeoutMs,omitempty"`
}

// BuildEvent represents a streaming event during build execution.
type BuildEvent struct {
	Type       string `json:"type"` // "start", "log", "finish", "cancel", "error"
	BuildID    string `json:"buildId"`
	Pid        int    `json:"pid,omitempty"`
	Stream     string `json:"stream,omitempty"` // "stdout" or "stderr"
	Line       string `json:"line,omitempty"`
	ExitCode   int    `json:"exitCode,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Message    string `json:"message,omitempty"`
	Code       string `json:"code,omitempty"`
	TS         int64  `json:"ts"`
}

// BuildEventHandler is called for each build event.
type BuildEventHandler func(event BuildEvent)

// CustomBuildExecutor manages custom build command execution and lifecycle (F19 / T27).
type CustomBuildExecutor struct {
	mu      sync.Mutex
	running map[string]*customBuildJob
	results map[string]customBuildResult
	handler BuildEventHandler
}

type customBuildJob struct {
	cmd       *exec.Cmd
	cancel    context.CancelFunc
	done      chan struct{}
	startTime time.Time
}

type customBuildResult struct {
	status   string // "finished" | "cancelled" | "error"
	exitCode int
}

// NewCustomBuildExecutor creates a new executor.
func NewCustomBuildExecutor(handler BuildEventHandler) *CustomBuildExecutor {
	return &CustomBuildExecutor{
		running: make(map[string]*customBuildJob),
		results: make(map[string]customBuildResult),
		handler: handler,
	}
}

// Start begins executing a custom build command.
func (e *CustomBuildExecutor) Start(ctx context.Context, cfg CustomBuildConfig) error {
	return e.StartWithCancel(ctx, nil, cfg)
}

// StartWithCancel begins executing a custom build with context ownership and cancel func (F19 / T27).
func (e *CustomBuildExecutor) StartWithCancel(ctx context.Context, cancel context.CancelFunc, cfg CustomBuildConfig) error {
	e.mu.Lock()
	if _, exists := e.running[cfg.BuildID]; exists {
		e.mu.Unlock()
		if cancel != nil {
			cancel() // Immediate release of timer! (F19 / T27)
		}
		return fmt.Errorf("build %s is already running", cfg.BuildID)
	}
	delete(e.results, cfg.BuildID)
	handler := e.handler
	e.mu.Unlock()

	// Parse command: split on spaces respecting quotes
	cmdParts := shellSplit(cfg.Command)
	if len(cmdParts) == 0 {
		if cancel != nil {
			cancel() // Immediate release of timer! (F19 / T27)
		}
		return fmt.Errorf("empty command")
	}
	exe := cmdParts[0]
	args := cmdParts[1:]

	cmd := exec.CommandContext(ctx, exe, args...)

	// Set working directory
	if cfg.WorkingDir != "" {
		cmd.Dir = cfg.WorkingDir
	} else {
		cmd.Dir = cfg.ProjectRoot
	}

	// Set environment variables
	cmd.Env = os.Environ()
	for k, v := range cfg.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	// Set platform-specific process attributes for cleanup
	cmd.SysProcAttr = sysProcAttrForBuild()

	// Create pipes for stdout/stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		if cancel != nil {
			cancel() // Immediate release of timer! (F19 / T27)
		}
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		if cancel != nil {
			cancel() // Immediate release of timer! (F19 / T27)
		}
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		if cancel != nil {
			cancel() // Immediate release of timer on start failure! (F19 / T27)
		}
		if handler != nil {
			handler(BuildEvent{
				Type:    "error",
				BuildID: cfg.BuildID,
				Message: fmt.Sprintf("Failed to start: %v", err),
				Code:    "COMMAND_NOT_FOUND",
				TS:      time.Now().UnixMilli(),
			})
		}
		return fmt.Errorf("start command: %w", err)
	}

	job := &customBuildJob{
		cmd:       cmd,
		cancel:    cancel,
		done:      make(chan struct{}),
		startTime: time.Now(),
	}

	e.mu.Lock()
	// Re-check in case of concurrent Start with same ID after unlock.
	if _, exists := e.running[cfg.BuildID]; exists {
		e.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		_ = killProcessGroup(cmd)
		return fmt.Errorf("build %s is already running", cfg.BuildID)
	}
	e.running[cfg.BuildID] = job
	e.mu.Unlock()

	startTime := job.startTime
	if handler != nil {
		handler(BuildEvent{
			Type:    "start",
			BuildID: cfg.BuildID,
			Pid:     cmd.Process.Pid,
			TS:      startTime.UnixMilli(),
		})
	}

	// Drain pipes before treating Wait as complete (GO-P2-4).
	var pipeWG sync.WaitGroup
	pipeWG.Add(2)
	go func() {
		defer pipeWG.Done()
		e.streamLogs(cfg.BuildID, stdout, "stdout")
	}()
	go func() {
		defer pipeWG.Done()
		e.streamLogs(cfg.BuildID, stderr, "stderr")
	}()

	go func() {
		defer func() {
			if cancel != nil {
				cancel() // Release timer immediately upon process completion! (F19 / T27)
			}
			close(job.done)
		}()
		err := cmd.Wait()
		pipeWG.Wait()
		e.mu.Lock()
		delete(e.running, cfg.BuildID)
		duration := time.Since(startTime).Milliseconds()
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = -1
			}
		}
		prevResult, wasCancelled := e.results[cfg.BuildID]
		isCancelled := wasCancelled && prevResult.status == "cancelled"
		if !isCancelled {
			e.results[cfg.BuildID] = customBuildResult{status: "finished", exitCode: exitCode}
		}
		finishHandler := e.handler
		e.mu.Unlock()

		if finishHandler != nil && !isCancelled {
			finishHandler(BuildEvent{
				Type:       "finish",
				BuildID:    cfg.BuildID,
				ExitCode:   exitCode,
				DurationMs: duration,
				TS:         time.Now().UnixMilli(),
			})
		}
	}()

	return nil
}

// Cancel stops a running build.
func (e *CustomBuildExecutor) Cancel(buildID string) error {
	e.mu.Lock()
	job, ok := e.running[buildID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("build %s not running", buildID)
	}
	e.results[buildID] = customBuildResult{status: "cancelled", exitCode: -1}
	e.mu.Unlock()

	if e.handler != nil {
		e.handler(BuildEvent{
			Type:    "cancel",
			BuildID: buildID,
			TS:      time.Now().UnixMilli(),
		})
	}

	if job.cancel != nil {
		job.cancel() // Immediate cancel release! (F19 / T27)
	}

	err := killProcessGroup(job.cmd)
	select {
	case <-job.done:
	case <-time.After(2 * time.Second):
	}
	return err
}

// Close terminates all active builds and releases all context resources.
func (e *CustomBuildExecutor) Close() error {
	e.mu.Lock()
	jobs := make([]*customBuildJob, 0, len(e.running))
	for _, job := range e.running {
		jobs = append(jobs, job)
	}
	e.mu.Unlock()

	for _, job := range jobs {
		if job.cancel != nil {
			job.cancel()
		}
		_ = killProcessGroup(job.cmd)
		select {
		case <-job.done:
		case <-time.After(1 * time.Second):
		}
	}
	return nil
}

// IsRunning checks if a build is currently running.
func (e *CustomBuildExecutor) IsRunning(buildID string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	_, ok := e.running[buildID]
	return ok
}

// Status returns the current status of a build.
// status is "running" | "finished" | "cancelled" | "unknown".
func (e *CustomBuildExecutor) Status(buildID string) (status string, exitCode int, known bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, ok := e.running[buildID]; ok {
		return "running", 0, true
	}
	if res, ok := e.results[buildID]; ok {
		return res.status, res.exitCode, true
	}
	return "unknown", 0, false
}

// RunningBuilds returns a list of currently running build IDs.
func (e *CustomBuildExecutor) RunningBuilds() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	ids := make([]string, 0, len(e.running))
	for id := range e.running {
		ids = append(ids, id)
	}
	return ids
}

func (e *CustomBuildExecutor) streamLogs(buildID string, reader io.Reader, stream string) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024) // 1MB max line
	for scanner.Scan() {
		if e.handler == nil {
			continue
		}
		e.handler(BuildEvent{
			Type:    "log",
			BuildID: buildID,
			Stream:  stream,
			Line:    scanner.Text(),
			TS:      time.Now().UnixMilli(),
		})
	}
}

// shellSplit splits a command string into parts, respecting quotes.
func shellSplit(command string) []string {
	var parts []string
	var current []byte
	inQuote := false
	quoteChar := byte(0)

	for i := 0; i < len(command); i++ {
		ch := command[i]
		if inQuote {
			if ch == quoteChar {
				inQuote = false
			} else {
				current = append(current, ch)
			}
		} else {
			switch ch {
			case '"', '\'':
				inQuote = true
				quoteChar = ch
			case ' ', '\t':
				if len(current) > 0 {
					parts = append(parts, string(current))
					current = nil
				}
			default:
				current = append(current, ch)
			}
		}
	}
	if len(current) > 0 {
		parts = append(parts, string(current))
	}
	return parts
}

// killProcessGroup kills a process and its children.
func killProcessGroup(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return killProcessTree(cmd.Process.Pid)
}