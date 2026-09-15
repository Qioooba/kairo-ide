package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

func makeTestEnvelope(reqID, corrID string, payload map[string]any) []byte {
	raw, _ := json.Marshal(payload)
	b := []byte(fmt.Sprintf(`{"requestId":%q,"correlationId":%q,"payload":`, reqID, corrID))
	b = append(b, raw...)
	b = append(b, '}')
	return b
}

// mockProjectStore for idempotency testing
type mockIdempotentProjectStore struct {
	mu       sync.Mutex
	projects map[string]domain.Project
}

func newMockIdempotentProjectStore() *mockIdempotentProjectStore {
	return &mockIdempotentProjectStore{
		projects: make(map[string]domain.Project),
	}
}

func (m *mockIdempotentProjectStore) List() []domain.Project {
	m.mu.Lock()
	defer m.mu.Unlock()
	res := make([]domain.Project, 0, len(m.projects))
	for _, p := range m.projects {
		res = append(res, p)
	}
	return res
}

func (m *mockIdempotentProjectStore) Get(id string) (domain.Project, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.projects[id]
	if !ok {
		return domain.Project{}, fmt.Errorf("project not found: %s", id)
	}
	return p, nil
}

func (m *mockIdempotentProjectStore) Update(id string, cfg *domain.Project) (domain.Project, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.projects[id] = *cfg
	return *cfg, nil
}

func (m *mockIdempotentProjectStore) Delete(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.projects, id)
	return nil
}

// mockCountingBuildEngine counts execution calls and simulates work
type mockCountingBuildEngine struct {
	startCalls int64
	delay      time.Duration
}

func (m *mockCountingBuildEngine) Start(req BuildRequest) (*BuildResult, error) {
	atomic.AddInt64(&m.startCalls, 1)
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	return &BuildResult{
		ID:        "build-idempotent-123",
		State:     "success",
		ProjectID: req.ProjectID,
	}, nil
}

func (m *mockCountingBuildEngine) Get(id string) (*BuildResult, error) {
	return &BuildResult{ID: id, State: "success"}, nil
}

func (m *mockCountingBuildEngine) List() []*BuildResult {
	return nil
}

func (m *mockCountingBuildEngine) Cancel(ctx context.Context, id string) (*BuildResult, error) {
	return nil, nil
}

// T25: 20 concurrent build requests with the same requestId execute exactly ONCE,
// coalesce, replay identical response to all callers, and status is queryable.
func TestIdempotency_20ConcurrentBuilds_T25(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	ps := newMockIdempotentProjectStore()
	ps.projects["proj-t25"] = domain.Project{
		ID:        "proj-t25",
		Name:      "proj-t25",
		RootPath:  t.TempDir(),
		OutputDir: "bin",
	}

	engine := &mockCountingBuildEngine{
		delay: 60 * time.Millisecond, // Ensures all 20 goroutines arrive while the first is executing
	}

	srv := NewServer(&Services{
		ProjectStore: ps,
		BuildEngine:  engine,
	}, logger, nil, "1.0.0", "")

	const concurrency = 20
	const sharedReqID = "req-idempotent-20-builds"
	const sharedCorrID = "corr-t25"

	type result struct {
		statusCode int
		replayHdr  string
		body       string
		err        error
	}
	results := make([]result, concurrency)

	var startBarrier sync.WaitGroup
	startBarrier.Add(concurrency)
	var doneBarrier sync.WaitGroup
	doneBarrier.Add(concurrency)

	for i := 0; i < concurrency; i++ {
		go func(idx int) {
			defer doneBarrier.Done()

			reqBytes := makeTestEnvelope(sharedReqID, sharedCorrID, map[string]any{"projectId": "proj-t25"})

			r := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(reqBytes))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			// Synchronize start so all goroutines fire simultaneously
			startBarrier.Done()
			startBarrier.Wait()

			srv.handleBuilds(w, r)

			results[idx] = result{
				statusCode: w.Code,
				replayHdr:  w.Header().Get("X-Kairo-Idempotent-Replay"),
				body:       w.Body.String(),
			}
		}(i)
	}

	doneBarrier.Wait()

	// 1. Verify side effect was executed EXACTLY ONCE
	finalCalls := atomic.LoadInt64(&engine.startCalls)
	if finalCalls != 1 {
		t.Fatalf("expected exactly 1 BuildEngine.Start execution, got %d", finalCalls)
	}

	// 2. Verify all 20 responses are HTTP 200 with identical payload
	var replayCount int
	firstBody := results[0].body
	for i, res := range results {
		if res.statusCode != http.StatusOK {
			t.Fatalf("goroutine %d got status %d, want 200. Body: %s", i, res.statusCode, res.body)
		}
		if res.body != firstBody {
			t.Fatalf("goroutine %d got different body: %s vs %s", i, res.body, firstBody)
		}
		if res.replayHdr == "1" {
			replayCount++
		}
	}

	t.Logf("T25: 20 concurrent requests completed. Replay count: %d, execution count: %d", replayCount, finalCalls)

	// 3. Verify operation status is queryable via GET /api/v1/operations/{requestId}
	queryReq := httptest.NewRequest(http.MethodGet, "/api/v1/operations/"+sharedReqID, nil)
	queryW := httptest.NewRecorder()
	srv.handleOperationsSub(queryW, queryReq)

	if queryW.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/operations/%s status = %d, want 200. Body: %s", sharedReqID, queryW.Code, queryW.Body.String())
	}

	var opStatusEnv protocol.ResponseEnvelope
	if err := json.Unmarshal(queryW.Body.Bytes(), &opStatusEnv); err != nil {
		t.Fatalf("failed to parse operation status envelope: %v", err)
	}
	if !opStatusEnv.OK {
		t.Fatalf("expected envelope OK=true, got false")
	}

	statusPayloadBytes, _ := json.Marshal(opStatusEnv.Payload)
	var statusDTO struct {
		RequestID   string `json:"requestId"`
		State       string `json:"state"`
		StatusCode  int    `json:"statusCode"`
		CompletedAt string `json:"completedAt"`
	}
	if err := json.Unmarshal(statusPayloadBytes, &statusDTO); err != nil {
		t.Fatalf("failed to parse operation DTO: %v", err)
	}

	if statusDTO.RequestID != sharedReqID {
		t.Errorf("status requestId = %q, want %q", statusDTO.RequestID, sharedReqID)
	}
	if statusDTO.State != "completed" {
		t.Errorf("status state = %q, want 'completed'", statusDTO.State)
	}
	if statusDTO.StatusCode != 200 {
		t.Errorf("status statusCode = %d, want 200", statusDTO.StatusCode)
	}
	if statusDTO.CompletedAt == "" {
		t.Errorf("status completedAt is empty")
	}
}

// T26: Requests with same requestId but different payload return HTTP 409 Conflict,
// do not replay stale cache, and do not execute a second side effect.
func TestIdempotency_PayloadConflict_T26(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	ps := newMockIdempotentProjectStore()
	ps.projects["proj-alpha"] = domain.Project{ID: "proj-alpha", RootPath: t.TempDir(), OutputDir: "bin"}
	ps.projects["proj-beta"] = domain.Project{ID: "proj-beta", RootPath: t.TempDir(), OutputDir: "bin"}

	engine := &mockCountingBuildEngine{}
	srv := NewServer(&Services{
		ProjectStore: ps,
		BuildEngine:  engine,
	}, logger, nil, "1.0.0", "")

	const reqID = "req-conflict-check"

	// Request 1: build proj-alpha with clean=false
	b1 := makeTestEnvelope(reqID, "corr-1", map[string]any{"projectId": "proj-alpha", "clean": false})
	r1 := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(b1))
	w1 := httptest.NewRecorder()
	srv.handleBuilds(w1, r1)

	if w1.Code != http.StatusOK {
		t.Fatalf("request 1 failed: status = %d, body: %s", w1.Code, w1.Body.String())
	}
	if calls := atomic.LoadInt64(&engine.startCalls); calls != 1 {
		t.Fatalf("expected 1 call after request 1, got %d", calls)
	}

	// Request 2: same requestId and scope, but different payload (clean=true)
	b2 := makeTestEnvelope(reqID, "corr-1", map[string]any{"projectId": "proj-alpha", "clean": true})
	r2 := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(b2))
	w2 := httptest.NewRecorder()
	srv.handleBuilds(w2, r2)

	// Must return HTTP 409 Conflict
	if w2.Code != http.StatusConflict {
		t.Fatalf("expected HTTP 409 Conflict for conflicting payload, got %d. Body: %s", w2.Code, w2.Body.String())
	}

	// Must NOT replay old cache
	if w2.Header().Get("X-Kairo-Idempotent-Replay") == "1" {
		t.Fatalf("conflicting request should not have X-Kairo-Idempotent-Replay header")
	}

	// Must NOT have executed a second build
	if calls := atomic.LoadInt64(&engine.startCalls); calls != 1 {
		t.Fatalf("expected BuildEngine.Start to remain at 1 call, got %d", calls)
	}

	// Request 3: Re-sending identical payload 1 again still returns 200 OK replay
	r3 := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(b1))
	w3 := httptest.NewRecorder()
	srv.handleBuilds(w3, r3)

	if w3.Code != http.StatusOK {
		t.Fatalf("replay of original payload should succeed with 200, got %d", w3.Code)
	}
	if w3.Header().Get("X-Kairo-Idempotent-Replay") != "1" {
		t.Fatalf("replay of original payload should have X-Kairo-Idempotent-Replay header")
	}
	if calls := atomic.LoadInt64(&engine.startCalls); calls != 1 {
		t.Fatalf("replay should not execute side effect, calls = %d", calls)
	}
}

// T27: Custom build context & timer cancellation:
// Verifies context.CancelFunc is invoked immediately on process exit, failure, and cancel,
// completely eliminating the 30-minute timer leak.
func TestJobManager_CustomBuildTimerCancellation_T27(t *testing.T) {
	// 1. Start failure (nonexistent binary) -> cancel() invoked immediately
	t.Run("StartFailure_CancelsImmediately", func(t *testing.T) {
		tempDir := t.TempDir()
		executor := build.NewCustomBuildExecutor(nil)
		defer executor.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		err := executor.StartWithCancel(ctx, cancel, build.CustomBuildConfig{
			BuildID:     "build-fail-bad-cmd",
			ProjectRoot: tempDir,
			Command:     "nonexistent_executable_binary_12345_xyz",
		})
		if err == nil {
			t.Fatalf("expected error for nonexistent binary, got nil")
		}

		// cancel() must have been called by StartWithCancel immediately
		select {
		case <-ctx.Done():
			// PASS
			if ctx.Err() != context.Canceled {
				t.Fatalf("expected context.Canceled, got %v", ctx.Err())
			}
		default:
			t.Fatalf("context was not cancelled after start failure; timer leaked!")
		}
	})

	// 2. Normal process completion -> cancel() invoked immediately upon exit
	t.Run("ProcessExit_CancelsImmediately", func(t *testing.T) {
		tempDir := t.TempDir()
		executor := build.NewCustomBuildExecutor(nil)
		defer executor.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		cmdStr := "cmd.exe /c exit 0"
		if _, err := os.Stat("/bin/sh"); err == nil {
			cmdStr = "sh -c 'exit 0'"
		}

		err := executor.StartWithCancel(ctx, cancel, build.CustomBuildConfig{
			BuildID:     "build-quick-exit",
			ProjectRoot: tempDir,
			Command:     cmdStr,
		})
		if err != nil {
			t.Fatalf("start failed: %v", err)
		}

		// Wait up to 3 seconds for process to exit and cancel() to trigger
		select {
		case <-ctx.Done():
			// PASS
			if ctx.Err() != context.Canceled {
				t.Fatalf("expected context.Canceled, got %v", ctx.Err())
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("context was not cancelled within 3s after process exited; timer leaked!")
		}
	})

	// 3. Manual Cancellation -> cancel() invoked immediately
	t.Run("ManualCancel_CancelsImmediately", func(t *testing.T) {
		executor := build.NewCustomBuildExecutor(nil)
		defer executor.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		cmdStr := "powershell.exe -NoProfile -Command Start-Sleep -Seconds 15"
		if _, err := os.Stat("/bin/sh"); err == nil {
			cmdStr = "sleep 15"
		}

		err := executor.StartWithCancel(ctx, cancel, build.CustomBuildConfig{
			BuildID:     "build-to-cancel",
			ProjectRoot: os.TempDir(),
			Command:     cmdStr,
		})
		if err != nil {
			t.Fatalf("start failed: %v", err)
		}

		// Cancel it
		time.Sleep(100 * time.Millisecond)
		if cancelErr := executor.Cancel("build-to-cancel"); cancelErr != nil {
			t.Fatalf("Cancel failed: %v", cancelErr)
		}

		select {
		case <-ctx.Done():
			// PASS
			if ctx.Err() != context.Canceled {
				t.Fatalf("expected context.Canceled, got %v", ctx.Err())
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("context was not cancelled within 2s after Cancel(); timer leaked!")
		}
	})

	// 4. Duplicate build ID -> new cancel() invoked immediately
	t.Run("DuplicateBuildID_CancelsImmediately", func(t *testing.T) {
		executor := build.NewCustomBuildExecutor(nil)
		defer executor.Close()

		ctx1, cancel1 := context.WithTimeout(context.Background(), 30*time.Minute)
		cmdStr := "powershell.exe -NoProfile -Command Start-Sleep -Seconds 10"
		if _, err := os.Stat("/bin/sh"); err == nil {
			cmdStr = "sleep 10"
		}

		_ = executor.StartWithCancel(ctx1, cancel1, build.CustomBuildConfig{
			BuildID:     "build-dup-id",
			ProjectRoot: os.TempDir(),
			Command:     cmdStr,
		})

		ctx2, cancel2 := context.WithTimeout(context.Background(), 30*time.Minute)
		dupErr := executor.StartWithCancel(ctx2, cancel2, build.CustomBuildConfig{
			BuildID:     "build-dup-id", // DUPLICATE!
			ProjectRoot: os.TempDir(),
			Command:     cmdStr,
		})
		if dupErr == nil {
			t.Fatalf("expected duplicate error, got nil")
		}

		select {
		case <-ctx2.Done():
			// PASS
		default:
			t.Fatalf("ctx2 was not cancelled after duplicate rejection!")
		}

		_ = executor.Cancel("build-dup-id")
		time.Sleep(100 * time.Millisecond)
	})

	// 5. Through HTTP handleCustomBuild endpoint
	t.Run("HTTPCustomBuild_ReleaseOnErrors", func(t *testing.T) {
		tempDir := t.TempDir()
		executor := build.NewCustomBuildExecutor(nil)
		defer executor.Close()

		roots, _ := security.NewWorkspaceRoots(tempDir)
		srv := NewServer(&Services{
			CustomBuild: executor,
			Sandbox:     roots,
		}, log.New("test").WithLevel(log.LevelWarn), nil, "1.0.0", "")

		// Missing command
		bBad := makeTestEnvelope("req-custom-bad", "corr-bad", map[string]any{
			"projectRoot": tempDir,
			"command":     "", // missing!
		})
		wBad := httptest.NewRecorder()
		rBad := httptest.NewRequest(http.MethodPost, "/api/v1/build/custom", bytes.NewReader(bBad))
		srv.handleCustomBuild(wBad, rBad)

		if wBad.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request, got %d", wBad.Code)
		}
	})
}
