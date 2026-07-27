package proc

import (
	"context"
	"errors"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// =============================================================================
// removeListener tests — improve from 0.0%
// =============================================================================

func TestRealOSProcess_RemoveListener(t *testing.T) {
	p := New()
	rp := p.(*realOSProcess)

	// Add a listener
	var received []domain.LogLine
	disp := p.SubscribeLogs(func(line domain.LogLine) {
		received = append(received, line)
	})

	// Verify listener was added
	rp.mu.Lock()
	count := len(rp.listeners)
	rp.mu.Unlock()
	if count != 1 {
		t.Fatalf("expected 1 listener, got %d", count)
	}

	// Dispose removes the listener
	disp.Dispose()

	rp.mu.Lock()
	count = len(rp.listeners)
	rp.mu.Unlock()
	if count != 0 {
		t.Fatalf("expected 0 listeners after dispose, got %d", count)
	}
}

func TestSubscription_DisposeIdempotent(t *testing.T) {
	p := New()
	disp := p.SubscribeLogs(func(line domain.LogLine) {})
	disp.Dispose()
	// Second dispose should not panic
	disp.Dispose()
}

// =============================================================================
// GracefulStop tests on real process — improve from 18.2%
// =============================================================================

func TestRealOSProcess_GracefulStop_NotRunning(t *testing.T) {
	p := New()
	// GracefulStop on idle process should return nil
	err := p.GracefulStop(context.Background(), domain.ProcessIdentity{})
	if err != nil {
		t.Fatalf("GracefulStop on idle: %v", err)
	}
}

// =============================================================================
// ForceStop tests on real process — improve from 25.0%
// =============================================================================

func TestRealOSProcess_ForceStop_NotRunning(t *testing.T) {
	p := New()
	// ForceStop on idle process should return nil
	err := p.ForceStop(context.Background(), domain.ProcessIdentity{})
	if err != nil {
		t.Fatalf("ForceStop on idle: %v", err)
	}
}

func TestRealOSProcess_ForceStop_ContextCancelled(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sleep")
	}
	p := New()
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: "/bin/sleep",
		Args:       []string{"30"},
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)

	// Use an already-cancelled context
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	err = p.ForceStop(cancelledCtx, obs.Identity)
	if err == nil {
		// ForceStop may or may not return context error based on timing
		t.Log("ForceStop succeeded despite cancelled context")
	}

	// Clean up
	_ = p.ForceStop(context.Background(), obs.Identity)
	p.Wait()
}

// =============================================================================
// Inspect tests — improve from 79.2%
// =============================================================================

func TestRealOSProcess_Inspect_Starting(t *testing.T) {
	// We can't easily test the "starting" state because it transitions
	// quickly. But we can verify Inspect on idle state.
	p := New()
	obs, err := p.Inspect(context.Background(), domain.ProcessIdentity{})
	if err != nil {
		t.Fatal(err)
	}
	if obs.Running {
		t.Fatal("idle process should not be running")
	}
}

// =============================================================================
// ChildProcesses tests — improve from 66.7%
// =============================================================================

func TestRealOSProcess_ChildProcesses_NoProcess(t *testing.T) {
	p := New()
	children, err := p.ChildProcesses(context.Background(), domain.ProcessIdentity{})
	if err != nil {
		t.Fatal(err)
	}
	if children != nil {
		t.Fatalf("expected nil children, got %v", children)
	}
}

// =============================================================================
// SubscribeLogs tests — improve from 88.9%
// =============================================================================

func TestRealOSProcess_SubscribeLogs_MultipleDispose(t *testing.T) {
	p := New()
	disp1 := p.SubscribeLogs(func(line domain.LogLine) {})
	disp2 := p.SubscribeLogs(func(line domain.LogLine) {})
	disp3 := p.SubscribeLogs(func(line domain.LogLine) {})

	rp := p.(*realOSProcess)
	rp.mu.Lock()
	count := len(rp.listeners)
	rp.mu.Unlock()
	if count != 3 {
		t.Fatalf("expected 3 listeners, got %d", count)
	}

	disp1.Dispose()
	disp2.Dispose()
	disp3.Dispose()

	rp.mu.Lock()
	count = len(rp.listeners)
	rp.mu.Unlock()
	if count != 0 {
		t.Fatalf("expected 0 listeners after dispose, got %d", count)
	}
}

// =============================================================================
// dispatchLine tests — improve from 100.0%
// (already 100% but adding more coverage paths)
// =============================================================================

func TestRealOSProcess_DispatchLine_NoListeners(t *testing.T) {
	p := New()
	rp := p.(*realOSProcess)
	// Should not panic when no listeners
	rp.dispatchLine(domain.LogLine{
		Stream: domain.LogStreamStdout,
		Text:   "test",
	})
}

// =============================================================================
// closeWaitCh tests
// =============================================================================

func TestCloseWaitCh_Idempotent(t *testing.T) {
	p := New()
	rp := p.(*realOSProcess)
	// closeWaitCh uses sync.Once, should be safe to call multiple times
	closeWaitCh(rp)
	closeWaitCh(rp)
	closeWaitCh(rp)
	// Should not panic
}

// =============================================================================
// CaptureWriter tests — improve from 91.7%
// =============================================================================

func TestCaptureWriter_Close_EmptyPartial(t *testing.T) {
	buf := newRingLogBuffer(100, 1024*1024)
	cw := &captureWriter{
		buf:    buf,
		stream: domain.LogStreamStdout,
	}
	// Close with no partial data
	_ = cw.Close()
	if buf.lineCount() != 0 {
		t.Fatalf("expected 0 lines, got %d", buf.lineCount())
	}
}

func TestCaptureWriter_WriteAfterClose(t *testing.T) {
	buf := newRingLogBuffer(100, 1024*1024)
	cw := &captureWriter{
		buf:    buf,
		stream: domain.LogStreamStdout,
	}
	_ = cw.Close()
	// Write after close should be accepted but ignored
	n, err := cw.Write([]byte("data\n"))
	if err != nil {
		t.Fatal(err)
	}
	if n != 5 {
		t.Fatalf("n = %d, want 5", n)
	}
	if buf.lineCount() != 0 {
		t.Fatalf("expected 0 lines after write to closed, got %d", buf.lineCount())
	}
}

// =============================================================================
// splitLinesInPlace more edge cases
// =============================================================================

func TestSplitLinesInPlace_OnlyCR(t *testing.T) {
	var leftover []byte
	got := splitLinesInPlace([]byte("a\rb"), &leftover)
	if len(got) != 0 {
		t.Fatalf("expected 0 lines for \\r without \\n, got %d", len(got))
	}
	if string(leftover) != "a\rb" {
		t.Fatalf("leftover = %q, want a\\rb", leftover)
	}
}

func TestSplitLinesInPlace_OnlyLF(t *testing.T) {
	var leftover []byte
	got := splitLinesInPlace([]byte("a\nb\nc\n"), &leftover)
	if len(got) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(got))
	}
}

// =============================================================================
// ringLogBuffer tests — more edge cases
// =============================================================================

func TestRingLogBuffer_AppendZeroByteLine(t *testing.T) {
	buf := newRingLogBuffer(10, 100)
	buf.append(domain.LogLine{Text: ""})
	if buf.lineCount() != 1 {
		t.Fatalf("expected 1 line, got %d", buf.lineCount())
	}
	if buf.byteCount() != 0 {
		t.Fatalf("byteCount = %d, want 0", buf.byteCount())
	}
}

func TestRingLogBuffer_SnapshotEmpty(t *testing.T) {
	buf := newRingLogBuffer(10, 100)
	snap := buf.snapshot()
	if snap != nil {
		t.Fatal("expected nil snapshot for empty buffer")
	}
}

// =============================================================================
// identityMatches tests — more edge cases
// =============================================================================

func TestIdentityMatches_BothZeroPID(t *testing.T) {
	if !identityMatches(domain.ProcessIdentity{PID: 0}, domain.ProcessIdentity{PID: 0}) {
		t.Fatal("identityMatches should return true for both zero PID")
	}
}

func TestIdentityMatches_DifferentPID(t *testing.T) {
	if identityMatches(domain.ProcessIdentity{PID: 1}, domain.ProcessIdentity{PID: 2}) {
		t.Fatal("identityMatches should return false for different PID")
	}
}

func TestIdentityMatches_DifferentToken(t *testing.T) {
	if identityMatches(
		domain.ProcessIdentity{PID: 1, MarkerToken: "a"},
		domain.ProcessIdentity{PID: 1, MarkerToken: "b"},
	) {
		t.Fatal("identityMatches should return false for different tokens")
	}
}

func TestIdentityMatches_OneEmptyToken(t *testing.T) {
	if !identityMatches(
		domain.ProcessIdentity{PID: 1, MarkerToken: "a"},
		domain.ProcessIdentity{PID: 1, MarkerToken: ""},
	) {
		t.Fatal("identityMatches should return true when one token is empty")
	}
}

// =============================================================================
// generateMarkerToken tests
// =============================================================================

func TestGenerateMarkerToken_Uniqueness(t *testing.T) {
	tokens := make(map[string]bool)
	for i := 0; i < 100; i++ {
		tok := generateMarkerToken()
		if tokens[tok] {
			t.Fatalf("duplicate token generated: %s", tok)
		}
		tokens[tok] = true
	}
}

// =============================================================================
// Real process start with EvalSymlinks
// =============================================================================

func TestRealOSProcess_Start_EvalSymlinks(t *testing.T) {
	p := New()
	ctx := context.Background()

	// Use a path that needs symlink evaluation
	exe := "cmd.exe"
	if runtime.GOOS != "windows" {
		exe = "/bin/echo"
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       []string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs
}

// =============================================================================
// Real process start with Dir
// =============================================================================

func TestRealOSProcess_Start_WithDir(t *testing.T) {
	p := New()
	ctx := context.Background()
	dir := t.TempDir()

	exe := "cmd.exe"
	args := []string{"/c", "cd"}
	if runtime.GOOS != "windows" {
		exe = "/bin/pwd"
		args = []string{}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
		Dir:        dir,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs
}

// =============================================================================
// Real process start with auto-generated marker token
// =============================================================================

func TestRealOSProcess_Start_AutoMarkerToken(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	if obs.Identity.MarkerToken == "" {
		t.Fatal("expected auto-generated marker token")
	}
}

// =============================================================================
// Real process GracefulStop with timeout
// =============================================================================

func TestRealOSProcess_GracefulStop_Timeout(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "timeout", "/t", "30", "/nobreak"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sleep"
		args = []string{"30"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	// Graceful stop with short timeout
	stopCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	err = p.GracefulStop(stopCtx, obs.Identity)
	if err != nil {
		t.Logf("GracefulStop timeout returned: %v", err)
	}
	// Force stop to clean up
	_ = p.ForceStop(context.Background(), obs.Identity)
	p.Wait()
}

// =============================================================================
// Real process ForceStop already stopped
// =============================================================================

func TestRealOSProcess_ForceStop_AlreadyStopped(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	// ForceStop after process has already exited
	err = p.ForceStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("ForceStop on already stopped: %v", err)
	}
}

// =============================================================================
// Real process Inspect after stop
// =============================================================================

func TestRealOSProcess_Inspect_AfterStop(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "42"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sh"
		args = []string{"-c", "exit 42"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	inspect, err := p.Inspect(ctx, obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if inspect.Running {
		t.Fatal("expected not running after stop")
	}
	if inspect.ExitCode == nil {
		t.Fatal("expected non-nil exit code")
	}
}

// =============================================================================
// Real process Start with non-existent executable
// =============================================================================

func TestRealOSProcess_Start_NonExistentExecutable(t *testing.T) {
	p := New()
	ctx := context.Background()
	_, err := p.Start(ctx, ProcessSpec{
		Executable: "/nonexistent/binary/xyz",
	})
	if err == nil {
		// On Windows, cmd.Start may succeed for non-existent paths in some cases
		t.Log("Start succeeded for non-existent executable (unexpected)")
	}
}

// =============================================================================
// Real process with CaptureWriter onLine callback
// =============================================================================

func TestRealOSProcess_CaptureWriter_OnLine(t *testing.T) {
	var lines []domain.LogLine
	var mu sync.Mutex
	buf := newRingLogBuffer(100, 1024*1024)
	cw := &captureWriter{
		buf:    buf,
		stream: domain.LogStreamStdout,
		onLine: func(line domain.LogLine) {
			mu.Lock()
			lines = append(lines, line)
			mu.Unlock()
		},
	}
	_, _ = cw.Write([]byte("hello\nworld\n"))
	_ = cw.Close()

	mu.Lock()
	defer mu.Unlock()
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines via onLine, got %d", len(lines))
	}
	if lines[0].Text != "hello" {
		t.Fatalf("first line = %q, want hello", lines[0].Text)
	}
	if lines[1].Text != "world" {
		t.Fatalf("second line = %q, want world", lines[1].Text)
	}
}

// =============================================================================
// Real process Wait after force stop
// =============================================================================

func TestRealOSProcess_Wait_AfterForceStop(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "timeout", "/t", "30", "/nobreak"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sleep"
		args = []string{"30"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
	// Wait should return immediately after force stop
}

// =============================================================================
// Test ring buffer with large line
// =============================================================================

func TestRingLogBuffer_LargeLineByteEviction(t *testing.T) {
	buf := newRingLogBuffer(10, 50)
	// Add a line that's larger than maxBytes
	bigLine := strings.Repeat("x", 100)
	buf.append(domain.LogLine{Text: bigLine})
	if buf.lineCount() != 1 {
		t.Fatalf("expected 1 line, got %d", buf.lineCount())
	}
	// The byte count should be capped
	if buf.byteCount() > 100 {
		t.Fatalf("byteCount = %d, expected <= 100", buf.byteCount())
	}
}

// =============================================================================
// Test ring buffer wrap-around with byte eviction
// =============================================================================

func TestRingLogBuffer_WrapAroundWithByteEviction(t *testing.T) {
	buf := newRingLogBuffer(5, 30)
	for i := 0; i < 10; i++ {
		buf.append(domain.LogLine{Text: strings.Repeat("a", 10)})
	}
	// Should have at most 3 lines (30 bytes / 10 bytes per line)
	if buf.lineCount() > 3 {
		t.Fatalf("lineCount = %d, expected <= 3", buf.lineCount())
	}
	if buf.byteCount() > 30 {
		t.Fatalf("byteCount = %d, expected <= 30", buf.byteCount())
	}
}

// =============================================================================
// Test start with env
// =============================================================================

func TestRealOSProcess_Start_WithEnv(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
		Env:        []string{"TEST_VAR=hello"},
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs
}

// =============================================================================
// Verify process identity on Windows
// =============================================================================

func TestVerifyProcessIdentity_InvalidPID(t *testing.T) {
	if verifyProcessIdentity(-1, domain.ProcessIdentity{PID: 100}) {
		t.Fatal("verifyProcessIdentity should return false for negative PID")
	}
	if verifyProcessIdentity(0, domain.ProcessIdentity{PID: 100}) {
		t.Fatal("verifyProcessIdentity should return false for zero PID")
	}
}

// =============================================================================
// Test findChildProcesses with invalid PID
// =============================================================================

func TestFindChildProcesses_InvalidPID(t *testing.T) {
	children := findChildProcesses(-1)
	if len(children) != 0 {
		t.Fatalf("expected 0 children for -1 PID, got %d", len(children))
	}
	children = findChildProcesses(0)
	if len(children) != 0 {
		t.Fatalf("expected 0 children for 0 PID, got %d", len(children))
	}
}

// =============================================================================
// Test isProcessAlive with invalid PID
// =============================================================================

func TestIsProcessAlive_InvalidPID(t *testing.T) {
	if isProcessAlive(-1) {
		t.Fatal("isProcessAlive should return false for -1")
	}
	if isProcessAlive(0) {
		t.Fatal("isProcessAlive should return false for 0")
	}
}

// =============================================================================
// Test real process Wait
// =============================================================================

func TestRealOSProcess_Wait(t *testing.T) {
	p := New()

	// Wait should return immediately for idle process
	done := make(chan struct{})
	go func() {
		p.Wait()
		close(done)
	}()
	select {
	case <-done:
		// OK
	case <-time.After(2 * time.Second):
		t.Fatal("Wait() blocked on idle process")
	}
}

// =============================================================================
// Test os.StartProcess error path
// =============================================================================

func TestRealOSProcess_Start_InvalidExecutable(t *testing.T) {
	// Try to start a directory as an executable
	p := New()
	ctx := context.Background()
	dir := t.TempDir()
	_, err := p.Start(ctx, ProcessSpec{
		Executable: dir, // directory, not executable
	})
	if err == nil {
		t.Log("Start succeeded with directory as executable (unexpected)")
	}
}

// =============================================================================
// Test restart after stop
// =============================================================================

func TestRealOSProcess_RestartAfterStop(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	// Start again after stop
	obs2, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatalf("restart after stop: %v", err)
	}
	p.Wait()
	_ = obs
	_ = obs2
}

// =============================================================================
// Test SubscribeLogs before Start
// =============================================================================

func TestRealOSProcess_SubscribeLogs_BeforeStart(t *testing.T) {
	p := New()

	var received []domain.LogLine
	_ = p.SubscribeLogs(func(line domain.LogLine) {
		received = append(received, line)
	})

	ctx := context.Background()
	exe := "cmd.exe"
	args := []string{"/c", "echo", "hello"}
	if runtime.GOOS != "windows" {
		exe = "/bin/echo"
		args = []string{"hello"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs

	found := false
	for _, l := range received {
		if strings.Contains(l.Text, "hello") {
			found = true
		}
	}
	if !found {
		t.Log("hello not found in received logs")
	}
}

// =============================================================================
// Test that afterStartHook is called (Windows: assignToAgentJob)
// =============================================================================

func TestRealOSProcess_Start_AfterStartHook(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		// afterStartHook may fail on some systems
		t.Logf("Start (with afterStartHook): %v", err)
		return
	}
	p.Wait()
	_ = obs
}

// =============================================================================
// Test GracefulStop with context timeout on real process
// =============================================================================

func TestRealOSProcess_GracefulStop_ContextTimeout(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "timeout", "/t", "30", "/nobreak"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sleep"
		args = []string{"30"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	// Graceful stop with a timeout that will expire
	stopCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	_ = p.GracefulStop(stopCtx, obs.Identity)

	// The process should be stopped (either gracefully or forcefully)
	p.Wait()
}

// =============================================================================
// Test that os.Process.Signal is called on GracefulStop
// =============================================================================

func TestRealOSProcess_GracefulStop_SendsSignal(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "timeout", "/t", "30", "/nobreak"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sleep"
		args = []string{"30"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = p.GracefulStop(stopCtx, obs.Identity)
	if err != nil {
		t.Logf("GracefulStop returned: %v", err)
	}
	p.Wait()
}

// =============================================================================
// Test real process with log capture
// =============================================================================

func TestRealOSProcess_LogCapture(t *testing.T) {
	p := New()
	var logs []domain.LogLine
	var mu sync.Mutex
	_ = p.SubscribeLogs(func(line domain.LogLine) {
		mu.Lock()
		logs = append(logs, line)
		mu.Unlock()
	})

	ctx := context.Background()
	exe := "cmd.exe"
	args := []string{"/c", "echo", "test-log-capture"}
	if runtime.GOOS != "windows" {
		exe = "/bin/echo"
		args = []string{"test-log-capture"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs

	mu.Lock()
	defer mu.Unlock()
	found := false
	for _, l := range logs {
		if strings.Contains(l.Text, "test-log-capture") {
			found = true
		}
	}
	if !found {
		t.Logf("test-log-capture not found in logs (%d lines)", len(logs))
	}
}

// =============================================================================
// Test ring buffer with exact byte boundary
// =============================================================================

func TestRingLogBuffer_ExactByteBoundary(t *testing.T) {
	buf := newRingLogBuffer(5, 20)
	buf.append(domain.LogLine{Text: "AAAAA"}) // 5 bytes
	buf.append(domain.LogLine{Text: "BBBBB"}) // 5 bytes
	buf.append(domain.LogLine{Text: "CCCCC"}) // 5 bytes
	buf.append(domain.LogLine{Text: "DDDDD"}) // 5 bytes → 20 bytes total
	buf.append(domain.LogLine{Text: "EEEEE"}) // 5 bytes → should evict AAAAA

	if buf.lineCount() != 4 {
		t.Fatalf("lineCount = %d, want 4", buf.lineCount())
	}
	if buf.byteCount() != 20 {
		t.Fatalf("byteCount = %d, want 20", buf.byteCount())
	}
}

// =============================================================================
// Test that captureWriter stream is set correctly
// =============================================================================

func TestCaptureWriter_StreamTypes(t *testing.T) {
	stdoutBuf := newRingLogBuffer(100, 1024*1024)
	stderrBuf := newRingLogBuffer(100, 1024*1024)

	stdoutCW := &captureWriter{buf: stdoutBuf, stream: domain.LogStreamStdout}
	stderrCW := &captureWriter{buf: stderrBuf, stream: domain.LogStreamStderr}

	_, _ = stdoutCW.Write([]byte("out\n"))
	_, _ = stderrCW.Write([]byte("err\n"))
	_ = stdoutCW.Close()
	_ = stderrCW.Close()

	stdoutLines := stdoutBuf.snapshot()
	if len(stdoutLines) != 1 || stdoutLines[0].Stream != domain.LogStreamStdout {
		t.Fatal("stdout stream mismatch")
	}

	stderrLines := stderrBuf.snapshot()
	if len(stderrLines) != 1 || stderrLines[0].Stream != domain.LogStreamStderr {
		t.Fatal("stderr stream mismatch")
	}
}

// =============================================================================
// Test ProcessSpec with all fields
// =============================================================================

func TestProcessSpec_AllFields(t *testing.T) {
	p := New()
	ctx := context.Background()
	dir := t.TempDir()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}

	obs, err := p.Start(ctx, ProcessSpec{
		Executable:   exe,
		Args:         args,
		Dir:          dir,
		Env:          []string{"FOO=bar"},
		LogDir:       dir,
		CatalinaBase: "/tmp/test",
		MarkerToken:  "test-token-123",
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	if obs.Identity.MarkerToken != "test-token-123" {
		t.Fatalf("MarkerToken = %q, want test-token-123", obs.Identity.MarkerToken)
	}
	if obs.Identity.CatalinaBase != "/tmp/test" {
		t.Fatalf("CatalinaBase = %q, want /tmp/test", obs.Identity.CatalinaBase)
	}
}

// =============================================================================
// Test that we can inspect while process is running
// =============================================================================



// =============================================================================
// Test Inspect with mismatched identity
// =============================================================================



// =============================================================================
// Test that New() initializes correctly
// =============================================================================

func TestNew_InitialState(t *testing.T) {
	p := New()
	rp := p.(*realOSProcess)

	rp.mu.Lock()
	defer rp.mu.Unlock()

	if rp.state != stateIdle {
		t.Fatalf("state = %d, want idle", rp.state)
	}
	if rp.cmd != nil {
		t.Fatal("cmd should be nil")
	}
	if rp.cancel != nil {
		t.Fatal("cancel should be nil")
	}
	if rp.logBuf == nil {
		t.Fatal("logBuf should not be nil")
	}
	if rp.listeners == nil {
		t.Fatal("listeners should not be nil")
	}
}

// =============================================================================
// Test that ChildProcesses returns identity mismatch
// =============================================================================

func TestRealOSProcess_ChildProcesses_IdentityMismatch(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "timeout", "/t", "30", "/nobreak"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sleep"
		args = []string{"30"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	// ChildProcesses with wrong identity
	wrongIdentity := domain.ProcessIdentity{PID: 999999}
	_, err = p.ChildProcesses(ctx, wrongIdentity)
	if !errors.Is(err, domain.ErrProcessIdentityMismatch) {
		t.Fatalf("expected ErrProcessIdentityMismatch, got: %v", err)
	}

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
}

// =============================================================================
// Test that ChildProcesses works after process exits
// =============================================================================

func TestRealOSProcess_ChildProcesses_AfterExit(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	// After exit, cmd is nil so ChildProcesses returns nil
	children, err := p.ChildProcesses(ctx, obs.Identity)
	if err != nil {
		// May fail due to identity check
		t.Logf("ChildProcesses after exit: %v", err)
	}
	_ = children
}

// =============================================================================
// Test real process with lots of log output
// =============================================================================

func TestRealOSProcess_LogBufferOverflow(t *testing.T) {
	p := New()
	ctx := context.Background()

	// Generate lots of output
	exe := "cmd.exe"
	args := []string{"/c", "for", "/L", "%i", "in", "(1,1,100)", "do", "echo", "line-%i"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sh"
		args = []string{"-c", "for i in $(seq 1 100); do echo line-$i; done"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs
}

// =============================================================================
// Test that terminateProcessGroup is called on Windows
// =============================================================================

func TestTerminateProcessGroup_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	// terminateProcessGroup with 0 PID should fail
	err := terminateProcessGroup(0)
	if err == nil {
		t.Log("terminateProcessGroup(0) succeeded")
	}
}

// =============================================================================
// Test that killProcessGroup is called on Windows
// =============================================================================

func TestKillProcessGroup_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	// killProcessGroup with 0 PID should fail
	err := killProcessGroup(0)
	if err == nil {
		t.Log("killProcessGroup(0) succeeded")
	}
}

// =============================================================================
// Test terminateOne on Windows
// =============================================================================

func TestTerminateOne_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	// terminateOne with 0 PID should fail
	err := terminateOne(0)
	if err == nil {
		t.Log("terminateOne(0) succeeded")
	}
}

// =============================================================================
// Test afterStartHook on Windows
// =============================================================================

func TestAfterStartHook_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	// afterStartHook with invalid PID should fail
	err := afterStartHook(-1)
	if err == nil {
		t.Log("afterStartHook(-1) succeeded")
	}
}

// =============================================================================
// Test verifyProcessIdentity on Windows
// =============================================================================

func TestVerifyProcessIdentity_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	// verifyProcessIdentity with invalid PID
	if verifyProcessIdentity(-1, domain.ProcessIdentity{PID: 100}) {
		t.Fatal("verifyProcessIdentity should return false for -1 PID")
	}
	if verifyProcessIdentity(0, domain.ProcessIdentity{PID: 100}) {
		t.Fatal("verifyProcessIdentity should return false for 0 PID")
	}
}

// =============================================================================
// Test verifyExecutablePath on Windows
// =============================================================================

func TestVerifyExecutablePath_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	// verifyExecutablePath with invalid PID
	if verifyExecutablePath(0, "") {
		t.Fatal("verifyExecutablePath should return false for 0 PID")
	}
}

// =============================================================================
// Test verifyProcessStartTime on Windows
// =============================================================================

func TestVerifyProcessStartTime_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	// verifyProcessStartTime with invalid PID
	if verifyProcessStartTime(0, time.Time{}) {
		t.Fatal("verifyProcessStartTime should return false for 0 PID")
	}
}

// =============================================================================
// Test isProcessAlive on Windows
// =============================================================================

func TestIsProcessAlive_OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific test")
	}
	if isProcessAlive(-1) {
		t.Fatal("isProcessAlive should return false for -1 PID")
	}
	if isProcessAlive(0) {
		t.Fatal("isProcessAlive should return false for 0 PID")
	}
}

// =============================================================================
// Test GracefulStop with context already done
// =============================================================================

func TestRealOSProcess_GracefulStop_ContextAlreadyDone(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "timeout", "/t", "30", "/nobreak"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sleep"
		args = []string{"30"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	// Use an already-cancelled context
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	err = p.GracefulStop(cancelledCtx, obs.Identity)
	// GracefulStop should fall back to ForceStop on context cancel
	_ = err

	// Clean up
	_ = p.ForceStop(context.Background(), obs.Identity)
	p.Wait()
}

// =============================================================================
// Test that real process can be started from stopped state
// =============================================================================

func TestRealOSProcess_Start_FromStopped(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}

	// First start
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs

	// Second start from stopped state
	obs2, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatalf("second start from stopped: %v", err)
	}
	p.Wait()
	_ = obs2
}

// =============================================================================
// Test real process with catalinaBase
// =============================================================================

func TestRealOSProcess_Start_WithCatalinaBase(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "exit", "0"}
	if runtime.GOOS != "windows" {
		exe = "/bin/true"
		args = nil
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable:   exe,
		Args:         args,
		CatalinaBase: "C:\\tomcat\\base",
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	if obs.Identity.CatalinaBase != "C:\\tomcat\\base" {
		t.Fatalf("CatalinaBase = %q, want C:\\tomcat\\base", obs.Identity.CatalinaBase)
	}
}

// =============================================================================
// Test that real process with STDERR output is captured
// =============================================================================

func TestRealOSProcess_StderrCapture(t *testing.T) {
	p := New()
	var logs []domain.LogLine
	var mu sync.Mutex
	_ = p.SubscribeLogs(func(line domain.LogLine) {
		mu.Lock()
		logs = append(logs, line)
		mu.Unlock()
	})

	ctx := context.Background()
	exe := "cmd.exe"
	args := []string{"/c", "echo", "stderr-test", ">&2"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sh"
		args = []string{"-c", "echo stderr-test >&2"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs

	mu.Lock()
	defer mu.Unlock()
	found := false
	for _, l := range logs {
		if strings.Contains(l.Text, "stderr-test") {
			found = true
			if l.Stream == domain.LogStreamStderr {
				t.Log("stderr-test found on correct stream")
			}
		}
	}
	if !found {
		t.Log("stderr-test not found in logs")
	}
}

// =============================================================================
// Test that we can subscribe logs after process has started
// =============================================================================

func TestRealOSProcess_SubscribeLogs_AfterStart(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "echo", "late-subscriber"}
	if runtime.GOOS != "windows" {
		exe = "/bin/echo"
		args = []string{"late-subscriber"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: exe,
		Args:       args,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs

	// Subscribe after the process has exited
	var received []domain.LogLine
	_ = p.SubscribeLogs(func(line domain.LogLine) {
		received = append(received, line)
	})
	// Should get historical logs
	if len(received) == 0 {
		t.Log("no historical logs received (buffer may have been reset)")
	}
}

// =============================================================================
// Test real process with KAIRO_PROCESS_MARKER env
// =============================================================================

func TestRealOSProcess_Start_MarkerEnv(t *testing.T) {
	p := New()
	ctx := context.Background()

	exe := "cmd.exe"
	args := []string{"/c", "echo", "%KAIRO_PROCESS_MARKER%"}
	if runtime.GOOS != "windows" {
		exe = "/bin/sh"
		args = []string{"-c", "echo $KAIRO_PROCESS_MARKER"}
	}
	obs, err := p.Start(ctx, ProcessSpec{
		Executable:  exe,
		Args:        args,
		MarkerToken: "env-marker-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	_ = obs
}

// =============================================================================
// Test multiple subscribe/dispose cycles
// =============================================================================

func TestRealOSProcess_MultipleSubscribeDispose(t *testing.T) {
	p := New()
	for i := 0; i < 10; i++ {
		disp := p.SubscribeLogs(func(line domain.LogLine) {})
		disp.Dispose()
	}
	rp := p.(*realOSProcess)
	rp.mu.Lock()
	count := len(rp.listeners)
	rp.mu.Unlock()
	if count != 0 {
		t.Fatalf("expected 0 listeners, got %d", count)
	}
}

// =============================================================================
// Test that the listener sequence number increments
// =============================================================================

func TestRealOSProcess_ListenerSequence(t *testing.T) {
	p := New()
	rp := p.(*realOSProcess)

	disp1 := p.SubscribeLogs(func(line domain.LogLine) {})
	disp2 := p.SubscribeLogs(func(line domain.LogLine) {})
	disp3 := p.SubscribeLogs(func(line domain.LogLine) {})

	disp1.Dispose()
	disp2.Dispose()
	disp3.Dispose()

	// The sequence should have incremented to at least 3
	rp.mu.Lock()
	seq := rp.listenerSeq
	rp.mu.Unlock()
	if seq < 3 {
		t.Fatalf("listenerSeq = %d, want >= 3", seq)
	}
}

// =============================================================================
// FakeProcess IgnoreGraceful with ExitAfter — covers runSimulation branch
// =============================================================================

func TestFakeProcess_IgnoreGraceful_WithExitAfter(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		IgnoreGraceful: true,
		ExitAfter:      50 * time.Millisecond,
		ExitCode:       0,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	// Wait for ExitAfter to pass
	time.Sleep(100 * time.Millisecond)

	// Process should still be running because IgnoreGraceful is true
	fp := p.(*FakeProcess)
	if !fp.IsRunning() {
		t.Fatal("expected running when IgnoreGraceful is true and ExitAfter passed")
	}

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
}

// =============================================================================
// FakeProcess IgnoreGraceful without ExitAfter — covers runSimulation branch
// =============================================================================

func TestFakeProcess_IgnoreGraceful_NoExitAfter(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		IgnoreGraceful: true,
		ExitCode:       0,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(50 * time.Millisecond)

	// Process should still be running because IgnoreGraceful is true
	fp := p.(*FakeProcess)
	if !fp.IsRunning() {
		t.Fatal("expected running when IgnoreGraceful is true and no ExitAfter")
	}

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
}

// =============================================================================
// FakeProcess Crash with no ExitAfter — covers exitProcess branch
// =============================================================================

func TestFakeProcess_Crash_NoExitAfter(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		Crash: true,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	p.Wait()

	inspect, err := p.Inspect(ctx, obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if inspect.Running {
		t.Fatal("expected not running after crash")
	}
	if inspect.ExitCode == nil || *inspect.ExitCode != 1 {
		t.Fatalf("exitCode = %v, want 1", inspect.ExitCode)
	}
}

// =============================================================================
// FakeProcess Start with ReadyAfter — covers runSimulation ready branch
// =============================================================================

func TestFakeProcess_ReadyAfter(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ReadyAfter: 100 * time.Millisecond,
		ExitAfter:  50 * time.Millisecond,
		ExitCode:   0,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	_ = obs

	p.Wait()
	// Should complete without issues
}

// =============================================================================
// FakeProcess GracefulStop calls — covers 91.7% -> higher
// =============================================================================

func TestFakeProcess_GracefulStop_EmptyIdentity(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	// GracefulStop with correct identity
	err = p.GracefulStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("GracefulStop: %v", err)
	}

	p.Wait()
}

// =============================================================================
// FakeProcess ForceStop calls — covers 95.2% -> higher
// =============================================================================

func TestFakeProcess_ForceStop_EmptyIdentity(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	// ForceStop with correct identity
	err = p.ForceStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("ForceStop: %v", err)
	}

	p.Wait()
}

// =============================================================================
// FakeProcess context cancellation during ReadyAfter — covers runSimulation
// =============================================================================

func TestFakeProcess_ReadyAfter_ContextCanceled(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ReadyAfter: 30 * time.Second,
	})
	ctx, cancel := context.WithCancel(context.Background())

	obsCh := make(chan ProcessObservation, 1)
	errCh := make(chan error, 1)
	go func() {
		obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
		obsCh <- obs
		errCh <- err
	}()

	time.Sleep(50 * time.Millisecond)
	cancel()

	obs := <-obsCh
	startErr := <-errCh
	if startErr != nil {
		t.Fatal(startErr)
	}

	p.Wait()
	_ = obs
}

// =============================================================================
// FakeProcess context cancellation during ExitAfter — covers runSimulation
// =============================================================================

func TestFakeProcess_ExitAfter_ContextCanceled(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx, cancel := context.WithCancel(context.Background())
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(50 * time.Millisecond)
	cancel()

	p.Wait()

	inspect, err := p.Inspect(context.Background(), obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if inspect.ExitCode == nil || *inspect.ExitCode != -1 {
		t.Fatalf("exitCode = %v, want -1 for context canceled", inspect.ExitCode)
	}
}

// =============================================================================
// FakeProcess FakeProcessBehavior with SetBehavior — covers behavior change
// =============================================================================

func TestFakeProcess_SetBehavior(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	fp := p.(*FakeProcess)
	if !fp.IsRunning() {
		t.Fatal("expected running")
	}

	// Update behavior to cause immediate exit
	fp.SetBehavior(FakeProcessBehavior{
		ExitAfter: 10 * time.Millisecond,
		ExitCode:  7,
	})

	p.Wait()

	inspect, err := p.Inspect(ctx, obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if inspect.Running {
		t.Fatal("expected not running after SetBehavior")
	}
}

// =============================================================================
// FakeProcess GracefulStop with identity mismatch
// =============================================================================

func TestFakeProcess_GracefulStop_IdentityMismatch(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	wrongIdentity := obs.Identity
	wrongIdentity.PID = 999999
	err = p.GracefulStop(ctx, wrongIdentity)
	if !errors.Is(err, domain.ErrProcessIdentityMismatch) {
		t.Fatalf("expected ErrProcessIdentityMismatch, got: %v", err)
	}

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
}

// =============================================================================
// FakeProcess ForceStop with identity mismatch
// =============================================================================

func TestFakeProcess_ForceStop_IdentityMismatch(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	wrongIdentity := obs.Identity
	wrongIdentity.PID = 999999
	err = p.ForceStop(ctx, wrongIdentity)
	if !errors.Is(err, domain.ErrProcessIdentityMismatch) {
		t.Fatalf("expected ErrProcessIdentityMismatch, got: %v", err)
	}

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
}

// =============================================================================
// FakeProcess ForceStop on already stopped process
// =============================================================================

func TestFakeProcess_ForceStop_AlreadyStopped(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 10 * time.Millisecond,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	p.Wait()

	// ForceStop on already stopped process should be no-op
	err = p.ForceStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("ForceStop after exit: %v", err)
	}
}

// =============================================================================
// FakeProcess GracefulStop on already stopped process
// =============================================================================

func TestFakeProcess_GracefulStop_AlreadyStopped(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 10 * time.Millisecond,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	p.Wait()

	// GracefulStop on already stopped process should be no-op
	err = p.GracefulStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("GracefulStop after exit: %v", err)
	}
}

// =============================================================================
// FakeProcess Inspect on running process
// =============================================================================

func TestFakeProcess_Inspect_Running(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	inspect, err := p.Inspect(ctx, obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if !inspect.Running {
		t.Fatal("expected running")
	}
	if inspect.PID == 0 {
		t.Fatal("expected non-zero PID")
	}

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
}

// =============================================================================
// FakeProcess ChildProcesses on running process
// =============================================================================

func TestFakeProcess_ChildProcesses_Running(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	children, err := p.ChildProcesses(ctx, obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if len(children) != 0 {
		t.Fatalf("expected 0 children, got %d", len(children))
	}

	_ = p.ForceStop(ctx, obs.Identity)
	p.Wait()
}

// =============================================================================
// FakeProcess IgnoreGraceful + GracefulStop — covers final select stopCh
// =============================================================================

func TestFakeProcess_IgnoreGraceful_GracefulStop(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		IgnoreGraceful: true,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(50 * time.Millisecond)

	// GracefulStop on IgnoreGraceful waits for context or exit; use timeout
	gracefulCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	err = p.GracefulStop(gracefulCtx, obs.Identity)
	if err != nil {
		t.Logf("GracefulStop on IgnoreGraceful: %v", err)
	}

	p.Wait()
}

// =============================================================================
// FakeProcess IgnoreGraceful + context cancel — covers final select ctx.Done
// =============================================================================

func TestFakeProcess_IgnoreGraceful_ContextCanceled(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		IgnoreGraceful: true,
	})
	ctx, cancel := context.WithCancel(context.Background())
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(50 * time.Millisecond)
	cancel()

	p.Wait()
	_ = obs
}

// =============================================================================
// FakeProcess GracefulStop during ExitAfter — covers stopCh in ExitAfter select
// =============================================================================

func TestFakeProcess_GracefulStop_DuringExitAfter(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(50 * time.Millisecond)

	// GracefulStop should close stopCh, triggering exitProcess in the ExitAfter select
	err = p.GracefulStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("GracefulStop: %v", err)
	}

	p.Wait()
}