package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

func setupBuildTest(t *testing.T) (*FileWorkspaceRepo, *FileProjectRepo, *FileBuildHistoryRepo) {
	t.Helper()
	dataDir := t.TempDir()
	workspaceRoot := t.TempDir()

	resolvedRoot, err := filepath.EvalSymlinks(workspaceRoot)
	if err == nil {
		workspaceRoot = resolvedRoot
	}

	wsRepo := NewFileWorkspaceRepo(dataDir)
	buildRepo := NewFileBuildHistoryRepo(dataDir)
	policy := pathpolicy.NewDefaultPathPolicy()
	projRepo := NewFileProjectRepo(dataDir, wsRepo, policy)

	ctx := context.Background()
	ws := domain.Workspace{ID: testWS1, Name: "WS", Root: workspaceRoot}
	wsRepo.Save(ctx, ws)

	proj := domain.Project{ID: testPRJ1, WorkspaceID: testWS1, Name: "P1", BuildTool: domain.BuildToolJavac}
	projRepo.Save(ctx, proj)

	return wsRepo, projRepo, buildRepo
}

func TestFileBuildHistoryRepo_SaveAndGet(t *testing.T) {
	_, _, buildRepo := setupBuildTest(t)
	ctx := context.Background()

	now := time.Now()
	exitCode := 0
	build := domain.BuildRun{
		ID:          testBLD1,
		WorkspaceID: testWS1,
		ProjectID:   testPRJ1,
		State:       domain.BuildStateSucceeded,
		QueuedAt:    now,
		StartedAt:   &now,
		FinishedAt:  func() *time.Time { t := now.Add(5 * time.Second); return &t }(),
		ExitCode:    &exitCode,
		LogPath:     "/tmp/build.log",
		Summary:     "Build succeeded",
	}

	if err := buildRepo.Save(ctx, build); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := buildRepo.Get(ctx, testWS1, testBLD1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if got.ProjectID != testPRJ1 {
		t.Errorf("expected project %s, got %s", testPRJ1, got.ProjectID)
	}
	if got.State != domain.BuildStateSucceeded {
		t.Errorf("expected state succeeded, got %s", got.State)
	}
	if got.ExitCode == nil || *got.ExitCode != 0 {
		t.Errorf("expected exit code 0, got %v", got.ExitCode)
	}
}

func TestFileBuildHistoryRepo_ListByProject(t *testing.T) {
	_, _, buildRepo := setupBuildTest(t)
	ctx := context.Background()

	now := time.Now()
	for i, id := range []domain.BuildID{testBLD1, testBLD2, testBLD3} {
		exitCode := 0
		buildRepo.Save(ctx, domain.BuildRun{
			ID:          id,
			WorkspaceID: testWS1,
			ProjectID:   testPRJ1,
			State:       domain.BuildStateSucceeded,
			QueuedAt:    now.Add(time.Duration(i) * time.Minute),
			ExitCode:    &exitCode,
		})
	}

	list, err := buildRepo.List(ctx, testWS1, testPRJ1, 10)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 3 {
		t.Errorf("expected 3 builds, got %d", len(list))
	}
}

func TestFileBuildHistoryRepo_ListAll(t *testing.T) {
	_, projRepo, buildRepo := setupBuildTest(t)
	ctx := context.Background()

	workspaceRoot := t.TempDir()
	resolvedRoot, _ := filepath.EvalSymlinks(workspaceRoot)
	projRepo.workspaces.Save(ctx, domain.Workspace{ID: testWS1, Name: "WS", Root: resolvedRoot})

	now := time.Now()
	exitCode := 0
	buildRepo.Save(ctx, domain.BuildRun{ID: testBLD1, WorkspaceID: testWS1, ProjectID: testPRJ1, State: domain.BuildStateSucceeded, QueuedAt: now, ExitCode: &exitCode})

	list, err := buildRepo.List(ctx, testWS1, "", 10)
	if err != nil {
		t.Fatalf("List all failed: %v", err)
	}
	if len(list) < 1 {
		t.Errorf("expected at least 1 build, got %d", len(list))
	}
}

func TestFileBuildHistoryRepo_NotFound(t *testing.T) {
	_, _, buildRepo := setupBuildTest(t)
	ctx := context.Background()

	_, err := buildRepo.Get(ctx, testWS1, testBLD2)
	if !errors.Is(err, domain.ErrBuildNotFound) {
		t.Errorf("expected ErrBuildNotFound, got %v", err)
	}
}

func TestFileBuildHistoryRepo_ReturnsCopy(t *testing.T) {
	_, _, buildRepo := setupBuildTest(t)
	ctx := context.Background()

	now := time.Now()
	buildRepo.Save(ctx, domain.BuildRun{
		ID:          testBLD1,
		WorkspaceID: testWS1,
		ProjectID:   testPRJ1,
		State:       domain.BuildStateSucceeded,
		QueuedAt:    now,
		Diagnostics: []domain.BuildDiagnostic{{File: "Test.java", Line: 1, Message: "test"}},
	})

	got1, err := buildRepo.Get(ctx, testWS1, testBLD1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	got1.State = domain.BuildStateFailed
	got1.Diagnostics[0].Message = "modified"

	got2, err := buildRepo.Get(ctx, testWS1, testBLD1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got2.State == domain.BuildStateFailed {
		t.Error("Get returned a shared reference for State, expected a copy")
	}
	if got2.Diagnostics[0].Message == "modified" {
		t.Error("Get returned a shared reference for Diagnostics, expected a copy")
	}
}

func TestFileBuildHistoryRepo_CorruptionNotSwallowed(t *testing.T) {
	_, _, buildRepo := setupBuildTest(t)
	ctx := context.Background()

	now := time.Now()
	exitCode := 0
	buildRepo.Save(ctx, domain.BuildRun{ID: testBLD1, WorkspaceID: testWS1, ProjectID: testPRJ1, State: domain.BuildStateSucceeded, QueuedAt: now, ExitCode: &exitCode})
	buildRepo.Save(ctx, domain.BuildRun{ID: testBLD2, WorkspaceID: testWS1, ProjectID: testPRJ1, State: domain.BuildStateSucceeded, QueuedAt: now.Add(time.Minute), ExitCode: &exitCode})

	projectFile := filepath.Join(buildRepo.dataDir, "history", "builds", string(testWS1), string(testPRJ1)+".json")
	info, err := os.Stat(projectFile)
	if err != nil {
		t.Fatalf("failed to stat project file: %v", err)
	}
	_ = info
	os.WriteFile(projectFile, []byte("{not valid json"), 0644)

	_, err = buildRepo.List(ctx, testWS1, testPRJ1, 10)
	if err == nil {
		t.Fatal("expected error due to corruption, got nil")
	}
}

func TestFileBuildHistoryRepo_InvalidID(t *testing.T) {
	_, _, buildRepo := setupBuildTest(t)
	ctx := context.Background()

	err := buildRepo.Save(ctx, domain.BuildRun{ID: "bld_bad", WorkspaceID: testWS1, ProjectID: testPRJ1, State: domain.BuildStateQueued, QueuedAt: time.Now()})
	if err == nil {
		t.Fatal("expected error for invalid build ID")
	}
}
