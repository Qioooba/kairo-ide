package services

import (
	"context"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// KAIRO-RC-WEB-258: ProjectStore (HTTP PUT path) and ProjectRepo
// (JDT LS launch-descriptor path) used to be backed by TWO
// separate diskProjectStore instances, so a project saved via the
// API was invisible to the JDT LS descriptor lookup — "project
// not found" and JDT LS never started.
func TestProjectStoreAndRepoShareState(t *testing.T) {
	cfg := Config{
		DataDir:    t.TempDir(),
		Logger:     log.New("test"),
		BundledDir: t.TempDir(),
	}
	svc := NewMemoryServices(cfg, nil)

	p := domain.Project{
		ID:          "project-ws_test",
		WorkspaceID: "ws_test",
		Name:        "demo",
		RootPath:    cfg.DataDir,
	}
	if _, err := svc.ProjectStore.Update(string(p.ID), &p); err != nil {
		t.Fatalf("ProjectStore.Update: %v", err)
	}
	got, err := svc.ProjectRepo.Get(context.Background(), domain.WorkspaceID(p.WorkspaceID), domain.ProjectID(p.ID))
	if err != nil {
		t.Fatalf("ProjectRepo.Get must see projects written through ProjectStore: %v", err)
	}
	if got.Name != "demo" {
		t.Fatalf("unexpected project: %+v", got)
	}
}
