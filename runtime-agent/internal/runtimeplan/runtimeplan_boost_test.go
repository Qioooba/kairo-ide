package runtimeplan

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// ── FakeWorkspaceRepo: Save, Touch, Delete ───────────────────────

func TestFakeWorkspaceRepo_Save(t *testing.T) {
	repo := NewFakeWorkspaceRepo()
	ws := domain.Workspace{ID: "ws1", Name: "test", Root: "/tmp"}
	repo.Save(context.Background(), ws)
	got, err := repo.Get(context.Background(), "ws1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "test" {
		t.Errorf("Name = %q, want test", got.Name)
	}
	// Update existing
	ws.Name = "updated"
	repo.Save(context.Background(), ws)
	got, err = repo.Get(context.Background(), "ws1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "updated" {
		t.Errorf("Name = %q, want updated", got.Name)
	}
}

func TestFakeWorkspaceRepo_Touch(t *testing.T) {
	repo := NewFakeWorkspaceRepo()
	// Touch non-existent
	err := repo.Touch(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error for non-existent workspace")
	}
	// Add and touch
	repo.Add(domain.Workspace{ID: "ws1", Name: "test", Root: "/tmp"})
	err = repo.Touch(context.Background(), "ws1")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestFakeWorkspaceRepo_Delete(t *testing.T) {
	repo := NewFakeWorkspaceRepo()
	repo.Add(domain.Workspace{ID: "ws1", Name: "test", Root: "/tmp"})
	repo.Delete(context.Background(), "ws1")
	_, err := repo.Get(context.Background(), "ws1")
	if err == nil {
		t.Error("expected error after delete")
	}
	// Delete non-existent (should not panic)
	repo.Delete(context.Background(), "nonexistent")
}

// ── FakeProjectRepo: Save, Delete, FindByRoot ────────────────────

func TestFakeProjectRepo_Save(t *testing.T) {
	repo := NewFakeProjectRepo()
	p := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		Name:        "test",
		Root:        "myproject",
	}
	repo.Save(context.Background(), p)
	got, err := repo.Get(context.Background(), "ws1", "p1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "test" {
		t.Errorf("Name = %q, want test", got.Name)
	}
	// Update
	p.Name = "updated"
	repo.Save(context.Background(), p)
	got, err = repo.Get(context.Background(), "ws1", "p1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "updated" {
		t.Errorf("Name = %q, want updated", got.Name)
	}
}

func TestFakeProjectRepo_Delete(t *testing.T) {
	repo := NewFakeProjectRepo()
	repo.Add(domain.Project{ID: "p1", WorkspaceID: "ws1", Name: "test", Root: "/tmp"})
	repo.Delete(context.Background(), "ws1", "p1")
	_, err := repo.Get(context.Background(), "ws1", "p1")
	if err == nil {
		t.Error("expected error after delete")
	}
	// Delete non-existent (should not panic)
	repo.Delete(context.Background(), "ws1", "nonexistent")
	repo.Delete(context.Background(), "nonexistent", "p1")
}

func TestFakeProjectRepo_FindByRoot(t *testing.T) {
	repo := NewFakeProjectRepo()
	// FindByRoot with no workspace
	_, err := repo.FindByRoot(context.Background(), "ws1", "myproject")
	if err == nil {
		t.Error("expected error for non-existent workspace")
	}
	repo.Add(domain.Project{ID: "p1", WorkspaceID: "ws1", Name: "test", Root: "myproject"})
	// FindByRoot found
	got, err := repo.FindByRoot(context.Background(), "ws1", "myproject")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "p1" {
		t.Errorf("ID = %q, want p1", got.ID)
	}
	// FindByRoot not found
	_, err = repo.FindByRoot(context.Background(), "ws1", "other-root")
	if err == nil {
		t.Error("expected error for non-matching root")
	}
}

// ── FakeToolchainRepo: List, Save, FindByJavaHome ────────────────

func TestFakeToolchainRepo_List(t *testing.T) {
	repo := NewFakeToolchainRepo()
	// Empty list
	list, err := repo.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d", len(list))
	}
	repo.Add(domain.Toolchain{ID: "tc1", JavaHome: "/jdk1", Version: "1.6"})
	repo.Add(domain.Toolchain{ID: "tc2", JavaHome: "/jdk2", Version: "1.8"})
	list, err = repo.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 toolchains, got %d", len(list))
	}
}

func TestFakeToolchainRepo_Save(t *testing.T) {
	repo := NewFakeToolchainRepo()
	tc := domain.Toolchain{ID: "tc1", JavaHome: "/jdk1", Version: "1.6"}
	repo.Save(context.Background(), tc)
	got, err := repo.Get(context.Background(), "tc1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != "1.6" {
		t.Errorf("Version = %q, want 1.6", got.Version)
	}
	// Update
	tc.Version = "1.8"
	repo.Save(context.Background(), tc)
	got, err = repo.Get(context.Background(), "tc1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != "1.8" {
		t.Errorf("Version = %q, want 1.8", got.Version)
	}
}

func TestFakeToolchainRepo_FindByJavaHome(t *testing.T) {
	repo := NewFakeToolchainRepo()
	// Not found
	_, err := repo.FindByJavaHome(context.Background(), "/jdk1")
	if err == nil {
		t.Error("expected error for non-existent java home")
	}
	repo.Add(domain.Toolchain{ID: "tc1", JavaHome: "/jdk1", Version: "1.6"})
	repo.Add(domain.Toolchain{ID: "tc2", JavaHome: "/jdk2", Version: "1.8"})
	// Found
	got, err := repo.FindByJavaHome(context.Background(), "/jdk2")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "tc2" {
		t.Errorf("ID = %q, want tc2", got.ID)
	}
}

// ── FakeRuntimeRegistry: List ────────────────────────────────────

func TestFakeRuntimeRegistry_List(t *testing.T) {
	reg := NewFakeRuntimeRegistry()
	list, err := reg.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d", len(list))
	}
	reg.Add(RuntimeInstallation{ID: "tomcat6", Version: "6.0.53", Provider: "tomcat6"})
	reg.Add(RuntimeInstallation{ID: "tomcat9", Version: "9.0.80", Provider: "tomcat9"})
	list, err = reg.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 runtimes, got %d", len(list))
	}
}

// ── FakePortAllocator: Leased ────────────────────────────────────

func TestFakePortAllocator_Leased(t *testing.T) {
	pa := NewFakePortAllocator()
	// Empty initially
	if leased := pa.Leased(); len(leased) != 0 {
		t.Errorf("expected 0 leases, got %d", len(leased))
	}
	lease, err := pa.Allocate(19090, 19091, 19092)
	if err != nil {
		t.Fatal(err)
	}
	leased := pa.Leased()
	if len(leased) != 1 {
		t.Errorf("expected 1 lease, got %d", len(leased))
	}
	// Release and verify
	lease.Release()
	leased = pa.Leased()
	if len(leased) != 0 {
		t.Errorf("expected 0 leases after release, got %d", len(leased))
	}
}

// ── DefaultPortAllocator: AllocateServer with debug ──────────────

func TestAllocateServer_WithDebug(t *testing.T) {
	cfg := PortConfig{
		HTTPMin:     18080,
		HTTPMax:     18089,
		ShutdownMin: 18005,
		ShutdownMax: 18009,
		DebugMin:    18000,
		DebugMax:    18004,
	}
	pa := NewDefaultPortAllocator(cfg)
	lease, err := pa.AllocateServer(0, 0, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Release()
	if lease.DebugPort == 0 {
		t.Error("DebugPort should be non-zero when withDebug=true")
	}
	if lease.DebugPort < cfg.DebugMin || lease.DebugPort > cfg.DebugMax {
		t.Errorf("DebugPort %d out of range", lease.DebugPort)
	}
	// Verify all ports are distinct
	ports := map[int]bool{lease.HTTPPort: true, lease.ShutdownPort: true, lease.DebugPort: true}
	if len(ports) != 3 {
		t.Errorf("ports should be distinct, got %v", ports)
	}
}

func TestAllocateServer_DebugAllocationFailure(t *testing.T) {
	// Use a tiny debug range that will be exhausted quickly
	cfg := PortConfig{
		HTTPMin:     18080,
		HTTPMax:     18089,
		ShutdownMin: 18005,
		ShutdownMax: 18009,
		DebugMin:    18000,
		DebugMax:    18000, // only 1 port
	}
	pa := NewDefaultPortAllocator(cfg)
	// Allocate the only debug port
	lease1, err := pa.AllocateServer(0, 0, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	defer lease1.Release()
	// Try to allocate another debug port - should fail
	_, err = pa.AllocateServer(0, 0, 0, true)
	if err == nil {
		t.Error("expected error when debug ports exhausted")
	}
}

// ── allocateOne: preferred port not available, exhausted ─────────

func TestAllocateOne_PreferredPortInUse(t *testing.T) {
	cfg := PortConfig{
		HTTPMin:     18080,
		HTTPMax:     18089,
		ShutdownMin: 18005,
		ShutdownMax: 18009,
		DebugMin:    18000,
		DebugMax:    18004,
	}
	pa := NewDefaultPortAllocator(cfg)
	// First, grab the preferred port
	lease1, err := pa.Allocate(18080, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease1.Release()
	// Now try to allocate with the same preferred port - should get a different one
	lease2, err := pa.Allocate(18080, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease2.Release()
	if lease2.HTTPPort == 18080 {
		t.Error("should not get the same preferred port when it's in use")
	}
}

func TestAllocateOne_Exhausted(t *testing.T) {
	// Test exhaustion by allocating the only available port, then trying again.
	// Use AllocateServer with withDebug=false to isolate HTTP port exhaustion.
	cfg := PortConfig{
		HTTPMin:     58080,
		HTTPMax:     58081, // 2 ports
		ShutdownMin: 58005,
		ShutdownMax: 58006,
		DebugMin:    58000,
		DebugMax:    58001,
	}
	pa := NewDefaultPortAllocator(cfg)
	// Allocate both HTTP ports
	lease1, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease1.Release()
	lease2, err := pa.Allocate(0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease2.Release()
	// Third allocation should fail
	_, err = pa.Allocate(0, 0, 0)
	if err == nil {
		t.Error("expected error when all ports exhausted")
	}
}

// ── portAvailable: false case ────────────────────────────────────

func TestPortAvailable_False(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port
	if portAvailable(port) {
		t.Error("portAvailable should return false when port is in use")
	}
}

// ── ResolveRuntime with webappDir ────────────────────────────────

func TestResolveRuntime_WithWebappDir(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	plan, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), nil)
	if err != nil {
		t.Fatal(err)
	}
	// The project has WebappDir = "src/main/webapp"
	if plan.WebappDir == "" {
		t.Error("WebappDir should not be empty")
	}
}

// ── ResolveRuntime with existing server ID (generation=0) ────────

func TestResolveRuntime_ExistingServerID_GenerationZero(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	existingID := domain.ServerID("srv_eeeeeeeeeeeeeeeeeeeeeeeeee")
	plan, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), &existingID)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Generation != 0 {
		t.Errorf("Generation = %d, want 0 for existing server", plan.Generation)
	}
}

// ── FakeProjectRepo: List with missing workspace ─────────────────

func TestFakeProjectRepo_List_Empty(t *testing.T) {
	repo := NewFakeProjectRepo()
	list, err := repo.List(context.Background(), "nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if list != nil {
		t.Errorf("expected nil for missing workspace, got %v", list)
	}
}

func TestFakeProjectRepo_List_WithProjects(t *testing.T) {
	repo := NewFakeProjectRepo()
	repo.Add(domain.Project{ID: "p1", WorkspaceID: "ws1", Name: "proj1", Root: "/tmp"})
	repo.Add(domain.Project{ID: "p2", WorkspaceID: "ws1", Name: "proj2", Root: "/tmp"})
	list, err := repo.List(context.Background(), "ws1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 projects, got %d", len(list))
	}
}

// ── FakeProjectRepo: Get with missing workspace ──────────────────

func TestFakeProjectRepo_Get_MissingWorkspace(t *testing.T) {
	repo := NewFakeProjectRepo()
	_, err := repo.Get(context.Background(), "nonexistent", "p1")
	if err == nil {
		t.Error("expected error for missing workspace")
	}
}

// ── FakeToolchainRepo: Get missing ───────────────────────────────

func TestFakeToolchainRepo_Get_Missing(t *testing.T) {
	repo := NewFakeToolchainRepo()
	_, err := repo.Get(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error for missing toolchain")
	}
}

// ── FakeRuntimeRegistry: Get missing ─────────────────────────────

func TestFakeRuntimeRegistry_Get_Missing(t *testing.T) {
	reg := NewFakeRuntimeRegistry()
	_, err := reg.Get(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error for missing runtime")
	}
}

// ── ResolveDeploymentTarget: relIsUnder edge cases ───────────────

func TestResolveDeploymentTarget_RelIsUnderEdge(t *testing.T) {
	sep := string(filepath.Separator)
	tests := []struct {
		rel  string
		want bool
	}{
		{"..", false},
		{".." + sep + "foo", false},
		{".." + sep + ".." + sep + "bar", false},
		{"foo", true},
		{"foo" + sep + ".." + sep + "bar", true},
		{".", true},
	}
	for _, tc := range tests {
		t.Run(tc.rel, func(t *testing.T) {
			if got := relIsUnder(tc.rel); got != tc.want {
				t.Errorf("relIsUnder(%q) = %v, want %v", tc.rel, got, tc.want)
			}
		})
	}
}

// ── canonicalExistingDir: existing directory ─────────────────────

func TestCanonicalExistingDir_Directory(t *testing.T) {
	dir := t.TempDir()
	got, err := canonicalExistingDir(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == "" {
		t.Fatal("expected non-empty canonical path")
	}
}

// ── ResolveRuntime: missing catalina home stat error ─────────────

func TestResolveRuntime_CatalinaHomeStatError(t *testing.T) {
	env := setupTestEnv(t)
	idGen := NewFakeIDGenerator()
	badProjID, _ := idGen.NewProjectID()
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(badProjID),
		WorkspaceID: env.wsID(),
		Name:        "bad-cat-home",
		Root:        "myproject",
		ContextPath: "app",
		RuntimeID:   "tomcat6-bad-home",
	})
	env.rtRepo.Add(RuntimeInstallation{
		ID:           "tomcat6-bad-home",
		CatalinaHome: "/nonexistent/catalina/home",
		Version:      "6.0.53",
		Provider:     "tomcat6",
	})
	resolver, _ := env.newResolver(t)
	_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), domain.ProjectID(badProjID), nil)
	if err == nil {
		t.Fatal("expected error for non-existent catalina home")
	}
}

// ── ResolveRuntime: JavaHome stat error ──────────────────────────

func TestResolveRuntime_JavaHomeStatError(t *testing.T) {
	env := setupTestEnv(t)
	idGen := NewFakeIDGenerator()
	badProjID, _ := idGen.NewProjectID()
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(badProjID),
		WorkspaceID: env.wsID(),
		Name:        "bad-java-home",
		Root:        "myproject",
		ContextPath: "app",
		ToolchainID: "tc-bad",
		RuntimeID:   "tomcat6",
	})
	env.tcRepo.Add(domain.Toolchain{
		ID:       "tc-bad",
		JavaHome: "/nonexistent/java/home",
		Version:  "1.6",
	})
	resolver, _ := env.newResolver(t)
	_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), domain.ProjectID(badProjID), nil)
	if err == nil {
		t.Fatal("expected error for non-existent java home")
	}
}

// ── ResolveRuntime: webappDir resolution error ───────────────────

func TestResolveRuntime_WebappDirEscape(t *testing.T) {
	env := setupTestEnv(t)
	idGen := NewFakeIDGenerator()
	badProjID, _ := idGen.NewProjectID()
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(badProjID),
		WorkspaceID: env.wsID(),
		Name:        "bad-webapp",
		Root:        "myproject",
		WebappDir:   "../../../etc",
		ContextPath: "app",
		RuntimeID:   "tomcat6",
	})
	resolver, _ := env.newResolver(t)
	_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), domain.ProjectID(badProjID), nil)
	if err == nil {
		t.Fatal("expected error for webapp dir escaping project root")
	}
}

// ── ResolveRuntime: ID generation error ──────────────────────────

type failingIDGenerator struct{}

func (f *failingIDGenerator) NewServerID() (string, error) {
	return "", fmt.Errorf("id generation failed")
}

func TestResolveRuntime_IDGenError(t *testing.T) {
	env := setupTestEnv(t)
	dataRoot := filepath.Join(env.tmpDir, "data")
	resolver, err := NewDefaultRuntimePlanResolver(ResolverConfig{
		DataRoot:   dataRoot,
		Workspaces: env.wsRepo,
		Projects:   env.projRepo,
		Toolchains: env.tcRepo,
		Runtimes:   env.rtRepo,
		PathPolicy: env.pp,
		IDGen:      &failingIDGenerator{},
		CBPlanner:  env.cbPlan,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), nil)
	if err == nil {
		t.Fatal("expected error from failing ID generator")
	}
}

// ── ResolveRuntime: no toolchain, no webapp dir ──────────────────

func TestResolveRuntime_NoToolchainNoWebappDir(t *testing.T) {
	env := setupTestEnv(t)
	idGen := NewFakeIDGenerator()
	noTcID, _ := idGen.NewProjectID()
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(noTcID),
		WorkspaceID: env.wsID(),
		Name:        "no-tc-no-webapp",
		Root:        "myproject",
		ContextPath: "app",
		ToolchainID: "",
		RuntimeID:   "tomcat6",
		WebappDir:   "", // no webapp dir
	})
	t.Setenv("JAVA_HOME", "")
	t.Setenv("KAIRO_JDK_HOME", "")
	t.Setenv("KAIRO_JDT_LS_JRE", "")
	t.Setenv("KAIRO_BUNDLED_DIR", env.tmpDir)
	bundledJDK := filepath.Join(env.tmpDir, "jdk17", "bin")
	if err := os.MkdirAll(bundledJDK, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(bundledJDK, "java"),
		[]byte("#!/bin/sh\necho 'openjdk version \"17.0.9\" 2023-10-17' >&2\nexit 0\n"),
		0o755,
	); err != nil {
		t.Fatal(err)
	}
	resolver, _ := env.newResolver(t)
	plan, err := resolver.ResolveRuntime(context.Background(), env.wsID(), domain.ProjectID(noTcID), nil)
	if err != nil {
		t.Fatalf("ResolveRuntime: %v", err)
	}
	if plan.JavaHome == "" {
		t.Error("JavaHome should be resolved from bundled JDK when no toolchain is configured")
	}
	if plan.WebappDir != "" {
		t.Errorf("WebappDir should be empty, got %q", plan.WebappDir)
	}
}

// ── ResolveRuntime: missing workspace ────────────────────────────

func TestResolveRuntime_WorkspaceNotFound(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)
	_, err := resolver.ResolveRuntime(context.Background(), domain.WorkspaceID("ws_nonexistent_xxxxxxxxxxxx"), env.projID(), nil)
	if err == nil {
		t.Fatal("expected error for non-existent workspace")
	}
}

// ── DefaultPortAllocator: preferred port with exclude ────────────

func TestAllocateOne_PreferredPortExcluded(t *testing.T) {
	// Use a non-overlapping range to test preferred port exclusion
	cfg := PortConfig{
		HTTPMin:     18080,
		HTTPMax:     18089,
		ShutdownMin: 18005,
		ShutdownMax: 18009,
		DebugMin:    18000,
		DebugMax:    18004,
	}
	pa := NewDefaultPortAllocator(cfg)
	// Allocate with preferred=18080, but exclude 18080 by occupying it first
	lease1, _ := pa.Allocate(18080, 0, 0)
	defer lease1.Release()
	// Now ask for preferred=18080 again - should get a different port
	lease2, err := pa.Allocate(18080, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lease2.Release()
	if lease2.HTTPPort == 18080 {
		t.Error("should not get preferred port when it's in use")
	}
}

// ── ResolveRuntime: workspace root canonicalization failure ──────

func TestResolveRuntime_WorkspaceRootCanonicalizationError(t *testing.T) {
	env := setupTestEnv(t)
	// Add a workspace with a root that doesn't exist
	idGen := NewFakeIDGenerator()
	wsID, _ := idGen.NewWorkspaceID()
	projID, _ := idGen.NewProjectID()
	env.wsRepo.Add(domain.Workspace{
		ID:   domain.WorkspaceID(wsID),
		Name: "bad-root-ws",
		Root: "/nonexistent/workspace/root",
	})
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(projID),
		WorkspaceID: domain.WorkspaceID(wsID),
		Name:        "bad-root-proj",
		Root:        "myproject",
		ContextPath: "app",
		RuntimeID:   "tomcat6",
	})
	resolver, _ := env.newResolver(t)
	_, err := resolver.ResolveRuntime(context.Background(), domain.WorkspaceID(wsID), domain.ProjectID(projID), nil)
	if err == nil {
		t.Fatal("expected error for non-existent workspace root")
	}
}

// ── ResolveDeploymentTarget: existing server ID generation ───────

func TestResolveRuntime_ExistingServerID_NoGeneration(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	// First resolve to get a server ID
	plan1, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), nil)
	if err != nil {
		t.Fatal(err)
	}
	// Now resolve with the existing server ID
	plan2, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), &plan1.ServerID)
	if err != nil {
		t.Fatal(err)
	}
	if plan2.Generation != 0 {
		t.Errorf("Generation = %d, want 0 for existing server", plan2.Generation)
	}
	if plan2.ServerID != plan1.ServerID {
		t.Errorf("ServerID changed: %q vs %q", plan2.ServerID, plan1.ServerID)
	}
}

// ── FakeWorkspaceRepo: List ──────────────────────────────────────

func TestFakeWorkspaceRepo_List(t *testing.T) {
	repo := NewFakeWorkspaceRepo()
	list, err := repo.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d", len(list))
	}
	repo.Add(domain.Workspace{ID: "ws1", Name: "ws1", Root: "/tmp"})
	repo.Add(domain.Workspace{ID: "ws2", Name: "ws2", Root: "/tmp"})
	list, err = repo.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 workspaces, got %d", len(list))
	}
}

// ── FakeWorkspaceRepo: Get missing ───────────────────────────────

func TestFakeWorkspaceRepo_Get_Missing(t *testing.T) {
	repo := NewFakeWorkspaceRepo()
	_, err := repo.Get(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error for missing workspace")
	}
}

// ── NewDefaultRuntimePlanResolver: existing error path ───────────

func TestNewDefaultRuntimePlanResolver_AllErrors(t *testing.T) {
	tests := []struct {
		name string
		cfg  ResolverConfig
	}{
		{"empty data root", ResolverConfig{}},
		{"missing workspaces", ResolverConfig{DataRoot: "/tmp", Projects: &FakeProjectRepo{}, Toolchains: &FakeToolchainRepo{}, Runtimes: &FakeRuntimeRegistry{}, PathPolicy: &fakePathPolicy{}, IDGen: &FakeIDGenerator{}}},
		{"missing projects", ResolverConfig{DataRoot: "/tmp", Workspaces: &FakeWorkspaceRepo{}, Toolchains: &FakeToolchainRepo{}, Runtimes: &FakeRuntimeRegistry{}, PathPolicy: &fakePathPolicy{}, IDGen: &FakeIDGenerator{}}},
		{"missing toolchains", ResolverConfig{DataRoot: "/tmp", Workspaces: &FakeWorkspaceRepo{}, Projects: &FakeProjectRepo{}, Runtimes: &FakeRuntimeRegistry{}, PathPolicy: &fakePathPolicy{}, IDGen: &FakeIDGenerator{}}},
		{"missing runtimes", ResolverConfig{DataRoot: "/tmp", Workspaces: &FakeWorkspaceRepo{}, Projects: &FakeProjectRepo{}, Toolchains: &FakeToolchainRepo{}, PathPolicy: &fakePathPolicy{}, IDGen: &FakeIDGenerator{}}},
		{"missing path policy", ResolverConfig{DataRoot: "/tmp", Workspaces: &FakeWorkspaceRepo{}, Projects: &FakeProjectRepo{}, Toolchains: &FakeToolchainRepo{}, Runtimes: &FakeRuntimeRegistry{}, IDGen: &FakeIDGenerator{}}},
		{"missing id gen", ResolverConfig{DataRoot: "/tmp", Workspaces: &FakeWorkspaceRepo{}, Projects: &FakeProjectRepo{}, Toolchains: &FakeToolchainRepo{}, Runtimes: &FakeRuntimeRegistry{}, PathPolicy: &fakePathPolicy{}}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewDefaultRuntimePlanResolver(tc.cfg)
			if err == nil {
				t.Error("expected error")
			}
		})
	}
}

// fakePathPolicy is a minimal pathpolicy.PathAuthorizer for testing
type fakePathPolicy struct{}

func (p *fakePathPolicy) ValidateRelativeConfigPath(value string, allowEmpty bool) error {
	return nil
}

func (p *fakePathPolicy) ResolveWithin(base, child string) (string, error) {
	return filepath.Join(base, child), nil
}

func (p *fakePathPolicy) ResolveWithinNoFollow(root, relative string) (string, error) {
	return filepath.Join(root, relative), nil
}