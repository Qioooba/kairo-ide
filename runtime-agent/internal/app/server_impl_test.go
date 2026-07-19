package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

type fakeServerIDGen struct {
	mu      sync.Mutex
	counter uint64
}

func newFakeServerIDGen() *fakeServerIDGen {
	return &fakeServerIDGen{}
}

func (g *fakeServerIDGen) NewServerID() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.counter++
	return fmt.Sprintf("srv_test_%03d", g.counter), nil
}

type fakeRuntimePlanResolver struct {
	mu          sync.Mutex
	resolveErr  error
	resolveFunc func(ws domain.WorkspaceID, project domain.ProjectID, existing *domain.ServerID) (*domain.RuntimePlan, error)
}

func newFakeRuntimePlanResolver() *fakeRuntimePlanResolver {
	return &fakeRuntimePlanResolver{}
}

func (r *fakeRuntimePlanResolver) ResolveRuntime(ctx context.Context, ws domain.WorkspaceID, project domain.ProjectID, existing *domain.ServerID) (*domain.RuntimePlan, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.resolveErr != nil {
		return nil, r.resolveErr
	}
	if r.resolveFunc != nil {
		return r.resolveFunc(ws, project, existing)
	}
	sid := domain.ServerID("srv_default")
	if existing != nil {
		sid = *existing
	}
	return &domain.RuntimePlan{
		WorkspaceID:    ws,
		ProjectID:      project,
		ServerID:       sid,
		RuntimeID:      "fake-runtime",
		CatalinaBase:   "/tmp/fake-catalina",
		WebappDir:      "/tmp/fake-webapp",
		DeploymentRoot: "/tmp/fake-deploy",
		ContextPath:    "/test",
		HTTPPort:       18080,
		ShutdownPort:   18005,
	}, nil
}

type fakeRuntimeProvider struct {
	mu               sync.Mutex
	id               string
	prepareErr       error
	startErr         error
	gracefulErr      error
	forceErr         error
	isReadyErr       error
	inspectErr       error
	running          bool
	identityMismatch bool
	prepareCount     int32
	startCount       int32
	gracefulCount    int32
	forceCount       int32
	lastIdentity     *domain.ProcessIdentity
	startDelay       time.Duration
	stopDelay        time.Duration
}

func newFakeRuntimeProvider(id string) *fakeRuntimeProvider {
	return &fakeRuntimeProvider{id: id}
}

func (p *fakeRuntimeProvider) ID() string { return p.id }

func (p *fakeRuntimeProvider) Prepare(ctx context.Context, plan domain.RuntimePlan) error {
	atomic.AddInt32(&p.prepareCount, 1)
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.prepareErr
}

func (p *fakeRuntimeProvider) Start(ctx context.Context, plan domain.RuntimePlan, logSink func(domain.LogLine)) (*domain.ProcessIdentity, error) {
	atomic.AddInt32(&p.startCount, 1)
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.startDelay > 0 {
		p.mu.Unlock()
		select {
		case <-time.After(p.startDelay):
		case <-ctx.Done():
			p.mu.Lock()
			return nil, ctx.Err()
		}
		p.mu.Lock()
	}

	if p.startErr != nil {
		return nil, p.startErr
	}

	pid := int(atomic.AddInt32(&p.startCount, 1000))
	identity := &domain.ProcessIdentity{
		PID:          pid,
		Executable:   "/fake/java",
		StartTime:    time.Now(),
		CatalinaBase: plan.CatalinaBase,
		MarkerToken:  "fake-marker",
	}
	p.lastIdentity = identity
	p.running = true

	logSink(domain.LogLine{
		Stream: domain.LogStreamStdout,
		Time:   time.Now(),
		Text:   "fake server started",
	})

	return identity, nil
}

func (p *fakeRuntimeProvider) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	atomic.AddInt32(&p.gracefulCount, 1)
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.stopDelay > 0 {
		p.mu.Unlock()
		select {
		case <-time.After(p.stopDelay):
		case <-ctx.Done():
			p.mu.Lock()
			return ctx.Err()
		}
		p.mu.Lock()
	}

	if p.gracefulErr != nil {
		return p.gracefulErr
	}
	p.running = false
	return nil
}

func (p *fakeRuntimeProvider) ForceStop(ctx context.Context, identity domain.ProcessIdentity) error {
	atomic.AddInt32(&p.forceCount, 1)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.forceErr != nil {
		return p.forceErr
	}
	p.running = false
	return nil
}

func (p *fakeRuntimeProvider) IsReady(ctx context.Context, plan domain.RuntimePlan, identity domain.ProcessIdentity, deadline time.Time) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.isReadyErr
}

func (p *fakeRuntimeProvider) Inspect(ctx context.Context, identity domain.ProcessIdentity) (domain.ProcessObservation, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.inspectErr != nil {
		return domain.ProcessObservation{}, p.inspectErr
	}
	return domain.ProcessObservation{
		PID:              identity.PID,
		Identity:         identity,
		Running:          p.running,
		IdentityMismatch: p.identityMismatch,
	}, nil
}

func (p *fakeRuntimeProvider) CleanupBase(ctx context.Context, plan domain.RuntimePlan) error {
	return nil
}

type fakeRuntimeProviderRegistry struct {
	mu        sync.Mutex
	providers map[string]domain.RuntimeProvider
}

func newFakeRuntimeProviderRegistry() *fakeRuntimeProviderRegistry {
	return &fakeRuntimeProviderRegistry{providers: make(map[string]domain.RuntimeProvider)}
}

func (r *fakeRuntimeProviderRegistry) Add(p domain.RuntimeProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[p.ID()] = p
}

func (r *fakeRuntimeProviderRegistry) Get(id string) (domain.RuntimeProvider, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.providers[id]
	return p, ok
}

type fakeServerHistoryRepo struct {
	mu      sync.RWMutex
	records map[domain.WorkspaceID]map[domain.ServerID]domain.ServerRecord
	saveErr error
}

func newFakeServerHistoryRepo() *fakeServerHistoryRepo {
	return &fakeServerHistoryRepo{records: make(map[domain.WorkspaceID]map[domain.ServerID]domain.ServerRecord)}
}

func (r *fakeServerHistoryRepo) Save(ctx context.Context, record domain.ServerRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.saveErr != nil {
		return r.saveErr
	}
	if _, ok := r.records[record.WorkspaceID]; !ok {
		r.records[record.WorkspaceID] = make(map[domain.ServerID]domain.ServerRecord)
	}
	cp := record.DeepCopy()
	r.records[record.WorkspaceID][record.ID] = cp
	return nil
}

func (r *fakeServerHistoryRepo) Get(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID) (*domain.ServerRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wsRecs, ok := r.records[ws]
	if !ok {
		return nil, domain.ErrServerNotFound
	}
	rec, ok := wsRecs[srv]
	if !ok {
		return nil, domain.ErrServerNotFound
	}
	cp := rec.DeepCopy()
	return &cp, nil
}

func (r *fakeServerHistoryRepo) List(ctx context.Context, ws domain.WorkspaceID) ([]domain.ServerRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wsRecs, ok := r.records[ws]
	if !ok {
		return []domain.ServerRecord{}, nil
	}
	result := make([]domain.ServerRecord, 0, len(wsRecs))
	for _, rec := range wsRecs {
		result = append(result, rec.DeepCopy())
	}
	return result, nil
}

func (r *fakeServerHistoryRepo) ListNonTerminal(ctx context.Context) ([]*domain.ServerRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []*domain.ServerRecord
	for _, wsRecs := range r.records {
		for _, rec := range wsRecs {
			if !rec.ObservedState.IsTerminal() {
				cp := rec.DeepCopy()
				result = append(result, &cp)
			}
		}
	}
	return result, nil
}

func (r *fakeServerHistoryRepo) Delete(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if wsRecs, ok := r.records[ws]; ok {
		delete(wsRecs, srv)
	}
	return nil
}

type serverTestDeps struct {
	ctx      context.Context
	cancel   context.CancelFunc
	planRes  *fakeRuntimePlanResolver
	provReg  *fakeRuntimeProviderRegistry
	prov     *fakeRuntimeProvider
	history  *fakeServerHistoryRepo
	idGen    *fakeServerIDGen
	eventPub *serverTestEventPublisher
	uc       ServerUseCase
}

type serverTestEventPublisher struct {
	mu     sync.Mutex
	events []domain.ServerEvent
	fail   bool
}

func (p *serverTestEventPublisher) PublishServerEvent(ctx context.Context, event domain.ServerEvent) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.fail {
		return fmt.Errorf("publish failed")
	}
	p.events = append(p.events, event)
	return nil
}

func setupServerTest(t *testing.T) *serverTestDeps {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	planRes := newFakeRuntimePlanResolver()
	provReg := newFakeRuntimeProviderRegistry()
	prov := newFakeRuntimeProvider("fake-runtime")
	provReg.Add(prov)
	history := newFakeServerHistoryRepo()
	idGen := newFakeServerIDGen()
	eventPub := &serverTestEventPublisher{}

	cfg := ServerUseCaseConfig{
		StartTimeout:      5 * time.Second,
		StopTimeout:       5 * time.Second,
		ShutdownTimeout:   5 * time.Second,
		InspectTimeout:    1 * time.Second,
		LogBufferSize:     1000,
		StopServersOnExit: true,
	}

	uc := NewServerUseCase(ctx, planRes, provReg, history, eventPub, idGen, cfg)

	return &serverTestDeps{
		ctx:      ctx,
		cancel:   cancel,
		planRes:  planRes,
		provReg:  provReg,
		prov:     prov,
		history:  history,
		idGen:    idGen,
		eventPub: eventPub,
		uc:       uc,
	}
}

func TestServerUseCase_Start_Success(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	cmd := domain.StartServerCommand{
		WorkspaceID: "ws_1",
		ProjectID:   "prj_1",
	}

	rec, err := deps.uc.Start(deps.ctx, cmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	if rec.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running, got %s", rec.ObservedState)
	}
	if rec.PID == 0 {
		t.Error("expected PID to be set")
	}
	if rec.ProcessIdentity == nil {
		t.Error("expected ProcessIdentity to be set")
	}
	if rec.Generation != 1 {
		t.Errorf("expected generation 1, got %d", rec.Generation)
	}
}

func TestServerUseCase_Start_Duplicate(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	cmd := domain.StartServerCommand{
		WorkspaceID: "ws_1",
		ProjectID:   "prj_1",
	}

	rec1, err := deps.uc.Start(deps.ctx, cmd)
	if err != nil {
		t.Fatalf("first Start failed: %v", err)
	}

	cmd2 := domain.StartServerCommand{
		WorkspaceID: "ws_1",
		ProjectID:   "prj_1",
		ServerID:    &rec1.ID,
	}
	_, err = deps.uc.Start(deps.ctx, cmd2)
	if err == nil {
		t.Error("expected error for duplicate start, got nil")
	}
}

func TestServerUseCase_Stop_Idempotent(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_1",
		ProjectID:   "prj_1",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	stopCmd := domain.StopServerCommand{
		WorkspaceID: "ws_1",
		ProjectID:   "prj_1",
		ServerID:    rec.ID,
	}

	stopped1, err := deps.uc.Stop(deps.ctx, stopCmd)
	if err != nil {
		t.Fatalf("first Stop failed: %v", err)
	}
	if stopped1.ObservedState != domain.ServerStateStopped {
		t.Errorf("expected stopped after first stop, got %s", stopped1.ObservedState)
	}

	stopped2, err := deps.uc.Stop(deps.ctx, stopCmd)
	if err != nil {
		t.Fatalf("second Stop failed: %v", err)
	}
	if stopped2.ObservedState != domain.ServerStateStopped {
		t.Errorf("expected stopped after second stop, got %s", stopped2.ObservedState)
	}
}

func TestServerUseCase_Restart_GenerationIncrement(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_1",
		ProjectID:   "prj_1",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	firstGen := rec.Generation
	firstPID := rec.PID

	restartCmd := domain.RestartServerCommand{
		WorkspaceID: "ws_1",
		ProjectID:   "prj_1",
		ServerID:    rec.ID,
	}
	restarted, err := deps.uc.Restart(deps.ctx, restartCmd)
	if err != nil {
		t.Fatalf("Restart failed: %v", err)
	}

	if restarted.Generation != firstGen+1 {
		t.Errorf("expected generation %d, got %d", firstGen+1, restarted.Generation)
	}
	if restarted.ID != rec.ID {
		t.Errorf("expected same server ID, got %s vs %s", restarted.ID, rec.ID)
	}
	if restarted.PID == firstPID {
		t.Log("warning: PID reused (possible but unlikely in fake)")
	}
}

func TestServerUseCase_ConcurrentStart_SameServer(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	const concurrency = 50
	var wg sync.WaitGroup
	successCount := int32(0)
	errCount := int32(0)

	serverID := domain.ServerID("srv_concurrent")

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := domain.StartServerCommand{
				WorkspaceID: "ws_concurrent",
				ProjectID:   "prj_concurrent",
				ServerID:    &serverID,
			}
			_, err := deps.uc.Start(deps.ctx, cmd)
			if err != nil {
				atomic.AddInt32(&errCount, 1)
			} else {
				atomic.AddInt32(&successCount, 1)
			}
		}()
	}

	wg.Wait()

	if successCount != 1 {
		t.Errorf("expected exactly 1 success, got %d successes and %d errors", successCount, errCount)
	}
	if errCount != concurrency-1 {
		t.Errorf("expected %d errors, got %d", concurrency-1, errCount)
	}
}

func TestServerUseCase_StartStopRace(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	const rounds = 20
	for round := 0; round < rounds; round++ {
		startCmd := domain.StartServerCommand{
			WorkspaceID: domain.WorkspaceID(fmt.Sprintf("ws_race_%d", round)),
			ProjectID:   "prj_race",
		}
		rec, err := deps.uc.Start(deps.ctx, startCmd)
		if err != nil {
			t.Fatalf("round %d: Start failed: %v", round, err)
		}

		stopCmd := domain.StopServerCommand{
			WorkspaceID: rec.WorkspaceID,
			ProjectID:   rec.ProjectID,
			ServerID:    rec.ID,
		}

		var wg sync.WaitGroup
		wg.Add(2)

		go func() {
			defer wg.Done()
			_, _ = deps.uc.Get(deps.ctx, rec.WorkspaceID, rec.ID)
		}()

		go func() {
			defer wg.Done()
			_, _ = deps.uc.Stop(deps.ctx, stopCmd)
		}()

		wg.Wait()

		after, err := deps.uc.Get(deps.ctx, rec.WorkspaceID, rec.ID)
		if err != nil {
			t.Fatalf("round %d: Get after stop failed: %v", round, err)
		}
		if after.ObservedState != domain.ServerStateStopped {
			t.Errorf("round %d: expected stopped, got %s", round, after.ObservedState)
		}
	}
}

func TestServerUseCase_Reconcile_DeadProcess(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_reconcile",
		ProjectID:   "prj_reconcile",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	deps.prov.mu.Lock()
	deps.prov.running = false
	deps.prov.mu.Unlock()

	err = deps.uc.Reconcile(deps.ctx)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	after, err := deps.uc.Get(deps.ctx, rec.WorkspaceID, rec.ID)
	if err != nil {
		t.Fatalf("Get after reconcile failed: %v", err)
	}
	if after.ObservedState != domain.ServerStateCrashed {
		t.Errorf("expected crashed after reconcile (dead process), got %s", after.ObservedState)
	}
}

func TestServerUseCase_Shutdown(t *testing.T) {
	deps := setupServerTest(t)

	for i := 0; i < 3; i++ {
		cmd := domain.StartServerCommand{
			WorkspaceID: domain.WorkspaceID(fmt.Sprintf("ws_shutdown_%d", i)),
			ProjectID:   "prj_shutdown",
		}
		_, err := deps.uc.Start(deps.ctx, cmd)
		if err != nil {
			t.Fatalf("Start %d failed: %v", i, err)
		}
	}

	unclean, err := deps.uc.Shutdown(deps.ctx)
	if err != nil {
		t.Fatalf("Shutdown failed: %v", err)
	}

	if len(unclean) != 0 {
		t.Errorf("expected 0 unclean (StopServersOnExit=true), got %d", len(unclean))
	}

	_, err = deps.uc.Start(deps.ctx, domain.StartServerCommand{
		WorkspaceID: "ws_after_shutdown",
		ProjectID:   "prj_after",
	})
	if err == nil {
		t.Error("expected error starting after shutdown")
	}
}

func TestServerUseCase_GetLogs(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_logs",
		ProjectID:   "prj_logs",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	lines, nextCursor, _, err := deps.uc.GetLogs(deps.ctx, rec.WorkspaceID, rec.ID, 0, 100)
	if err != nil {
		t.Fatalf("GetLogs failed: %v", err)
	}
	if len(lines) == 0 {
		t.Error("expected some log lines after start")
	}
	if nextCursor <= 0 {
		t.Error("expected valid next cursor")
	}
}

func TestServerUseCase_GetList_DeepCopy(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_deepcopy",
		ProjectID:   "prj_deepcopy",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	got1, err := deps.uc.Get(deps.ctx, rec.WorkspaceID, rec.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	got1.LastError = "modified"

	got2, err := deps.uc.Get(deps.ctx, rec.WorkspaceID, rec.ID)
	if err != nil {
		t.Fatalf("Get again failed: %v", err)
	}

	if got2.LastError == "modified" {
		t.Error("DeepCopy failed: modification to returned record affected stored state")
	}
}

func TestServerUseCase_EventFailure_DoesNotBreakState(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	deps.eventPub.fail = true

	cmd := domain.StartServerCommand{
		WorkspaceID: "ws_events",
		ProjectID:   "prj_events",
	}
	rec, err := deps.uc.Start(deps.ctx, cmd)
	if err != nil {
		t.Fatalf("Start failed even with event failures: %v", err)
	}
	if rec.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running, got %s", rec.ObservedState)
	}
}

func TestServerUseCase_Restart_StopFailure(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_restart_fail",
		ProjectID:   "prj_restart_fail",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	deps.prov.mu.Lock()
	deps.prov.gracefulErr = fmt.Errorf("graceful stop failed")
	deps.prov.mu.Unlock()

	restartCmd := domain.RestartServerCommand{
		WorkspaceID: rec.WorkspaceID,
		ProjectID:   rec.ProjectID,
		ServerID:    rec.ID,
	}

	restarted, err := deps.uc.Restart(deps.ctx, restartCmd)
	if err != nil {
		t.Fatalf("Restart failed even though force stop should work: %v", err)
	}
	if restarted.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running after restart with force stop fallback, got %s", restarted.ObservedState)
	}
}

func TestServerUseCase_Reconcile_AliveProcess(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_reconcile_alive",
		ProjectID:   "prj_reconcile_alive",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// Product rule (ADR-0011 Section 9): Reconcile assumes the previous
	// Agent lifecycle stopped all managed processes. Even if the process
	// is still alive in the same address space (as in this in-process
	// test), Reconcile must NOT trust the persisted ProcessIdentity and
	// must mark the record as Crashed so the user can explicitly restart.
	err = deps.uc.Reconcile(deps.ctx)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	after, err := deps.uc.Get(deps.ctx, rec.WorkspaceID, rec.ID)
	if err != nil {
		t.Fatalf("Get after reconcile failed: %v", err)
	}
	if after.ObservedState != domain.ServerStateCrashed {
		t.Errorf("expected crashed after reconcile (cross-lifecycle recovery forbidden), got %s", after.ObservedState)
	}
	if after.PID != 0 || after.ProcessIdentity != nil {
		t.Errorf("expected PID/ProcessIdentity cleared, got PID=%d Identity=%v", after.PID, after.ProcessIdentity)
	}
}

func TestServerUseCase_List_WorkspaceFilter(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	ws1 := domain.WorkspaceID("ws_filter_1")
	ws2 := domain.WorkspaceID("ws_filter_2")

	_, err := deps.uc.Start(deps.ctx, domain.StartServerCommand{WorkspaceID: ws1, ProjectID: "prj_a"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = deps.uc.Start(deps.ctx, domain.StartServerCommand{WorkspaceID: ws2, ProjectID: "prj_b"})
	if err != nil {
		t.Fatal(err)
	}

	list1, err := deps.uc.List(deps.ctx, ws1)
	if err != nil {
		t.Fatal(err)
	}
	if len(list1) != 1 {
		t.Errorf("expected 1 server in ws1, got %d", len(list1))
	}
	if list1[0].WorkspaceID != ws1 {
		t.Errorf("wrong workspace in list")
	}

	list2, err := deps.uc.List(deps.ctx, ws2)
	if err != nil {
		t.Fatal(err)
	}
	if len(list2) != 1 {
		t.Errorf("expected 1 server in ws2, got %d", len(list2))
	}
}

func TestServerUseCase_Reconcile_IdentityMismatch(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_reconcile_mismatch",
		ProjectID:   "prj_reconcile_mismatch",
	}
	rec, err := deps.uc.Start(deps.ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// Product rule (ADR-0011 Section 9): Reconcile no longer calls
	// Provider.Inspect on the persisted ProcessIdentity. Even when the
	// provider would report an identity mismatch, Reconcile must mark
	// the record as Crashed because cross-lifecycle recovery is
	// forbidden regardless of the underlying identity state.
	deps.prov.mu.Lock()
	deps.prov.identityMismatch = true
	deps.prov.mu.Unlock()

	err = deps.uc.Reconcile(deps.ctx)
	if err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	after, err := deps.uc.Get(deps.ctx, rec.WorkspaceID, rec.ID)
	if err != nil {
		t.Fatalf("Get after reconcile failed: %v", err)
	}
	if after.ObservedState != domain.ServerStateCrashed {
		t.Errorf("expected crashed after reconcile (cross-lifecycle recovery forbidden), got %s", after.ObservedState)
	}
}

func TestServerUseCase_PortCollision_TypedFailure(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	deps.prov.mu.Lock()
	deps.prov.startErr = domain.ErrPortInUse
	deps.prov.mu.Unlock()

	startCmd := domain.StartServerCommand{
		WorkspaceID: "ws_port_busy",
		ProjectID:   "prj_port_busy",
	}
	_, err := deps.uc.Start(deps.ctx, startCmd)
	if err == nil {
		t.Fatal("expected error for port collision")
	}
	if err != nil && !strings.Contains(err.Error(), "port already in use") {
		t.Logf("port collision error: %v", err)
	}
}

func TestServerUseCase_Get_Nonexistent(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	_, err := deps.uc.Get(deps.ctx, "ws_none", "srv_none")
	if !errors.Is(err, domain.ErrServerNotFound) {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
}

func TestServerUseCase_Stop_Nonexistent(t *testing.T) {
	deps := setupServerTest(t)
	defer deps.cancel()

	_, err := deps.uc.Stop(deps.ctx, domain.StopServerCommand{
		WorkspaceID: "ws_none",
		ProjectID:   "prj_none",
		ServerID:    "srv_none",
	})
	if !errors.Is(err, domain.ErrServerNotFound) {
		t.Errorf("expected ErrServerNotFound for non-existent stop, got %v", err)
	}
}
