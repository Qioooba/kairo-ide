package api

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestOperationRegistry_ScopeIsolation(t *testing.T) {
	reg := NewOperationRegistry(time.Minute, 100)

	keyA := OperationKey{
		Scope:     "project-a",
		Kind:      OpBuild,
		RequestID: "req-1001",
	}
	keyB := OperationKey{
		Scope:     "project-b",
		Kind:      OpBuild,
		RequestID: "req-1001", // Same Kind and RequestID, DIFFERENT Scope!
	}

	payloadA := []byte(`{"target":"clean"}`)
	payloadB := []byte(`{"target":"compile"}`)

	// Project A claims
	resA, recA := reg.ClaimOrWait(context.Background(), keyA, payloadA)
	if resA != ClaimResultExecute || recA == nil {
		t.Fatalf("expected project-a to win execution, got %v", resA)
	}

	// Project B claims — MUST NOT collide with Project A!
	resB, recB := reg.ClaimOrWait(context.Background(), keyB, payloadB)
	if resB != ClaimResultExecute || recB == nil {
		t.Fatalf("expected project-b to win execution independently of project-a, got %v", resB)
	}

	// Finish project A
	reg.Finish(keyA, 200, []byte(`{"status":"ok-a"}`), nil)

	// Finish project B
	reg.Finish(keyB, 200, []byte(`{"status":"ok-b"}`), nil)

	// Replay on A must return A's result
	replayA, recReplayA := reg.ClaimOrWait(context.Background(), keyA, payloadA)
	if replayA != ClaimResultReplay || string(recReplayA.Response) != `{"status":"ok-a"}` {
		t.Fatalf("expected replay for project-a to yield ok-a, got %s", string(recReplayA.Response))
	}

	// Replay on B must return B's result
	replayB, recReplayB := reg.ClaimOrWait(context.Background(), keyB, payloadB)
	if replayB != ClaimResultReplay || string(recReplayB.Response) != `{"status":"ok-b"}` {
		t.Fatalf("expected replay for project-b to yield ok-b, got %s", string(recReplayB.Response))
	}
}

func TestOperationRegistry_ConflictDetection(t *testing.T) {
	reg := NewOperationRegistry(time.Minute, 100)
	key := OperationKey{
		Scope:     "proj-1",
		Kind:      OpDeploy,
		RequestID: "req-2001",
	}

	res1, _ := reg.ClaimOrWait(context.Background(), key, []byte(`{"version":"1.0"}`))
	if res1 != ClaimResultExecute {
		t.Fatalf("expected first claim to execute, got %v", res1)
	}

	// Same key, different payload -> conflict!
	res2, _ := reg.ClaimOrWait(context.Background(), key, []byte(`{"version":"2.0"}`))
	if res2 != ClaimResultConflict {
		t.Fatalf("expected second claim with different payload to conflict, got %v", res2)
	}
}

func TestOperationRegistry_NilContext(t *testing.T) {
	reg := NewOperationRegistry(time.Minute, 100)
	key := OperationKey{
		Scope:     "proj-1",
		Kind:      OpBuild,
		RequestID: "req-nil-ctx",
	}

	// Must not panic on nil ctx
	res, rec := reg.ClaimOrWait(nil, key, []byte(`{}`))
	if res != ClaimResultExecute || rec == nil {
		t.Fatalf("expected execute with nil ctx, got %v", res)
	}
	reg.Finish(key, 200, []byte("done"), nil)
}

func TestOperationRegistry_ConcurrentCoalescing(t *testing.T) {
	reg := NewOperationRegistry(time.Minute, 100)
	key := OperationKey{
		Scope:     "proj-concurrent",
		Kind:      OpServerStart,
		RequestID: "req-coalesce",
	}
	payload := []byte(`{"port":8080}`)

	const numGoroutines = 10
	var wg sync.WaitGroup
	results := make([]ClaimResult, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			r, _ := reg.ClaimOrWait(context.Background(), key, payload)
			results[idx] = r
		}(i)
	}

	// Give goroutines time to enter wait
	time.Sleep(20 * time.Millisecond)

	// Finish operation
	reg.Finish(key, 200, []byte(`{"started":true}`), nil)
	wg.Wait()

	executeCount := 0
	replayCount := 0
	for _, res := range results {
		if res == ClaimResultExecute {
			executeCount++
		} else if res == ClaimResultReplay {
			replayCount++
		}
	}

	if executeCount != 1 {
		t.Errorf("expected exactly 1 caller to win execution, got %d", executeCount)
	}
	if replayCount != numGoroutines-1 {
		t.Errorf("expected %d callers to receive replay, got %d", numGoroutines-1, replayCount)
	}
}
