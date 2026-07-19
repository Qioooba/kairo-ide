package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

const (
	testValidID26 = "aaaaaaaaaaaaaaaaaaaaaaaaaa"
)

var testCryptoGen = pathpolicy.NewCryptoIDGenerator()

type fixedIDGen struct {
	id string
}

func (g *fixedIDGen) NewWorkspaceID() (string, error) { return g.id, nil }
func (g *fixedIDGen) NewProjectID() (string, error)   { return g.id, nil }
func (g *fixedIDGen) NewBuildID() (string, error)     { return g.id, nil }
func (g *fixedIDGen) NewServerID() (string, error)    { return g.id, nil }
func (g *fixedIDGen) NewRuntimeID() (string, error)   { return g.id, nil }

type seqIDGen struct {
	mu  sync.Mutex
	seq int
}

func (g *seqIDGen) NewWorkspaceID() (string, error) { return "ws_" + testValidID26, nil }
func (g *seqIDGen) NewProjectID() (string, error)   { return "prj_" + testValidID26, nil }
func (g *seqIDGen) NewServerID() (string, error)    { return "srv_" + testValidID26, nil }
func (g *seqIDGen) NewRuntimeID() (string, error)   { return "rt_" + testValidID26, nil }
func (g *seqIDGen) NewBuildID() (string, error) {
	return testCryptoGen.NewBuildID()
}

type errorIDGen struct{}

func (g *errorIDGen) NewWorkspaceID() (string, error) { return "", errors.New("id gen error") }
func (g *errorIDGen) NewProjectID() (string, error)   { return "", errors.New("id gen error") }
func (g *errorIDGen) NewBuildID() (string, error)     { return "", errors.New("id gen error") }
func (g *errorIDGen) NewServerID() (string, error)    { return "", errors.New("id gen error") }
func (g *errorIDGen) NewRuntimeID() (string, error)   { return "", errors.New("id gen error") }

type fakeResolver struct {
	plan *domain.BuildPlan
	err  error
}

func (r *fakeResolver) ResolveProject(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID) (*domain.ResolvedProject, error) {
	return &domain.ResolvedProject{}, nil
}
func (r *fakeResolver) ResolveBuild(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID, intent domain.BuildIntent, clean bool, selectedFiles []string) (*domain.BuildPlan, error) {
	if r.err != nil {
		return nil, r.err
	}
	return r.plan, nil
}
func (r *fakeResolver) ResolveDeploy(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID, bID domain.BuildID, target domain.DeploymentTarget) (*domain.DeployPlan, error) {
	return &domain.DeployPlan{DeploymentRoot: target.Root}, nil
}
func (r *fakeResolver) ResolveRuntime(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID, existing *domain.ServerID) (*domain.RuntimePlan, error) {
	return nil, domain.ErrRuntimeIntegrationRequired
}

type fakeHistory struct {
	mu            sync.Mutex
	saves         []domain.BuildRun
	getMap        map[domain.BuildID]domain.BuildRun
	saveErr       error
	saveErrAfter  int
	saveCallCount int32
}

func newFakeHistory() *fakeHistory {
	return &fakeHistory{
		getMap: make(map[domain.BuildID]domain.BuildRun),
	}
}

func (h *fakeHistory) Save(ctx context.Context, run domain.BuildRun) error {
	count := atomic.AddInt32(&h.saveCallCount, 1)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.saveErr != nil {
		if h.saveErrAfter <= 0 || int(count) > h.saveErrAfter {
			return h.saveErr
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	h.saves = append(h.saves, run)
	h.getMap[run.ID] = run
	return nil
}

func (h *fakeHistory) Get(ctx context.Context, wsID domain.WorkspaceID, bID domain.BuildID) (*domain.BuildRun, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if run, ok := h.getMap[bID]; ok {
		result := run.DeepCopy()
		return &result, nil
	}
	return nil, domain.ErrBuildNotFound
}

func (h *fakeHistory) List(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID, limit int) ([]domain.BuildRun, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var result []domain.BuildRun
	for _, run := range h.getMap {
		if run.WorkspaceID == wsID {
			if pID == "" || run.ProjectID == pID {
				result = append(result, run.DeepCopy())
			}
		}
	}
	return result, nil
}

func (h *fakeHistory) lastSave() (domain.BuildRun, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.saves) == 0 {
		return domain.BuildRun{}, false
	}
	return h.saves[len(h.saves)-1], true
}

func (h *fakeHistory) resetCalls() {
	atomic.StoreInt32(&h.saveCallCount, 0)
}

type fakeProvider struct {
	validateErr  error
	buildDelay   time.Duration
	buildErr     error
	buildOutput  *domain.BuildOutput
	ignoreCancel bool
}

func (p *fakeProvider) ID() domain.BuildToolID { return domain.BuildToolJavac }
func (p *fakeProvider) Validate(ctx context.Context, plan domain.BuildPlan) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	return p.validateErr
}
func (p *fakeProvider) Build(ctx context.Context, plan domain.BuildPlan, sink func(event domain.BuildEvent), logLine func(stream domain.LogStream, line string)) (*domain.BuildOutput, error) {
	if p.buildDelay > 0 {
		if p.ignoreCancel {
			time.Sleep(p.buildDelay)
		} else {
			select {
			case <-time.After(p.buildDelay):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
	}
	if p.buildErr != nil {
		return p.buildOutput, p.buildErr
	}
	if p.buildOutput != nil {
		return p.buildOutput, nil
	}
	return &domain.BuildOutput{ExitCode: 0}, nil
}

type fakeRegistry struct {
	provider domain.BuildProvider
}

func (r *fakeRegistry) Get(id domain.BuildToolID) (domain.BuildProvider, bool) {
	if r.provider != nil {
		return r.provider, true
	}
	return nil, false
}

type fakePublisher struct {
	mu           sync.Mutex
	events       []domain.BuildEvent
	publishErr   error
	publishAfter int
	callCount    int32
}

func (p *fakePublisher) PublishBuildEvent(ctx context.Context, event domain.BuildEvent) error {
	count := atomic.AddInt32(&p.callCount, 1)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.publishErr != nil {
		if p.publishAfter <= 0 || int(count) > p.publishAfter {
			return p.publishErr
		}
	}
	p.events = append(p.events, event)
	return nil
}

func (p *fakePublisher) Events() []domain.BuildEvent {
	p.mu.Lock()
	defer p.mu.Unlock()
	result := make([]domain.BuildEvent, len(p.events))
	copy(result, p.events)
	return result
}

func (p *fakePublisher) HasEventType(t domain.BuildEventType) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, e := range p.events {
		if e.Type == t {
			return true
		}
	}
	return false
}

func (p *fakePublisher) resetCalls() {
	atomic.StoreInt32(&p.callCount, 0)
}

func testBuildCmd() StartBuildCommand {
	return StartBuildCommand{
		WorkspaceID: domain.WorkspaceID("ws_" + testValidID26),
		ProjectID:   domain.ProjectID("prj_" + testValidID26),
		Intent:      domain.BuildIntentFull,
	}
}

func testPlan() *domain.BuildPlan {
	return &domain.BuildPlan{
		WorkspaceID: domain.WorkspaceID("ws_" + testValidID26),
		ProjectID:   domain.ProjectID("prj_" + testValidID26),
		BuildTool:   domain.BuildToolJavac,
	}
}

func TestBuildUseCase_Success(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildOutput: &domain.BuildOutput{ExitCode: 0}}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	if run.State != domain.BuildStateQueued {
		t.Errorf("expected queued state, got %s", run.State)
	}

	time.Sleep(200 * time.Millisecond)

	finalRun, err := uc.Get(context.Background(), run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if finalRun.State != domain.BuildStateSucceeded {
		t.Errorf("expected succeeded state, got %s", finalRun.State)
	}

	events := publisher.Events()
	if len(events) < 3 {
		t.Errorf("expected at least 3 events (queued, started, succeeded), got %d", len(events))
	}
	for _, evt := range events {
		if evt.WorkspaceID != run.WorkspaceID {
			t.Errorf("event has wrong workspace id: %v", evt)
		}
		if evt.ProjectID != run.ProjectID {
			t.Errorf("event has wrong project id: %v", evt)
		}
	}
}

func TestBuildUseCase_ValidateFailure(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{validateErr: errors.New("invalid config")}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	finalRun, err := uc.Get(context.Background(), run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if finalRun.State != domain.BuildStateFailed {
		t.Errorf("expected failed state, got %s", finalRun.State)
	}
	if finalRun.Summary == "" {
		t.Error("expected summary to be set")
	}
}

func TestBuildUseCase_BuildFailureWithDiagnostics(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	diags := []domain.BuildDiagnostic{
		{File: "Main.java", Line: 10, Severity: "error", Message: "cannot find symbol"},
	}
	provider := &fakeProvider{buildOutput: &domain.BuildOutput{ExitCode: 1, Diagnostics: diags}}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	finalRun, err := uc.Get(context.Background(), run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if finalRun.State != domain.BuildStateFailed {
		t.Errorf("expected failed state, got %s", finalRun.State)
	}
	if len(finalRun.Diagnostics) != 1 {
		t.Errorf("expected 1 diagnostic, got %d", len(finalRun.Diagnostics))
	}
	if finalRun.ExitCode == nil || *finalRun.ExitCode != 1 {
		t.Error("expected exit code 1")
	}
}

func TestBuildUseCase_CancelSlowProvider(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildDelay: 5 * time.Second}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	cancelCtx, cancelWait := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancelWait()
	err = uc.Cancel(cancelCtx, run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}

	finalRun, err := uc.Get(context.Background(), run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if finalRun.State != domain.BuildStateCancelled {
		t.Errorf("expected cancelled state, got %s", finalRun.State)
	}
}

func TestBuildUseCase_ProviderIgnoreCancelTimeout(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildDelay: 5 * time.Second, ignoreCancel: true}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	cancelCtx, cancelWait := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancelWait()
	err = uc.Cancel(cancelCtx, run.WorkspaceID, run.ID)
	if err != context.DeadlineExceeded {
		t.Errorf("expected DeadlineExceeded, got %v", err)
	}
}

func TestBuildUseCase_CancelIdempotent(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildDelay: 100 * time.Millisecond}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	cancelCtx, cancelWait := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancelWait()
	err = uc.Cancel(cancelCtx, run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("first Cancel failed: %v", err)
	}

	err = uc.Cancel(cancelCtx, run.WorkspaceID, run.ID)
	if err != nil {
		t.Errorf("second Cancel should be idempotent, got: %v", err)
	}
}

func TestBuildUseCase_QueuedSaveFailure(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	history.saveErr = errors.New("disk full")
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	_, err := uc.Start(context.Background(), testBuildCmd())
	if err == nil {
		t.Error("expected error when history save fails")
	}
	if !strings.Contains(err.Error(), "persist queued build") {
		t.Errorf("expected persist queued error, got %v", err)
	}
}

func TestBuildUseCase_StartedSaveFailure(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	history.saveErr = errors.New("disk full")
	history.saveErrAfter = 1
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildOutput: &domain.BuildOutput{ExitCode: 0}}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(300 * time.Millisecond)

	events := publisher.Events()
	foundPersistenceFailed := false
	for _, e := range events {
		if e.Type == domain.BuildEventPersistenceFailed {
			foundPersistenceFailed = true
			break
		}
	}
	if !foundPersistenceFailed {
		t.Error("expected persistence-failed event for running state")
	}

	finalRun, err := uc.Get(context.Background(), run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if finalRun.State != domain.BuildStateSucceeded {
		t.Errorf("expected succeeded state in memory, got %s", finalRun.State)
	}
}

func TestBuildUseCase_TerminalSaveFailure(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	history.saveErr = errors.New("disk full")
	history.saveErrAfter = 2
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildOutput: &domain.BuildOutput{ExitCode: 0}}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(300 * time.Millisecond)

	events := publisher.Events()
	foundPersistenceFailed := false
	for _, e := range events {
		if e.Type == domain.BuildEventPersistenceFailed && strings.Contains(e.Message, "terminal") {
			foundPersistenceFailed = true
			break
		}
	}
	if !foundPersistenceFailed {
		t.Error("expected persistence-failed event for terminal state")
	}

	finalRun, err := uc.Get(context.Background(), run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if finalRun.State != domain.BuildStateSucceeded {
		t.Errorf("expected succeeded state in memory, got %s", finalRun.State)
	}
	if !strings.Contains(finalRun.Summary, "persistence failed") {
		t.Errorf("expected summary to contain persistence failed, got %q", finalRun.Summary)
	}

	runs, err := uc.List(context.Background(), run.WorkspaceID, "", 10)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	found := false
	for _, r := range runs {
		if r.ID == run.ID {
			found = true
			if r.State != domain.BuildStateSucceeded {
				t.Errorf("List should return terminal state from memory, got %s", r.State)
			}
			break
		}
	}
	if !found {
		t.Error("build should still be queryable via List after terminal persistence failure")
	}
}

func TestBuildUseCase_PublishEventFailure(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildOutput: &domain.BuildOutput{ExitCode: 0}}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{
		publishErr:   errors.New("event hub down"),
		publishAfter: 1,
	}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	finalRun, err := uc.Get(context.Background(), run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if finalRun.State != domain.BuildStateSucceeded {
		t.Errorf("build should complete successfully even if publisher fails, got %s", finalRun.State)
	}
}

func TestBuildUseCase_CancelThenPersistWithBoundedContext(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildDelay: 5 * time.Second}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	run, err := uc.Start(context.Background(), testBuildCmd())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	cancelCtx, cancelWait := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelWait()
	err = uc.Cancel(cancelCtx, run.WorkspaceID, run.ID)
	if err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	events := publisher.Events()
	foundCancelled := false
	for _, e := range events {
		if e.Type == domain.BuildEventCancelled {
			foundCancelled = true
		}
	}
	if !foundCancelled {
		t.Errorf("expected cancelled event even after cancel, events: %v", events)
	}
}

func TestBuildUseCase_ListDedupeSortLimit(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildDelay: 200 * time.Millisecond}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &seqIDGen{}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	cmd := testBuildCmd()
	run1, err := uc.Start(context.Background(), cmd)
	if err != nil {
		t.Fatalf("Start 1 failed: %v", err)
	}
	time.Sleep(10 * time.Millisecond)

	run2, err := uc.Start(context.Background(), cmd)
	if err != nil {
		t.Fatalf("Start 2 failed: %v", err)
	}
	time.Sleep(10 * time.Millisecond)

	run3, err := uc.Start(context.Background(), cmd)
	if err != nil {
		t.Fatalf("Start 3 failed: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	runs, err := uc.List(context.Background(), cmd.WorkspaceID, "", 2)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(runs) != 2 {
		t.Errorf("expected limit 2, got %d runs", len(runs))
	}

	seenIDs := make(map[domain.BuildID]bool)
	for _, r := range runs {
		if seenIDs[r.ID] {
			t.Errorf("duplicate build ID found: %s", r.ID)
		}
		seenIDs[r.ID] = true
	}

	for i := 1; i < len(runs); i++ {
		t1 := buildRunSortKey(runs[i-1])
		t2 := buildRunSortKey(runs[i])
		if t1.Before(t2) {
			t.Error("runs should be sorted newest first")
		}
	}

	_ = run1
	_ = run2
	_ = run3
}

func TestBuildUseCase_ConstructorNilFailFast(t *testing.T) {
	lifecycleCtx := context.Background()
	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	registry := &fakeRegistry{provider: &fakeProvider{}}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	testCases := []struct {
		name  string
		setup func()
	}{
		{
			name: "nil history",
			setup: func() {
				NewBuildUseCase(lifecycleCtx, nil, resolver, registry, publisher, idGen)
			},
		},
		{
			name: "nil resolver",
			setup: func() {
				NewBuildUseCase(lifecycleCtx, history, nil, registry, publisher, idGen)
			},
		},
		{
			name: "nil registry",
			setup: func() {
				NewBuildUseCase(lifecycleCtx, history, resolver, nil, publisher, idGen)
			},
		},
		{
			name: "nil publisher",
			setup: func() {
				NewBuildUseCase(lifecycleCtx, history, resolver, registry, nil, idGen)
			},
		},
		{
			name: "nil idGen",
			setup: func() {
				NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, nil)
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Errorf("expected panic for %s", tc.name)
				}
			}()
			tc.setup()
		})
	}
}

func TestBuildUseCase_HistoryFailure(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	history.saveErr = errors.New("disk full")
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &fixedIDGen{id: "bld_" + testValidID26}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	_, err := uc.Start(context.Background(), testBuildCmd())
	if err == nil {
		t.Error("expected error when history save fails")
	}
}

func TestBuildUseCase_LifecycleShutdown(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildDelay: 5 * time.Second}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &seqIDGen{}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	for i := 0; i < 5; i++ {
		_, err := uc.Start(context.Background(), testBuildCmd())
		if err != nil {
			t.Fatalf("Start failed: %v", err)
		}
	}

	time.Sleep(100 * time.Millisecond)

	shutdownCtx, shutdownWait := context.WithTimeout(context.Background(), 2*time.Second)
	defer shutdownWait()
	err := uc.Shutdown(shutdownCtx)
	if err != nil {
		t.Fatalf("Shutdown failed: %v", err)
	}
}

func TestBuildUseCase_ConcurrentBuildsRace(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()

	history := newFakeHistory()
	resolver := &fakeResolver{plan: testPlan()}
	provider := &fakeProvider{buildDelay: 50 * time.Millisecond}
	registry := &fakeRegistry{provider: provider}
	publisher := &fakePublisher{}
	idGen := &seqIDGen{}

	uc := NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)

	const concurrency = 100
	var wg sync.WaitGroup

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			run, err := uc.Start(context.Background(), testBuildCmd())
			if err != nil {
				return
			}

			for j := 0; j < 5; j++ {
				_, _ = uc.Get(context.Background(), run.WorkspaceID, run.ID)
				_, _ = uc.List(context.Background(), run.WorkspaceID, "", 100)
				time.Sleep(5 * time.Millisecond)
			}
		}()
	}

	wg.Wait()
	time.Sleep(500 * time.Millisecond)
}

func TestBuildRunDeepCopy(t *testing.T) {
	now := domain.UTCNow()
	later := now.Add(time.Hour)
	code := 1
	orig := domain.BuildRun{
		ID:          domain.BuildID("bld_test"),
		WorkspaceID: domain.WorkspaceID("ws_test"),
		ProjectID:   domain.ProjectID("prj_test"),
		State:       domain.BuildStateFailed,
		QueuedAt:    now,
		StartedAt:   &now,
		FinishedAt:  &later,
		ExitCode:    &code,
		Summary:     "test",
		Diagnostics: []domain.BuildDiagnostic{
			{File: "a.java", Line: 1, Message: "err"},
		},
	}

	cp := orig.DeepCopy()

	if cp.ID != orig.ID {
		t.Error("ID not copied")
	}
	if cp.StartedAt == orig.StartedAt {
		t.Error("StartedAt should be different pointer")
	}
	if cp.FinishedAt == orig.FinishedAt {
		t.Error("FinishedAt should be different pointer")
	}
	if cp.ExitCode == orig.ExitCode {
		t.Error("ExitCode should be different pointer")
	}
	if len(cp.Diagnostics) != len(orig.Diagnostics) {
		t.Error("Diagnostics length mismatch")
	}
	if &cp.Diagnostics[0] == &orig.Diagnostics[0] {
		t.Error("Diagnostics should be different slice")
	}

	*cp.ExitCode = 2
	if *orig.ExitCode != 1 {
		t.Error("modifying copy ExitCode should not modify original")
	}
}
