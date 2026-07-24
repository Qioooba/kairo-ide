package repository

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestLoadWorkspaces_Empty(t *testing.T) {
	dir := t.TempDir()
	workspaces, err := LoadWorkspaces(dir)
	if err != nil {
		t.Fatalf("LoadWorkspaces failed: %v", err)
	}
	if len(workspaces) != 0 {
		t.Errorf("expected 0 workspaces, got %d", len(workspaces))
	}
}

func TestSaveAndLoadWorkspaces(t *testing.T) {
	dir := t.TempDir()
	ws := []domain.Workspace{
		{ID: "ws_test1", Name: "Test Workspace", Root: "/test/root"},
	}
	if err := SaveWorkspaces(dir, ws); err != nil {
		t.Fatalf("SaveWorkspaces failed: %v", err)
	}
	loaded, err := LoadWorkspaces(dir)
	if err != nil {
		t.Fatalf("LoadWorkspaces failed: %v", err)
	}
	if len(loaded) != 1 {
		t.Fatalf("expected 1 workspace, got %d", len(loaded))
	}
	if loaded[0].Name != "Test Workspace" {
		t.Errorf("got %q, want %q", loaded[0].Name, "Test Workspace")
	}
}

func TestTouchWorkspace(t *testing.T) {
	dir := t.TempDir()
	ws := []domain.Workspace{
		{ID: "ws_test1", Name: "Test Workspace", Root: "/test/root"},
	}
	if err := SaveWorkspaces(dir, ws); err != nil {
		t.Fatalf("SaveWorkspaces failed: %v", err)
	}
	if err := TouchWorkspace(dir, "ws_test1"); err != nil {
		t.Fatalf("TouchWorkspace failed: %v", err)
	}
	loaded, err := LoadWorkspaces(dir)
	if err != nil {
		t.Fatalf("LoadWorkspaces failed: %v", err)
	}
	if loaded[0].LastOpened.IsZero() {
		t.Error("LastOpened should be set after touch")
	}
}

func TestTouchWorkspace_NotFound(t *testing.T) {
	dir := t.TempDir()
	ws := []domain.Workspace{
		{ID: "ws_test1", Name: "Test Workspace", Root: "/test/root"},
	}
	if err := SaveWorkspaces(dir, ws); err != nil {
		t.Fatalf("SaveWorkspaces failed: %v", err)
	}
	if err := TouchWorkspace(dir, "ws_nonexistent"); err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestWorkspacesFilePath(t *testing.T) {
	path := workspacesFilePath("/data")
	expected := filepath.Join("/data", "catalog", "workspaces.json")
	if path != expected {
		t.Errorf("got %q, want %q", path, expected)
	}
}

func TestLoadWorkspaces_CorruptFile(t *testing.T) {
	dir := t.TempDir()
	catalogDir := filepath.Join(dir, "catalog")
	os.MkdirAll(catalogDir, 0755)
	os.WriteFile(filepath.Join(catalogDir, "workspaces.json"), []byte("not json"), 0644)

	_, err := LoadWorkspaces(dir)
	if err == nil {
		t.Fatal("expected error for corrupt JSON")
	}
}

func TestLoadToolchains_Empty(t *testing.T) {
	dir := t.TempDir()
	toolchains, err := LoadToolchains(dir)
	if err != nil {
		t.Fatalf("LoadToolchains failed: %v", err)
	}
	if len(toolchains) != 0 {
		t.Errorf("expected 0 toolchains, got %d", len(toolchains))
	}
}

func TestSaveAndLoadToolchains(t *testing.T) {
	dir := t.TempDir()
	tc := []domain.Toolchain{
		{ID: "tc1", JavaHome: "/usr/lib/jvm/java-11", Version: "11"},
	}
	if err := SaveToolchains(dir, tc); err != nil {
		t.Fatalf("SaveToolchains failed: %v", err)
	}
	loaded, err := LoadToolchains(dir)
	if err != nil {
		t.Fatalf("LoadToolchains failed: %v", err)
	}
	if len(loaded) != 1 {
		t.Fatalf("expected 1 toolchain, got %d", len(loaded))
	}
	if loaded[0].JavaHome != "/usr/lib/jvm/java-11" {
		t.Errorf("got %q, want %q", loaded[0].JavaHome, "/usr/lib/jvm/java-11")
	}
}

func TestFindToolchainByJavaHome(t *testing.T) {
	dir := t.TempDir()
	tc := []domain.Toolchain{
		{ID: "tc1", JavaHome: "/usr/lib/jvm/java-11", Version: "11"},
		{ID: "tc2", JavaHome: "/usr/lib/jvm/java-17", Version: "17"},
	}
	if err := SaveToolchains(dir, tc); err != nil {
		t.Fatalf("SaveToolchains failed: %v", err)
	}
	found, err := FindToolchainByJavaHome(dir, "/usr/lib/jvm/java-11")
	if err != nil {
		t.Fatalf("FindToolchainByJavaHome failed: %v", err)
	}
	if found.JavaHome != "/usr/lib/jvm/java-11" {
		t.Errorf("got %q, want %q", found.JavaHome, "/usr/lib/jvm/java-11")
	}
}

func TestFindToolchainByJavaHome_NotFound(t *testing.T) {
	dir := t.TempDir()
	tc := []domain.Toolchain{
		{ID: "tc1", JavaHome: "/usr/lib/jvm/java-11", Version: "11"},
	}
	if err := SaveToolchains(dir, tc); err != nil {
		t.Fatalf("SaveToolchains failed: %v", err)
	}
	_, err := FindToolchainByJavaHome(dir, "/nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent JavaHome")
	}
}

func TestFindToolchainByJavaHome_Empty(t *testing.T) {
	dir := t.TempDir()
	_, err := FindToolchainByJavaHome(dir, "/usr/lib/jvm/java-11")
	if err == nil {
		t.Fatal("expected error when no toolchains exist")
	}
}

func TestToolchainsFilePath(t *testing.T) {
	path := toolchainsFilePath("/data")
	expected := filepath.Join("/data", "toolchains.json")
	if path != expected {
		t.Errorf("got %q, want %q", path, expected)
	}
}

func TestLoadToolchains_CorruptFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "toolchains.json"), []byte("not json"), 0644)

	_, err := LoadToolchains(dir)
	if err == nil {
		t.Fatal("expected error for corrupt JSON")
	}
}