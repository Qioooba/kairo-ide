package app

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/runtimeplan"
)

// TestPersistence_RunningStateSaveFails_ReturnsError verifies the P0-4 fix:
// When the Running state cannot be persisted after a successful start,
// the server must be stopped and an error returned — NOT a silent success.
func TestPersistence_RunningStateSaveFails_ReturnsError(t *testing.T) {
	t.Parallel()

	inner := newFakeServerHistoryRepo()
	// failAfterN=2: first 2 saves succeed (preparing, starting);
	// 3rd save (running) fails, triggering the P0-4 rollback path.
	history := &failAfterNRepo{
		inner:      inner,
		failAfterN: 2,
	}

	deps := setupPersistenceTest(t, history)
	defer deps.cancel()

	srvID := domain.ServerID("srv_persist_fail")
	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_persist",
		ProjectID:   "prj_persist",
		ServerID:    &srvID,
	}
	_, err := deps.uc.Start(deps.ctx, startCmd)
	if err == nil {
		t.Fatal("expected error when Running state save fails, got nil")
	}

	// Verify the server is NOT persisted as Running.
	rec, err := history.Get(deps.ctx, "ws_persist", srvID)
	if err == nil && rec.ObservedState == domain.ServerStateRunning {
		t.Error("server should NOT be persisted as Running when the Running state save failed")
	}
}

// TestPersistence_PortLeaseReleasedOnStartFailure verifies that when server
// start fails after port allocation, the PortLease is released.
func TestPersistence_PortLeaseReleasedOnStartFailure(t *testing.T) {
	t.Parallel()

	inner := newFakeServerHistoryRepo()
	deps := setupPersistenceTest(t, inner)
	defer deps.cancel()

	// Make the provider fail after port allocation (Start is called
	// after allocateAndStoreLease in the use case flow).
	deps.prov.mu.Lock()
	deps.prov.startErr = errors.New("simulated provider failure")
	deps.prov.mu.Unlock()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_port_fail",
		ProjectID:   "prj_port_fail",
	}
	_, err := deps.uc.Start(deps.ctx, startCmd)
	if err == nil {
		t.Fatal("expected error from failing provider, got nil")
	}

	// Verify the port allocator has no outstanding leases.
	if leased := deps.portAlloc.Leased(); len(leased) != 0 {
		t.Errorf("expected 0 outstanding leases, got %d", len(leased))
	}
}

// TestPersistence_PortLeaseReleasedOnStop verifies that stopping a server
// releases the PortLease.
func TestPersistence_PortLeaseReleasedOnStop(t *testing.T) {
	t.Parallel()

	inner := newFakeServerHistoryRepo()
	deps := setupPersistenceTest(t, inner)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_port_stop",
		ProjectID:   "prj_port_stop",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// Verify lease is outstanding.
	if leased := deps.portAlloc.Leased(); len(leased) == 0 {
		t.Fatal("expected outstanding lease after start")
	}

	// Stop the server.
	stopCmd := domain.StopServerCommand{
		WorkspaceID: rec.WorkspaceID,
		ProjectID:   rec.ProjectID,
		ServerID:    rec.ID,
	}
	_, err = deps.uc.Stop(deps.ctx, stopCmd)
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	// Verify lease is released.
	if leased := deps.portAlloc.Leased(); len(leased) != 0 {
		t.Errorf("expected 0 outstanding leases after stop, got %d", len(leased))
	}
}

// TestPersistence_ConcurrentStartStop verifies that concurrent start/stop
// operations on different servers don't corrupt state or leak leases.
func TestPersistence_ConcurrentStartStop(t *testing.T) {
	t.Parallel()

	inner := newFakeServerHistoryRepo()
	deps := setupPersistenceTest(t, inner)
	defer deps.cancel()

	const servers = 5
	var wg sync.WaitGroup
	wg.Add(servers)

	for i := 0; i < servers; i++ {
		go func(i int) {
			defer wg.Done()
			cmd := domain.StartServerCommand{
				WorkspaceID: domain.WorkspaceID(fmt.Sprintf("ws_concurrent_%d", i)),
				ProjectID:   "prj_concurrent",
			}
			rec, err := deps.uc.Start(deps.ctx, cmd)
			if err != nil {
				t.Logf("Start %d failed: %v", i, err)
				return
			}
			stopCmd := domain.StopServerCommand{
				WorkspaceID: rec.WorkspaceID,
				ProjectID:   rec.ProjectID,
				ServerID:    rec.ID,
			}
			_, err = deps.uc.Stop(deps.ctx, stopCmd)
			if err != nil {
				t.Logf("Stop %d failed: %v", i, err)
			}
		}(i)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("concurrent start/stop timed out")
	}

	// Verify no outstanding leases.
	if leased := deps.portAlloc.Leased(); len(leased) != 0 {
		t.Errorf("expected 0 outstanding leases after all stops, got %d", len(leased))
	}
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// failAfterNRepo wraps a domain.ServerHistoryRepository and fails on the
// (failAfterN+1)th call to Save. All other methods delegate to inner.
type failAfterNRepo struct {
	inner      domain.ServerHistoryRepository
	mu         sync.Mutex
	failAfterN int
	saveCount  int
}

func (r *failAfterNRepo) Save(ctx context.Context, record domain.ServerRecord) error {
	r.mu.Lock()
	r.saveCount++
	count := r.saveCount
	r.mu.Unlock()
	if count > r.failAfterN {
		return errors.New("injected persistence failure")
	}
	return r.inner.Save(ctx, record)
}

func (r *failAfterNRepo) Get(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID) (*domain.ServerRecord, error) {
	return r.inner.Get(ctx, ws, srv)
}

func (r *failAfterNRepo) List(ctx context.Context, ws domain.WorkspaceID) ([]domain.ServerRecord, error) {
	return r.inner.List(ctx, ws)
}

func (r *failAfterNRepo) ListNonTerminal(ctx context.Context) ([]*domain.ServerRecord, error) {
	return r.inner.ListNonTerminal(ctx)
}

func (r *failAfterNRepo) Delete(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID) error {
	return r.inner.Delete(ctx, ws, srv)
}

// persistenceTestDeps is a lighter-weight test fixture that injects a
// FakePortAllocator (for lease tracking) and allows a custom history repo.
type persistenceTestDeps struct {
	ctx       context.Context
	cancel    context.CancelFunc
	prov      *fakeRuntimeProvider
	history   domain.ServerHistoryRepository
	portAlloc *runtimeplan.FakePortAllocator
	uc        ServerUseCase
}

func setupPersistenceTest(t *testing.T, history domain.ServerHistoryRepository) *persistenceTestDeps {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	planRes := newFakeRuntimePlanResolver()
	provReg := newFakeRuntimeProviderRegistry()
	prov := newFakeRuntimeProvider("fake-runtime")
	provReg.Add(prov)
	idGen := newFakeServerIDGen()
	eventPub := &serverTestEventPublisher{}
	portAlloc := runtimeplan.NewFakePortAllocator()

	cfg := ServerUseCaseConfig{
		StartTimeout:      5 * time.Second,
		StopTimeout:       5 * time.Second,
		ShutdownTimeout:   5 * time.Second,
		InspectTimeout:    1 * time.Second,
		LogBufferSize:     1000,
		StopServersOnExit: true,
		PortAllocator:     portAlloc,
	}

	uc := NewServerUseCase(ctx, planRes, provReg, history, eventPub, idGen, cfg)

	return &persistenceTestDeps{
		ctx:       ctx,
		cancel:    cancel,
		prov:      prov,
		history:   history,
		portAlloc: portAlloc,
		uc:        uc,
	}
}
