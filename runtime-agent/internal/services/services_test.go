package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// =========================================================================
// Deployer Tests
// =========================================================================

func TestNewDiskDeployer(t *testing.T) {
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	if d == nil {
		t.Fatal("newDiskDeployer returned nil")
	}
	if d.items == nil {
		t.Fatal("items map is nil")
	}
}

func TestDiskDeployer_ListEmpty(t *testing.T) {
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	items := d.List()
	if len(items) != 0 {
		t.Errorf("List() = %d items, want 0", len(items))
	}
}

func TestDiskDeployer_GetNotFound(t *testing.T) {
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	_, err := d.Get("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent deployment")
	}
}

func TestDiskDeployer_Publish_InvalidMode(t *testing.T) {
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	_, err := d.Publish(api.DeployRequest{
		Mode:   "invalid",
		Source: t.TempDir(),
		Target: t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected error for invalid mode")
	}
}

func TestDiskDeployer_Publish_EmptySource(t *testing.T) {
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	_, err := d.Publish(api.DeployRequest{
		Mode:   "merge",
		Target: t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected error for empty source")
	}
}

func TestDiskDeployer_Publish_EmptyTarget(t *testing.T) {
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	_, err := d.Publish(api.DeployRequest{
		Mode:   "merge",
		Source: t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected error for empty target")
	}
}

func TestDiskDeployer_Publish_SourceNotFound(t *testing.T) {
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	_, err := d.Publish(api.DeployRequest{
		Mode:   "merge",
		Source: "/nonexistent/source/path",
		Target: t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected error for nonexistent source")
	}
}

func TestDiskDeployer_Publish_Defaults(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "test.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	result, err := d.Publish(api.DeployRequest{
		Source: src,
		Target: dst,
	})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if result.State != "success" {
		t.Errorf("state = %q, want success", result.State)
	}
	if result.ID == "" {
		t.Error("ID should be generated")
	}
	if result.What != "all" {
		t.Errorf("What = %q, want all", result.What)
	}
	if result.Trigger != "manual" {
		t.Errorf("Trigger = %q, want manual", result.Trigger)
	}

	// Verify Get returns the same result
	got, err := d.Get(result.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.State != result.State {
		t.Errorf("Get state = %q, want %q", got.State, result.State)
	}
}

func TestDiskDeployer_Publish_Mirror(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "test.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	result, err := d.Publish(api.DeployRequest{
		Source: src,
		Target: dst,
		Mode:   "mirror",
	})
	if err != nil {
		t.Fatalf("Publish mirror: %v", err)
	}
	if result.State != "success" {
		t.Errorf("state = %q, want success", result.State)
	}
}

func TestDiskDeployer_Publish_StaticMode(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "webapp")
	dst := filepath.Join(dir, "deploy")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "style.css"), []byte("body{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	result, err := d.Publish(api.DeployRequest{
		Source: src,
		Target: dst,
		What:   "static",
	})
	if err != nil {
		t.Fatalf("Publish static: %v", err)
	}
	if result.State != "success" {
		t.Errorf("state = %q, want success", result.State)
	}
}

func TestDiskDeployer_ListAfterPublish(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "test.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	d := newDiskDeployer(t.TempDir(), log.New("test"))
	_, err := d.Publish(api.DeployRequest{
		Source: src,
		Target: dst,
	})
	if err != nil {
		t.Fatal(err)
	}
	items := d.List()
	if len(items) != 1 {
		t.Errorf("List() = %d items, want 1", len(items))
	}
}

// =========================================================================
// SyncDir Tests
// =========================================================================

func TestSyncDir_SingleFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, modified, deleted, bytes, err := syncDir(src, dst, false)
	if err != nil {
		t.Fatalf("syncDir: %v", err)
	}
	if added != 1 {
		t.Errorf("added = %d, want 1", added)
	}
	if modified != 0 {
		t.Errorf("modified = %d, want 0", modified)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0", deleted)
	}
	if bytes != 5 {
		t.Errorf("bytes = %d, want 5", bytes)
	}
	data, _ := os.ReadFile(dst)
	if string(data) != "hello" {
		t.Errorf("content = %q, want hello", string(data))
	}
}

func TestSyncDir_SingleFileToDir(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst")
	if err := os.WriteFile(src, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}
	_, _, _, _, err := syncDir(src, dst, false)
	if err != nil {
		t.Fatalf("syncDir: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(dst, "src.txt"))
	if string(data) != "hello" {
		t.Errorf("content = %q, want hello", string(data))
	}
}

func TestSyncDir_Directory(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, modified, deleted, _, err := syncDir(src, dst, false)
	if err != nil {
		t.Fatalf("syncDir: %v", err)
	}
	if added != 2 {
		t.Errorf("added = %d, want 2", added)
	}
	if modified != 0 {
		t.Errorf("modified = %d, want 0", modified)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0", deleted)
	}
}

func TestSyncDir_Prune(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "remove.txt"), []byte("remove"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, _, deleted, _, err := syncDir(src, dst, true)
	if err != nil {
		t.Fatalf("syncDir: %v", err)
	}
	if added != 1 {
		t.Errorf("added = %d, want 1", added)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
	if _, err := os.Stat(filepath.Join(dst, "remove.txt")); !os.IsNotExist(err) {
		t.Error("stale file should be removed")
	}
}

func TestSyncDir_Modify(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "file.txt"), []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "file.txt"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, modified, _, _, err := syncDir(src, dst, false)
	if err != nil {
		t.Fatalf("syncDir: %v", err)
	}
	if modified != 1 {
		t.Errorf("modified = %d, want 1", modified)
	}
	if added != 0 {
		t.Errorf("added = %d, want 0", added)
	}
}

func TestSyncDir_NonexistentSource(t *testing.T) {
	_, _, _, _, err := syncDir("/nonexistent/src", "/tmp/dst", false)
	if err == nil {
		t.Fatal("expected error for nonexistent source")
	}
}

// =========================================================================
// CopyOneFile Tests
// =========================================================================

func TestCopyOneFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, modified, bytes, err := copyOneFile(src, dst)
	if err != nil {
		t.Fatalf("copyOneFile: %v", err)
	}
	if added != 1 {
		t.Errorf("added = %d, want 1", added)
	}
	if modified != 0 {
		t.Errorf("modified = %d, want 0", modified)
	}
	if bytes != 5 {
		t.Errorf("bytes = %d, want 5", bytes)
	}
}

func TestCopyOneFile_Overwrite(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := os.WriteFile(src, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, modified, _, err := copyOneFile(src, dst)
	if err != nil {
		t.Fatalf("copyOneFile: %v", err)
	}
	if added != 0 {
		t.Errorf("added = %d, want 0", added)
	}
	if modified != 1 {
		t.Errorf("modified = %d, want 1", modified)
	}
}

// =========================================================================
// SyncStaticWebFiles Tests
// =========================================================================

func TestSyncStaticWebFiles(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "webapp")
	dst := filepath.Join(dir, "deploy")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "style.css"), []byte("body{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, modified, _, err := syncStaticWebFiles(src, dst)
	if err != nil {
		t.Fatalf("syncStaticWebFiles: %v", err)
	}
	if added != 1 {
		t.Errorf("added = %d, want 1", added)
	}
	if modified != 0 {
		t.Errorf("modified = %d, want 0", modified)
	}
}

func TestSyncStaticWebFiles_IgnoresNonWebFiles(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "webapp")
	dst := filepath.Join(dir, "deploy")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "test.java"), []byte("class X{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, modified, _, err := syncStaticWebFiles(src, dst)
	if err != nil {
		t.Fatalf("syncStaticWebFiles: %v", err)
	}
	if added != 0 {
		t.Errorf("added = %d, want 0 (java files should be ignored)", added)
	}
	if modified != 0 {
		t.Errorf("modified = %d, want 0", modified)
	}
}

// =========================================================================
// PruneUnseen Tests
// =========================================================================

func TestPruneUnseen(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "remove.txt"), []byte("remove"), 0o644); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{filepath.Join(dir, "keep.txt"): true}
	var deleted int
	if err := pruneUnseen(dir, seen, &deleted); err != nil {
		t.Fatalf("pruneUnseen: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
	if _, err := os.Stat(filepath.Join(dir, "remove.txt")); !os.IsNotExist(err) {
		t.Error("remove.txt should be deleted")
	}
	if _, err := os.Stat(filepath.Join(dir, "keep.txt")); err != nil {
		t.Error("keep.txt should still exist")
	}
}

func TestPruneUnseen_Empty(t *testing.T) {
	dir := t.TempDir()
	seen := map[string]bool{}
	var deleted int
	if err := pruneUnseen(dir, seen, &deleted); err != nil {
		t.Fatalf("pruneUnseen: %v", err)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0", deleted)
	}
}

func TestPruneUnseen_Nonexistent(t *testing.T) {
	seen := map[string]bool{}
	var deleted int
	if err := pruneUnseen("/nonexistent/path", seen, &deleted); err != nil {
		t.Fatalf("pruneUnseen: %v", err)
	}
}

// =========================================================================
// ShortID Tests
// =========================================================================

func TestShortID(t *testing.T) {
	id1 := shortID()
	id2 := shortID()
	if id1 == "" {
		t.Error("shortID returned empty string")
	}
	if len(id1) != 8 {
		t.Errorf("shortID length = %d, want 8", len(id1))
	}
	if id1 == id2 {
		t.Error("two shortIDs should differ")
	}
}

// =========================================================================
// DomainProjectRepo Tests
// =========================================================================

func TestDomainProjectRepo_Get(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	store.Create("proj-1", &domain.Project{
		ID:          "proj-1",
		WorkspaceID: "ws-1",
		Name:        "test-project",
		RootPath:    dir,
	})
	repo := &domainProjectRepo{store: store}
	proj, err := repo.Get(nil, "ws-1", "proj-1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if proj.Name != "test-project" {
		t.Errorf("Name = %q, want test-project", proj.Name)
	}
}

func TestDomainProjectRepo_Get_WrongWorkspace(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	store.Create("proj-1", &domain.Project{
		ID:          "proj-1",
		WorkspaceID: "ws-1",
		Name:        "test-project",
		RootPath:    dir,
	})
	repo := &domainProjectRepo{store: store}
	_, err := repo.Get(nil, "ws-2", "proj-1")
	if err == nil {
		t.Fatal("expected error for wrong workspace")
	}
}

func TestDomainProjectRepo_Get_NotFound(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	repo := &domainProjectRepo{store: store}
	_, err := repo.Get(nil, "ws-1", "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent project")
	}
}

// =========================================================================
// Workspace Store Tests
// =========================================================================

func TestDiskWorkspaceStore_Open(t *testing.T) {
	dir := t.TempDir()
	store := newDiskWorkspaceStore(dir, nil)
	ws, err := store.Open(dir, "test-workspace")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if ws.Name != "test-workspace" {
		t.Errorf("Name = %q, want test-workspace", ws.Name)
	}
	if ws.RootPath != dir {
		t.Errorf("RootPath = %q, want %q", ws.RootPath, dir)
	}
	if ws.ID == "" {
		t.Error("ID should be generated")
	}
}

func TestDiskWorkspaceStore_Open_Duplicate(t *testing.T) {
	dir := t.TempDir()
	store := newDiskWorkspaceStore(dir, nil)
	ws1, err := store.Open(dir, "test-ws")
	if err != nil {
		t.Fatal(err)
	}
	ws2, err := store.Open(dir, "test-ws")
	if err != nil {
		t.Fatal(err)
	}
	if ws1.ID != ws2.ID {
		t.Error("duplicate Open should return same workspace")
	}
}

func TestDiskWorkspaceStore_Open_DefaultName(t *testing.T) {
	dir := t.TempDir()
	store := newDiskWorkspaceStore(dir, nil)
	ws, err := store.Open(dir, "")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if ws.Name != filepath.Base(dir) {
		t.Errorf("Name = %q, want %q", ws.Name, filepath.Base(dir))
	}
}

func TestDiskWorkspaceStore_Get(t *testing.T) {
	dir := t.TempDir()
	store := newDiskWorkspaceStore(dir, nil)
	ws1, err := store.Open(dir, "test-ws")
	if err != nil {
		t.Fatal(err)
	}
	ws2, err := store.Get(ws1.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if ws2.ID != ws1.ID {
		t.Errorf("Get ID = %q, want %q", ws2.ID, ws1.ID)
	}
}

func TestDiskWorkspaceStore_Get_NotFound(t *testing.T) {
	dir := t.TempDir()
	store := newDiskWorkspaceStore(dir, nil)
	_, err := store.Get("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent workspace")
	}
}

func TestDiskWorkspaceStore_List(t *testing.T) {
	dir := t.TempDir()
	ws1Dir := filepath.Join(dir, "ws1")
	ws2Dir := filepath.Join(dir, "ws2")
	if err := os.MkdirAll(ws1Dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ws2Dir, 0o755); err != nil {
		t.Fatal(err)
	}
	store := newDiskWorkspaceStore(dir, nil)
	_, err := store.Open(ws1Dir, "ws1")
	if err != nil {
		t.Fatalf("Open ws1: %v", err)
	}
	_, err = store.Open(ws2Dir, "ws2")
	if err != nil {
		t.Fatalf("Open ws2: %v", err)
	}
	items := store.List()
	if len(items) != 2 {
		t.Errorf("List() = %d items, want 2", len(items))
	}
}

func TestDiskWorkspaceStore_Close(t *testing.T) {
	dir := t.TempDir()
	store := newDiskWorkspaceStore(dir, nil)
	ws, err := store.Open(dir, "test-ws")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(ws.ID); err != nil {
		t.Fatalf("Close: %v", err)
	}
	_, err = store.Get(ws.ID)
	if err == nil {
		t.Fatal("expected error after close")
	}
}

func TestDiskWorkspaceStore_Open_Nonexistent(t *testing.T) {
	store := newDiskWorkspaceStore(t.TempDir(), nil)
	_, err := store.Open("/nonexistent/path/12345", "test")
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}

// =========================================================================
// ProjectStore Tests
// =========================================================================

func TestDiskProjectStore_Create(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	proj, err := store.Create("proj-1", &domain.Project{
		ID:          "proj-1",
		WorkspaceID: "ws-1",
		Name:        "test",
		RootPath:    dir,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if proj.Name != "test" {
		t.Errorf("Name = %q, want test", proj.Name)
	}
}

func TestDiskProjectStore_Create_Duplicate(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	proj := &domain.Project{
		ID:          "proj-1",
		WorkspaceID: "ws-1",
		Name:        "test",
		RootPath:    dir,
	}
	_, err := store.Create("proj-1", proj)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Create("proj-1", proj)
	if err == nil {
		t.Fatal("expected error for duplicate create")
	}
}

func TestDiskProjectStore_Create_DuplicateRoot(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	_, err := store.Create("proj-1", &domain.Project{
		ID:          "proj-1",
		WorkspaceID: "ws-1",
		Name:        "test1",
		RootPath:    dir,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Create("proj-2", &domain.Project{
		ID:          "proj-2",
		WorkspaceID: "ws-1",
		Name:        "test2",
		RootPath:    dir,
	})
	if err == nil {
		t.Fatal("expected error for duplicate root")
	}
}

func TestDiskProjectStore_Create_NilProject(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	_, err := store.Create("proj-1", nil)
	if err == nil {
		t.Fatal("expected error for nil project")
	}
}

func TestDiskProjectStore_Get_NotFound(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	_, err := store.Get("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent project")
	}
}

func TestDiskProjectStore_List(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	store.Create("proj-1", &domain.Project{
		ID:          "proj-1",
		WorkspaceID: "ws-1",
		Name:        "test1",
		RootPath:    filepath.Join(dir, "p1"),
	})
	store.Create("proj-2", &domain.Project{
		ID:          "proj-2",
		WorkspaceID: "ws-1",
		Name:        "test2",
		RootPath:    filepath.Join(dir, "p2"),
	})
	items := store.List()
	if len(items) != 2 {
		t.Errorf("List() = %d items, want 2", len(items))
	}
}

// =========================================================================
// JDTLS Service Tests
// =========================================================================

func TestNewJDTLSService(t *testing.T) {
	dir := t.TempDir()
	svc := newJDTLSService(dir, dir, log.New("test"), false, "")
	if svc == nil {
		t.Fatal("newJDTLSService returned nil")
	}
	if svc.mgr == nil {
		t.Fatal("manager is nil")
	}
	if svc.sourceLvl != "1.6" {
		t.Errorf("sourceLvl = %q, want 1.6", svc.sourceLvl)
	}
}

func TestJDTLSService_Status(t *testing.T) {
	dir := t.TempDir()
	svc := newJDTLSService(dir, dir, log.New("test"), false, "")
	resp, err := svc.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	var result map[string]any
	if err := json.Unmarshal(resp, &result); err != nil {
		t.Fatalf("unmarshal status: %v", err)
	}
	if result["state"] != "stopped" {
		t.Errorf("state = %v, want stopped", result["state"])
	}
	if result["sourceLevel"] != "1.6" {
		t.Errorf("sourceLevel = %v, want 1.6", result["sourceLevel"])
	}
}

// =========================================================================
// DiskAuthenticator Logout Tests
// =========================================================================

func TestDiskAuthenticator_Logout_Success(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	os.Unsetenv("KAIRO_AUTH_USER")
	os.Unsetenv("KAIRO_AUTH_PASSWORD")
	os.Unsetenv("KAIRO_SECRET")
	os.Setenv("KAIRO_LOCAL_SECRET", "logout-ok")
	defer os.Unsetenv("KAIRO_LOCAL_SECRET")

	payload, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "logout-ok",
	})
	resp, err := a.Login(payload, nil)
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	var result map[string]any
	json.Unmarshal(resp, &result)
	token := result["sessionToken"].(string)

	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	err = a.Logout(req, rec)
	if err != nil {
		t.Errorf("Logout: %v", err)
	}
	if err := a.ValidateSession(token); err == nil {
		t.Fatal("expected session invalidated")
	}
}

// =========================================================================
// Test domainToolchainRepo
// =========================================================================

func TestMemToolchainRegistry_List(t *testing.T) {
	cfg := Config{
		DataDir:    t.TempDir(),
		BundledDir: t.TempDir(),
		Logger:     log.New("test"),
	}
	svc := NewMemoryServices(cfg, nil)
	items := svc.ToolchainRegistry.List()
	// Should be empty initially
	if items == nil {
		t.Error("List should not return nil")
	}
}

// =========================================================================
// Encoding Validate Edge Cases
// =========================================================================

func TestMemEncoder_Validate_UTF8UpperCase(t *testing.T) {
	m := &memEncoder{}
	payload, _ := json.Marshal(map[string]string{
		"text":     "hello",
		"encoding": "UTF-8",
	})
	resp, err := m.Validate(payload)
	if err != nil {
		t.Fatalf("Validate UTF-8 uppercase: %v", err)
	}
	var result map[string]any
	json.Unmarshal(resp, &result)
	if result["valid"] != true {
		t.Error("UTF-8 uppercase should be valid")
	}
}

func TestMemEncoder_Validate_InvalidJSON(t *testing.T) {
	m := &memEncoder{}
	_, err := m.Validate([]byte("not json"))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestMemEncoder_ResolveRead_NilEncoder(t *testing.T) {
	var m *memEncoder
	path, err := m.resolveRead("/some/path")
	if err != nil {
		t.Fatalf("resolveRead with nil encoder: %v", err)
	}
	if path != "/some/path" {
		t.Errorf("path = %q, want /some/path", path)
	}
}

func TestMemEncoder_ResolveWrite_NilEncoder(t *testing.T) {
	var m *memEncoder
	path, err := m.resolveWrite("/some/path")
	if err != nil {
		t.Fatalf("resolveWrite with nil encoder: %v", err)
	}
	if path != "/some/path" {
		t.Errorf("path = %q, want /some/path", path)
	}
}

// =========================================================================
// DiskAuthenticator Login with user auth but no password hash
// =========================================================================

func TestDiskAuthenticator_Login_UserAuthNoPasswordHash(t *testing.T) {
	a := newDiskAuthenticator(t.TempDir(), log.New("test"))
	os.Unsetenv("KAIRO_SECRET")
	os.Unsetenv("KAIRO_LOCAL_SECRET")
	os.Setenv("KAIRO_AUTH_USER", "admin")
	os.Unsetenv("KAIRO_AUTH_PASSWORD")
	defer os.Unsetenv("KAIRO_AUTH_USER")

	payload, _ := json.Marshal(map[string]string{
		"username": "admin",
		"password": "any-password",
	})
	_, err := a.Login(payload, nil)
	if err == nil {
		t.Fatal("Login with user auth but no password hash should fail")
	}
}

// =========================================================================
// Test domainToolchainRepo.Get
// =========================================================================

func TestDomainToolchainRepo_Get_NotFound(t *testing.T) {
	cfg := Config{
		DataDir:    t.TempDir(),
		BundledDir: t.TempDir(),
		Logger:     log.New("test"),
	}
	svc := NewMemoryServices(cfg, nil)
	_, err := svc.ToolchainRepo.Get(nil, "nonexistent-toolchain")
	if err == nil {
		t.Fatal("expected error for nonexistent toolchain")
	}
}

// =========================================================================
// Test diskProjectStore.Update
// =========================================================================

func TestDiskProjectStore_Update(t *testing.T) {
	dir := t.TempDir()
	store := newDiskProjectStore(dir)
	proj, err := store.Create("proj-1", &domain.Project{
		ID:          "proj-1",
		WorkspaceID: "ws-1",
		Name:        "original",
		RootPath:    dir,
	})
	if err != nil {
		t.Fatal(err)
	}
	proj.Name = "updated"
	updated, err := store.Update("proj-1", &proj)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != "updated" {
		t.Errorf("Name = %q, want updated", updated.Name)
	}
	got, err := store.Get("proj-1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "updated" {
		t.Errorf("Get after Update: Name = %q, want updated", got.Name)
	}
}

// =========================================================================
// Test serverMeta.toResponse edge cases
// =========================================================================

func TestServerMeta_toResponse_NoPorts(t *testing.T) {
	meta := &serverMeta{
		ID:          "srv_1",
		ProjectID:   "prj_1",
		Type:        "tomcat6",
		State:       "running",
		PID:         1234,
		ContextPath: "/app",
	}
	resp := meta.toResponse()
	if resp.URL != "" {
		t.Errorf("URL = %q, want empty when no ports", resp.URL)
	}
}

// =========================================================================
// Test realServerRunner.CatalinaHome
// =========================================================================

func TestRealServerRunner_CatalinaHome(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "/path/to/tomcat6", nil, 0, 0)
	home := r.CatalinaHome()
	if home != "/path/to/tomcat6" {
		t.Errorf("CatalinaHome = %q, want /path/to/tomcat6", home)
	}
}

// =========================================================================
// Test realServerRunner.Get/List/DeploymentTarget/Recoverable/Recover edge cases
// =========================================================================

func TestRealServerRunner_GetNotFound(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "", nil, 0, 0)
	_, err := r.Get("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent server")
	}
}

func TestRealServerRunner_ListEmpty(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "", nil, 0, 0)
	items := r.List()
	if len(items) != 0 {
		t.Errorf("List() = %d, want 0", len(items))
	}
}

func TestRealServerRunner_DeploymentTargetNotFound(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "", nil, 0, 0)
	_, err := r.DeploymentTarget("nonexistent-project")
	if err == nil {
		t.Fatal("expected error for nonexistent project")
	}
}

func TestRealServerRunner_StopNotFound(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "", nil, 0, 0)
	_, err := r.Stop("nonexistent", false)
	if err == nil {
		t.Fatal("expected error for nonexistent server")
	}
}

func TestRealServerRunner_RecoverableEmpty(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "", nil, 0, 0)
	items := r.Recoverable()
	if len(items) != 0 {
		t.Errorf("Recoverable() = %d, want 0", len(items))
	}
}

func TestRealServerRunner_RecoverNotFound(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "", nil, 0, 0)
	_, err := r.Recover("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent server recovery")
	}
}

func TestRealServerRunner_RecoverNotCrashed(t *testing.T) {
	dataDir := t.TempDir()
	seedServerMeta(t, dataDir, &serverMeta{
		ID:    "srv_1",
		State: "stopped",
	})
	r := newRealServerRunner(dataDir, "", "", nil, 0, 0)
	_, err := r.Recover("srv_1")
	if err == nil {
		t.Fatal("expected error for non-crashed server recovery")
	}
}

func TestRealServerRunner_DebugNotFound(t *testing.T) {
	r := newRealServerRunner(t.TempDir(), "", "", nil, 0, 0)
	_, err := r.Debug("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent server debug")
	}
}

func TestRealServerRunner_DebugMissingMetadata(t *testing.T) {
	dataDir := t.TempDir()
	seedServerMeta(t, dataDir, &serverMeta{
		ID:    "srv_1",
		State: "stopped",
	})
	r := newRealServerRunner(dataDir, "", "", nil, 0, 0)
	_, err := r.Debug("srv_1")
	if err == nil {
		t.Fatal("expected error for missing debug metadata")
	}
}

func TestRealServerRunner_DebugMissingPorts(t *testing.T) {
	dataDir := t.TempDir()
	seedServerMeta(t, dataDir, &serverMeta{
		ID:           "srv_1",
		State:        "stopped",
		JavaHome:     "/jdk",
		CatalinaBase: "/base",
	})
	r := newRealServerRunner(dataDir, "", "", nil, 0, 0)
	_, err := r.Debug("srv_1")
	if err == nil {
		t.Fatal("expected error for missing ports metadata")
	}
}

func TestRealServerRunner_RecoverMissingPorts(t *testing.T) {
	dataDir := t.TempDir()
	seedServerMeta(t, dataDir, &serverMeta{
		ID:           "srv_1",
		State:        "crashed",
		WasRunning:   true,
		JavaHome:     "/jdk",
		CatalinaBase: "/base",
	})
	r := newRealServerRunner(dataDir, "", "", nil, 0, 0)
	_, err := r.Recover("srv_1")
	if err == nil {
		t.Fatal("expected error for missing ports during recovery")
	}
}

func TestRealServerRunner_RecoverMissingMetadata(t *testing.T) {
	dataDir := t.TempDir()
	seedServerMeta(t, dataDir, &serverMeta{
		ID:    "srv_1",
		State: "crashed",
	})
	r := newRealServerRunner(dataDir, "", "", nil, 0, 0)
	_, err := r.Recover("srv_1")
	if err == nil {
		t.Fatal("expected error for missing recovery metadata")
	}
}

func TestRealServerRunner_RestartMissingMetadata(t *testing.T) {
	dataDir := t.TempDir()
	seedServerMeta(t, dataDir, &serverMeta{
		ID:    "srv_1",
		State: "stopped",
	})
	r := newRealServerRunner(dataDir, "", "", nil, 0, 0)
	_, err := r.Restart("srv_1")
	if err == nil {
		t.Fatal("expected error for missing restart metadata")
	}
}