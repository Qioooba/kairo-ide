package runtimeplan

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/catalinabase"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

type testEnv struct {
	tmpDir       string
	wsRoot       string
	projectRoot  string
	catalinaHome string
	javaHome     string
	webappDir    string
	outputDir    string

	wsRepo   *FakeWorkspaceRepo
	projRepo *FakeProjectRepo
	tcRepo   *FakeToolchainRepo
	rtRepo   *FakeRuntimeRegistry
	idGen    *FakeIDGenerator
	pp       pathpolicy.PathAuthorizer
	cbPlan   catalinabase.Planner
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	tmpDir := t.TempDir()

	wsRoot := filepath.Join(tmpDir, "workspace")
	projectRoot := filepath.Join(wsRoot, "myproject")
	webappDir := filepath.Join(projectRoot, "src", "main", "webapp")
	outputDir := filepath.Join(projectRoot, "build", "classes")
	catalinaHome := filepath.Join(tmpDir, "catalina-home")
	javaHome := filepath.Join(tmpDir, "jdk")

	for _, dir := range []string{
		wsRoot, projectRoot, webappDir, outputDir,
		catalinaHome,
		filepath.Join(catalinaHome, "conf"),
		javaHome,
		filepath.Join(javaHome, "bin"),
		filepath.Join(tmpDir, "data"),
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}

	confFile := filepath.Join(catalinaHome, "conf", "server.xml")
	if err := os.WriteFile(confFile, []byte("<Server/>"), 0644); err != nil {
		t.Fatal(err)
	}
	javaExe := filepath.Join(javaHome, "bin", "java")
	if err := os.WriteFile(javaExe, []byte("#!/bin/sh"), 0755); err != nil {
		t.Fatal(err)
	}

	idGen := NewFakeIDGenerator()

	wsID, _ := idGen.NewWorkspaceID()
	projID, _ := idGen.NewProjectID()

	env := &testEnv{
		tmpDir:       tmpDir,
		wsRoot:       wsRoot,
		projectRoot:  projectRoot,
		catalinaHome: catalinaHome,
		javaHome:     javaHome,
		webappDir:    webappDir,
		outputDir:    outputDir,
		wsRepo:       NewFakeWorkspaceRepo(),
		projRepo:     NewFakeProjectRepo(),
		tcRepo:       NewFakeToolchainRepo(),
		rtRepo:       NewFakeRuntimeRegistry(),
		idGen:        idGen,
		pp:           pathpolicy.NewDefaultPathPolicy(),
		cbPlan:       catalinabase.NewDefaultPlanner(),
	}

	env.wsRepo.Add(domain.Workspace{
		ID:   domain.WorkspaceID(wsID),
		Name: "test-ws",
		Root: wsRoot,
	})

	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(projID),
		WorkspaceID: domain.WorkspaceID(wsID),
		Name:        "test-project",
		Root:        "myproject",
		WebappDir:   "src/main/webapp",
		OutputDir:   "build/classes",
		ContextPath: "myapp",
		ToolchainID: "tc-test",
		RuntimeID:   "tomcat6",
	})

	env.tcRepo.Add(domain.Toolchain{
		ID:       "tc-test",
		JavaHome: javaHome,
		Version:  "1.6",
	})

	env.rtRepo.Add(RuntimeInstallation{
		ID:           "tomcat6",
		CatalinaHome: catalinaHome,
		Version:      "6.0.53",
		Provider:     "tomcat6",
	})

	return env
}

func (env *testEnv) newResolver(t *testing.T) (*DefaultRuntimePlanResolver, string) {
	t.Helper()
	dataRoot := filepath.Join(env.tmpDir, "data")
	resolver, err := NewDefaultRuntimePlanResolver(ResolverConfig{
		DataRoot:   dataRoot,
		Workspaces: env.wsRepo,
		Projects:   env.projRepo,
		Toolchains: env.tcRepo,
		Runtimes:   env.rtRepo,
		PathPolicy: env.pp,
		IDGen:      env.idGen,
		CBPlanner:  env.cbPlan,
	})
	if err != nil {
		t.Fatalf("NewDefaultRuntimePlanResolver: %v", err)
	}
	return resolver, dataRoot
}

func (env *testEnv) wsID() domain.WorkspaceID {
	if wss, _ := env.wsRepo.List(context.Background()); len(wss) > 0 {
		return wss[0].ID
	}
	return ""
}

func (env *testEnv) projID() domain.ProjectID {
	ws := env.wsID()
	if projs, _ := env.projRepo.List(context.Background(), ws); len(projs) > 0 {
		return projs[0].ID
	}
	return ""
}

func TestResolveRuntime_Success(t *testing.T) {
	env := setupTestEnv(t)
	resolver, dataRoot := env.newResolver(t)

	plan, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), nil)
	if err != nil {
		t.Fatalf("ResolveRuntime: %v", err)
	}

	if plan.WorkspaceID != env.wsID() {
		t.Errorf("WorkspaceID = %q, want %q", plan.WorkspaceID, env.wsID())
	}
	if plan.ProjectID != env.projID() {
		t.Errorf("ProjectID = %q, want %q", plan.ProjectID, env.projID())
	}
	if string(plan.ServerID) == "" {
		t.Error("ServerID should not be empty")
	}
	if plan.RuntimeID != "tomcat6" {
		t.Errorf("RuntimeID = %q, want tomcat6", plan.RuntimeID)
	}
	if plan.JavaHome != env.javaHome {
		t.Errorf("JavaHome = %q, want %q", plan.JavaHome, env.javaHome)
	}
	if plan.CatalinaHome != env.catalinaHome {
		t.Errorf("CatalinaHome = %q, want %q", plan.CatalinaHome, env.catalinaHome)
	}
	expectedBase := filepath.Join(dataRoot, "runtime", "servers", string(plan.ServerID))
	if plan.CatalinaBase != expectedBase {
		t.Errorf("CatalinaBase = %q, want %q", plan.CatalinaBase, expectedBase)
	}
	if plan.ContextPath != "/myapp" {
		t.Errorf("ContextPath = %q, want /myapp", plan.ContextPath)
	}
	expectedDeploy := filepath.Join(expectedBase, "webapps", "myapp")
	if plan.DeploymentRoot != expectedDeploy {
		t.Errorf("DeploymentRoot = %q, want %q", plan.DeploymentRoot, expectedDeploy)
	}
	if plan.Generation != 1 {
		t.Errorf("Generation = %d, want 1", plan.Generation)
	}
}

func TestResolveRuntime_ExistingServerID(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	existingID := domain.ServerID("srv_eeeeeeeeeeeeeeeeeeeeeeeeee")
	plan, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), &existingID)
	if err != nil {
		t.Fatalf("ResolveRuntime: %v", err)
	}

	if plan.ServerID != existingID {
		t.Errorf("ServerID = %q, want %q", plan.ServerID, existingID)
	}
}

func TestResolveRuntime_WrongWorkspace(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	wrongWS := domain.WorkspaceID("ws_xxxxxxxxxxxxxxxxxxxxxxxxxx")
	_, err := resolver.ResolveRuntime(context.Background(), wrongWS, env.projID(), nil)
	if err == nil {
		t.Fatal("expected error for wrong workspace")
	}
}

func TestResolveRuntime_MissingToolchain(t *testing.T) {
	env := setupTestEnv(t)
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID("prj_badtc"),
		WorkspaceID: env.wsID(),
		Name:        "bad-tc",
		Root:        "myproject",
		ContextPath: "app",
		ToolchainID: "nonexistent",
		RuntimeID:   "tomcat6",
	})

	resolver, _ := env.newResolver(t)

	_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), "prj_badtc", nil)
	if err == nil {
		t.Fatal("expected error for missing toolchain")
	}
}

func TestResolveRuntime_MissingRuntime(t *testing.T) {
	env := setupTestEnv(t)
	idGen := NewFakeIDGenerator()
	badProjID, _ := idGen.NewProjectID()
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(badProjID),
		WorkspaceID: env.wsID(),
		Name:        "bad-rt",
		Root:        "myproject",
		ContextPath: "app",
		RuntimeID:   "nonexistent",
	})

	resolver, _ := env.newResolver(t)

	_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), domain.ProjectID(badProjID), nil)
	if err == nil {
		t.Fatal("expected error for missing runtime")
	}
}

func TestResolveRuntime_ProjectRootMoved(t *testing.T) {
	env := setupTestEnv(t)
	idGen := NewFakeIDGenerator()
	badProjID, _ := idGen.NewProjectID()
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(badProjID),
		WorkspaceID: env.wsID(),
		Name:        "moved",
		Root:        "nonexistent",
		ContextPath: "app",
		RuntimeID:   "tomcat6",
	})

	resolver, _ := env.newResolver(t)

	_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), domain.ProjectID(badProjID), nil)
	if err == nil {
		t.Fatal("expected error for moved project root")
	}
}

func TestResolveRuntime_InvalidContextPath(t *testing.T) {
	env := setupTestEnv(t)
	idGen := NewFakeIDGenerator()
	badProjID, _ := idGen.NewProjectID()
	env.projRepo.Add(domain.Project{
		ID:          domain.ProjectID(badProjID),
		WorkspaceID: env.wsID(),
		Name:        "bad-ctx",
		Root:        "myproject",
		ContextPath: "../escape",
		RuntimeID:   "tomcat6",
	})

	resolver, _ := env.newResolver(t)

	_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), domain.ProjectID(badProjID), nil)
	if err == nil {
		t.Fatal("expected error for invalid context path")
	}
}

func TestResolveDeploymentTarget(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	plan, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), nil)
	if err != nil {
		t.Fatal(err)
	}

	target, err := resolver.ResolveDeploymentTarget(plan)
	if err != nil {
		t.Fatalf("ResolveDeploymentTarget: %v", err)
	}

	if !target.OwnerToken.Valid() {
		t.Error("OwnerToken should be valid")
	}
	if target.WorkspaceID != plan.WorkspaceID {
		t.Error("WorkspaceID mismatch")
	}
	if target.ProjectID != plan.ProjectID {
		t.Error("ProjectID mismatch")
	}
	if target.ServerID != plan.ServerID {
		t.Error("ServerID mismatch")
	}
	if target.Root != plan.DeploymentRoot {
		t.Errorf("Root = %q, want %q", target.Root, plan.DeploymentRoot)
	}
}

func TestResolveDeploymentTarget_WrongRoot(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	plan, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), nil)
	if err != nil {
		t.Fatal(err)
	}

	badPlan := *plan
	badPlan.DeploymentRoot = "/tmp/outside"
	_, err = resolver.ResolveDeploymentTarget(&badPlan)
	if err == nil {
		t.Error("expected error for deployment root outside catalina base")
	}
}

func TestConcurrentResolve(t *testing.T) {
	env := setupTestEnv(t)
	resolver, _ := env.newResolver(t)

	var wg sync.WaitGroup
	errs := make(chan error, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := resolver.ResolveRuntime(context.Background(), env.wsID(), env.projID(), nil)
			if err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent resolve error: %v", err)
	}
}

func TestConfigValidation(t *testing.T) {
	env := setupTestEnv(t)
	_, err := NewDefaultRuntimePlanResolver(ResolverConfig{
		DataRoot:   "",
		Workspaces: env.wsRepo,
		Projects:   env.projRepo,
		Toolchains: env.tcRepo,
		Runtimes:   env.rtRepo,
		PathPolicy: env.pp,
		IDGen:      env.idGen,
	})
	if err == nil {
		t.Error("expected error for empty data root")
	}
}
