package services

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// setupRunConfigTest creates a diskWorkspaceStore with a workspace
// in a temp directory, then returns the store and the workspace ID.
func setupRunConfigTest(t *testing.T) (*diskWorkspaceStore, string) {
	t.Helper()
	dir := t.TempDir()
	wsDir := filepath.Join(dir, "workspaces")
	os.MkdirAll(wsDir, 0755)
	wsStore := &diskWorkspaceStore{
		dir:  wsDir,
		data: map[string]api.WorkspaceRecord{},
	}
	wsID := "ws_xv3wp6ifsxuk3hbrlqq2g6t2fe" // valid workspace ID format
	wsStore.data[wsID] = api.WorkspaceRecord{
		ID:       wsID,
		RootPath: dir,
		Name:     "test-workspace",
	}
	return wsStore, wsID
}

// validTestConfig returns a TomcatRunConfiguration with all required fields set.
func validTestConfig(id string) domain.TomcatRunConfiguration {
	return domain.TomcatRunConfiguration{
		ID:        id,
		Name:      "Test Config " + id,
		Type:      "tomcat6",
		ProjectID: "proj1",
		Mode:      "run",
		JDKRef:    "jdk11",
		Build: domain.RunConfigurationBuild{
			Type: "javac",
		},
		Server: domain.RunConfigurationServer{
			ID:          "tomcat6-local",
			HTTPPort:    8080,
			DebugPort:   8000,
			ContextPath: "/app",
		},
		Deploy: domain.RunConfigurationDeploy{
			Mode:     "exploded",
			Artifact: "dist/app",
		},
		Env:               map[string]string{"PATH": "/usr/bin"},
		VMOptions:         []string{"-Xmx512m"},
		BeforeLaunchTasks: []string{"build"},
	}
}

func TestNewDiskRunConfigurationStore(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	if store == nil {
		t.Fatal("newDiskRunConfigurationStore returned nil")
	}
	if store.workspaces != wsStore {
		t.Fatal("workspaces not set")
	}
	if store.repository == nil {
		t.Fatal("repository not set")
	}
}

func TestDiskRunConfigurationStore_WorkspaceRoot(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)

	root, err := store.workspaceRoot(wsID)
	if err != nil {
		t.Fatalf("workspaceRoot failed: %v", err)
	}
	if root == "" {
		t.Fatal("expected non-empty root")
	}
}

func TestDiskRunConfigurationStore_WorkspaceRoot_InvalidID(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)

	_, err := store.workspaceRoot("")
	if err == nil {
		t.Fatal("expected error for empty workspace ID")
	}
}

func TestDiskRunConfigurationStore_WorkspaceRoot_NotFound(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)

	_, err := store.workspaceRoot("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskRunConfigurationStore_Load(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	// First create a configuration so the file exists
	cfg := validTestConfig("test-load")
	_, err := store.Create(ctx, wsID, cfg)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	doc, err := store.Load(ctx, wsID)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if doc.Version != 1 {
		t.Errorf("expected Version=1, got %d", doc.Version)
	}
	if len(doc.Configurations) != 1 {
		t.Errorf("expected 1 configuration, got %d", len(doc.Configurations))
	}
}

func TestDiskRunConfigurationStore_Load_InvalidWorkspace(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	_, err := store.Load(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskRunConfigurationStore_Replace(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	selected := "test-cfg"
	doc := domain.RunConfigurationDocument{
		Version: 1,
		Configurations: []domain.TomcatRunConfiguration{
			validTestConfig("test-cfg"),
		},
		SelectedConfigurationID: &selected,
	}

	result, err := store.Replace(ctx, wsID, doc)
	if err != nil {
		t.Fatalf("Replace failed: %v", err)
	}
	if len(result.Configurations) != 1 {
		t.Fatalf("expected 1 configuration, got %d", len(result.Configurations))
	}
	if result.Configurations[0].Name != "Test Config test-cfg" {
		t.Errorf("got %q, want %q", result.Configurations[0].Name, "Test Config test-cfg")
	}
}

func TestDiskRunConfigurationStore_Replace_InvalidWorkspace(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	doc := domain.RunConfigurationDocument{
		Version: 1,
		Configurations: []domain.TomcatRunConfiguration{},
	}

	_, err := store.Replace(ctx, "nonexistent", doc)
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskRunConfigurationStore_Get(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	// First create a configuration
	cfg := validTestConfig("custom")
	_, err := store.Create(ctx, wsID, cfg)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Then get it
	result, err := store.Get(ctx, wsID, "custom")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if result.Name != "Test Config custom" {
		t.Errorf("got %q, want %q", result.Name, "Test Config custom")
	}
	if result.Server.HTTPPort != 8080 {
		t.Errorf("got %d, want 8080", result.Server.HTTPPort)
	}
}

func TestDiskRunConfigurationStore_Get_NotFound(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	_, err := store.Get(ctx, wsID, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent configuration")
	}
}

func TestDiskRunConfigurationStore_Get_InvalidWorkspace(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	_, err := store.Get(ctx, "nonexistent", "custom")
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskRunConfigurationStore_Create(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	cfg := validTestConfig("test-create")

	doc, err := store.Create(ctx, wsID, cfg)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if len(doc.Configurations) != 1 {
		t.Fatalf("expected 1 configuration, got %d", len(doc.Configurations))
	}
	if doc.Configurations[0].Name != "Test Config test-create" {
		t.Errorf("got %q, want %q", doc.Configurations[0].Name, "Test Config test-create")
	}
}

func TestDiskRunConfigurationStore_Create_InvalidWorkspace(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	cfg := validTestConfig("test")
	_, err := store.Create(ctx, "nonexistent", cfg)
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskRunConfigurationStore_Update(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	// First create
	cfg := validTestConfig("test-update")
	_, err := store.Create(ctx, wsID, cfg)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Then update
	updated := validTestConfig("test-update")
	updated.Name = "Updated"
	updated.Server.HTTPPort = 9090
	updated.Server.DebugPort = 8001
	doc, err := store.Update(ctx, wsID, "test-update", updated)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	// Find the updated config
	found := false
	for _, c := range doc.Configurations {
		if c.ID == "test-update" {
			if c.Name != "Updated" {
				t.Errorf("got %q, want %q", c.Name, "Updated")
			}
			if c.Server.HTTPPort != 9090 {
				t.Errorf("got %d, want 9090", c.Server.HTTPPort)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("updated configuration not found in document")
	}
}

func TestDiskRunConfigurationStore_Update_InvalidWorkspace(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	cfg := validTestConfig("test")
	_, err := store.Update(ctx, "nonexistent", "test", cfg)
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskRunConfigurationStore_Delete(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	// First create
	cfg := validTestConfig("test-delete")
	_, err := store.Create(ctx, wsID, cfg)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Then delete
	doc, err := store.Delete(ctx, wsID, "test-delete")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	// Verify it's gone
	for _, c := range doc.Configurations {
		if c.ID == "test-delete" {
			t.Fatal("deleted configuration still in document")
		}
	}
}

func TestDiskRunConfigurationStore_Delete_InvalidWorkspace(t *testing.T) {
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	_, err := store.Delete(ctx, "nonexistent", "test")
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskRunConfigurationStore_Delete_NotFound(t *testing.T) {
	wsStore, wsID := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)
	ctx := context.Background()

	_, err := store.Delete(ctx, wsID, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent configuration")
	}
}

func TestDiskRunConfigurationStore_WorkspaceRoot_ValidateID(t *testing.T) {
	// Test with invalid workspace ID characters
	wsStore, _ := setupRunConfigTest(t)
	store := newDiskRunConfigurationStore(wsStore)

	_, err := store.workspaceRoot("../../../etc/passwd")
	if err == nil {
		t.Fatal("expected error for path traversal workspace ID")
	}
}