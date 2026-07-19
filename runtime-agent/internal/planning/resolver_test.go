package planning

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

type fakeWorkspaceRepo struct {
	workspaces map[domain.WorkspaceID]domain.Workspace
}

func (f *fakeWorkspaceRepo) Get(ctx context.Context, id domain.WorkspaceID) (*domain.Workspace, error) {
	if ws, ok := f.workspaces[id]; ok {
		return &ws, nil
	}
	return nil, domain.ErrWorkspaceNotFound
}

func (f *fakeWorkspaceRepo) List(ctx context.Context) ([]domain.Workspace, error) {
	var res []domain.Workspace
	for _, ws := range f.workspaces {
		res = append(res, ws)
	}
	return res, nil
}

func (f *fakeWorkspaceRepo) Save(ctx context.Context, ws domain.Workspace) error {
	f.workspaces[ws.ID] = ws
	return nil
}

func (f *fakeWorkspaceRepo) Touch(ctx context.Context, id domain.WorkspaceID) error {
	return nil
}

func (f *fakeWorkspaceRepo) Delete(ctx context.Context, id domain.WorkspaceID) error {
	delete(f.workspaces, id)
	return nil
}

type fakeProjectRepo struct {
	projects map[domain.WorkspaceID]map[domain.ProjectID]domain.Project
}

func (f *fakeProjectRepo) Get(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID) (*domain.Project, error) {
	if projs, ok := f.projects[wsID]; ok {
		if p, ok := projs[pID]; ok {
			return &p, nil
		}
	}
	return nil, domain.ErrProjectNotFound
}

func (f *fakeProjectRepo) List(ctx context.Context, wsID domain.WorkspaceID) ([]domain.Project, error) {
	var res []domain.Project
	if projs, ok := f.projects[wsID]; ok {
		for _, p := range projs {
			res = append(res, p)
		}
	}
	return res, nil
}

func (f *fakeProjectRepo) Save(ctx context.Context, p domain.Project) error {
	if f.projects[p.WorkspaceID] == nil {
		f.projects[p.WorkspaceID] = make(map[domain.ProjectID]domain.Project)
	}
	f.projects[p.WorkspaceID][p.ID] = p
	return nil
}

func (f *fakeProjectRepo) Delete(ctx context.Context, wsID domain.WorkspaceID, pID domain.ProjectID) error {
	if projs, ok := f.projects[wsID]; ok {
		delete(projs, pID)
	}
	return nil
}

func (f *fakeProjectRepo) FindByRoot(ctx context.Context, wsID domain.WorkspaceID, root string) (*domain.Project, error) {
	return nil, domain.ErrProjectNotFound
}

type fakeToolchainRepo struct {
	toolchains map[string]domain.Toolchain
}

func (f *fakeToolchainRepo) Get(ctx context.Context, id string) (*domain.Toolchain, error) {
	if tc, ok := f.toolchains[id]; ok {
		return &tc, nil
	}
	return nil, domain.ErrToolchainNotFound
}

func (f *fakeToolchainRepo) List(ctx context.Context) ([]domain.Toolchain, error) {
	var res []domain.Toolchain
	for _, tc := range f.toolchains {
		res = append(res, tc)
	}
	return res, nil
}

func (f *fakeToolchainRepo) Save(ctx context.Context, tc domain.Toolchain) error {
	f.toolchains[tc.ID] = tc
	return nil
}

func (f *fakeToolchainRepo) FindByJavaHome(ctx context.Context, javaHome string) (*domain.Toolchain, error) {
	return nil, domain.ErrToolchainNotFound
}

func setupTestProject(t *testing.T) (string, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "resolver-test")
	if err != nil {
		t.Fatal(err)
	}

	realTmpDir, err := filepath.EvalSymlinks(tmpDir)
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatal(err)
	}

	projDir := filepath.Join(realTmpDir, "myproject")
	srcDir := filepath.Join(projDir, "src", "main", "java")
	resDir := filepath.Join(projDir, "src", "main", "resources")
	libDir := filepath.Join(projDir, "lib")
	outDir := filepath.Join(projDir, "build", "classes")
	webappDir := filepath.Join(projDir, "webapp")

	dirs := []string{srcDir, resDir, libDir, outDir, webappDir}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			os.RemoveAll(tmpDir)
			t.Fatal(err)
		}
	}

	os.WriteFile(filepath.Join(srcDir, "Main.java"), []byte("class Main {}"), 0644)
	os.WriteFile(filepath.Join(libDir, "a.jar"), []byte("fake"), 0644)
	os.WriteFile(filepath.Join(libDir, "b.jar"), []byte("fake"), 0644)
	os.WriteFile(filepath.Join(webappDir, "index.html"), []byte("<html/>"), 0644)

	cleanup := func() {
		os.RemoveAll(tmpDir)
	}
	return realTmpDir, cleanup
}

func TestResolveProject_Success(t *testing.T) {
	tmpDir, cleanup := setupTestProject(t)
	defer cleanup()

	wsID := domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa")
	projID := domain.ProjectID("prj_aaaaaaaaaaaaaaaaaaaaaaaaaa")

	wsRepo := &fakeWorkspaceRepo{workspaces: map[domain.WorkspaceID]domain.Workspace{
		wsID: {ID: wsID, Name: "test", Root: tmpDir, CreatedAt: time.Now()},
	}}
	projRepo := &fakeProjectRepo{projects: map[domain.WorkspaceID]map[domain.ProjectID]domain.Project{
		wsID: {
			projID: {
				ID:            projID,
				WorkspaceID:   wsID,
				Name:          "test-proj",
				Root:          "myproject",
				SourceRoots:   []string{"src/main/java"},
				ResourceRoots: []string{"src/main/resources"},
				LibraryDirs:   []string{"lib"},
				OutputDir:     "build/classes",
				BuildTool:     domain.BuildToolJavac,
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
			},
		},
	}}
	tcRepo := &fakeToolchainRepo{toolchains: map[string]domain.Toolchain{}}
	pp := pathpolicy.NewDefaultPathPolicy()

	resolver := NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pp)
	resolved, err := resolver.ResolveProject(context.Background(), wsID, projID)
	if err != nil {
		t.Fatalf("ResolveProject failed: %v", err)
	}

	if resolved.Root != filepath.Join(tmpDir, "myproject") {
		t.Errorf("expected project root %s, got %s", filepath.Join(tmpDir, "myproject"), resolved.Root)
	}
	if len(resolved.Classpath) != 2 {
		t.Errorf("expected 2 jars in classpath, got %d", len(resolved.Classpath))
	}
}

func TestResolveProject_InvalidIDs(t *testing.T) {
	wsRepo := &fakeWorkspaceRepo{workspaces: map[domain.WorkspaceID]domain.Workspace{}}
	projRepo := &fakeProjectRepo{projects: map[domain.WorkspaceID]map[domain.ProjectID]domain.Project{}}
	tcRepo := &fakeToolchainRepo{toolchains: map[string]domain.Toolchain{}}
	pp := pathpolicy.NewDefaultPathPolicy()
	resolver := NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pp)

	_, err := resolver.ResolveProject(context.Background(), "bad-id", "prj_aaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err == nil {
		t.Error("expected error for invalid workspace id")
	}
}

func TestResolveBuild_SelectedFileEscape(t *testing.T) {
	tmpDir, cleanup := setupTestProject(t)
	defer cleanup()

	wsID := domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa")
	projID := domain.ProjectID("prj_aaaaaaaaaaaaaaaaaaaaaaaaaa")

	wsRepo := &fakeWorkspaceRepo{workspaces: map[domain.WorkspaceID]domain.Workspace{
		wsID: {ID: wsID, Name: "test", Root: tmpDir, CreatedAt: time.Now()},
	}}
	projRepo := &fakeProjectRepo{projects: map[domain.WorkspaceID]map[domain.ProjectID]domain.Project{
		wsID: {
			projID: {
				ID:          projID,
				WorkspaceID: wsID,
				Name:        "test-proj",
				Root:        "myproject",
				SourceRoots: []string{"src/main/java"},
				OutputDir:   "build/classes",
				BuildTool:   domain.BuildToolJavac,
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			},
		},
	}}
	tcRepo := &fakeToolchainRepo{toolchains: map[string]domain.Toolchain{}}
	pp := pathpolicy.NewDefaultPathPolicy()
	resolver := NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pp)

	_, err := resolver.ResolveBuild(context.Background(), wsID, projID, domain.BuildIntentSelectedFiles, false, []string{"../etc/passwd"})
	if err == nil {
		t.Error("expected error for path traversal in selected files")
	}
}

func TestResolveBuild_NonJavaFile(t *testing.T) {
	tmpDir, cleanup := setupTestProject(t)
	defer cleanup()

	wsID := domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa")
	projID := domain.ProjectID("prj_aaaaaaaaaaaaaaaaaaaaaaaaaa")

	wsRepo := &fakeWorkspaceRepo{workspaces: map[domain.WorkspaceID]domain.Workspace{
		wsID: {ID: wsID, Name: "test", Root: tmpDir, CreatedAt: time.Now()},
	}}
	projRepo := &fakeProjectRepo{projects: map[domain.WorkspaceID]map[domain.ProjectID]domain.Project{
		wsID: {
			projID: {
				ID:          projID,
				WorkspaceID: wsID,
				Name:        "test-proj",
				Root:        "myproject",
				SourceRoots: []string{"src/main/java"},
				OutputDir:   "build/classes",
				BuildTool:   domain.BuildToolJavac,
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			},
		},
	}}
	tcRepo := &fakeToolchainRepo{toolchains: map[string]domain.Toolchain{}}
	pp := pathpolicy.NewDefaultPathPolicy()
	resolver := NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pp)

	os.WriteFile(filepath.Join(tmpDir, "myproject", "src", "main", "java", "test.txt"), []byte("test"), 0644)
	_, err := resolver.ResolveBuild(context.Background(), wsID, projID, domain.BuildIntentSelectedFiles, false, []string{"src/main/java/test.txt"})
	if err == nil {
		t.Error("expected error for non-java file")
	}
}

func TestResolveRuntime_ReturnsError(t *testing.T) {
	wsRepo := &fakeWorkspaceRepo{workspaces: map[domain.WorkspaceID]domain.Workspace{}}
	projRepo := &fakeProjectRepo{projects: map[domain.WorkspaceID]map[domain.ProjectID]domain.Project{}}
	tcRepo := &fakeToolchainRepo{toolchains: map[string]domain.Toolchain{}}
	pp := pathpolicy.NewDefaultPathPolicy()
	resolver := NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pp)

	_, err := resolver.ResolveRuntime(context.Background(), "ws_aaaaaaaaaaaaaaaaaaaaaaaaaa", "prj_aaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	if err != domain.ErrRuntimeIntegrationRequired {
		t.Errorf("expected ErrRuntimeIntegrationRequired, got %v", err)
	}
}
