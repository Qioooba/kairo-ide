package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

func TestFileServerHistoryRepo_SaveAndGet(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	inst := domain.ServerInstance{
		ID:          testSRV1,
		WorkspaceID: testWS1,
		ProjectID:   testPRJ1,
		State:       domain.ServerStateRunning,
		HTTPPort:    8080,
		PID:         12345,
		StartTime:   time.Now(),
		URL:         "http://localhost:8080",
		LastPlan: &domain.RuntimePlan{
			ServerID:     testSRV1,
			JavaHome:     "/usr/lib/jvm/java-17",
			CatalinaHome: "/opt/tomcat",
			HTTPPort:     8080,
			JVMOptions:   []string{"-Xmx512m"},
		},
	}

	if err := repo.Save(ctx, inst); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if got.State != domain.ServerStateRunning {
		t.Errorf("expected state running, got %s", got.State)
	}
	if got.HTTPPort != 8080 {
		t.Errorf("expected port 8080, got %d", got.HTTPPort)
	}
	if got.LastPlan == nil {
		t.Fatal("expected LastPlan to be set")
	}
	if got.LastPlan.JavaHome != "/usr/lib/jvm/java-17" {
		t.Errorf("expected JavaHome /usr/lib/jvm/java-17, got %s", got.LastPlan.JavaHome)
	}
}

func TestFileServerHistoryRepo_List(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	now := time.Now()
	repo.Save(ctx, domain.ServerInstance{ID: testSRV1, WorkspaceID: testWS1, ProjectID: testPRJ1, State: domain.ServerStateRunning, StartTime: now})

	list, err := repo.List(ctx, testWS1)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 instance, got %d", len(list))
	}
}

func TestFileServerHistoryRepo_Delete(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	now := time.Now()
	repo.Save(ctx, domain.ServerInstance{ID: testSRV1, WorkspaceID: testWS1, ProjectID: testPRJ1, State: domain.ServerStateStopped, StartTime: now})

	if err := repo.Delete(ctx, testWS1, testSRV1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err := repo.Get(ctx, testWS1, testSRV1)
	if !errors.Is(err, domain.ErrServerNotFound) {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
}

func TestFileServerHistoryRepo_NotFound(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	_, err := repo.Get(ctx, testWS1, testSRV1)
	if !errors.Is(err, domain.ErrServerNotFound) {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
}

func TestFileServerHistoryRepo_ReturnsCopy(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	now := time.Now()
	repo.Save(ctx, domain.ServerInstance{
		ID:          testSRV1,
		WorkspaceID: testWS1,
		ProjectID:   testPRJ1,
		State:       domain.ServerStateRunning,
		StartTime:   now,
		LastPlan: &domain.RuntimePlan{
			ServerID:   testSRV1,
			JVMOptions: []string{"-Xmx512m"},
		},
	})

	got1, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	got1.State = domain.ServerStateStopped
	got1.LastPlan.JVMOptions[0] = "-Xmx1g"

	got2, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got2.State == domain.ServerStateStopped {
		t.Error("Get returned a shared reference for State, expected a copy")
	}
	if got2.LastPlan.JVMOptions[0] == "-Xmx1g" {
		t.Error("Get returned a shared reference for LastPlan.JVMOptions, expected a copy")
	}
}

func TestFileServerHistoryRepo_InvalidID(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	err := repo.Save(ctx, domain.ServerInstance{ID: "srv_bad", WorkspaceID: testWS1, ProjectID: testPRJ1, State: domain.ServerStateRunning, StartTime: time.Now()})
	if err == nil {
		t.Fatal("expected error for invalid server ID")
	}
}
