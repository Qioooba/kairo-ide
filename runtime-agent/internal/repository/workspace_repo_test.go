package repository

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

func setupWorkspaceTest(t *testing.T) (string, *FileWorkspaceRepo) {
	t.Helper()
	dir := t.TempDir()
	repo := NewFileWorkspaceRepo(dir)
	return dir, repo
}

func TestFileWorkspaceRepo_SaveAndGet(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	ctx := context.Background()

	root := t.TempDir()
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err == nil {
		root = resolvedRoot
	}

	ws := domain.Workspace{
		ID:   testWS1,
		Name: "Test Workspace",
		Root: root,
	}

	if err := repo.Save(ctx, ws); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := repo.Get(ctx, testWS1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if got.Name != "Test Workspace" {
		t.Errorf("expected name 'Test Workspace', got %q", got.Name)
	}
	if got.Root != root {
		t.Errorf("expected root %q, got %q", root, got.Root)
	}
	if got.CreatedAt.IsZero() {
		t.Error("expected CreatedAt to be set")
	}
}

func TestFileWorkspaceRepo_List(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	ctx := context.Background()

	root1 := t.TempDir()
	root2 := t.TempDir()
	for _, r := range []*string{&root1, &root2} {
		if resolved, err := filepath.EvalSymlinks(*r); err == nil {
			*r = resolved
		}
	}

	repo.Save(ctx, domain.Workspace{ID: testWS1, Name: "WS1", Root: root1})
	repo.Save(ctx, domain.Workspace{ID: testWS2, Name: "WS2", Root: root2})

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 workspaces, got %d", len(list))
	}
}

func TestFileWorkspaceRepo_Delete(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	ctx := context.Background()

	root := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}

	repo.Save(ctx, domain.Workspace{ID: testWS1, Name: "ToDelete", Root: root})

	if err := repo.Delete(ctx, testWS1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err := repo.Get(ctx, testWS1)
	if !errors.Is(err, domain.ErrWorkspaceNotFound) {
		t.Errorf("expected ErrWorkspaceNotFound, got %v", err)
	}
}

func TestFileWorkspaceRepo_DuplicateRoot(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	ctx := context.Background()

	root := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}

	repo.Save(ctx, domain.Workspace{ID: testWS1, Name: "WS1", Root: root})

	err := repo.Save(ctx, domain.Workspace{ID: testWS2, Name: "WS2", Root: root})
	if err == nil {
		t.Fatal("expected duplicate root error")
	}
	if !errors.Is(err, domain.ErrDuplicateRoot) {
		t.Errorf("expected ErrDuplicateRoot, got %v", err)
	}
}

func TestFileWorkspaceRepo_ReturnsCopy(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	ctx := context.Background()

	root := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}

	repo.Save(ctx, domain.Workspace{ID: testWS1, Name: "Original", Root: root})

	got1, err := repo.Get(ctx, testWS1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	got1.Name = "Modified"

	got2, err := repo.Get(ctx, testWS1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got2.Name == "Modified" {
		t.Error("Get returned a shared reference, expected a copy")
	}
}

func TestFileWorkspaceRepo_InvalidID(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	ctx := context.Background()

	_, err := repo.Get(ctx, "ws_bad")
	if err == nil {
		t.Fatal("expected error for invalid workspace ID")
	}
}
