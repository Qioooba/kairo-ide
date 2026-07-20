package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

func setupProjectTest(t *testing.T) (string, string, *FileWorkspaceRepo, *FileProjectRepo) {
	t.Helper()
	dataDir := t.TempDir()
	workspaceRoot := t.TempDir()

	resolvedRoot, err := filepath.EvalSymlinks(workspaceRoot)
	if err == nil {
		workspaceRoot = resolvedRoot
	}

	wsRepo := NewFileWorkspaceRepo(dataDir)
	policy := pathpolicy.NewDefaultPathPolicy()
	projRepo := NewFileProjectRepo(dataDir, wsRepo, policy)

	ctx := context.Background()
	ws := domain.Workspace{
		ID:   testWS1,
		Name: "Test WS",
		Root: workspaceRoot,
	}
	if err := wsRepo.Save(ctx, ws); err != nil {
		t.Fatalf("failed to save workspace: %v", err)
	}

	return dataDir, workspaceRoot, wsRepo, projRepo
}

func TestFileProjectRepo_SaveAndGet(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	project := domain.Project{
		ID:          testPRJ1,
		WorkspaceID: testWS1,
		Name:        "Test Project",
		BuildTool:   domain.BuildToolJavac,
	}

	if err := projRepo.Save(ctx, project); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := projRepo.Get(ctx, testWS1, testPRJ1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if got.Name != "Test Project" {
		t.Errorf("expected name 'Test Project', got %q", got.Name)
	}
	if got.WorkspaceID != testWS1 {
		t.Errorf("expected workspace ID %q, got %q", testWS1, got.WorkspaceID)
	}
	if got.Root != "." {
		t.Errorf("expected default root '.', got %q", got.Root)
	}
}

func TestFileProjectRepo_SaveWithSubdirectory(t *testing.T) {
	_, workspaceDir, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	subDir := "myproject"
	os.MkdirAll(filepath.Join(workspaceDir, subDir, ".kairo"), 0755)

	project := domain.Project{
		ID:          testPRJ2,
		WorkspaceID: testWS1,
		Name:        "Sub Project",
		Root:        subDir,
		BuildTool:   domain.BuildToolAnt,
	}

	if err := projRepo.Save(ctx, project); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := projRepo.Get(ctx, testWS1, testPRJ2)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.Root != subDir {
		t.Errorf("expected root %q, got %q", subDir, got.Root)
	}
}

func TestFileProjectRepo_List(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	projRepo.Save(ctx, domain.Project{ID: testPRJ1, WorkspaceID: testWS1, Name: "P1", BuildTool: domain.BuildToolJavac})
	projRepo.Save(ctx, domain.Project{ID: testPRJ2, WorkspaceID: testWS1, Name: "P2", Root: "proj2", BuildTool: domain.BuildToolJavac})

	list, err := projRepo.List(ctx, testWS1)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 projects, got %d", len(list))
	}
}

func TestFileProjectRepo_Delete(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	project := domain.Project{ID: testPRJ1, WorkspaceID: testWS1, Name: "ToDelete", BuildTool: domain.BuildToolJavac}
	projRepo.Save(ctx, project)

	if err := projRepo.Delete(ctx, testWS1, testPRJ1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err := projRepo.Get(ctx, testWS1, testPRJ1)
	if !errors.Is(err, domain.ErrProjectNotFound) {
		t.Errorf("expected ErrProjectNotFound, got %v", err)
	}
}

func TestFileProjectRepo_FindByRoot(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	projRepo.Save(ctx, domain.Project{ID: testPRJ1, WorkspaceID: testWS1, Name: "P1", Root: ".", BuildTool: domain.BuildToolJavac})

	found, err := projRepo.FindByRoot(ctx, testWS1, ".")
	if err != nil {
		t.Fatalf("FindByRoot failed: %v", err)
	}
	if found.ID != testPRJ1 {
		t.Errorf("expected prj1, got %s", found.ID)
	}
}

func TestFileProjectRepo_ReturnsCopy(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	projRepo.Save(ctx, domain.Project{ID: testPRJ1, WorkspaceID: testWS1, Name: "Original", BuildTool: domain.BuildToolJavac})

	got1, err := projRepo.Get(ctx, testWS1, testPRJ1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	got1.Name = "Modified"
	got1.SourceRoots[0] = "modified"

	got2, err := projRepo.Get(ctx, testWS1, testPRJ1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got2.Name == "Modified" {
		t.Error("Get returned a shared reference for Name, expected a copy")
	}
	if got2.SourceRoots[0] == "modified" {
		t.Error("Get returned a shared reference for SourceRoots, expected a copy")
	}
}

func TestFileProjectRepo_YAMLWrittenNotJSON(t *testing.T) {
	_, workspaceDir, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	project := domain.Project{
		ID:          testPRJ1,
		WorkspaceID: testWS1,
		Name:        "YAML Test",
		BuildTool:   domain.BuildToolJavac,
	}
	projRepo.Save(ctx, project)

	yamlPath := filepath.Join(workspaceDir, ".kairo", "project.yaml")
	data, err := os.ReadFile(yamlPath)
	if err != nil {
		t.Fatalf("failed to read project.yaml: %v", err)
	}

	content := string(data)
	if len(content) == 0 {
		t.Fatal("project.yaml is empty")
	}
	if content[0] == '{' || content[0] == '[' {
		t.Error("project.yaml looks like JSON, expected YAML")
	}
}

func TestFileProjectRepo_NotFound(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	_, err := projRepo.Get(ctx, testWS1, testPRJ2)
	if !errors.Is(err, domain.ErrProjectNotFound) {
		t.Errorf("expected ErrProjectNotFound, got %v", err)
	}
}

func TestFileProjectRepo_InvalidID(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	_, err := projRepo.Get(ctx, "ws_bad", testPRJ1)
	if err == nil {
		t.Fatal("expected error for invalid workspace ID")
	}

	_, err = projRepo.Get(ctx, testWS1, "prj_bad")
	if err == nil {
		t.Fatal("expected error for invalid project ID")
	}
}

func TestFileProjectRepo_ListReturnsAggregateError(t *testing.T) {
	_, _, _, projRepo := setupProjectTest(t)
	ctx := context.Background()

	projRepo.Save(ctx, domain.Project{ID: testPRJ1, WorkspaceID: testWS1, Name: "P1", BuildTool: domain.BuildToolJavac})
	projRepo.Save(ctx, domain.Project{ID: testPRJ2, WorkspaceID: testWS1, Name: "P2", Root: "proj2", BuildTool: domain.BuildToolJavac})

	projRepo.catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ3, Root: "nonexistent"})

	projects, err := projRepo.List(ctx, testWS1)
	if err == nil {
		t.Fatal("expected error for missing project config")
	}
	if len(projects) != 2 {
		t.Errorf("expected 2 valid projects, got %d", len(projects))
	}
}
