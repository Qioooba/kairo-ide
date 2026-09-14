package api

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// T33: State file atomic write and generation monotonicity:
// Older generation cannot overwrite newer generation; stale instance exit does not delete newer state file.
func TestLifecycle_StateFile_AtomicMonotonicity_T33(t *testing.T) {
	dir := t.TempDir()

	// 1. Initial write: Generation 1, PID 100
	st1 := AgentState{
		InstanceID:  "inst_100",
		Generation:  1,
		PID:         100,
		Port:        18080,
		BindAddress: "127.0.0.1",
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
		Status:      "ready",
	}
	if err := WriteAgentStateAtomic(dir, st1); err != nil {
		t.Fatalf("WriteAgentStateAtomic Gen 1: %v", err)
	}

	read1, err := ReadAgentState(dir)
	if err != nil {
		t.Fatalf("ReadAgentState: %v", err)
	}
	if read1.Generation != 1 || read1.PID != 100 || read1.Status != "ready" {
		t.Fatalf("unexpected read1 state: %+v", read1)
	}

	// 2. Reject stale overwrite: Generation 0 (< 1)
	stOld := AgentState{
		InstanceID:  "inst_old",
		Generation:  0,
		PID:         99,
		Port:        18080,
		BindAddress: "127.0.0.1",
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
		Status:      "ready",
	}
	if err := WriteAgentStateAtomic(dir, stOld); err == nil {
		t.Fatalf("expected error overwriting Gen 1 with Gen 0, got nil")
	}

	// 3. Successor generation takes over: Generation 2, PID 200
	st2 := AgentState{
		InstanceID:  "inst_200",
		Generation:  2,
		PID:         200,
		Port:        18080,
		BindAddress: "127.0.0.1",
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
		Status:      "ready",
	}
	if err := WriteAgentStateAtomic(dir, st2); err != nil {
		t.Fatalf("WriteAgentStateAtomic Gen 2: %v", err)
	}

	read2, err := ReadAgentState(dir)
	if err != nil {
		t.Fatalf("ReadAgentState Gen 2: %v", err)
	}
	if read2.Generation != 2 || read2.PID != 200 {
		t.Fatalf("unexpected read2 state: %+v", read2)
	}

	// 4. Stale Generation 1 exits and calls RemoveAgentState(dir, 100, 1)
	// It MUST NOT delete the state file because Generation 2 owns it!
	if err := RemoveAgentState(dir, 100, 1); err != nil {
		t.Fatalf("RemoveAgentState Gen 1: %v", err)
	}

	readAfterStaleExit, err := ReadAgentState(dir)
	if err != nil {
		t.Fatalf("state file was erroneously deleted by stale generation: %v", err)
	}
	if readAfterStaleExit.Generation != 2 || readAfterStaleExit.PID != 200 {
		t.Fatalf("state file content modified: %+v", readAfterStaleExit)
	}

	// 5. Current Generation 2 exits and calls RemoveAgentState(dir, 200, 2)
	if err := RemoveAgentState(dir, 200, 2); err != nil {
		t.Fatalf("RemoveAgentState Gen 2: %v", err)
	}

	if _, err := ReadAgentState(dir); err == nil {
		t.Fatalf("expected state file to be removed after active generation exited")
	}
}

// T31: Verify ListenWithHandoff succeeds when the preceding process holds the port and shuts down slowly.
func TestLifecycle_ListenWithHandoff_SlowShutdownSuccess_T31(t *testing.T) {
	// Allocate a free local port
	tmpLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("allocate port: %v", err)
	}
	addr := tmpLn.Addr().String()
	port := tmpLn.Addr().(*net.TCPAddr).Port

	// In a background goroutine, simulate slow predecessor process shutting down after 300ms
	go func() {
		time.Sleep(300 * time.Millisecond)
		_ = tmpLn.Close()
	}()

	// The successor calls ListenWithHandoff with a 3s timeout
	start := time.Now()
	ln, err := ListenWithHandoff(context.Background(), addr, 3*time.Second)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("ListenWithHandoff failed: %v", err)
	}
	defer ln.Close()

	if elapsed < 250*time.Millisecond {
		t.Fatalf("expected ListenWithHandoff to wait for slow shutdown, but returned too fast in %v", elapsed)
	}

	boundPort := ln.Addr().(*net.TCPAddr).Port
	if boundPort != port {
		t.Fatalf("boundPort = %d, want %d", boundPort, port)
	}
}

// T32: Verify ListenWithHandoff times out gracefully when port is permanently occupied by another process.
func TestLifecycle_ListenWithHandoff_PortOccupiedTimeout_T32(t *testing.T) {
	dir := t.TempDir()

	// Occupy a port and keep it open
	occupiedLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy port: %v", err)
	}
	defer occupiedLn.Close()

	addr := occupiedLn.Addr().String()

	// Successor attempts to bind with 200ms timeout
	_, err = ListenWithHandoff(context.Background(), addr, 200*time.Millisecond)
	if err == nil {
		t.Fatalf("expected ListenWithHandoff to fail due to timeout, got nil")
	}

	if !isAddrInUse(err) && !isAddrInUseMessage(err) {
		t.Fatalf("expected address in use / timeout error, got %v", err)
	}

	// Write failed status to agent-state.json and verify diagnosis is preserved
	stFailed := AgentState{
		InstanceID:  "inst_failed",
		Generation:  1,
		PID:         12345,
		Port:        occupiedLn.Addr().(*net.TCPAddr).Port,
		BindAddress: "127.0.0.1",
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
		Status:      "failed",
		Error:       err.Error(),
	}
	if err := WriteAgentStateAtomic(dir, stFailed); err != nil {
		t.Fatalf("WriteAgentStateAtomic failed: %v", err)
	}

	readFailed, err := ReadAgentState(dir)
	if err != nil {
		t.Fatalf("ReadAgentState failed: %v", err)
	}
	if readFailed.Status != "failed" || readFailed.Error == "" {
		t.Fatalf("expected status=failed with diagnostic error, got: %+v", readFailed)
	}
}

func isAddrInUseMessage(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return len(s) > 0
}

// T33: Verify 20 rapid concurrent clicks to POST /api/v1/runtime/restart only trigger one restart execution.
func TestLifecycle_ConcurrentRestartClicks_Idempotent_T33(t *testing.T) {
	logger := log.New("test-restart").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	defer auditLog.Close()

	srv := NewServer(&Services{}, logger, auditLog, "0.1.0", "secret")

	var onShutdownCount atomic.Int32
	srv.SetRestartConfig(RestartConfig{
		NoExec:          true, // do not spawn or os.Exit in test
		ShutdownTimeout: 1 * time.Second,
		OnShutdown: func(ctx context.Context) error {
			onShutdownCount.Add(1)
			time.Sleep(50 * time.Millisecond)
			return nil
		},
	})

	handler := srv.Handler()

	const concurrentClicks = 20
	var wg sync.WaitGroup
	var successCount atomic.Int32

	for i := 0; i < concurrentClicks; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/runtime/restart", nil)
			req.Header.Set("X-Kairo-Secret", "secret")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code == http.StatusOK {
				successCount.Add(1)
			}
		}()
	}

	wg.Wait()

	if successCount.Load() != concurrentClicks {
		t.Fatalf("expected all %d requests to receive HTTP 200, got %d", concurrentClicks, successCount.Load())
	}

	// Wait for background doRestart goroutine to finish
	time.Sleep(200 * time.Millisecond)

	// Exactly 1 restart should have executed
	if onShutdownCount.Load() != 1 {
		t.Fatalf("expected OnShutdown to run exactly 1 time, got %d", onShutdownCount.Load())
	}
}
