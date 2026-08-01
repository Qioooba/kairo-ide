package repository

import (
	"context"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestFileWorkspaceRepo_Touch(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	ctx := context.Background()

	// Touch a non-existent workspace -> not found.
	if err := repo.Touch(ctx, testWS2); err == nil {
		t.Error("expected error touching missing workspace")
	}

	root := t.TempDir()
	ws := domain.Workspace{ID: testWS1, Name: "demo", Root: root}
	if err := repo.Save(ctx, ws); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	if err := repo.Touch(ctx, testWS1); err != nil {
		t.Fatalf("Touch failed: %v", err)
	}
	got, err := repo.Get(ctx, testWS1)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastOpened.IsZero() {
		t.Error("expected LastOpened to be updated after Touch")
	}
}

func TestFileWorkspaceRepo_TouchInvalidID(t *testing.T) {
	_, repo := setupWorkspaceTest(t)
	if err := repo.Touch(context.Background(), "bad id with space"); err == nil {
		t.Error("expected error for invalid workspace id")
	}
}

func TestCloneRecordPtr(t *testing.T) {
	if got := cloneRecordPtr(nil); got != nil {
		t.Errorf("expected nil for nil input, got %+v", got)
	}

	rec := &domain.ServerRecord{ID: "srv_1", ObservedState: domain.ServerState("running")}
	cp := cloneRecordPtr(rec)
	if cp == nil {
		t.Fatal("expected non-nil clone")
	}
	if cp.ID != "srv_1" || cp.ObservedState != "running" {
		t.Errorf("clone = %+v", cp)
	}
	// Mutating the clone must not affect the source.
	cp.ObservedState = "stopped"
	if rec.ObservedState != "running" {
		t.Error("clone shares state with source")
	}
}
