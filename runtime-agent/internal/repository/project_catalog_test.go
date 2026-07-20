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

func TestProjectCatalog_PutAndGet(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	record := ProjectRecord{
		WorkspaceID: testWS1,
		ProjectID:   testPRJ1,
		Root:        ".",
	}

	if err := catalog.Put(ctx, record); err != nil {
		t.Fatalf("Put failed: %v", err)
	}

	got, err := catalog.Get(ctx, testWS1, testPRJ1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if got.Root != "." {
		t.Errorf("expected root '.', got %q", got.Root)
	}
	if got.CreatedAt.IsZero() {
		t.Error("expected CreatedAt to be set")
	}
	if got.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
}

func TestProjectCatalog_ListByWorkspace(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ1, Root: "."})
	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ2, Root: "sub"})
	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS2, ProjectID: testPRJ3, Root: "."})

	list1, err := catalog.ListByWorkspace(ctx, testWS1)
	if err != nil {
		t.Fatalf("ListByWorkspace failed: %v", err)
	}
	if len(list1) != 2 {
		t.Errorf("expected 2 projects in ws1, got %d", len(list1))
	}

	list2, err := catalog.ListByWorkspace(ctx, testWS2)
	if err != nil {
		t.Fatalf("ListByWorkspace for ws2 failed: %v", err)
	}
	if len(list2) != 1 {
		t.Errorf("expected 1 project in ws2, got %d", len(list2))
	}
}

func TestProjectCatalog_FindByRoot(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ1, Root: "."})
	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ2, Root: "myproject"})

	found, err := catalog.FindByRoot(ctx, testWS1, "myproject")
	if err != nil {
		t.Fatalf("FindByRoot failed: %v", err)
	}
	if found.ProjectID != testPRJ2 {
		t.Errorf("expected prj2, got %s", found.ProjectID)
	}

	_, err = catalog.FindByRoot(ctx, testWS1, "nonexistent")
	if !errors.Is(err, domain.ErrProjectNotFound) {
		t.Errorf("expected ErrProjectNotFound, got %v", err)
	}
}

func TestProjectCatalog_Delete(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ1, Root: "."})

	if err := catalog.Delete(ctx, testWS1, testPRJ1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err := catalog.Get(ctx, testWS1, testPRJ1)
	if !errors.Is(err, domain.ErrProjectNotFound) {
		t.Errorf("expected ErrProjectNotFound after delete, got %v", err)
	}
}

func TestProjectCatalog_DuplicateRoot(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	if err := catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ1, Root: "sub"}); err != nil {
		t.Fatalf("first Put failed: %v", err)
	}

	err := catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ2, Root: "sub"})
	if err == nil {
		t.Fatal("expected duplicate root error, got nil")
	}
	if !errors.Is(err, domain.ErrDuplicateRoot) {
		t.Errorf("expected ErrDuplicateRoot, got %v", err)
	}
}

func TestProjectCatalog_InvalidID(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	err := catalog.Put(ctx, ProjectRecord{WorkspaceID: "ws_bad", ProjectID: testPRJ1, Root: "."})
	if err == nil {
		t.Fatal("expected error for invalid workspace ID")
	}
}

func TestProjectCatalog_ReturnsCopy(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ1, Root: "."})

	got1, _ := catalog.Get(ctx, testWS1, testPRJ1)
	got1.Root = "modified"

	got2, _ := catalog.Get(ctx, testWS1, testPRJ1)
	if got2.Root == "modified" {
		t.Error("Get returned a shared reference, expected a copy")
	}
}

func TestProjectCatalog_FilePath(t *testing.T) {
	dir := t.TempDir()
	policy := pathpolicy.NewDefaultPathPolicy()
	catalog := NewProjectCatalog(dir, policy)
	ctx := context.Background()

	catalog.Put(ctx, ProjectRecord{WorkspaceID: testWS1, ProjectID: testPRJ1, Root: "."})

	expected := filepath.Join(dir, "catalog", projectsFileName)
	if _, err := os.Stat(expected); os.IsNotExist(err) {
		t.Errorf("expected catalog file at %s", expected)
	}
}
