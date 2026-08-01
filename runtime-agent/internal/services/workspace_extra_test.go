package services

import (
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestDiskProjectStore_Delete(t *testing.T) {
	s := newDiskProjectStore(t.TempDir())

	if err := s.Delete("missing"); err == nil {
		t.Error("expected error deleting missing project")
	}

	root := t.TempDir()
	if _, err := s.Create("proj-1", &domain.Project{
		WorkspaceID: "ws_1",
		ID:          "proj-1",
		Name:        "demo",
		RootPath:    root,
	}); err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if err := s.Delete("proj-1"); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if _, err := s.Get("proj-1"); err == nil {
		t.Error("expected project to be gone after delete")
	}
}
