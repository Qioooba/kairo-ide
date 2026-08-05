//go:build unwired

package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/repository"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

func TestPlanResolver_ResolveBuild_Success(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		SourceRoots: []string{"src"},
		OutputDir:   "build/classes",
		BuildTool:   domain.BuildToolJavac,
	}

	plan, err := r.ResolveBuild(context.Background(), project, domain.BuildIntentFull)
	if err != nil {
		t.Fatalf("ResolveBuild: %v", err)
	}
	if plan.ProjectRoot != root {
		t.Errorf("ProjectRoot = %q, want %q", plan.ProjectRoot, root)
	}
	if len(plan.SourceRoots) != 1 {
		t.Errorf("SourceRoots = %d, want 1", len(plan.SourceRoots))
	}
	expectedOutput := filepath.Join(root, "build/classes")
	if plan.OutputDir != expectedOutput {
		t.Errorf("OutputDir = %q, want %q", plan.OutputDir, expectedOutput)
	}
	if plan.BuildTool != "javac" {
		t.Errorf("BuildTool = %q, want javac", plan.BuildTool)
	}
}

func TestPlanResolver_ResolveBuild_NoSourceRoots(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		OutputDir:   "build/classes",
		BuildTool:   domain.BuildToolJavac,
	}

	plan, err := r.ResolveBuild(context.Background(), project, domain.BuildIntentFull)
	if err != nil {
		t.Fatalf("ResolveBuild: %v", err)
	}
	// Should load source roots from project.yaml
	if len(plan.SourceRoots) == 0 {
		t.Error("expected source roots from project config")
	}
}

func TestPlanResolver_ResolveBuild_Ant(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:           "p1",
		WorkspaceID:  "ws1",
		RootPath:     root,
		SourceRoots:  []string{"src"},
		OutputDir:    "build/classes",
		BuildTool:    domain.BuildToolAnt,
		BuildFile:    "build.xml",
		BuildTargets: []string{"compile", "test"},
	}

	plan, err := r.ResolveBuild(context.Background(), project, domain.BuildIntentFull)
	if err != nil {
		t.Fatalf("ResolveBuild: %v", err)
	}
	if plan.AntFile != "build.xml" {
		t.Errorf("AntFile = %q, want build.xml", plan.AntFile)
	}
	if plan.AntTarget != "compile" {
		t.Errorf("AntTarget = %q, want compile", plan.AntTarget)
	}
}

func TestPlanResolver_ResolveBuild_WithRoot(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		Root:        root,
		SourceRoots: []string{"src"},
	}

	plan, err := r.ResolveBuild(context.Background(), project, domain.BuildIntentFull)
	if err != nil {
		t.Fatalf("ResolveBuild: %v", err)
	}
	if plan.ProjectRoot != root {
		t.Errorf("ProjectRoot = %q, want %q", plan.ProjectRoot, root)
	}
}

func TestPlanResolver_ResolveBuild_CancelledContext(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    "/tmp/test",
	}

	_, err := r.ResolveBuild(ctx, project, domain.BuildIntentFull)
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestPlanResolver_ResolveDeploy_Success(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		WebappDir:   "webapp",
		OutputDir:   "build/classes",
		BuildTool:   domain.BuildToolJavac,
	}

	plan, err := r.ResolveDeploy(context.Background(), project, "b1")
	if err != nil {
		t.Fatalf("ResolveDeploy: %v", err)
	}
	if plan.ProjectRoot != root {
		t.Errorf("ProjectRoot = %q, want %q", plan.ProjectRoot, root)
	}
	expectedWebapp := filepath.Join(root, "webapp")
	if plan.WebappDir != expectedWebapp {
		t.Errorf("WebappDir = %q, want %q", plan.WebappDir, expectedWebapp)
	}
}

func TestPlanResolver_ResolveDeploy_Defaults(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		BuildTool:   domain.BuildToolJavac,
	}

	plan, err := r.ResolveDeploy(context.Background(), project, "b1")
	if err != nil {
		t.Fatalf("ResolveDeploy: %v", err)
	}
	// Default webappDir should be src/main/webapp
	expectedWebapp := filepath.Join(root, "src/main/webapp")
	if plan.WebappDir != expectedWebapp {
		t.Errorf("WebappDir = %q, want %q", plan.WebappDir, expectedWebapp)
	}
	// Default outputDir should be target/classes
	expectedOutput := filepath.Join(root, "target/classes")
	if plan.OutputDir != expectedOutput {
		t.Errorf("OutputDir = %q, want %q", plan.OutputDir, expectedOutput)
	}
	// Default resource roots should be src/main/resources
	if len(plan.ResourceRoots) == 0 {
		t.Error("expected default resource roots")
	}
	// Default lib dirs should be lib
	if len(plan.LibDirs) == 0 {
		t.Error("expected default lib dirs")
	}
}

func TestPlanResolver_ResolveDeploy_CancelledContext(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    "/tmp/test",
	}

	_, err := r.ResolveDeploy(ctx, project, "b1")
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestPlanResolver_ResolveRuntime_Success(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		WebappDir:   "webapp",
		ContextPath: "/myapp",
	}

	plan, err := r.ResolveRuntime(context.Background(), project)
	if err != nil {
		t.Fatalf("ResolveRuntime: %v", err)
	}
	if plan.ProjectRoot != root {
		t.Errorf("ProjectRoot = %q, want %q", plan.ProjectRoot, root)
	}
	expectedWebapp := filepath.Join(root, "webapp")
	if plan.WebappDir != expectedWebapp {
		t.Errorf("WebappDir = %q, want %q", plan.WebappDir, expectedWebapp)
	}
	if plan.ContextPath != "/myapp" {
		t.Errorf("ContextPath = %q, want /myapp", plan.ContextPath)
	}
}

func TestPlanResolver_ResolveRuntime_Defaults(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		BuildTool:   domain.BuildToolJavac,
	}

	plan, err := r.ResolveRuntime(context.Background(), project)
	if err != nil {
		t.Fatalf("ResolveRuntime: %v", err)
	}
	// Default context path should be /
	if plan.ContextPath != "/" {
		t.Errorf("ContextPath = %q, want /", plan.ContextPath)
	}
	// Default webapp dir should be src/main/webapp
	expectedWebapp := filepath.Join(root, "src/main/webapp")
	if plan.WebappDir != expectedWebapp {
		t.Errorf("WebappDir = %q, want %q", plan.WebappDir, expectedWebapp)
	}
}

func TestPlanResolver_ResolveRuntime_CancelledContext(t *testing.T) {
	r := NewPlanResolver(nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    "/tmp/test",
	}

	_, err := r.ResolveRuntime(ctx, project)
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestPlanResolver_ResolveBuild_NoConfigFile(t *testing.T) {
	// Create a temp dir without a .kairo/project.yaml
	root := t.TempDir()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		BuildTool:   domain.BuildToolJavac,
	}

	_, err := r.ResolveBuild(context.Background(), project, domain.BuildIntentFull)
	if err == nil {
		t.Fatal("expected error when no project config exists")
	}
}

func TestPlanResolver_ResolveDeploy_WithResourceRoots(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:            "p1",
		WorkspaceID:   "ws1",
		RootPath:      root,
		WebappDir:     "webapp",
		OutputDir:     "build/classes",
		ResourceRoots: []string{"resources", "conf"},
		LibraryDirs:   []string{"lib", "web/WEB-INF/lib"},
		BuildTool:     domain.BuildToolJavac,
	}

	plan, err := r.ResolveDeploy(context.Background(), project, "b1")
	if err != nil {
		t.Fatalf("ResolveDeploy: %v", err)
	}
	if len(plan.ResourceRoots) != 2 {
		t.Errorf("ResourceRoots = %d, want 2", len(plan.ResourceRoots))
	}
	if len(plan.LibDirs) != 2 {
		t.Errorf("LibDirs = %d, want 2", len(plan.LibDirs))
	}
}

func TestPlanResolver_ResolveBuild_LoadConfigError(t *testing.T) {
	// Create a project with empty source roots and a config file that fails to load
	root := t.TempDir()
	configDir := filepath.Join(root, ".kairo")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Write invalid YAML
	if err := os.WriteFile(filepath.Join(configDir, "project.yaml"), []byte("{invalid"), 0644); err != nil {
		t.Fatal(err)
	}

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		RootPath:    root,
		BuildTool:   domain.BuildToolJavac,
	}

	_, err := r.ResolveBuild(context.Background(), project, domain.BuildIntentFull)
	if err == nil {
		t.Fatal("expected error for invalid project config")
	}
}

func TestDefaultServerUseCaseConfig(t *testing.T) {
	cfg := DefaultServerUseCaseConfig()
	if cfg.StartTimeout == 0 {
		t.Error("StartTimeout should not be zero")
	}
	if cfg.StopTimeout == 0 {
		t.Error("StopTimeout should not be zero")
	}
	if cfg.ReadinessCheck == 0 {
		t.Error("ReadinessCheck should not be zero")
	}
}

func TestPlanResolver_ResolveDeploy_WithRoot(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		Root:        root,
	}

	plan, err := r.ResolveDeploy(context.Background(), project, "b1")
	if err != nil {
		t.Fatalf("ResolveDeploy: %v", err)
	}
	if plan.ProjectRoot != root {
		t.Errorf("ProjectRoot = %q, want %q", plan.ProjectRoot, root)
	}
}

func TestPlanResolver_ResolveRuntime_WithRoot(t *testing.T) {
	root, cleanup := setupTestProject(t)
	defer cleanup()

	r := NewPlanResolver(nil, nil)

	project := domain.Project{
		ID:          "p1",
		WorkspaceID: "ws1",
		Root:        root,
	}

	plan, err := r.ResolveRuntime(context.Background(), project)
	if err != nil {
		t.Fatalf("ResolveRuntime: %v", err)
	}
	if plan.ProjectRoot != root {
		t.Errorf("ProjectRoot = %q, want %q", plan.ProjectRoot, root)
	}
}

func TestPlanResolver_WithSandbox(t *testing.T) {
	dir := t.TempDir()
	sandbox, err := security.NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatal(err)
	}
	r := NewPlanResolver(sandbox, nil)
	if r == nil {
		t.Fatal("NewPlanResolver returned nil")
	}
	if r.sandbox != sandbox {
		t.Error("sandbox not set")
	}
}

// Ensure unused imports don't cause issues
var _ = repository.LoadProjectConfig