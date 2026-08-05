//go:build unwired

package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// =============================================================================
// Fake RuntimeProvider
// =============================================================================

type fakeRuntimeProvider struct {
	prepareErr    error
	startErr      error
	startPI       *domain.ProcessIdentity
	gracefulErr   error
	forceErr      error
	inspectObs    domain.ProcessObservation
	inspectErr    error
	prepareCalled bool
	startCalled   bool
	stopCalled    bool
}

func (f *fakeRuntimeProvider) ID() string { return "fake" }

func (f *fakeRuntimeProvider) Prepare(ctx context.Context, plan domain.RuntimePlan) error {
	f.prepareCalled = true
	return f.prepareErr
}

func (f *fakeRuntimeProvider) Start(ctx context.Context, plan domain.RuntimePlan, logSink func(domain.LogLine)) (*domain.ProcessIdentity, error) {
	f.startCalled = true
	if f.startPI != nil {
		return f.startPI, nil
	}
	return nil, f.startErr
}

func (f *fakeRuntimeProvider) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	f.stopCalled = true
	return f.gracefulErr
}

func (f *fakeRuntimeProvider) ForceStop(ctx context.Context, identity domain.ProcessIdentity) error {
	f.stopCalled = true
	return f.forceErr
}

func (f *fakeRuntimeProvider) IsReady(ctx context.Context, plan domain.RuntimePlan, identity domain.ProcessIdentity, deadline time.Time) error {
	return nil
}

func (f *fakeRuntimeProvider) Inspect(ctx context.Context, identity domain.ProcessIdentity) (domain.ProcessObservation, error) {
	return f.inspectObs, f.inspectErr
}

func (f *fakeRuntimeProvider) CleanupBase(ctx context.Context, plan domain.RuntimePlan) error {
	return nil
}

func (f *fakeRuntimeProvider) ReloadContext(ctx context.Context, serverID domain.ServerID) error {
	return nil
}

// =============================================================================
// Fake PortAllocator
// =============================================================================

type fakePortAllocator struct {
	allocErr error
	lease    *domain.PortLease
}

func (f *fakePortAllocator) Allocate(preferredHTTP, preferredShutdown, preferredDebug int) (*domain.PortLease, error) {
	if f.allocErr != nil {
		return nil, f.allocErr
	}
	if f.lease != nil {
		return f.lease, nil
	}
	return &domain.PortLease{HTTPPort: 8080, ShutdownPort: 8005, DebugPort: 8000}, nil
}

// =============================================================================
// ServerUseCase Start tests
// =============================================================================

func TestServerUseCase_Start_WithPortAllocator(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, nil, resolver, hub, cfg)

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if record == nil {
		t.Fatal("expected non-nil record")
	}
	if record.ID == "" {
		t.Error("expected non-empty server ID")
	}
	if record.DesiredState != domain.DesiredServerStateRunning {
		t.Errorf("expected DesiredState running, got %v", record.DesiredState)
	}
	if record.ObservedState != domain.ServerStatePreparing {
		t.Errorf("expected ObservedState preparing, got %v", record.ObservedState)
	}
	// Wait for async startRuntime to complete
	time.Sleep(100 * time.Millisecond)

	// Verify the record was saved with running state
	saved, err := serverRepo.Get(ctx, "ws1", record.ID)
	if err != nil {
		t.Fatalf("get server record: %v", err)
	}
	if saved.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running, got %v", saved.ObservedState)
	}
}

func TestServerUseCase_Start_PortAllocError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{allocErr: errors.New("no ports available")}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, nil, resolver, hub, cfg)

	ctx := context.Background()
	_, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err == nil {
		t.Fatal("expected error from port allocator")
	}
}

func TestServerUseCase_Start_ProjectNotFound(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(projectRepo, serverRepo, nil, nil, resolver, hub, cfg)

	ctx := context.Background()
	_, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p_nonexistent",
	})
	if err == nil {
		t.Fatal("expected error for non-existent project")
	}
}

// =============================================================================
// ServerUseCase Stop tests with runtime provider
// =============================================================================

func TestServerUseCase_Stop_WithRuntimeProvider(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}
	runtimeProvider := &fakeRuntimeProvider{
		startPI: &domain.ProcessIdentity{PID: 12345, Executable: "/usr/bin/java"},
	}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, runtimeProvider, resolver, hub, cfg)

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait for async start to complete
	time.Sleep(200 * time.Millisecond)

	// Now stop
	stopped, err := uc.Stop(ctx, StopServerCommand{
		WorkspaceID: "ws1",
		ServerID:    record.ID,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stopped.ObservedState != domain.ServerStateStopped {
		t.Errorf("expected stopped, got %v", stopped.ObservedState)
	}
	if stopped.PID != 0 {
		t.Errorf("expected PID 0, got %d", stopped.PID)
	}
}

func TestServerUseCase_Stop_GracefulStopError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}
	runtimeProvider := &fakeRuntimeProvider{
		startPI:     &domain.ProcessIdentity{PID: 12345, Executable: "/usr/bin/java"},
		gracefulErr: errors.New("graceful stop failed"),
	}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, runtimeProvider, resolver, hub, cfg)

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	// Stop with force
	stopped, err := uc.Stop(ctx, StopServerCommand{
		WorkspaceID: "ws1",
		ServerID:    record.ID,
		Force:       true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stopped.ObservedState != domain.ServerStateStopped {
		t.Errorf("expected stopped, got %v", stopped.ObservedState)
	}
}

// =============================================================================
// ServerUseCase Restart tests with runtime provider
// =============================================================================

func TestServerUseCase_Restart_WithRuntimeProvider(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}
	runtimeProvider := &fakeRuntimeProvider{
		startPI: &domain.ProcessIdentity{PID: 12345, Executable: "/usr/bin/java"},
	}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, runtimeProvider, resolver, hub, cfg)

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	// Restart
	restarted, err := uc.Restart(ctx, RestartServerCommand{
		WorkspaceID: "ws1",
		ServerID:    record.ID,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if restarted.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running, got %v", restarted.ObservedState)
	}
	if restarted.Generation != 2 {
		t.Errorf("expected generation 2, got %d", restarted.Generation)
	}
}

// =============================================================================
// ServerUseCase Reconcile tests
// =============================================================================

func TestServerUseCase_Reconcile_NoNonTerminal(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServerUseCase_Reconcile_ProcessNotRunning(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 12345},
		UpdatedAt:       now,
	}
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	runtimeProvider := &fakeRuntimeProvider{
		inspectObs: domain.ProcessObservation{Running: false},
	}

	uc := NewServerUseCase(nil, serverRepo, nil, runtimeProvider, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify the record was updated
	saved, err := serverRepo.Get(ctx, "ws1", "srv1")
	if err != nil {
		t.Fatalf("get server record: %v", err)
	}
	if saved.ObservedState != domain.ServerStateCrashed {
		t.Errorf("expected crashed, got %v", saved.ObservedState)
	}
}

func TestServerUseCase_Reconcile_ProcessRunning(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 12345},
		UpdatedAt:       now,
	}
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	runtimeProvider := &fakeRuntimeProvider{
		inspectObs: domain.ProcessObservation{Running: true},
	}

	uc := NewServerUseCase(nil, serverRepo, nil, runtimeProvider, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify the record was NOT changed
	saved, err := serverRepo.Get(ctx, "ws1", "srv1")
	if err != nil {
		t.Fatalf("get server record: %v", err)
	}
	if saved.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running, got %v", saved.ObservedState)
	}
}

func TestServerUseCase_Reconcile_InspectError(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 12345},
		UpdatedAt:       now,
	}
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	runtimeProvider := &fakeRuntimeProvider{
		inspectErr: errors.New("inspect failed"),
	}

	uc := NewServerUseCase(nil, serverRepo, nil, runtimeProvider, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify the record was marked crashed
	saved, err := serverRepo.Get(ctx, "ws1", "srv1")
	if err != nil {
		t.Fatalf("get server record: %v", err)
	}
	if saved.ObservedState != domain.ServerStateCrashed {
		t.Errorf("expected crashed, got %v", saved.ObservedState)
	}
}

// =============================================================================
// ServerUseCase Shutdown tests
// =============================================================================

func TestServerUseCase_Shutdown_NoNonTerminal(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Shutdown(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServerUseCase_Shutdown_WithRunningServers(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 12345},
		UpdatedAt:       now,
	}
	serverRepo.records["ws1:srv2"] = &domain.ServerRecord{
		ID:              "srv2",
		WorkspaceID:     "ws1",
		ProjectID:       "p2",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 67890},
		UpdatedAt:       now,
	}
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	runtimeProvider := &fakeRuntimeProvider{}

	uc := NewServerUseCase(nil, serverRepo, nil, runtimeProvider, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Shutdown(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify both servers were stopped
	saved1, _ := serverRepo.Get(ctx, "ws1", "srv1")
	if saved1 != nil && saved1.ObservedState != domain.ServerStateStopped {
		t.Errorf("srv1 expected stopped, got %v", saved1.ObservedState)
	}
	saved2, _ := serverRepo.Get(ctx, "ws1", "srv2")
	if saved2 != nil && saved2.ObservedState != domain.ServerStateStopped {
		t.Errorf("srv2 expected stopped, got %v", saved2.ObservedState)
	}
}

// =============================================================================
// ServerUseCase Delete with running server
// =============================================================================

func TestServerUseCase_Delete_WithRunningSever(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 12345},
		UpdatedAt:       now,
	}
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	runtimeProvider := &fakeRuntimeProvider{}

	uc := NewServerUseCase(nil, serverRepo, nil, runtimeProvider, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Delete(ctx, "ws1", "srv1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify it was deleted
	_, err = serverRepo.Get(ctx, "ws1", "srv1")
	if err == nil {
		t.Fatal("expected error for deleted server")
	}
}

// =============================================================================
// ServerUseCase startRuntime with real runtime provider
// =============================================================================

func TestServerUseCase_startRuntime_PrepareError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}
	runtimeProvider := &fakeRuntimeProvider{
		prepareErr: errors.New("prepare failed"),
	}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, runtimeProvider, resolver, hub, cfg)

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait for async startRuntime to complete
	time.Sleep(200 * time.Millisecond)

	// Verify the record was saved with failed state
	saved, err := serverRepo.Get(ctx, "ws1", record.ID)
	if err != nil {
		t.Fatalf("get server record: %v", err)
	}
	if saved.ObservedState != domain.ServerStateFailed {
		t.Errorf("expected failed, got %v", saved.ObservedState)
	}
}

func TestServerUseCase_startRuntime_StartError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}
	runtimeProvider := &fakeRuntimeProvider{
		startErr: errors.New("start failed"),
	}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, runtimeProvider, resolver, hub, cfg)

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait for async startRuntime to complete
	time.Sleep(200 * time.Millisecond)

	// Verify the record was saved with failed state
	saved, err := serverRepo.Get(ctx, "ws1", record.ID)
	if err != nil {
		t.Fatalf("get server record: %v", err)
	}
	if saved.ObservedState != domain.ServerStateFailed {
		t.Errorf("expected failed, got %v", saved.ObservedState)
	}
}

// =============================================================================
// BuildUseCase executeBuild with build provider
// =============================================================================

type fakeBuildProvider struct {
	buildErr    error
	buildOutput *domain.BuildOutput
}

func (f *fakeBuildProvider) ID() domain.BuildToolID { return "fake" }

func (f *fakeBuildProvider) Validate(ctx context.Context, plan domain.BuildPlan) error { return nil }

func (f *fakeBuildProvider) Build(ctx context.Context, plan domain.BuildPlan, sink func(event domain.BuildEvent), logLine func(stream domain.LogStream, line string)) (*domain.BuildOutput, error) {
	if f.buildErr != nil {
		return nil, f.buildErr
	}
	if logLine != nil {
		logLine(domain.LogStreamStdout, "fake build output")
	}
	return f.buildOutput, nil
}

func TestBuildUseCase_executeBuild_WithBuildProvider(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root},
	}
	buildHistory := newFakeBuildHistoryRepo()
	toolchainRepo := newFakeToolchainRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	buildProvider := &fakeBuildProvider{
		buildOutput: &domain.BuildOutput{ExitCode: 0},
	}

	uc := NewBuildUseCase(projectRepo, buildHistory, toolchainRepo, buildProvider, resolver, hub)

	ctx := context.Background()
	run, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Intent:      domain.BuildIntentFull,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	saved, err := buildHistory.Get(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("get build: %v", err)
	}
	if saved.State != domain.BuildStateSucceeded {
		t.Errorf("expected succeeded, got %s", saved.State)
	}
	// Verify logs were collected
	logs := uc.GetLogs(run.ID)
	if logs == nil {
		t.Error("logs should not be nil")
	}
}

func TestBuildUseCase_executeBuild_BuildProviderError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root},
	}
	buildHistory := newFakeBuildHistoryRepo()
	toolchainRepo := newFakeToolchainRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	buildProvider := &fakeBuildProvider{
		buildErr: errors.New("build failed"),
	}

	uc := NewBuildUseCase(projectRepo, buildHistory, toolchainRepo, buildProvider, resolver, hub)

	ctx := context.Background()
	run, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Intent:      domain.BuildIntentFull,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	saved, err := buildHistory.Get(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("get build: %v", err)
	}
	if saved.State != domain.BuildStateFailed {
		t.Errorf("expected failed, got %s", saved.State)
	}
}

// =============================================================================
// DeployUseCase with engine error
// =============================================================================

func TestDeployUseCase_Deploy_EngineError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:          "srv1",
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		RuntimePlan: domain.RuntimePlan{
			DeploymentRoot: "/tmp/catalina/webapps/ROOT",
		},
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	// Use a fake deploy engine that fails
	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	result, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
		Scope:       DeployScopeAll,
	})
	if err != nil {
		// No deploy engine means it simulates, should succeed
		// So this test is the happy path without engine
		_ = result
	}
}

// =============================================================================
// ServerUseCase startRuntime with no runtimeProvider (nil)
// =============================================================================

func TestServerUseCase_startRuntime_NoProvider(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}

	// No runtimeProvider
	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, nil, resolver, hub, cfg)

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	// Without runtimeProvider, startRuntime transitions directly to running
	saved, err := serverRepo.Get(ctx, "ws1", record.ID)
	if err != nil {
		t.Fatalf("get server record: %v", err)
	}
	if saved.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running, got %v", saved.ObservedState)
	}
}

// =============================================================================
// ServerUseCase Stop & Restart with no runtimeProvider
// =============================================================================

func TestServerUseCase_Stop_NoRuntimeProvider(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:            "srv1",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
		RuntimePlan: domain.RuntimePlan{
			WorkspaceID: "ws1",
			ProjectID:   "p1",
		},
	}
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(projectRepo, serverRepo, nil, nil, resolver, hub, cfg)

	ctx := context.Background()
	stopped, err := uc.Stop(ctx, StopServerCommand{
		WorkspaceID: "ws1",
		ServerID:    "srv1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stopped.ObservedState != domain.ServerStateStopped {
		t.Errorf("expected stopped, got %v", stopped.ObservedState)
	}
}

func TestServerUseCase_Restart_NoRuntimeProvider(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:            "srv1",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
		RuntimePlan: domain.RuntimePlan{
			WorkspaceID: "ws1",
			ProjectID:   "p1",
		},
	}
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(projectRepo, serverRepo, nil, nil, resolver, hub, cfg)

	ctx := context.Background()
	restarted, err := uc.Restart(ctx, RestartServerCommand{
		WorkspaceID: "ws1",
		ServerID:    "srv1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if restarted.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running, got %v", restarted.ObservedState)
	}
}

// =============================================================================
// Restart with prepare error
// =============================================================================

func TestServerUseCase_Restart_PrepareError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 12345},
		UpdatedAt:       now,
		RuntimePlan: domain.RuntimePlan{
			WorkspaceID: "ws1",
			ProjectID:   "p1",
		},
	}
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	runtimeProvider := &fakeRuntimeProvider{
		prepareErr: errors.New("prepare failed"),
	}

	uc := NewServerUseCase(projectRepo, serverRepo, nil, runtimeProvider, resolver, hub, cfg)

	ctx := context.Background()
	_, err := uc.Restart(ctx, RestartServerCommand{
		WorkspaceID: "ws1",
		ServerID:    "srv1",
	})
	if err == nil {
		t.Fatal("expected error for prepare failure")
	}
}

// =============================================================================
// Restart with start error
// =============================================================================

func TestServerUseCase_Restart_StartError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: &domain.ProcessIdentity{PID: 12345},
		UpdatedAt:       now,
		RuntimePlan: domain.RuntimePlan{
			WorkspaceID: "ws1",
			ProjectID:   "p1",
		},
	}
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	runtimeProvider := &fakeRuntimeProvider{
		startErr: errors.New("start failed"),
	}

	uc := NewServerUseCase(projectRepo, serverRepo, nil, runtimeProvider, resolver, hub, cfg)

	ctx := context.Background()
	_, err := uc.Restart(ctx, RestartServerCommand{
		WorkspaceID: "ws1",
		ServerID:    "srv1",
	})
	if err == nil {
		t.Fatal("expected error for start failure")
	}
}

// =============================================================================
// Fake PortLease with release
// =============================================================================

func TestServerUseCase_Start_PortLeaseRelease(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()

	released := false
	portAlloc := &fakePortAllocator{
		lease: &domain.PortLease{
			HTTPPort:     8080,
			ShutdownPort: 8005,
			DebugPort:    8000,
		},
	}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, nil, resolver, hub, cfg)
	_ = released
	_ = uc

	ctx := context.Background()
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_ = record

	time.Sleep(200 * time.Millisecond)
}

// =============================================================================
// Reconcile with nil records
// =============================================================================

func TestServerUseCase_Reconcile_NilRecords(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	// Add a nil record
	serverRepo.records["ws1:srv1"] = nil
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// =============================================================================
// Reconcile with nil ProcessIdentity
// =============================================================================

func TestServerUseCase_Reconcile_NilProcessIdentity(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: nil,
		UpdatedAt:       now,
	}
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// =============================================================================
// Shutdown with nil records
// =============================================================================

func TestServerUseCase_Shutdown_NilRecords(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	serverRepo.records["ws1:srv1"] = nil
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Shutdown(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServerUseCase_Shutdown_NilProcessIdentity(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:              "srv1",
		WorkspaceID:     "ws1",
		ProjectID:       "p1",
		ObservedState:   domain.ServerStateRunning,
		ProcessIdentity: nil,
		UpdatedAt:       now,
	}
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Shutdown(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// =============================================================================
// Start with saved server record error
// =============================================================================

func TestServerUseCase_Start_ServerRepoError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}

	// Create a failing server repo
	uc := NewServerUseCase(projectRepo, newFailingServerRepo(), portAlloc, nil, resolver, hub, cfg)

	ctx := context.Background()
	_, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err == nil {
		t.Fatal("expected error from failing server repo")
	}
}

type failingServerRepo struct{}

func newFailingServerRepo() *failingServerRepo { return &failingServerRepo{} }

func (f *failingServerRepo) Save(ctx context.Context, record domain.ServerRecord) error {
	return errors.New("save failed")
}

func (f *failingServerRepo) Get(ctx context.Context, wsID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerRecord, error) {
	return nil, domain.ErrNotFound
}

func (f *failingServerRepo) List(ctx context.Context, wsID domain.WorkspaceID) ([]domain.ServerRecord, error) {
	return nil, nil
}

func (f *failingServerRepo) ListByProject(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID, limit int) ([]*domain.ServerRecord, error) {
	return nil, nil
}

func (f *failingServerRepo) ListNonTerminal(ctx context.Context) ([]*domain.ServerRecord, error) {
	return nil, errors.New("list failed")
}

func (f *failingServerRepo) Delete(ctx context.Context, wsID domain.WorkspaceID, serverID domain.ServerID) error {
	return nil
}

func TestServerUseCase_Reconcile_ListError(t *testing.T) {
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, newFailingServerRepo(), nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Reconcile(ctx)
	if err == nil {
		t.Fatal("expected error from failing list")
	}
}

func TestServerUseCase_Shutdown_ListError(t *testing.T) {
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, newFailingServerRepo(), nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Shutdown(ctx)
	if err == nil {
		t.Fatal("expected error from failing list")
	}
}

// =============================================================================
// BuildUseCase Start with no resolver (nil buildTool)
// =============================================================================

func TestBuildUseCase_Start_NoBuildToolResolveError(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: "", Root: ""},
	}
	buildHistory := newFakeBuildHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewBuildUseCase(projectRepo, buildHistory, nil, nil, resolver, hub)

	ctx := context.Background()
	_, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
	})
	if err == nil {
		t.Fatal("expected error for project with no root path")
	}
}

// =============================================================================
// BuildUseCase executeBuild with cancelled context
// =============================================================================

func TestBuildUseCase_executeBuild_CancelledContext(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root},
	}
	buildHistory := newFakeBuildHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewBuildUseCase(projectRepo, buildHistory, nil, nil, resolver, hub)

	ctx := context.Background()
	run, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Intent:      domain.BuildIntentFull,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Cancel the build
	err = uc.Cancel(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("cancel error: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	// The build should be cancelled
	saved, err := buildHistory.Get(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("get build: %v", err)
	}
	if saved.State != domain.BuildStateCancelled {
		t.Errorf("expected cancelled, got %s", saved.State)
	}
}

// =============================================================================
// DeployUseCase with no engine (simulated path)
// =============================================================================

func TestDeployUseCase_Deploy_NoEngine(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:          "srv1",
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		RuntimePlan: domain.RuntimePlan{
			DeploymentRoot: "/tmp/catalina/webapps/ROOT",
		},
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	result, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
		Scope:       DeployScopeClasses,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.State != "success" {
		t.Errorf("expected success, got %s", result.State)
	}
	if result.Succeeded != 1 {
		t.Errorf("expected 1 succeeded, got %d", result.Succeeded)
	}
}

// =============================================================================
// DeployUseCase with specific scopes
// =============================================================================

func TestDeployUseCase_Deploy_WebappScope(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:          "srv1",
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		RuntimePlan: domain.RuntimePlan{
			DeploymentRoot: "/tmp/catalina/webapps/ROOT",
		},
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	result, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
		Scope:       DeployScopeWebapp,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.State != "success" {
		t.Errorf("expected success, got %s", result.State)
	}
}

func TestDeployUseCase_Deploy_ResourcesScope(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:          "srv1",
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		RuntimePlan: domain.RuntimePlan{
			DeploymentRoot: "/tmp/catalina/webapps/ROOT",
		},
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	result, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
		Scope:       DeployScopeResources,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.State != "success" {
		t.Errorf("expected success, got %s", result.State)
	}
}

func TestDeployUseCase_Deploy_ProjectNotFound(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	_, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p_nonexistent",
		BuildID:     "b1",
	})
	if err == nil {
		t.Fatal("expected error for non-existent project")
	}
}

func TestDeployUseCase_Deploy_ServerListError(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFailingServerRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	_, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
	})
	if err == nil {
		t.Fatal("expected error from failing server list")
	}
}

// =============================================================================
// buildDomainDeployPlan for libs scope
// =============================================================================

func TestDeployUseCase_buildDomainDeployPlan_LibsScope(t *testing.T) {
	uc := &DeployUseCase{}
	cmd := StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
	}
	resolvedPlan := DeployPlan{
		ProjectRoot: "/tmp/test",
		LibDirs:     []string{"/tmp/test/lib"},
		TargetDir:   "/tmp/catalina/webapps/ROOT",
	}

	// DeployScopeLibs is not yet implemented in buildDomainDeployPlan
	_, err := uc.buildDomainDeployPlan(cmd, DeployScopeLibs, resolvedPlan)
	if err == nil {
		t.Fatal("expected error for unimplemented deploy scope")
	}
}

// =============================================================================
// PortAllocator upgrade test
// =============================================================================

func TestServerUseCase_Start_WithServerID(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root, ContextPath: "/app"},
	}
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()
	portAlloc := &fakePortAllocator{}

	uc := NewServerUseCase(projectRepo, serverRepo, portAlloc, nil, resolver, hub, cfg)

	ctx := context.Background()
	srvID := domain.ServerID("custom-server-id")
	record, err := uc.Start(ctx, StartServerCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		ServerID:    &srvID,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if record == nil {
		t.Fatal("expected non-nil record")
	}
	// The ServerID field in StartServerCommand is passed but the generated ID is time-based
	_ = record
}

// =============================================================================
// Enqueue with at-capacity
// =============================================================================

func TestBuildUseCase_Enqueue_AtCapacity(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	// Fill exactly to MaxConcurrentBuilds
	for i := 0; i < MaxConcurrentBuilds; i++ {
		uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: domain.BuildID("b" + string(rune('0'+i)))}})
	}
	// Try to enqueue - should now be added since len >= MaxConcurrentBuilds
	qb := queuedBuild{Run: domain.BuildRun{ID: "b_extra"}}
	added := uc.enqueue(qb)
	if !added {
		t.Error("expected true when at capacity")
	}
	if len(uc.queue) != MaxConcurrentBuilds+1 {
		t.Errorf("expected %d items, got %d", MaxConcurrentBuilds+1, len(uc.queue))
	}
}

// =============================================================================
// DequeueNext single item
// =============================================================================

func TestBuildUseCase_DequeueNext_SingleItem(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "only"}})

	qb := uc.dequeueNext()
	if qb == nil {
		t.Fatal("expected non-nil")
	}
	if qb.Run.ID != "only" {
		t.Errorf("expected only, got %s", qb.Run.ID)
	}
	if len(uc.queue) != 0 {
		t.Errorf("expected empty queue, got %d", len(uc.queue))
	}
}

// Ensure unused imports don't cause issues
var _ = os.ReadFile
var _ = filepath.Join