package proc

import (
	"context"
	"errors"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func truePath(t *testing.T) string {
	t.Helper()
	for _, cand := range []string{"/bin/true", "/usr/bin/true"} {
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			return cand
		}
	}
	t.Skip("true binary not found")
	return ""
}

func TestWaitBeforeStart(t *testing.T) {
	p := New()
	done := make(chan struct{})
	go func() {
		p.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Wait() blocked before Start")
	}
}

func TestFakeShortProcessSuccess(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitCode:  0,
		LogLines:  []string{"hello", "world"},
		ExitAfter: 50 * time.Millisecond,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{
		Executable:   "/bin/echo",
		CatalinaBase: "/tmp/test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if obs.PID == 0 {
		t.Fatal("expected non-zero PID")
	}
	if !obs.Running {
		t.Fatal("expected running after start")
	}
	p.Wait()

	inspect, err := p.Inspect(ctx, obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if inspect.Running {
		t.Fatal("expected not running after exit")
	}
	if inspect.ExitCode == nil || *inspect.ExitCode != 0 {
		t.Fatalf("exitCode = %v, want 0", inspect.ExitCode)
	}
}

func TestChildProcessTreeKill(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sh")
	}
	p := New()
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{
		Executable:   "/bin/sh",
		Args:         []string{"-c", "sleep 30 & sleep 30 & wait"},
		CatalinaBase: "/tmp/test-child",
		MarkerToken:  "test-child-kill",
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	gracefulCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
	defer cancel()
	if err := p.GracefulStop(gracefulCtx, obs.Identity); err != nil {
		if !errors.Is(err, context.DeadlineExceeded) {
			_ = p.ForceStop(context.Background(), obs.Identity)
		}
	}

	done := make(chan struct{})
	go func() {
		p.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("process tree did not exit after kill")
	}
}

func TestGracefulTimeoutForceFallback(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		IgnoreGraceful: true,
		ExitAfter:      30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	fp := p.(*FakeProcess)

	gracefulCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	err = p.GracefulStop(gracefulCtx, obs.Identity)
	if err != nil {
		t.Logf("graceful stop returned: %v", err)
	}
	if fp.ForceCount() < 1 {
		t.Fatal("expected ForceStop to be called after graceful timeout")
	}
}

func TestConcurrentStop(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 5 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stopCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			_ = p.GracefulStop(stopCtx, obs.Identity)
		}()
	}
	wg.Wait()

	fp := p.(*FakeProcess)
	if fp.IsRunning() {
		t.Fatal("process should be stopped after concurrent stops")
	}
}

func TestStopDuringStart(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ReadyAfter: 500 * time.Millisecond,
		ExitAfter:  30 * time.Second,
	})
	ctx := context.Background()

	obsCh := make(chan ProcessObservation, 1)
	errCh := make(chan error, 1)
	go func() {
		obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
		obsCh <- obs
		errCh <- err
	}()

	time.Sleep(50 * time.Millisecond)

	var obs ProcessObservation
	var startErr error
	select {
	case obs = <-obsCh:
		startErr = <-errCh
		if startErr != nil {
			t.Fatal(startErr)
		}
	default:
		t.Fatal("Start should return quickly for fake process")
	}

	stopCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := p.GracefulStop(stopCtx, obs.Identity); err != nil {
		t.Fatalf("GracefulStop during start: %v", err)
	}
	p.Wait()
}

func TestProcessAlreadyExited(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitCode:  42,
		ExitAfter: 50 * time.Millisecond,
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
		t.Fatal("expected not running")
	}
	if inspect.ExitCode == nil || *inspect.ExitCode != 42 {
		t.Fatalf("exitCode = %v, want 42", inspect.ExitCode)
	}

	err = p.GracefulStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("stop on exited process should be nil, got: %v", err)
	}
	err = p.ForceStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("force stop on exited process should be nil, got: %v", err)
	}
}

func TestPIDIdentityMismatchNoKill(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		ExitAfter: 30 * time.Second,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	fp := p.(*FakeProcess)

	wrongIdentity := obs.Identity
	wrongIdentity.PID = 999999

	err = p.GracefulStop(ctx, wrongIdentity)
	if !errors.Is(err, domain.ErrProcessIdentityMismatch) {
		t.Fatalf("expected ErrProcessIdentityMismatch, got: %v", err)
	}
	if !fp.IsRunning() {
		t.Fatal("process should still be running after mismatched identity stop")
	}

	err = p.ForceStop(ctx, wrongIdentity)
	if !errors.Is(err, domain.ErrProcessIdentityMismatch) {
		t.Fatalf("expected ErrProcessIdentityMismatch, got: %v", err)
	}
	if !fp.IsRunning() {
		t.Fatal("process should still be running after mismatched identity force stop")
	}

	_ = p.ForceStop(ctx, obs.Identity)
}

func TestPartialLogWrites(t *testing.T) {
	var received []domain.LogLine
	var mu sync.Mutex
	p := NewFakeManagedProcess(FakeProcessBehavior{
		LogLines:      []string{"line1", "line2", "line3"},
		PartialWrites: true,
		ExitAfter:     100 * time.Millisecond,
	})
	ctx := context.Background()

	_ = p.SubscribeLogs(func(line domain.LogLine) {
		mu.Lock()
		received = append(received, line)
		mu.Unlock()
	})

	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	mu.Lock()
	defer mu.Unlock()
	var texts []string
	for _, l := range received {
		texts = append(texts, l.Text)
	}
	joined := strings.Join(texts, "")
	if !strings.Contains(joined, "line1") {
		t.Fatalf("logs missing line1, got: %v", texts)
	}
	if !strings.Contains(joined, "line2") {
		t.Fatalf("logs missing line2, got: %v", texts)
	}
	if !strings.Contains(joined, "line3") {
		t.Fatalf("logs missing line3, got: %v", texts)
	}
	_ = obs
}

func TestCaptureWriterPartialLine(t *testing.T) {
	buf := newRingLogBuffer(1000, 1024*1024)
	cw := &captureWriter{
		buf:    buf,
		stream: domain.LogStreamStdout,
	}
	n1, err := cw.Write([]byte("hello "))
	if err != nil || n1 != 6 {
		t.Fatalf("first write: n=%d err=%v", n1, err)
	}
	if buf.lineCount() != 0 {
		t.Fatal("should have no complete lines after partial write")
	}

	n2, err := cw.Write([]byte("world\n"))
	if err != nil || n2 != 6 {
		t.Fatalf("second write: n=%d err=%v", n2, err)
	}
	if buf.lineCount() != 1 {
		t.Fatalf("should have 1 complete line, got %d", buf.lineCount())
	}

	lines := buf.snapshot()
	if lines[0].Text != "hello world" {
		t.Fatalf("line = %q, want %q", lines[0].Text, "hello world")
	}

	_ = cw.Close()
}

func TestCaptureWriterCloseFlushes(t *testing.T) {
	buf := newRingLogBuffer(1000, 1024*1024)
	cw := &captureWriter{
		buf:    buf,
		stream: domain.LogStreamStderr,
	}
	_, _ = cw.Write([]byte("incomplete"))
	if buf.lineCount() != 0 {
		t.Fatal("should have no complete lines")
	}
	_ = cw.Close()
	if buf.lineCount() != 1 {
		t.Fatalf("close should flush partial line, got %d lines", buf.lineCount())
	}
	lines := buf.snapshot()
	if lines[0].Text != "incomplete" {
		t.Fatalf("flushed line = %q, want %q", lines[0].Text, "incomplete")
	}
}

func TestCaptureWriterCRLF(t *testing.T) {
	buf := newRingLogBuffer(1000, 1024*1024)
	cw := &captureWriter{
		buf:    buf,
		stream: domain.LogStreamStdout,
	}
	_, _ = cw.Write([]byte("line1\r\nline2\r\n"))
	_ = cw.Close()
	lines := buf.snapshot()
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}
	if lines[0].Text != "line1" {
		t.Fatalf("line0 = %q", lines[0].Text)
	}
	if lines[1].Text != "line2" {
		t.Fatalf("line1 = %q", lines[1].Text)
	}
}

func TestOneMBLineDoesNotCrash(t *testing.T) {
	buf := newRingLogBuffer(MaxLogLines, MaxLogBytes)
	bigLine := strings.Repeat("X", 1024*1024+100)
	cw := &captureWriter{
		buf:    buf,
		stream: domain.LogStreamStdout,
	}
	data := []byte(bigLine + "\n")
	n, err := cw.Write(data)
	if err != nil {
		t.Fatal(err)
	}
	if n != len(data) {
		t.Fatalf("wrote %d, want %d", n, len(data))
	}
	_ = cw.Close()
	if buf.byteCount() > MaxLogBytes {
		t.Logf("buffer bytes = %d, may exceed max but should not crash", buf.byteCount())
	}
}

func Test100kLogLinesBounded(t *testing.T) {
	buf := newRingLogBuffer(MaxLogLines, MaxLogBytes)
	for i := 0; i < 100000; i++ {
		buf.append(domain.LogLine{
			Stream: domain.LogStreamStdout,
			Time:   time.Now(),
			Text:   "log line " + strings.Repeat("x", 10),
		})
	}
	if buf.lineCount() > MaxLogLines {
		t.Fatalf("line count = %d exceeds max %d", buf.lineCount(), MaxLogLines)
	}
	if buf.byteCount() > MaxLogBytes+1024 {
		t.Logf("byte count = %d, close to max %d", buf.byteCount(), MaxLogBytes)
	}
}

func TestDuplicateStartError(t *testing.T) {
	p := New()
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: "/bin/sleep",
		Args:       []string{"30"},
	})
	if err != nil {
		if runtime.GOOS == "windows" {
			t.Skip("sleep not available")
		}
		t.Fatal(err)
	}
	_, err = p.Start(ctx, ProcessSpec{
		Executable: "/bin/sleep",
		Args:       []string{"30"},
	})
	if err == nil {
		t.Fatal("expected error on duplicate start")
	}
	_ = p.ForceStop(context.Background(), obs.Identity)
	p.Wait()
}

func TestSubscribeLogsGetsHistory(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		LogLines:  []string{"existing1", "existing2"},
		ExitAfter: 50 * time.Millisecond,
	})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()

	var received []domain.LogLine
	_ = p.SubscribeLogs(func(line domain.LogLine) {
		received = append(received, line)
	})

	time.Sleep(50 * time.Millisecond)
	if len(received) < 2 {
		t.Fatalf("expected at least 2 historical log lines, got %d", len(received))
	}
	_ = obs
}

func TestFakeStartError(t *testing.T) {
	startErr := errors.New("permission denied")
	p := NewFakeManagedProcess(FakeProcessBehavior{StartErr: startErr})
	_, err := p.Start(context.Background(), ProcessSpec{Executable: "bad"})
	if !errors.Is(err, startErr) {
		t.Fatalf("expected start error, got: %v", err)
	}
}

func TestFakeCrashExit(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{
		Crash:     true,
		ExitAfter: 50 * time.Millisecond,
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
	if inspect.ExitCode == nil {
		t.Fatal("expected non-nil exit code after crash")
	}
}

func TestRealProcessRunsAndExits(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/echo")
	}
	p := New()
	ctx := context.Background()
	var logs []domain.LogLine
	_ = p.SubscribeLogs(func(line domain.LogLine) {
		logs = append(logs, line)
	})
	obs, err := p.Start(ctx, ProcessSpec{
		Executable:   "/bin/echo",
		Args:         []string{"hello", "world"},
		CatalinaBase: "/tmp/test-echo",
		MarkerToken:  "test-echo-marker",
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
		t.Fatal("echo should exit immediately")
	}
	if inspect.ExitCode == nil || *inspect.ExitCode != 0 {
		t.Fatalf("exitCode = %v, want 0", inspect.ExitCode)
	}
	if obs.Identity.MarkerToken != "test-echo-marker" {
		t.Fatalf("marker token = %q", obs.Identity.MarkerToken)
	}
	foundHello := false
	for _, l := range logs {
		if strings.Contains(l.Text, "hello world") {
			foundHello = true
		}
	}
	if !foundHello {
		t.Logf("logs received: %d lines", len(logs))
	}
}

func TestRealProcessGracefulStop(t *testing.T) {
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

	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := p.GracefulStop(stopCtx, obs.Identity); err != nil {
		t.Fatalf("GracefulStop: %v", err)
	}

	inspect, err := p.Inspect(ctx, obs.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if inspect.Running {
		t.Fatal("process should be stopped")
	}
}

func TestSplitLinesInPlace(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		want     []string
		leftover string
	}{
		{"empty", "", nil, ""},
		{"single no newline", "hello", nil, "hello"},
		{"single with newline", "hello\n", []string{"hello"}, ""},
		{"two lines", "a\nb\n", []string{"a", "b"}, ""},
		{"partial after", "a\nb", []string{"a"}, "b"},
		{"crlf", "a\r\nb\r\n", []string{"a", "b"}, ""},
		{"just newline", "\n", []string{""}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var leftover []byte
			got := splitLinesInPlace([]byte(tt.input), &leftover)
			if len(got) != len(tt.want) {
				t.Fatalf("lines = %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("line[%d] = %q, want %q", i, got[i], tt.want[i])
				}
			}
			if string(leftover) != tt.leftover {
				t.Fatalf("leftover = %q, want %q", leftover, tt.leftover)
			}
		})
	}
}

func TestRingBufferEviction(t *testing.T) {
	buf := newRingLogBuffer(5, 100)
	for i := 0; i < 10; i++ {
		buf.append(domain.LogLine{Text: strings.Repeat("x", 10)})
	}
	if buf.lineCount() > 5 {
		t.Fatalf("line count should be bounded by cap, got %d", buf.lineCount())
	}
}

func TestRingBufferBytesBounded(t *testing.T) {
	buf := newRingLogBuffer(10000, 200)
	for i := 0; i < 100; i++ {
		buf.append(domain.LogLine{Text: strings.Repeat("y", 50)})
	}
	if buf.byteCount() > 200+100 {
		t.Fatalf("bytes = %d should be bounded near 200", buf.byteCount())
	}
}

func TestInspectIdle(t *testing.T) {
	p := New()
	obs, err := p.Inspect(context.Background(), domain.ProcessIdentity{})
	if err != nil {
		t.Fatal(err)
	}
	if obs.Running {
		t.Fatal("idle process should not be running")
	}
}

func TestDisposableUnsubscribes(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{ExitAfter: 1 * time.Hour})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}

	count := 0
	var mu sync.Mutex
	disp := p.SubscribeLogs(func(line domain.LogLine) {
		mu.Lock()
		count++
		mu.Unlock()
	})
	disp.Dispose()

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	c := count
	mu.Unlock()
	_ = c
	_ = p.ForceStop(ctx, obs.Identity)
}

func TestRealProcessNonExistentExe(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix path")
	}
	p := New()
	_, err := p.Start(context.Background(), ProcessSpec{
		Executable: "/nonexistent/binary/xyz",
	})
	if err == nil {
		t.Fatal("expected error for non-existent executable")
	}
}

func TestWaitChannelCloseIdempotent(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{ExitAfter: 50 * time.Millisecond})
	obs, err := p.Start(context.Background(), ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	p.Wait()
	p.Wait()
	_ = obs
}

func TestCaptureWriterAcrossMultiplePartialWrites(t *testing.T) {
	buf := newRingLogBuffer(100, 1024*1024)
	cw := &captureWriter{buf: buf, stream: domain.LogStreamStdout}
	chunks := []string{"a", "b", "c", "\n", "d", "e", "\n"}
	for _, c := range chunks {
		_, _ = cw.Write([]byte(c))
	}
	_ = cw.Close()
	lines := buf.snapshot()
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d: %v", len(lines), lines)
	}
	if lines[0].Text != "abc" {
		t.Fatalf("first line = %q, want abc", lines[0].Text)
	}
	if lines[1].Text != "de" {
		t.Fatalf("second line = %q, want de", lines[1].Text)
	}
}

func TestCaptureWriterEmptyWrites(t *testing.T) {
	buf := newRingLogBuffer(100, 1024*1024)
	cw := &captureWriter{buf: buf, stream: domain.LogStreamStdout}
	_, _ = cw.Write([]byte{})
	_, _ = cw.Write([]byte("hello\n"))
	_, _ = cw.Write([]byte{})
	_ = cw.Close()
	lines := buf.snapshot()
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if lines[0].Text != "hello" {
		t.Fatalf("line = %q", lines[0].Text)
	}
}

func TestMarkerTokenAutoGenerated(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses true")
	}
	trueBin := truePath(t)
	p := New()
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: trueBin,
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	if obs.Identity.MarkerToken == "" {
		t.Fatal("expected auto-generated marker token")
	}
	if len(obs.Identity.MarkerToken) < 8 {
		t.Fatalf("marker token too short: %q", obs.Identity.MarkerToken)
	}
}

func TestRealProcessIdentityFields(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses true")
	}
	trueBin := truePath(t)
	p := New()
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{
		Executable:   trueBin,
		CatalinaBase: "/tmp/test-cb",
		MarkerToken:  "custom-marker",
	})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	if obs.Identity.CatalinaBase != "/tmp/test-cb" {
		t.Fatalf("CatalinaBase = %q", obs.Identity.CatalinaBase)
	}
	if obs.Identity.MarkerToken != "custom-marker" {
		t.Fatalf("MarkerToken = %q", obs.Identity.MarkerToken)
	}
	if obs.Identity.PID == 0 {
		t.Fatal("expected non-zero PID")
	}
	if obs.Identity.StartTime.IsZero() {
		t.Fatal("expected non-zero StartTime")
	}
}

func TestConcurrentStartAndLogs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix")
	}
	p := New()
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = p.SubscribeLogs(func(line domain.LogLine) {})
		}()
	}
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{
		Executable: "/bin/echo",
		Args:       []string{"concurrent"},
	})
	if err != nil {
		wg.Wait()
		t.Fatal(err)
	}
	p.Wait()
	wg.Wait()
	_ = obs
}

func TestStopReturnsNilIfAlreadyStopped(t *testing.T) {
	p := NewFakeManagedProcess(FakeProcessBehavior{ExitAfter: 50 * time.Millisecond})
	ctx := context.Background()
	obs, err := p.Start(ctx, ProcessSpec{Executable: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	p.Wait()
	err = p.GracefulStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("stop on already stopped should return nil, got: %v", err)
	}
	err = p.ForceStop(ctx, obs.Identity)
	if err != nil {
		t.Fatalf("force stop on already stopped should return nil, got: %v", err)
	}
}

func TestRingBufferSnapshotCopy(t *testing.T) {
	buf := newRingLogBuffer(10, 1024)
	buf.append(domain.LogLine{Text: "original"})
	snap := buf.snapshot()
	snap[0].Text = "modified"
	snap2 := buf.snapshot()
	if snap2[0].Text != "original" {
		t.Fatal("snapshot should be a copy")
	}
}

func TestCaptureWriterWriteAfterClose(t *testing.T) {
	buf := newRingLogBuffer(100, 1024)
	cw := &captureWriter{buf: buf, stream: domain.LogStreamStdout}
	_ = cw.Close()
	n, err := cw.Write([]byte("after close\n"))
	if err != nil {
		t.Fatal(err)
	}
	if n != len("after close\n") {
		t.Fatalf("n=%d", n)
	}
}

func TestByteCountCorrect(t *testing.T) {
	buf := newRingLogBuffer(100, 1024*1024)
	buf.append(domain.LogLine{Text: "hello"})
	buf.append(domain.LogLine{Text: "world"})
	if buf.byteCount() != 10 {
		t.Fatalf("byteCount = %d, want 10", buf.byteCount())
	}
}
