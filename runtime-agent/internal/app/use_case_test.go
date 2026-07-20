package app

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// setupTestProject creates a temp directory with a minimal .kairo/project.yaml
func setupTestProject(t *testing.T) (string, func()) {
	t.Helper()
	dir := t.TempDir()
	configDir := filepath.Join(dir, ".kairo")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("create config dir: %v", err)
	}
	configContent := `schemaVersion: 1
name: test-project
root: .
sourceRoots:
  - src
webappDir: webapp
resourceRoots:
  - resources
outputDir: build/classes
sourceLevel: "1.8"
targetLevel: "1.8"
encoding: utf-8
buildTool: javac
buildFile: build.xml
buildTargets:
  - compile
contextPath: /app
`
	if err := os.WriteFile(filepath.Join(configDir, "project.yaml"), []byte(configContent), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return dir, func() {}
}

func TestBuildUseCase_Start_ValidatesInput(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	buildHistory := newFakeBuildHistoryRepo()
	toolchainRepo := newFakeToolchainRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewBuildUseCase(projectRepo, buildHistory, toolchainRepo, nil, resolver, hub)

	ctx := context.Background()

	// Empty workspaceId
	_, err := uc.Start(ctx, StartBuildCommand{WorkspaceID: "", ProjectID: "p1"})
	if err == nil {
		t.Fatal("expected error for empty workspaceId")
	}

	// Empty projectId
	_, err = uc.Start(ctx, StartBuildCommand{WorkspaceID: "ws1", ProjectID: ""})
	if err == nil {
		t.Fatal("expected error for empty projectId")
	}
}

func TestBuildUseCase_Start_QueuesBuild(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root},
	}
	buildHistory := newFakeBuildHistoryRepo()
	toolchainRepo := newFakeToolchainRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil} // Use real resolver with nil sandbox

	uc := NewBuildUseCase(projectRepo, buildHistory, toolchainRepo, nil, resolver, hub)

	ctx := context.Background()
	run, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Intent:      domain.BuildIntentFull,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if run.ID == "" {
		t.Error("expected non-empty build ID")
	}
	if run.State != domain.BuildStateQueued {
		t.Errorf("expected queued state, got %s", run.State)
	}
	if run.WorkspaceID != "ws1" {
		t.Errorf("expected workspaceID ws1, got %s", run.WorkspaceID)
	}
	if run.ProjectID != "p1" {
		t.Errorf("expected projectID p1, got %s", run.ProjectID)
	}

	// Wait for async build to complete
	time.Sleep(100 * time.Millisecond)

	// Verify build was saved
	saved, err := buildHistory.Get(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("unexpected error getting build: %v", err)
	}
	if saved.State != domain.BuildStateSucceeded {
		t.Errorf("expected succeeded state, got %s", saved.State)
	}
}

func TestBuildUseCase_Cancel_ValidatesState(t *testing.T) {
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

	uc := NewBuildUseCase(projectRepo, buildHistory, toolchainRepo, nil, resolver, hub)

	ctx := context.Background()

	// Start a build
	run, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Intent:      domain.BuildIntentFull,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait for async build to complete
	time.Sleep(100 * time.Millisecond)

	// Try to cancel a completed build
	err = uc.Cancel(ctx, "ws1", run.ID)
	if err == nil {
		t.Error("expected error cancelling completed build")
	}
}

func TestBuildUseCase_List_SortedByTime(t *testing.T) {
	buildHistory := newFakeBuildHistoryRepo()
	now := domain.UTCNow()

	// Add builds in reverse order
	buildHistory.runs["ws1:p1"] = []domain.BuildRun{
		{
			ID:          "b1",
			WorkspaceID: "ws1",
			ProjectID:   "p1",
			State:       domain.BuildStateSucceeded,
			QueuedAt:    now.Add(-3 * time.Hour),
		},
		{
			ID:          "b2",
			WorkspaceID: "ws1",
			ProjectID:   "p1",
			State:       domain.BuildStateFailed,
			QueuedAt:    now.Add(-1 * time.Hour),
		},
		{
			ID:          "b3",
			WorkspaceID: "ws1",
			ProjectID:   "p1",
			State:       domain.BuildStateQueued,
			QueuedAt:    now,
		},
	}

	hub := events.NewEventHub(100, 10)
	uc := NewBuildUseCase(nil, buildHistory, nil, nil, nil, hub)

	ctx := context.Background()
	runs, err := uc.List(ctx, "ws1", "p1", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(runs) != 3 {
		t.Fatalf("expected 3 runs, got %d", len(runs))
	}
	// Should be sorted by start time DESC
	if runs[0].ID != "b3" {
		t.Errorf("expected b3 first, got %s", runs[0].ID)
	}
	if runs[1].ID != "b2" {
		t.Errorf("expected b2 second, got %s", runs[1].ID)
	}
	if runs[2].ID != "b1" {
		t.Errorf("expected b1 third, got %s", runs[2].ID)
	}
}

func TestBuildUseCase_List_RespectsLimit(t *testing.T) {
	buildHistory := newFakeBuildHistoryRepo()
	now := domain.UTCNow()

	var runs []domain.BuildRun
	for i := 0; i < 10; i++ {
		runs = append(runs, domain.BuildRun{
			ID:          domain.BuildID("b" + string(rune('0'+i))),
			WorkspaceID: "ws1",
			ProjectID:   "p1",
			State:       domain.BuildStateSucceeded,
			QueuedAt:    now.Add(-time.Duration(i) * time.Hour),
		})
	}
	buildHistory.runs["ws1:p1"] = runs

	hub := events.NewEventHub(100, 10)
	uc := NewBuildUseCase(nil, buildHistory, nil, nil, nil, hub)

	ctx := context.Background()
	result, err := uc.List(ctx, "ws1", "p1", 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 3 {
		t.Errorf("expected 3 runs, got %d", len(result))
	}
}

func TestBuildUseCase_Get_ReturnsBuild(t *testing.T) {
	buildHistory := newFakeBuildHistoryRepo()
	buildHistory.runs["ws1:build1"] = []domain.BuildRun{
		{
			ID:          "build1",
			WorkspaceID: "ws1",
			ProjectID:   "p1",
			State:       domain.BuildStateSucceeded,
		},
	}

	hub := events.NewEventHub(100, 10)
	uc := NewBuildUseCase(nil, buildHistory, nil, nil, nil, hub)

	ctx := context.Background()
	run, err := uc.Get(ctx, "ws1", "build1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if run.ID != "build1" {
		t.Errorf("expected build1, got %s", run.ID)
	}
}

func TestBuildUseCase_BuildStateTransitions(t *testing.T) {
	// Verify only legal transitions
	tests := []struct {
		from domain.BuildState
		to   domain.BuildState
		ok   bool
	}{
		{domain.BuildStateQueued, domain.BuildStateRunning, true},
		{domain.BuildStateRunning, domain.BuildStateSucceeded, true},
		{domain.BuildStateRunning, domain.BuildStateFailed, true},
		{domain.BuildStateRunning, domain.BuildStateCancelled, true},
		{domain.BuildStateQueued, domain.BuildStateCancelled, true},
		{domain.BuildStateSucceeded, domain.BuildStateRunning, false},
		{domain.BuildStateFailed, domain.BuildStateRunning, false},
		{domain.BuildStateCancelled, domain.BuildStateRunning, false},
		{domain.BuildStateQueued, domain.BuildStateSucceeded, false},
	}

	for _, tt := range tests {
		t.Run(string(tt.from)+"_to_"+string(tt.to), func(t *testing.T) {
			got := tt.from.CanTransitionTo(tt.to)
			if got != tt.ok {
				t.Errorf("CanTransitionTo(%s, %s) = %v, want %v", tt.from, tt.to, got, tt.ok)
			}
		})
	}
}

func TestServerUseCase_Start_ValidatesInput(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(projectRepo, serverRepo, nil, nil, resolver, hub, cfg)

	ctx := context.Background()

	// Empty workspaceId
	_, err := uc.Start(ctx, StartServerCommand{WorkspaceID: "", ProjectID: "p1"})
	if err == nil {
		t.Fatal("expected error for empty workspaceId")
	}

	// Empty projectId
	_, err = uc.Start(ctx, StartServerCommand{WorkspaceID: "ws1", ProjectID: ""})
	if err == nil {
		t.Fatal("expected error for empty projectId")
	}
}

func TestServerUseCase_Stop_ValidatesInput(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(projectRepo, serverRepo, nil, nil, resolver, hub, cfg)

	ctx := context.Background()

	_, err := uc.Stop(ctx, StopServerCommand{WorkspaceID: "", ServerID: "s1"})
	if err == nil {
		t.Fatal("expected error for empty workspaceId")
	}

	_, err = uc.Stop(ctx, StopServerCommand{WorkspaceID: "ws1", ServerID: ""})
	if err == nil {
		t.Fatal("expected error for empty serverId")
	}
}

func TestServerUseCase_Restart_ValidatesInput(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(projectRepo, serverRepo, nil, nil, resolver, hub, cfg)

	ctx := context.Background()

	_, err := uc.Restart(ctx, RestartServerCommand{WorkspaceID: "", ServerID: "s1"})
	if err == nil {
		t.Fatal("expected error for empty workspaceId")
	}

	_, err = uc.Restart(ctx, RestartServerCommand{WorkspaceID: "ws1", ServerID: ""})
	if err == nil {
		t.Fatal("expected error for empty serverId")
	}
}

func TestServerUseCase_Get_NotFound(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	_, err := uc.Get(ctx, "ws1", "srv_nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent server")
	}
}

func TestServerUseCase_Delete(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:            "srv1",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		ObservedState: domain.ServerStateStopped,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()

	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Delete(ctx, "ws1", "srv1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = serverRepo.Get(ctx, "ws1", "srv1")
	if err == nil {
		t.Fatal("expected error for deleted server")
	}
}

func TestDeployUseCase_ScopeMapping(t *testing.T) {
	// Verify scope strings
	scopes := []struct {
		scope DeployScope
		str   string
	}{
		{DeployScopeAll, "all"},
		{DeployScopeClasses, "classes"},
		{DeployScopeWebapp, "webapp"},
		{DeployScopeResources, "resources"},
		{DeployScopeLibs, "libs"},
	}

	for _, s := range scopes {
		if string(s.scope) != s.str {
			t.Errorf("expected scope string %s, got %s", s.str, s.scope)
		}
	}
}

func TestDeployUseCase_ValidatesInput(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()

	// Empty workspaceId
	_, err := uc.Deploy(ctx, StartDeployCommand{WorkspaceID: "", ProjectID: "p1", BuildID: "b1"})
	if err == nil {
		t.Fatal("expected error for empty workspaceId")
	}

	// Empty projectId
	_, err = uc.Deploy(ctx, StartDeployCommand{WorkspaceID: "ws1", ProjectID: "", BuildID: "b1"})
	if err == nil {
		t.Fatal("expected error for empty projectId")
	}

	// Empty buildId
	_, err = uc.Deploy(ctx, StartDeployCommand{WorkspaceID: "ws1", ProjectID: "p1", BuildID: ""})
	if err == nil {
		t.Fatal("expected error for empty buildId")
	}
}

func TestDeployUseCase_NoRunningServer(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	projectRepo := newFakeProjectRepo()
	projectRepo.projects = map[string]*domain.Project{
		"ws1:p1": {ID: "p1", WorkspaceID: "ws1", RootPath: root},
	}
	buildHistory := newFakeBuildHistoryRepo()
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	resolver := &PlanResolver{sandbox: nil, portAlloc: nil}

	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	_, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
		Scope:       DeployScopeAll,
	})
	if err == nil {
		t.Fatal("expected error for no running server")
	}
}

func TestDeployUseCase_DefaultScope(t *testing.T) {
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

	// Use a real deploy engine (sync engine)
	uc := NewDeployUseCase(projectRepo, buildHistory, serverRepo, nil, resolver, hub)

	ctx := context.Background()
	result, err := uc.Deploy(ctx, StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
		// No scope specified - should default to "all"
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Scope != string(DeployScopeAll) {
		t.Errorf("expected default scope 'all', got %s", result.Scope)
	}
}

func TestDeployUseCase_ListDeployments(t *testing.T) {
	hub := events.NewEventHub(100, 10)
	uc := NewDeployUseCase(nil, nil, nil, nil, nil, hub)

	ctx := context.Background()
	results, err := uc.ListDeployments(ctx, "ws1", "p1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if results == nil {
		t.Error("expected non-nil results")
	}
}

func TestDeployUseCase_GetDeployment_NotFound(t *testing.T) {
	hub := events.NewEventHub(100, 10)
	uc := NewDeployUseCase(nil, nil, nil, nil, nil, hub)

	ctx := context.Background()
	_, err := uc.GetDeployment(ctx, "ws1", "dep_nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent deployment")
	}
}

func TestServerUseCaseConfig_Defaults(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	if cfg.StartTimeout <= 0 {
		t.Error("expected positive StartTimeout")
	}
	if cfg.StopTimeout <= 0 {
		t.Error("expected positive StopTimeout")
	}
	if cfg.ReadinessCheck <= 0 {
		t.Error("expected positive ReadinessCheck")
	}
}

// =============================================================================
// Fakes
// =============================================================================

type fakeProjectRepo struct {
	projects map[string]*domain.Project
}

func newFakeProjectRepo() *fakeProjectRepo {
	return &fakeProjectRepo{projects: make(map[string]*domain.Project)}
}

func (f *fakeProjectRepo) Save(ctx context.Context, p domain.Project) error {
	f.projects[string(p.WorkspaceID)+":"+string(p.ID)] = &p
	return nil
}

func (f *fakeProjectRepo) Get(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID) (*domain.Project, error) {
	p, ok := f.projects[string(wsID)+":"+string(pID)]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return p, nil
}

func (f *fakeProjectRepo) List(ctx context.Context, wsID domain.WorkspaceID) ([]domain.Project, error) {
	var result []domain.Project
	for _, p := range f.projects {
		if string(p.WorkspaceID) == string(wsID) {
			result = append(result, *p)
		}
	}
	return result, nil
}

func (f *fakeProjectRepo) Delete(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID) error {
	delete(f.projects, string(wsID)+":"+string(pID))
	return nil
}

func (f *fakeProjectRepo) FindByRoot(ctx context.Context, wsID domain.WorkspaceID, root string) (*domain.Project, error) {
	for _, p := range f.projects {
		if string(p.WorkspaceID) == string(wsID) && p.RootPath == root {
			return p, nil
		}
	}
	return nil, domain.ErrNotFound
}

type fakeBuildHistoryRepo struct {
	mu   sync.Mutex
	runs map[string][]domain.BuildRun
}

func newFakeBuildHistoryRepo() *fakeBuildHistoryRepo {
	return &fakeBuildHistoryRepo{runs: make(map[string][]domain.BuildRun)}
}

func (f *fakeBuildHistoryRepo) Save(ctx context.Context, run domain.BuildRun) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := string(run.WorkspaceID) + ":" + string(run.ProjectID)
	existing := f.runs[key]
	replaced := false
	for i, r := range existing {
		if r.ID == run.ID {
			existing[i] = run
			replaced = true
			break
		}
	}
	if !replaced {
		existing = append(existing, run)
	}
	f.runs[key] = existing
	// Also save by build ID for Get
	f.runs[string(run.WorkspaceID)+":"+string(run.ID)] = []domain.BuildRun{run}
	return nil
}

func (f *fakeBuildHistoryRepo) Get(ctx context.Context, wsID domain.WorkspaceID, buildID domain.BuildID) (*domain.BuildRun, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := string(wsID) + ":" + string(buildID)
	runs, ok := f.runs[key]
	if !ok || len(runs) == 0 {
		return nil, domain.ErrNotFound
	}
	return &runs[0], nil
}

func (f *fakeBuildHistoryRepo) List(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID, limit int) ([]domain.BuildRun, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := string(wsID) + ":" + string(pID)
	runs, ok := f.runs[key]
	if !ok {
		return nil, nil
	}
	// Sort by start time descending
	sorted := make([]domain.BuildRun, len(runs))
	copy(sorted, runs)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].QueuedAt.After(sorted[i].QueuedAt) {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	if limit > 0 && limit < len(sorted) {
		sorted = sorted[:limit]
	}
	return sorted, nil
}

type fakeToolchainRepo struct {
	toolchains []domain.Toolchain
}

func newFakeToolchainRepo() *fakeToolchainRepo {
	return &fakeToolchainRepo{
		toolchains: []domain.Toolchain{
			{ID: "jdk1.8", JavaHome: "/usr/lib/jvm/java-8", Version: "1.8.0"},
		},
	}
}

func (f *fakeToolchainRepo) List(ctx context.Context) ([]domain.Toolchain, error) {
	return f.toolchains, nil
}

func (f *fakeToolchainRepo) Get(ctx context.Context, id string) (*domain.Toolchain, error) {
	for _, tc := range f.toolchains {
		if tc.ID == id {
			return &tc, nil
		}
	}
	return nil, domain.ErrNotFound
}

func (f *fakeToolchainRepo) Save(ctx context.Context, tc domain.Toolchain) error {
	return nil
}

func (f *fakeToolchainRepo) FindByJavaHome(ctx context.Context, javaHome string) (*domain.Toolchain, error) {
	for _, tc := range f.toolchains {
		if tc.JavaHome == javaHome {
			return &tc, nil
		}
	}
	return nil, domain.ErrNotFound
}

type fakeServerHistoryRepo struct {
	records map[string]*domain.ServerRecord
}

func newFakeServerHistoryRepo() *fakeServerHistoryRepo {
	return &fakeServerHistoryRepo{records: make(map[string]*domain.ServerRecord)}
}

func (f *fakeServerHistoryRepo) Save(ctx context.Context, record domain.ServerRecord) error {
	key := string(record.WorkspaceID) + ":" + string(record.ID)
	f.records[key] = &record
	return nil
}

func (f *fakeServerHistoryRepo) Get(ctx context.Context, wsID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerRecord, error) {
	key := string(wsID) + ":" + string(serverID)
	r, ok := f.records[key]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return r, nil
}

func (f *fakeServerHistoryRepo) List(ctx context.Context, wsID domain.WorkspaceID) ([]domain.ServerRecord, error) {
	var result []domain.ServerRecord
	for _, r := range f.records {
		if string(r.WorkspaceID) == string(wsID) {
			result = append(result, *r)
		}
	}
	return result, nil
}

func (f *fakeServerHistoryRepo) ListByProject(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID, limit int) ([]*domain.ServerRecord, error) {
	var result []*domain.ServerRecord
	for _, r := range f.records {
		if string(r.WorkspaceID) == string(wsID) && string(r.ProjectID) == string(pID) {
			result = append(result, r)
		}
	}
	if limit > 0 && limit < len(result) {
		result = result[:limit]
	}
	return result, nil
}

func (f *fakeServerHistoryRepo) ListNonTerminal(ctx context.Context) ([]*domain.ServerRecord, error) {
	var result []*domain.ServerRecord
	for _, r := range f.records {
		if !r.ObservedState.IsTerminal() {
			result = append(result, r)
		}
	}
	return result, nil
}

func (f *fakeServerHistoryRepo) Delete(ctx context.Context, wsID domain.WorkspaceID, serverID domain.ServerID) error {
	key := string(wsID) + ":" + string(serverID)
	delete(f.records, key)
	return nil
}
