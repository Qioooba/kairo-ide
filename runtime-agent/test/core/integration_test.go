package core_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/app"
	"github.com/kairo-ide/runtime-agent/internal/deploy"
	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
	"github.com/kairo-ide/runtime-agent/internal/planning"
	buildprovider "github.com/kairo-ide/runtime-agent/internal/provider/build"
	"github.com/kairo-ide/runtime-agent/internal/repository"
)

type fakeCommandRunner struct {
	mu       sync.Mutex
	commands []buildprovider.CommandSpec
	onRun    func(spec buildprovider.CommandSpec) (int, []string)
}

func newFakeCommandRunner() *fakeCommandRunner {
	return &fakeCommandRunner{
		onRun: func(spec buildprovider.CommandSpec) (int, []string) {
			return 0, nil
		},
	}
}

func (r *fakeCommandRunner) Commands() []buildprovider.CommandSpec {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := make([]buildprovider.CommandSpec, len(r.commands))
	copy(cp, r.commands)
	return cp
}

func (r *fakeCommandRunner) SetOnRun(fn func(spec buildprovider.CommandSpec) (int, []string)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.onRun = fn
}

func (r *fakeCommandRunner) Run(ctx context.Context, spec buildprovider.CommandSpec, onLine func(stream domain.Stream, line string)) (buildprovider.CommandResult, error) {
	r.mu.Lock()
	r.commands = append(r.commands, spec)
	fn := r.onRun
	r.mu.Unlock()

	exitCode, lines := fn(spec)

	select {
	case <-ctx.Done():
		return buildprovider.CommandResult{ExitCode: -1}, ctx.Err()
	default:
	}

	for _, line := range lines {
		onLine(domain.StreamStdout, line)
	}

	return buildprovider.CommandResult{ExitCode: exitCode}, nil
}

type noopPublisher struct{}

func (p *noopPublisher) PublishBuildEvent(ctx context.Context, event domain.BuildEvent) error {
	return nil
}

type slowBuildProvider struct {
	delay time.Duration
}

func (p *slowBuildProvider) ID() domain.BuildToolID {
	return "slow"
}

func (p *slowBuildProvider) Validate(ctx context.Context, plan domain.BuildPlan) error {
	return nil
}

func (p *slowBuildProvider) Build(ctx context.Context, plan domain.BuildPlan, sink func(event domain.BuildEvent), logLine func(stream domain.Stream, line string)) (*domain.BuildOutput, error) {
	startTime := domain.UTCNow()
	select {
	case <-ctx.Done():
		return &domain.BuildOutput{
			ExitCode:  -1,
			StartTime: startTime,
			EndTime:   domain.UTCNow(),
		}, ctx.Err()
	case <-time.After(p.delay):
	}
	return &domain.BuildOutput{
		ExitCode:  0,
		StartTime: startTime,
		EndTime:   domain.UTCNow(),
	}, nil
}

func setupTestRepos(t *testing.T, dataDir string) (*repository.FileWorkspaceRepo, *repository.FileProjectRepo, *repository.FileToolchainRepo, *repository.FileBuildHistoryRepo, pathpolicy.PathAuthorizer) {
	t.Helper()

	pathPolicy := pathpolicy.NewDefaultPathPolicy()
	wsRepo := repository.NewFileWorkspaceRepo(dataDir)
	projRepo := repository.NewFileProjectRepo(dataDir, wsRepo, pathPolicy)
	tcRepo := repository.NewFileToolchainRepo(dataDir)
	history := repository.NewFileBuildHistoryRepo(dataDir)

	return wsRepo, projRepo, tcRepo, history, pathPolicy
}

func evalSymlinks(t *testing.T, p string) string {
	t.Helper()
	real, err := filepath.EvalSymlinks(p)
	if err != nil {
		t.Fatal(err)
	}
	return real
}

func createFakeJavaHome(t *testing.T, parentDir string) string {
	t.Helper()
	javaHome := filepath.Join(parentDir, "fake-jdk")
	binDir := filepath.Join(javaHome, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatal(err)
	}
	javacPath := filepath.Join(binDir, "javac")
	f, err := os.Create(javacPath)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := os.Chmod(javacPath, 0755); err != nil {
		t.Fatal(err)
	}
	return evalSymlinks(t, javaHome)
}

func waitForBuildState(t *testing.T, uc app.BuildUseCase, workspaceID domain.WorkspaceID, buildID domain.BuildID, expected domain.BuildState, timeout time.Duration) *domain.BuildRun {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		run, err := uc.Get(context.Background(), workspaceID, buildID)
		if err == nil && run != nil && run.State == expected {
			return run
		}
		time.Sleep(20 * time.Millisecond)
	}
	run, err := uc.Get(context.Background(), workspaceID, buildID)
	if err != nil {
		t.Fatalf("build %s never reached state %s: %v", buildID, expected, err)
	}
	t.Fatalf("build %s state was %s, expected %s (after %v)", buildID, run.State, expected, timeout)
	return nil
}

func TestG1_FullBuildDeployFlow(t *testing.T) {
	t.Parallel()

	dataDir := t.TempDir()
	wsRepo, projRepo, tcRepo, history, pathPolicy := setupTestRepos(t, dataDir)

	idGen := pathpolicy.NewCryptoIDGenerator()

	workspaceRoot := evalSymlinks(t, t.TempDir())
	wsIDStr, err := idGen.NewWorkspaceID()
	if err != nil {
		t.Fatal(err)
	}
	wsID := domain.WorkspaceID(wsIDStr)
	ws := domain.Workspace{
		ID:   wsID,
		Name: "test-ws",
		Root: workspaceRoot,
	}
	if err := wsRepo.Save(context.Background(), ws); err != nil {
		t.Fatal(err)
	}

	projectRoot := filepath.Join(workspaceRoot, "myproject")
	srcDir := filepath.Join(projectRoot, "src", "main", "java")
	webappDir := filepath.Join(projectRoot, "src", "main", "webapp")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(webappDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "Hello.java"), []byte("public class Hello { public String greet() { return \"Hi\"; } }"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webappDir, "index.html"), []byte("<html><body>Hi</body></html>"), 0644); err != nil {
		t.Fatal(err)
	}

	javaHome := createFakeJavaHome(t, dataDir)
	tcID := "fake-jdk"
	tc := domain.Toolchain{
		ID:       tcID,
		JavaHome: javaHome,
		Version:  "fake-17",
	}
	if err := tcRepo.Save(context.Background(), tc); err != nil {
		t.Fatal(err)
	}

	projIDStr, err := idGen.NewProjectID()
	if err != nil {
		t.Fatal(err)
	}
	projID := domain.ProjectID(projIDStr)
	project := domain.Project{
		ID:            projID,
		WorkspaceID:   wsID,
		Name:          "simple-java",
		Root:          "myproject",
		SourceRoots:   []string{"src/main/java"},
		ResourceRoots: []string{"src/main/resources"},
		LibraryDirs:   []string{},
		WebappDir:     "src/main/webapp",
		OutputDir:     "target/classes",
		BuildTargets:  []string{"compile"},
		SourceLevel:   "1.8",
		TargetLevel:   "1.8",
		Encoding:      "UTF-8",
		BuildTool:     domain.BuildToolJavac,
		ContextPath:   "/",
		ToolchainID:   tcID,
	}
	if err := projRepo.Save(context.Background(), project); err != nil {
		t.Fatal(err)
	}

	resolver := planning.NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pathPolicy)

	buildPlan, err := resolver.ResolveBuild(context.Background(), wsID, projID, domain.BuildIntentFull, false, nil)
	if err != nil {
		t.Fatalf("ResolveBuild failed: %v", err)
	}
	if buildPlan.BuildTool != domain.BuildToolJavac {
		t.Errorf("expected BuildTool javac, got %s", buildPlan.BuildTool)
	}
	if buildPlan.JavaHome != javaHome {
		t.Errorf("expected JavaHome %s, got %s", javaHome, buildPlan.JavaHome)
	}

	runner := newFakeCommandRunner()
	runner.SetOnRun(func(spec buildprovider.CommandSpec) (int, []string) {
		outputDir := buildPlan.OutputDir
		classFile := filepath.Join(outputDir, "Hello.class")
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return 1, []string{err.Error()}
		}
		if err := os.WriteFile(classFile, []byte("fake-class"), 0644); err != nil {
			return 1, []string{err.Error()}
		}
		return 0, []string{"javac completed"}
	})

	javacProvider := buildprovider.NewJavacProvider(runner, pathPolicy)
	registry := buildprovider.NewBuildProviderRegistry(javacProvider)
	publisher := &noopPublisher{}

	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()
	uc := app.NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)
	defer uc.Shutdown(context.Background())

	startCmd := app.StartBuildCommand{
		WorkspaceID: wsID,
		ProjectID:   projID,
		Clean:       false,
		Intent:      domain.BuildIntentFull,
	}
	run, err := uc.Start(context.Background(), startCmd)
	if err != nil {
		t.Fatalf("Start build failed: %v", err)
	}
	if run.State != domain.BuildStateQueued {
		t.Errorf("expected initial state queued, got %s", run.State)
	}

	var completedRun *domain.BuildRun
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r, err := uc.Get(context.Background(), wsID, run.ID)
		if err == nil && r != nil && r.IsTerminal() {
			completedRun = r
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if completedRun == nil {
		r, err := uc.Get(context.Background(), wsID, run.ID)
		if err != nil {
			t.Fatalf("build never finished: %v", err)
		}
		completedRun = r
	}
	t.Logf("Build state: %s, summary: %s", completedRun.State, completedRun.Summary)
	if completedRun.State != domain.BuildStateSucceeded {
		t.Fatalf("expected state succeeded, got %s", completedRun.State)
	}
	if completedRun.ExitCode == nil || *completedRun.ExitCode != 0 {
		t.Errorf("expected exit code 0, got %v", completedRun.ExitCode)
	}

	cmds := runner.Commands()
	if len(cmds) == 0 {
		t.Fatal("expected javac to be invoked")
	}
	if !strings.HasSuffix(cmds[0].Executable, "javac") {
		t.Errorf("expected javac executable, got %s", cmds[0].Executable)
	}

	classFile := filepath.Join(buildPlan.OutputDir, "Hello.class")
	if _, err := os.Stat(classFile); err != nil {
		t.Errorf("expected .class file at %s: %v", classFile, err)
	}

	deploymentRoot := t.TempDir()
	buildID := run.ID

	resolvedProj, err := resolver.ResolveProject(context.Background(), wsID, projID)
	if err != nil {
		t.Fatalf("ResolveProject failed: %v", err)
	}

	allowedSourceDirs := []string{
		resolvedProj.OutputDir,
		resolvedProj.WebappDir,
	}
	allowedSourceDirs = append(allowedSourceDirs, resolvedProj.ResourceRoots...)
	allowedSourceDirs = append(allowedSourceDirs, resolvedProj.LibraryDirs...)

	srvIDStr, err := idGen.NewServerID()
	if err != nil {
		t.Fatal(err)
	}
	deployTarget := domain.DeploymentTarget{
		WorkspaceID: wsID,
		ProjectID:   projID,
		ServerID:    domain.ServerID(srvIDStr),
		Root:        deploymentRoot,
		OwnerToken:  domain.NewDeploymentOwnerToken(),
	}

	deployPlan, err := resolver.ResolveDeploy(context.Background(), wsID, projID, buildID, deployTarget)
	if err != nil {
		t.Fatalf("ResolveDeploy failed: %v", err)
	}

	engine := deploy.NewDeployEngine()
	deployResult, err := engine.Execute(context.Background(), *deployPlan, allowedSourceDirs)
	if err != nil {
		t.Fatalf("Deploy failed: %v (succeeded=%d failed=%d)", err, deployResult.Succeeded, deployResult.Failed)
	}
	if deployResult.Failed != 0 {
		t.Errorf("expected 0 failed files, got %d", deployResult.Failed)
	}

	deployedClass := filepath.Join(deploymentRoot, "WEB-INF", "classes", "Hello.class")
	if _, err := os.Stat(deployedClass); err != nil {
		t.Errorf("expected deployed class at %s: %v", deployedClass, err)
	}

	deployedHtml := filepath.Join(deploymentRoot, "index.html")
	if _, err := os.Stat(deployedHtml); err != nil {
		t.Errorf("expected deployed webapp file at %s: %v", deployedHtml, err)
	}

	historyRuns, err := history.List(context.Background(), wsID, projID, 10)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, hr := range historyRuns {
		if hr.ID == buildID && hr.State == domain.BuildStateSucceeded {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected to find succeeded build %s in history", buildID)
	}
}

func TestG2_AntPlanIntegration(t *testing.T) {
	t.Parallel()

	dataDir := t.TempDir()
	wsRepo, projRepo, tcRepo, history, pathPolicy := setupTestRepos(t, dataDir)

	idGen := pathpolicy.NewCryptoIDGenerator()

	workspaceRoot := evalSymlinks(t, t.TempDir())
	wsIDStr, err := idGen.NewWorkspaceID()
	if err != nil {
		t.Fatal(err)
	}
	wsID := domain.WorkspaceID(wsIDStr)
	ws := domain.Workspace{
		ID:   wsID,
		Name: "test-ws",
		Root: workspaceRoot,
	}
	if err := wsRepo.Save(context.Background(), ws); err != nil {
		t.Fatal(err)
	}

	projectRoot := filepath.Join(workspaceRoot, "antproj")
	javaSrc := filepath.Join(projectRoot, "src", "main", "java")
	if err := os.MkdirAll(javaSrc, 0755); err != nil {
		t.Fatal(err)
	}
	javaFile := filepath.Join(javaSrc, "Main.java")
	if err := os.WriteFile(javaFile, []byte("public class Main {}"), 0644); err != nil {
		t.Fatal(err)
	}
	buildXml := filepath.Join(projectRoot, "build.xml")
	buildXmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<project name="test-ant" default="compile" basedir=".">
    <property name="src.dir" value="src/main/java"/>
    <property name="build.dir" value="target/classes"/>
    <target name="clean">
        <delete dir="${build.dir}"/>
    </target>
    <target name="compile" depends="clean">
        <mkdir dir="${build.dir}"/>
    </target>
</project>`
	if err := os.WriteFile(buildXml, []byte(buildXmlContent), 0644); err != nil {
		t.Fatal(err)
	}

	javaHome := createFakeJavaHome(t, dataDir)
	tcID := "fake-jdk"
	tc := domain.Toolchain{
		ID:       tcID,
		JavaHome: javaHome,
		Version:  "fake-17",
	}
	if err := tcRepo.Save(context.Background(), tc); err != nil {
		t.Fatal(err)
	}

	projIDStr, err := idGen.NewProjectID()
	if err != nil {
		t.Fatal(err)
	}
	projID := domain.ProjectID(projIDStr)
	project := domain.Project{
		ID:            projID,
		WorkspaceID:   wsID,
		Name:          "ant-project",
		Root:          "antproj",
		SourceRoots:   []string{"src/main/java"},
		ResourceRoots: []string{},
		LibraryDirs:   []string{},
		WebappDir:     "",
		OutputDir:     "target/classes",
		BuildFile:     "build.xml",
		BuildTargets:  []string{"compile"},
		SourceLevel:   "1.8",
		TargetLevel:   "1.8",
		Encoding:      "UTF-8",
		BuildTool:     domain.BuildToolAnt,
		ContextPath:   "/",
		ToolchainID:   tcID,
	}
	if err := projRepo.Save(context.Background(), project); err != nil {
		t.Fatal(err)
	}

	resolver := planning.NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pathPolicy)
	buildPlan, err := resolver.ResolveBuild(context.Background(), wsID, projID, domain.BuildIntentFull, false, nil)
	if err != nil {
		t.Fatalf("ResolveBuild failed: %v", err)
	}

	if buildPlan.BuildTool != domain.BuildToolAnt {
		t.Errorf("expected BuildTool ant, got %s", buildPlan.BuildTool)
	}
	if len(buildPlan.Targets) == 0 {
		t.Error("expected at least one target")
	}
	foundCompile := false
	for _, tgt := range buildPlan.Targets {
		if tgt == "compile" {
			foundCompile = true
			break
		}
	}
	if !foundCompile {
		t.Errorf("expected 'compile' target in targets, got %v", buildPlan.Targets)
	}
	if buildPlan.BuildFile == "" {
		t.Error("expected BuildFile to be set")
	}
	if !strings.HasSuffix(buildPlan.BuildFile, "build.xml") {
		t.Errorf("expected BuildFile to end with build.xml, got %s", buildPlan.BuildFile)
	}

	runner := newFakeCommandRunner()
	antProvider := buildprovider.NewAntProvider(runner)
	registry := buildprovider.NewBuildProviderRegistry(antProvider)
	publisher := &noopPublisher{}

	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()
	uc := app.NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)
	defer uc.Shutdown(context.Background())

	startCmd := app.StartBuildCommand{
		WorkspaceID: wsID,
		ProjectID:   projID,
		Clean:       false,
		Intent:      domain.BuildIntentFull,
	}
	run, err := uc.Start(context.Background(), startCmd)
	if err != nil {
		t.Fatalf("Start build failed: %v", err)
	}

	var antCompletedRun *domain.BuildRun
	antDeadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(antDeadline) {
		r, err := uc.Get(context.Background(), wsID, run.ID)
		if err == nil && r != nil && r.IsTerminal() {
			antCompletedRun = r
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if antCompletedRun == nil {
		r, err := uc.Get(context.Background(), wsID, run.ID)
		if err != nil {
			t.Fatalf("build never finished: %v", err)
		}
		antCompletedRun = r
	}
	if antCompletedRun.State != domain.BuildStateSucceeded {
		t.Fatalf("expected state succeeded, got %s, summary: %s", antCompletedRun.State, antCompletedRun.Summary)
	}
	completedRun := antCompletedRun
	if completedRun.ExitCode == nil || *completedRun.ExitCode != 0 {
		t.Errorf("expected exit code 0, got %v", completedRun.ExitCode)
	}

	cmds := runner.Commands()
	if len(cmds) == 0 {
		t.Fatal("expected ant to be invoked")
	}
	if cmds[0].Executable != "ant" {
		t.Errorf("expected ant executable, got %s", cmds[0].Executable)
	}

	hasBuildFile := false
	hasCompileTarget := false
	for i, arg := range cmds[0].Args {
		if arg == "-f" && i+1 < len(cmds[0].Args) && strings.HasSuffix(cmds[0].Args[i+1], "build.xml") {
			hasBuildFile = true
		}
		if arg == "compile" {
			hasCompileTarget = true
		}
	}
	if !hasBuildFile {
		t.Errorf("expected -f build.xml in args, got %v", cmds[0].Args)
	}
	if !hasCompileTarget {
		t.Errorf("expected 'compile' target in args, got %v", cmds[0].Args)
	}
}

func TestG3_CancellationIntegration(t *testing.T) {
	t.Parallel()

	dataDir := t.TempDir()
	wsRepo, projRepo, tcRepo, history, pathPolicy := setupTestRepos(t, dataDir)

	idGen := pathpolicy.NewCryptoIDGenerator()

	workspaceRoot := evalSymlinks(t, t.TempDir())
	wsIDStr, err := idGen.NewWorkspaceID()
	if err != nil {
		t.Fatal(err)
	}
	wsID := domain.WorkspaceID(wsIDStr)
	ws := domain.Workspace{
		ID:   wsID,
		Name: "test-ws",
		Root: workspaceRoot,
	}
	if err := wsRepo.Save(context.Background(), ws); err != nil {
		t.Fatal(err)
	}

	projectRoot := filepath.Join(workspaceRoot, "cancelproj")
	javaSrc := filepath.Join(projectRoot, "src", "main", "java")
	if err := os.MkdirAll(javaSrc, 0755); err != nil {
		t.Fatal(err)
	}
	javaFile := filepath.Join(javaSrc, "Main.java")
	if err := os.WriteFile(javaFile, []byte("public class Main {}"), 0644); err != nil {
		t.Fatal(err)
	}

	javaHome := createFakeJavaHome(t, dataDir)
	tcID := "fake-jdk"
	tc := domain.Toolchain{
		ID:       tcID,
		JavaHome: javaHome,
		Version:  "fake-17",
	}
	if err := tcRepo.Save(context.Background(), tc); err != nil {
		t.Fatal(err)
	}

	projIDStr, err := idGen.NewProjectID()
	if err != nil {
		t.Fatal(err)
	}
	projID := domain.ProjectID(projIDStr)
	project := domain.Project{
		ID:            projID,
		WorkspaceID:   wsID,
		Name:          "cancel-proj",
		Root:          "cancelproj",
		SourceRoots:   []string{"src/main/java"},
		ResourceRoots: []string{},
		LibraryDirs:   []string{},
		WebappDir:     "",
		OutputDir:     "target/classes",
		BuildTargets:  []string{"compile"},
		SourceLevel:   "1.8",
		TargetLevel:   "1.8",
		Encoding:      "UTF-8",
		BuildTool:     domain.BuildToolJavac,
		ContextPath:   "/",
		ToolchainID:   tcID,
	}
	if err := projRepo.Save(context.Background(), project); err != nil {
		t.Fatal(err)
	}

	resolver := planning.NewDefaultPlanResolver(wsRepo, projRepo, tcRepo, pathPolicy)

	slowProvider := &slowBuildProvider{delay: 500 * time.Millisecond}
	registry := &customRegistry{provider: slowProvider}
	publisher := &noopPublisher{}

	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()
	uc := app.NewBuildUseCase(lifecycleCtx, history, resolver, registry, publisher, idGen)
	defer uc.Shutdown(context.Background())

	startCmd := app.StartBuildCommand{
		WorkspaceID: wsID,
		ProjectID:   projID,
		Clean:       false,
		Intent:      domain.BuildIntentFull,
	}
	run, err := uc.Start(context.Background(), startCmd)
	if err != nil {
		t.Fatalf("Start build failed: %v", err)
	}

	waitForBuildState(t, uc, wsID, run.ID, domain.BuildStateRunning, 2*time.Second)

	if err := uc.Cancel(context.Background(), wsID, run.ID); err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}

	cancelledRun := waitForBuildState(t, uc, wsID, run.ID, domain.BuildStateCancelled, 5*time.Second)
	if cancelledRun.State != domain.BuildStateCancelled {
		t.Errorf("expected state cancelled, got %s", cancelledRun.State)
	}

	historyRuns, err := history.List(context.Background(), wsID, projID, 10)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, hr := range historyRuns {
		if hr.ID == run.ID && hr.State == domain.BuildStateCancelled {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected to find cancelled build %s in history", run.ID)
	}
}

type customRegistry struct {
	provider domain.BuildProvider
}

func (r *customRegistry) Get(id domain.BuildToolID) (domain.BuildProvider, bool) {
	return r.provider, true
}

func TestG4_CorruptionRecovery(t *testing.T) {
	t.Parallel()

	dataDir := t.TempDir()

	idGen := pathpolicy.NewCryptoIDGenerator()
	wsIDStr, err := idGen.NewWorkspaceID()
	if err != nil {
		t.Fatal(err)
	}
	wsID := domain.WorkspaceID(wsIDStr)

	catalogDir := filepath.Join(dataDir, "catalog")
	if err := os.MkdirAll(catalogDir, 0755); err != nil {
		t.Fatal(err)
	}
	projectsFile := filepath.Join(catalogDir, "projects.json")
	corruptContent := []byte(`{"schemaVersion":1,"updatedAt":"2024-01-01T00:00:00Z","data":{"records":[{this is broken json`)
	if err := os.WriteFile(projectsFile, corruptContent, 0644); err != nil {
		t.Fatal(err)
	}

	pp := pathpolicy.NewDefaultPathPolicy()
	catalog := repository.NewProjectCatalog(dataDir, pp)
	_, err = catalog.ListByWorkspace(context.Background(), wsID)
	if err == nil {
		t.Fatal("expected error reading corrupt catalog")
	}

	var corruptErr *repository.CorruptionError
	if !errors.As(err, &corruptErr) {
		t.Errorf("expected CorruptionError, got %T: %v", err, err)
	}
	if corruptErr.Path != projectsFile {
		t.Errorf("expected corrupt path %s, got %s", projectsFile, corruptErr.Path)
	}

	contentAfter, err := os.ReadFile(projectsFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(contentAfter) != string(corruptContent) {
		t.Error("corrupt file was modified/overwritten")
	}
}
