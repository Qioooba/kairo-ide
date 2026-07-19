package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

func TestFileToolchainRepo_SaveAndGet(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileToolchainRepo(dir)
	ctx := context.Background()

	tc := domain.Toolchain{
		ID:          "tc_1",
		JavaHome:    "/usr/lib/jvm/java-8",
		Version:     "1.8.0_302",
		Fingerprint: "abc123",
	}

	if err := repo.Save(ctx, tc); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := repo.Get(ctx, "tc_1")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if got.JavaHome != tc.JavaHome {
		t.Errorf("expected JavaHome %q, got %q", tc.JavaHome, got.JavaHome)
	}
	if got.Version != tc.Version {
		t.Errorf("expected Version %q, got %q", tc.Version, got.Version)
	}
	if got.VerifiedAt.IsZero() {
		t.Error("expected VerifiedAt to be set")
	}
}

func TestFileToolchainRepo_List(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileToolchainRepo(dir)
	ctx := context.Background()

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List on empty repo failed: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d items", len(list))
	}

	repo.Save(ctx, domain.Toolchain{ID: "tc_1", JavaHome: "/jdk1"})
	repo.Save(ctx, domain.Toolchain{ID: "tc_2", JavaHome: "/jdk2"})

	list, err = repo.List(ctx)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 toolchains, got %d", len(list))
	}
}

func TestFileToolchainRepo_FindByJavaHome(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileToolchainRepo(dir)
	ctx := context.Background()

	repo.Save(ctx, domain.Toolchain{ID: "tc_1", JavaHome: "/usr/lib/jvm/java-8"})
	repo.Save(ctx, domain.Toolchain{ID: "tc_2", JavaHome: "/usr/lib/jvm/java-11"})

	found, err := repo.FindByJavaHome(ctx, "/usr/lib/jvm/java-11")
	if err != nil {
		t.Fatalf("FindByJavaHome failed: %v", err)
	}
	if found.ID != "tc_2" {
		t.Errorf("expected tc_2, got %s", found.ID)
	}

	_, err = repo.FindByJavaHome(ctx, "/nonexistent")
	if !errors.Is(err, domain.ErrToolchainNotFound) {
		t.Errorf("expected ErrToolchainNotFound, got %v", err)
	}
}

func TestFileToolchainRepo_ReturnsCopy(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileToolchainRepo(dir)
	ctx := context.Background()

	repo.Save(ctx, domain.Toolchain{ID: "tc_copy", JavaHome: "/original"})

	got1, _ := repo.Get(ctx, "tc_copy")
	got1.JavaHome = "/modified"

	got2, _ := repo.Get(ctx, "tc_copy")
	if got2.JavaHome == "/modified" {
		t.Error("Get returned a shared reference, expected a copy")
	}
}

func TestFileToolchainRepo_NotFound(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileToolchainRepo(dir)
	ctx := context.Background()

	_, err := repo.Get(ctx, "tc_nonexistent")
	if !errors.Is(err, domain.ErrToolchainNotFound) {
		t.Errorf("expected ErrToolchainNotFound, got %v", err)
	}
}
