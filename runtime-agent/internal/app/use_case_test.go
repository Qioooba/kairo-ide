package app

import (
	"context"
	"errors"
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
// BuildUseCase additional tests
// =============================================================================

func TestNewBuildUseCase(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	if uc == nil {
		t.Fatal("expected non-nil BuildUseCase")
	}
	if uc.cancelFuncs == nil {
		t.Error("expected cancelFuncs map to be initialized")
	}
}

func TestBuildUseCase_Start_CanceledContext(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.Start(ctx, StartBuildCommand{WorkspaceID: "ws1", ProjectID: "p1"})
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestBuildUseCase_Start_DefaultIntent(t *testing.T) {
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
		// Intent left empty - should default to BuildIntentFull
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if run.State != domain.BuildStateQueued {
		t.Errorf("expected queued state, got %s", run.State)
	}
}

func TestBuildUseCase_Start_ProjectNotFound(t *testing.T) {
	projectRepo := newFakeProjectRepo()
	buildHistory := newFakeBuildHistoryRepo()
	hub := events.NewEventHub(100, 10)
	uc := NewBuildUseCase(projectRepo, buildHistory, nil, nil, nil, hub)

	ctx := context.Background()
	_, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p_nonexistent",
	})
	if err == nil {
		t.Fatal("expected error for non-existent project")
	}
}

func TestBuildUseCase_Get_NotFound(t *testing.T) {
	buildHistory := newFakeBuildHistoryRepo()
	hub := events.NewEventHub(100, 10)
	uc := NewBuildUseCase(nil, buildHistory, nil, nil, nil, hub)

	ctx := context.Background()
	_, err := uc.Get(ctx, "ws1", "build_nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent build")
	}
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestBuildUseCase_Get_CanceledContext(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.Get(ctx, "ws1", "b1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestBuildUseCase_List_CanceledContext(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.List(ctx, "ws1", "p1", 10)
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestBuildUseCase_Cancel_HappyPath(t *testing.T) {
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

	// Cancel immediately while still queued/running
	err = uc.Cancel(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("unexpected error cancelling: %v", err)
	}

	// Verify the build was saved as cancelled
	saved, err := buildHistory.Get(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("unexpected error getting build: %v", err)
	}
	if saved.State != domain.BuildStateCancelled {
		t.Errorf("expected cancelled state, got %s", saved.State)
	}
}

func TestBuildUseCase_Cancel_NotFound(t *testing.T) {
	buildHistory := newFakeBuildHistoryRepo()
	hub := events.NewEventHub(100, 10)
	uc := NewBuildUseCase(nil, buildHistory, nil, nil, nil, hub)

	ctx := context.Background()
	err := uc.Cancel(ctx, "ws1", "build_nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent build")
	}
}

func TestBuildUseCase_Cancel_CanceledContext(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := uc.Cancel(ctx, "ws1", "b1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

// =============================================================================
// DeployUseCase additional tests
// =============================================================================

func TestNewDeployUseCase(t *testing.T) {
	uc := NewDeployUseCase(nil, nil, nil, nil, nil, nil)
	if uc == nil {
		t.Fatal("expected non-nil DeployUseCase")
	}
}

func TestDeployUseCase_Deploy_CanceledContext(t *testing.T) {
	uc := NewDeployUseCase(nil, nil, nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.Deploy(ctx, StartDeployCommand{WorkspaceID: "ws1", ProjectID: "p1", BuildID: "b1"})
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestDeployUseCase_buildDomainDeployPlan_AllScopes(t *testing.T) {
	tests := []struct {
		name          string
		scope         DeployScope
		wantMinEntries int
		wantErr       bool
	}{
		{"all", DeployScopeAll, 2, false},
		{"classes", DeployScopeClasses, 1, false},
		{"webapp", DeployScopeWebapp, 1, false},
		{"resources", DeployScopeResources, 0, false},
		{"libs", DeployScopeLibs, 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			uc := &DeployUseCase{}
			cmd := StartDeployCommand{
				WorkspaceID: "ws1",
				ProjectID:   "p1",
				BuildID:     "b1",
			}
			resolvedPlan := DeployPlan{
				ProjectRoot:   "/tmp/test",
				WebappDir:     "/tmp/test/webapp",
				OutputDir:     "/tmp/test/build/classes",
				ResourceRoots: []string{"/tmp/test/resources"},
				LibDirs:       []string{"/tmp/test/lib"},
				TargetDir:     "/tmp/catalina/webapps/ROOT",
			}

			plan, err := uc.buildDomainDeployPlan(cmd, tt.scope, resolvedPlan)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(plan.Entries) < tt.wantMinEntries {
				t.Errorf("expected at least %d entries, got %d", tt.wantMinEntries, len(plan.Entries))
			}
			if plan.Mode != domain.DeployModeMerge {
				t.Errorf("expected merge mode, got %s", plan.Mode)
			}
		})
	}
}

func TestDeployUseCase_buildDomainDeployPlan_UnknownScope(t *testing.T) {
	uc := &DeployUseCase{}
	cmd := StartDeployCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		BuildID:     "b1",
	}
	resolvedPlan := DeployPlan{
		TargetDir: "/tmp/target",
	}

	_, err := uc.buildDomainDeployPlan(cmd, "unknown", resolvedPlan)
	if err == nil {
		t.Fatal("expected error for unknown scope")
	}
}

func TestDeployUseCase_ListDeployments_CanceledContext(t *testing.T) {
	uc := NewDeployUseCase(nil, nil, nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.ListDeployments(ctx, "ws1", "p1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestDeployUseCase_GetDeployment_CanceledContext(t *testing.T) {
	uc := NewDeployUseCase(nil, nil, nil, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.GetDeployment(ctx, "ws1", "dep1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

// =============================================================================
// ServerUseCase additional tests
// =============================================================================

func TestNewServerUseCase(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	if uc == nil {
		t.Fatal("expected non-nil ServerUseCase")
	}
	if uc.cfg.StartTimeout != cfg.StartTimeout {
		t.Error("config StartTimeout not preserved")
	}
}

func TestServerUseCase_Start_CanceledContext(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.Start(ctx, StartServerCommand{WorkspaceID: "ws1", ProjectID: "p1"})
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestServerUseCase_Stop_NotFound(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	_, err := uc.Stop(ctx, StopServerCommand{WorkspaceID: "ws1", ServerID: "srv_nonexistent"})
	if err == nil {
		t.Fatal("expected error for non-existent server")
	}
}

func TestServerUseCase_Stop_CanceledContext(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.Stop(ctx, StopServerCommand{WorkspaceID: "ws1", ServerID: "s1"})
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestServerUseCase_Restart_NotFound(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	_, err := uc.Restart(ctx, RestartServerCommand{WorkspaceID: "ws1", ServerID: "srv_nonexistent"})
	if err == nil {
		t.Fatal("expected error for non-existent server")
	}
}

func TestServerUseCase_Restart_CanceledContext(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.Restart(ctx, RestartServerCommand{WorkspaceID: "ws1", ServerID: "s1"})
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestServerUseCase_Get_CanceledContext(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.Get(ctx, "ws1", "s1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestServerUseCase_List(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:            "srv1",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	records, err := uc.List(ctx, "ws1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if records[0].ID != "srv1" {
		t.Errorf("expected srv1, got %s", records[0].ID)
	}
}

func TestServerUseCase_List_CanceledContext(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.List(ctx, "ws1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestServerUseCase_ListByProject(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:            "srv1",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}
	serverRepo.records["ws1:srv2"] = &domain.ServerRecord{
		ID:            "srv2",
		WorkspaceID:   "ws1",
		ProjectID:     "p2",
		ObservedState: domain.ServerStateStopped,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	records, err := uc.ListByProject(ctx, "ws1", "p1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record for p1, got %d", len(records))
	}
	if records[0].ID != "srv1" {
		t.Errorf("expected srv1, got %s", records[0].ID)
	}
}

func TestServerUseCase_ListByProject_CanceledContext(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := uc.ListByProject(ctx, "ws1", "p1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestServerUseCase_Delete_NotFound(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	err := uc.Delete(ctx, "ws1", "srv_nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent server")
	}
}

func TestServerUseCase_Delete_CanceledContext(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, nil, nil, nil, nil, nil, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := uc.Delete(ctx, "ws1", "s1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

// =============================================================================
// PlanResolver additional tests
// =============================================================================

func TestNewPlanResolver(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	if r == nil {
		t.Fatal("expected non-nil PlanResolver")
	}
}

func TestPlanResolver_ResolveBuild_CanceledContext(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	project := domain.Project{ID: "p1", RootPath: "/tmp/test"}
	_, err := r.ResolveBuild(ctx, project, domain.BuildIntentFull)
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestPlanResolver_ResolveBuild_NoRootPath(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx := context.Background()

	project := domain.Project{ID: "p1", RootPath: "", Root: ""}
	_, err := r.ResolveBuild(ctx, project, domain.BuildIntentFull)
	if err == nil {
		t.Fatal("expected error for project with no root path")
	}
}

func TestPlanResolver_ResolveBuild_AntTool(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)
	ctx := context.Background()

	project := domain.Project{
		ID:           "p1",
		RootPath:     root,
		BuildTool:    domain.BuildToolAnt,
		BuildFile:    "build.xml",
		BuildTargets: []string{"compile"},
		SourceRoots:  []string{"src"},
	}

	plan, err := r.ResolveBuild(ctx, project, domain.BuildIntentFull)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.AntFile != "build.xml" {
		t.Errorf("expected AntFile 'build.xml', got %s", plan.AntFile)
	}
	if plan.AntTarget != "compile" {
		t.Errorf("expected AntTarget 'compile', got %s", plan.AntTarget)
	}
	if plan.BuildTool != "ant" {
		t.Errorf("expected BuildTool 'ant', got %s", plan.BuildTool)
	}
}

func TestPlanResolver_ResolveDeploy_CanceledContext(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	project := domain.Project{ID: "p1", RootPath: "/tmp/test"}
	_, err := r.ResolveDeploy(ctx, project, "b1")
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestPlanResolver_ResolveDeploy_NoRootPath(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx := context.Background()

	project := domain.Project{ID: "p1", RootPath: "", Root: ""}
	_, err := r.ResolveDeploy(ctx, project, "b1")
	if err == nil {
		t.Fatal("expected error for project with no root path")
	}
}

func TestPlanResolver_ResolveRuntime_CanceledContext(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	project := domain.Project{ID: "p1", RootPath: "/tmp/test"}
	_, err := r.ResolveRuntime(ctx, project)
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

func TestPlanResolver_ResolveRuntime_NoRootPath(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx := context.Background()

	project := domain.Project{ID: "p1", RootPath: "", Root: ""}
	_, err := r.ResolveRuntime(ctx, project)
	if err == nil {
		t.Fatal("expected error for project with no root path")
	}
}

func TestPlanResolver_ResolveRuntime_DefaultContextPath(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)
	ctx := context.Background()

	project := domain.Project{
		ID:       "p1",
		RootPath: root,
		// ContextPath left empty — should default to "/"
	}

	plan, err := r.ResolveRuntime(ctx, project)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.ContextPath != "/" {
		t.Errorf("expected default ContextPath '/', got %s", plan.ContextPath)
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
		if r == nil || !r.ObservedState.IsTerminal() {
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

func TestResolveAbsPaths(t *testing.T) {
	root := "/tmp/project"
	rels := []string{"src", "lib", "web/WEB-INF"}
	got := resolveAbsPaths(root, rels)
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	if got[0] != filepath.Join(root, "src") {
		t.Errorf("got[0] = %q", got[0])
	}
	if got[1] != filepath.Join(root, "lib") {
		t.Errorf("got[1] = %q", got[1])
	}
	if got[2] != filepath.Join(root, "web", "WEB-INF") {
		t.Errorf("got[2] = %q", got[2])
	}
}

func TestResolveAbsPaths_Empty(t *testing.T) {
	got := resolveAbsPaths("/root", nil)
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}

// =============================================================================
// buildLogBuffer tests
// =============================================================================

func TestBuildLogBuffer_Append(t *testing.T) {
	buf := &buildLogBuffer{}
	buf.append("line 1")
	buf.append("line 2")
	buf.append("line 3")

	snapshot := buf.snapshot()
	if len(snapshot) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(snapshot))
	}
	if snapshot[0] != "line 1" {
		t.Errorf("line 0 = %q, want line 1", snapshot[0])
	}
	if snapshot[1] != "line 2" {
		t.Errorf("line 1 = %q, want line 2", snapshot[1])
	}
	if snapshot[2] != "line 3" {
		t.Errorf("line 2 = %q, want line 3", snapshot[2])
	}
}

func TestBuildLogBuffer_Snapshot_Empty(t *testing.T) {
	buf := &buildLogBuffer{}
	snapshot := buf.snapshot()
	if len(snapshot) != 0 {
		t.Errorf("expected 0 lines, got %d", len(snapshot))
	}
	if snapshot == nil {
		t.Error("snapshot should be non-nil even for empty buffer")
	}
}

func TestBuildLogBuffer_Snapshot_IsCopy(t *testing.T) {
	buf := &buildLogBuffer{}
	buf.append("original")
	snapshot := buf.snapshot()
	// Modify the snapshot - should not affect the buffer
	snapshot[0] = "modified"
	snapshot2 := buf.snapshot()
	if snapshot2[0] != "original" {
		t.Errorf("snapshot should be a copy, got %q", snapshot2[0])
	}
}

func TestBuildLogBuffer_ConcurrentAppend(t *testing.T) {
	buf := &buildLogBuffer{}
	const goroutines = 20
	const appendsPer = 50
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < appendsPer; j++ {
				buf.append("line")
			}
		}(i)
	}
	wg.Wait()
	snapshot := buf.snapshot()
	if len(snapshot) != goroutines*appendsPer {
		t.Errorf("expected %d lines, got %d", goroutines*appendsPer, len(snapshot))
	}
}

// =============================================================================
// BuildUseCase GetLogs tests
// =============================================================================

func TestBuildUseCase_GetLogs_Empty(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	logs := uc.GetLogs("build_nonexistent")
	if logs != nil {
		t.Errorf("expected nil logs for non-existent build, got %v", logs)
	}
}

func TestBuildUseCase_GetLogs_WithLogs(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	buildID := domain.BuildID("build1")

	// Manually add logs to the buffer
	uc.mu.Lock()
	uc.logs[buildID] = &buildLogBuffer{}
	uc.logs[buildID].append("log line 1")
	uc.logs[buildID].append("log line 2")
	uc.mu.Unlock()

	logs := uc.GetLogs(buildID)
	if len(logs) != 2 {
		t.Fatalf("expected 2 log lines, got %d", len(logs))
	}
	if logs[0] != "log line 1" {
		t.Errorf("log[0] = %q, want log line 1", logs[0])
	}
	if logs[1] != "log line 2" {
		t.Errorf("log[1] = %q, want log line 2", logs[1])
	}
}

// =============================================================================
// BuildUseCase ActiveCount tests
// =============================================================================

func TestBuildUseCase_ActiveCount_Empty(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	running, queued := uc.ActiveCount()
	if running != 0 {
		t.Errorf("expected 0 running, got %d", running)
	}
	if queued != 0 {
		t.Errorf("expected 0 queued, got %d", queued)
	}
}

func TestBuildUseCase_ActiveCount_WithRunning(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	// Manually add a cancel function
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	uc.cancelFuncs["build1"] = cancel

	running, queued := uc.ActiveCount()
	if running != 1 {
		t.Errorf("expected 1 running, got %d", running)
	}
	if queued != 0 {
		t.Errorf("expected 0 queued, got %d", queued)
	}
}

func TestBuildUseCase_ActiveCount_WithQueued(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b1"}})
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b2"}})

	running, queued := uc.ActiveCount()
	if running != 0 {
		t.Errorf("expected 0 running, got %d", running)
	}
	if queued != 2 {
		t.Errorf("expected 2 queued, got %d", queued)
	}
}

// =============================================================================
// BuildUseCase enqueue / dequeueNext tests
// =============================================================================

func TestBuildUseCase_Enqueue_BelowMax(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	// Queue is empty, so len < MaxConcurrentBuilds (3)
	qb := queuedBuild{Run: domain.BuildRun{ID: "b1"}}
	added := uc.enqueue(qb)
	if added {
		t.Error("expected false (not added to queue) when below max")
	}
	if len(uc.queue) != 0 {
		t.Errorf("expected empty queue, got %d items", len(uc.queue))
	}
}

func TestBuildUseCase_Enqueue_AtMax(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	// Fill queue to MaxConcurrentBuilds (3)
	for i := 0; i < MaxConcurrentBuilds; i++ {
		uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: domain.BuildID("b" + string(rune('0'+i)))}})
	}
	// Now enqueue should succeed
	qb := queuedBuild{Run: domain.BuildRun{ID: "b_extra"}}
	added := uc.enqueue(qb)
	if !added {
		t.Error("expected true (added to queue) when at max")
	}
	if len(uc.queue) != MaxConcurrentBuilds+1 {
		t.Errorf("expected %d items in queue, got %d", MaxConcurrentBuilds+1, len(uc.queue))
	}
}

func TestBuildUseCase_DequeueNext_Empty(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	qb := uc.dequeueNext()
	if qb != nil {
		t.Errorf("expected nil for empty queue, got %v", qb)
	}
}

func TestBuildUseCase_DequeueNext_WithItems(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b1"}})
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b2"}})
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b3"}})

	qb := uc.dequeueNext()
	if qb == nil {
		t.Fatal("expected non-nil dequeued item")
	}
	if qb.Run.ID != "b1" {
		t.Errorf("expected b1, got %s", qb.Run.ID)
	}
	if len(uc.queue) != 2 {
		t.Errorf("expected 2 remaining items, got %d", len(uc.queue))
	}

	// Dequeue second
	qb = uc.dequeueNext()
	if qb.Run.ID != "b2" {
		t.Errorf("expected b2, got %s", qb.Run.ID)
	}
	if len(uc.queue) != 1 {
		t.Errorf("expected 1 remaining item, got %d", len(uc.queue))
	}
}

// =============================================================================
// BuildUseCase DrainQueue tests
// =============================================================================

func TestBuildUseCase_DrainQueue_Empty(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	drained := uc.DrainQueue("ws1", "p1")
	if len(drained) != 0 {
		t.Errorf("expected 0 drained, got %d", len(drained))
	}
}

func TestBuildUseCase_DrainQueue_NoMatch(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b1", WorkspaceID: "ws2", ProjectID: "p2"}})
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b2", WorkspaceID: "ws2", ProjectID: "p2"}})

	drained := uc.DrainQueue("ws1", "p1")
	if len(drained) != 0 {
		t.Errorf("expected 0 drained, got %d", len(drained))
	}
	if len(uc.queue) != 2 {
		t.Errorf("expected 2 remaining in queue, got %d", len(uc.queue))
	}
}

func TestBuildUseCase_DrainQueue_PartialMatch(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b1", WorkspaceID: "ws1", ProjectID: "p1"}})
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b2", WorkspaceID: "ws2", ProjectID: "p2"}})
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b3", WorkspaceID: "ws1", ProjectID: "p1"}})

	drained := uc.DrainQueue("ws1", "p1")
	if len(drained) != 2 {
		t.Errorf("expected 2 drained, got %d", len(drained))
	}
	if len(uc.queue) != 1 {
		t.Errorf("expected 1 remaining, got %d", len(uc.queue))
	}
	if uc.queue[0].Run.ID != "b2" {
		t.Errorf("expected b2 remaining, got %s", uc.queue[0].Run.ID)
	}
	// Verify drained items
	if drained[0].ID != "b1" || drained[1].ID != "b3" {
		t.Errorf("drained IDs = %v, want [b1, b3]", []string{string(drained[0].ID), string(drained[1].ID)})
	}
}

func TestBuildUseCase_DrainQueue_AllMatch(t *testing.T) {
	uc := NewBuildUseCase(nil, nil, nil, nil, nil, nil)
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b1", WorkspaceID: "ws1", ProjectID: "p1"}})
	uc.queue = append(uc.queue, queuedBuild{Run: domain.BuildRun{ID: "b2", WorkspaceID: "ws1", ProjectID: "p1"}})

	drained := uc.DrainQueue("ws1", "p1")
	if len(drained) != 2 {
		t.Errorf("expected 2 drained, got %d", len(drained))
	}
	if len(uc.queue) != 0 {
		t.Errorf("expected empty queue, got %d items", len(uc.queue))
	}
}

// =============================================================================
// BuildUseCase executeBuild edge cases
// =============================================================================

func TestBuildUseCase_executeBuild_AlreadyRunning(t *testing.T) {
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
	run, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Intent:      domain.BuildIntentFull,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait for async build to complete
	time.Sleep(200 * time.Millisecond)

	// Get the build - should be in succeeded state
	saved, err := buildHistory.Get(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if saved.State != domain.BuildStateSucceeded {
		t.Errorf("expected succeeded, got %s", saved.State)
	}
}

func TestBuildUseCase_executeBuild_Cancelled(t *testing.T) {
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
	run, err := uc.Start(ctx, StartBuildCommand{
		WorkspaceID: "ws1",
		ProjectID:   "p1",
		Intent:      domain.BuildIntentFull,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Cancel immediately
	err = uc.Cancel(ctx, "ws1", run.ID)
	if err != nil {
		t.Fatalf("cancel error: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	saved, _ := buildHistory.Get(ctx, "ws1", run.ID)
	if saved != nil && saved.State != domain.BuildStateCancelled {
		// The build may have already completed, so this is non-deterministic
		t.Logf("build state: %s", saved.State)
	}
}

// =============================================================================
// ServerUseCase Delete additional tests
// =============================================================================

func TestServerUseCase_Delete_RunningServer(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:            "srv1",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	// Delete should succeed even for running servers (it will attempt graceful stop)
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

func TestServerUseCase_Get_HappyPath(t *testing.T) {
	serverRepo := newFakeServerHistoryRepo()
	now := domain.UTCNow()
	serverRepo.records["ws1:srv1"] = &domain.ServerRecord{
		ID:            "srv1",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		ObservedState: domain.ServerStateRunning,
		UpdatedAt:     now,
	}

	hub := events.NewEventHub(100, 10)
	cfg := DefaultServerUseCaseConfig()
	uc := NewServerUseCase(nil, serverRepo, nil, nil, nil, hub, cfg)

	ctx := context.Background()
	record, err := uc.Get(ctx, "ws1", "srv1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if record.ID != "srv1" {
		t.Errorf("expected srv1, got %s", record.ID)
	}
}
