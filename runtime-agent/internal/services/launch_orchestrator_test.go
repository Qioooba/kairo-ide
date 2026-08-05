package services

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// mockBuildEngine 模拟 BuildEngine 接口
type mockBuildEngine struct {
	startResult *api.BuildResult
	startErr    error
	getResult   *api.BuildResult
	getErr      error
	cancelFn    func(context.Context, string) (*api.BuildResult, error)
}

func (m *mockBuildEngine) Start(req api.BuildRequest) (*api.BuildResult, error) {
	if m.startErr != nil {
		return nil, m.startErr
	}
	return m.startResult, nil
}

func (m *mockBuildEngine) Get(id string) (*api.BuildResult, error) {
	if m.getErr != nil {
		return nil, m.getErr
	}
	return m.getResult, nil
}

func (m *mockBuildEngine) List() []*api.BuildResult {
	return nil
}

func (m *mockBuildEngine) Cancel(ctx context.Context, id string) (*api.BuildResult, error) {
	if m.cancelFn != nil {
		return m.cancelFn(ctx, id)
	}
	return nil, nil
}

// mockDeployer 模拟 Deployer 接口
type mockDeployer struct {
	publishResult *api.DeployResult
	publishErr    error
}

func (m *mockDeployer) Publish(req api.DeployRequest) (*api.DeployResult, error) {
	if m.publishErr != nil {
		return nil, m.publishErr
	}
	return m.publishResult, nil
}

func (m *mockDeployer) Get(id string) (*api.DeployResult, error) {
	return nil, nil
}

func (m *mockDeployer) List() []*api.DeployResult {
	return nil
}

// mockServerRunner 模拟 ServerRunner 接口
type mockServerRunner struct {
	startResult *api.ServerResponse
	startErr    error
}

func (m *mockServerRunner) CatalinaHome() string {
	return ""
}

func (m *mockServerRunner) Start(req api.StartServerRequest) (*api.ServerResponse, error) {
	if m.startErr != nil {
		return nil, m.startErr
	}
	return m.startResult, nil
}

func (m *mockServerRunner) Get(id string) (*api.ServerResponse, error) {
	return nil, nil
}

func (m *mockServerRunner) Stop(id string, force bool) (*api.ServerResponse, error) {
	return nil, nil
}

func (m *mockServerRunner) Restart(id string) (*api.ServerResponse, error) {
	return nil, nil
}

func (m *mockServerRunner) Debug(id string) (*api.ServerResponse, error) {
	return nil, nil
}

func (m *mockServerRunner) Logs(id string, tail int) ([]api.ServerLogEntry, error) {
	return nil, nil
}

func (m *mockServerRunner) List() []*api.ServerResponse {
	return nil
}

func (m *mockServerRunner) Recoverable() []*api.ServerResponse {
	return nil
}

func (m *mockServerRunner) Recover(id string) (*api.ServerResponse, error) {
	return nil, nil
}

func (m *mockServerRunner) ReloadContext(id string) error {
	return nil
}

// makeValidConfig 创建有效的启动配置
func makeValidConfig(t *testing.T) api.LaunchOrchestratorConfig {
	t.Helper()
	projectRoot := t.TempDir()
	return api.LaunchOrchestratorConfig{
		Configuration: domain.TomcatRunConfiguration{
			ID:        "cfg-1",
			Name:      "Test Config",
			Type:      "tomcat6",
			ProjectID: "project-1",
			Mode:      "run",
			Build: domain.RunConfigurationBuild{
				Type:  "javac",
				Clean: false,
			},
			Server: domain.RunConfigurationServer{
				HTTPPort:    8080,
				ContextPath: "/test",
			},
			Deploy: domain.RunConfigurationDeploy{
				Mode: "exploded",
			},
			BeforeLaunchTasks: []string{"build"},
		},
		WorkspaceRoot: projectRoot,
		ProjectRoot:   projectRoot,
		ArtifactPath:  "build/classes",
		JavaHome:      "/usr/lib/jvm/java-8",
	}
}

// TestLaunchOrchestrator_ValidConfig 验证有效配置的启动流程
func TestLaunchOrchestrator_ValidConfig(t *testing.T) {
	t.Parallel()
	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getResult:   &api.BuildResult{ID: "build-1", State: "success"},
	}
	deployer := &mockDeployer{
		publishResult: &api.DeployResult{ID: "dep-1", State: "success"},
	}
	serverRunner := &mockServerRunner{
		startResult: &api.ServerResponse{
			ID:          "srv-1",
			ProjectID:   "project-1",
			Type:        "tomcat6",
			State:       "running",
			PID:         12345,
			StartedAt:   time.Now(),
			ContextPath: "/test",
			URL:         "http://localhost:8080/test",
		},
	}

	orch := NewLaunchOrchestrator(buildEngine, deployer, serverRunner,
		t.TempDir(), nil)
	config := makeValidConfig(t)

	result, err := orch.Execute(context.Background(), config)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected result, got nil")
	}
	if result.State != "running" {
		t.Errorf("state = %q, want running", result.State)
	}
	if result.ProjectID != "project-1" {
		t.Errorf("ProjectID = %q, want project-1", result.ProjectID)
	}
}

// TestLaunchOrchestrator_MissingBuild 验证缺少构建步骤时的处理
func TestLaunchOrchestrator_MissingBuild(t *testing.T) {
	t.Parallel()
	// 配置不包含 build 任务
	config := makeValidConfig(t)
	config.Configuration.BeforeLaunchTasks = nil

	deployer := &mockDeployer{
		publishResult: &api.DeployResult{ID: "dep-1", State: "success"},
	}
	serverRunner := &mockServerRunner{
		startResult: &api.ServerResponse{
			ID:        "srv-1",
			State:     "running",
			StartedAt: time.Now(),
		},
	}

	orch := NewLaunchOrchestrator(&mockBuildEngine{}, deployer, serverRunner,
		t.TempDir(), nil)

	result, err := orch.Execute(context.Background(), config)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected result, got nil")
	}
}

// TestLaunchOrchestrator_BuildFailure 验证构建失败时的处理
func TestLaunchOrchestrator_BuildFailure(t *testing.T) {
	t.Parallel()
	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getResult:   &api.BuildResult{ID: "build-1", State: "failure", Error: "compilation error"},
	}

	orch := NewLaunchOrchestrator(buildEngine, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)
	config := makeValidConfig(t)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for build failure")
	}
}

// TestLaunchOrchestrator_ContextCanceled 验证上下文取消
func TestLaunchOrchestrator_ContextCanceled(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	orch := NewLaunchOrchestrator(&mockBuildEngine{}, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)
	config := makeValidConfig(t)

	_, err := orch.Execute(ctx, config)
	if err == nil {
		t.Fatal("expected error for canceled context")
	}
}

// TestLaunchOrchestrator_UnknownBuildType 验证未知构建类型
func TestLaunchOrchestrator_UnknownBuildType(t *testing.T) {
	t.Parallel()
	config := makeValidConfig(t)
	config.Configuration.Build.Type = "unknown"

	orch := NewLaunchOrchestrator(&mockBuildEngine{}, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for unknown build type")
	}
}

// TestLaunchOrchestrator_AntBuildNotSupported 验证 Ant 构建暂不支持
func TestLaunchOrchestrator_AntBuildNotSupported(t *testing.T) {
	t.Parallel()
	config := makeValidConfig(t)
	config.Configuration.Build.Type = "ant"

	orch := NewLaunchOrchestrator(&mockBuildEngine{}, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for ant build type")
	}
}

// TestLaunchOrchestrator_CustomBuildNotSupported 验证自定义构建暂不支持
func TestLaunchOrchestrator_CustomBuildNotSupported(t *testing.T) {
	t.Parallel()
	config := makeValidConfig(t)
	config.Configuration.Build.Type = "custom"

	orch := NewLaunchOrchestrator(&mockBuildEngine{}, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for custom build type")
	}
}

// TestLaunchOrchestrator_UnknownDeployMode 验证未知部署模式
func TestLaunchOrchestrator_UnknownDeployMode(t *testing.T) {
	t.Parallel()
	config := makeValidConfig(t)
	config.Configuration.Deploy.Mode = "unknown"
	config.Configuration.BeforeLaunchTasks = []string{"deploy"}

	orch := NewLaunchOrchestrator(&mockBuildEngine{}, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for unknown deploy mode")
	}
}

// TestLaunchOrchestrator_ProgressReporting 验证进度报告
func TestLaunchOrchestrator_ProgressReporting(t *testing.T) {
	t.Parallel()
	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getResult:   &api.BuildResult{ID: "build-1", State: "success"},
	}
	deployer := &mockDeployer{
		publishResult: &api.DeployResult{ID: "dep-1", State: "success"},
	}
	serverRunner := &mockServerRunner{
		startResult: &api.ServerResponse{
			ID:        "srv-1",
			State:     "running",
			StartedAt: time.Now(),
		},
	}

	var progressSteps []StepProgress
	progressReporter := func(step StepProgress) {
		progressSteps = append(progressSteps, step)
	}

	orch := NewLaunchOrchestrator(buildEngine, deployer, serverRunner,
		t.TempDir(), progressReporter)
	config := makeValidConfig(t)

	_, err := orch.Execute(context.Background(), config)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	// 验证进度报告包含所有步骤
	if len(progressSteps) < 4 {
		t.Errorf("expected at least 4 progress steps, got %d", len(progressSteps))
	}

	// 验证 pending 状态
	pendingCount := 0
	successCount := 0
	for _, step := range progressSteps {
		if step.Status == StepPending {
			pendingCount++
		}
		if step.Status == StepSuccess {
			successCount++
		}
	}
	if pendingCount < 2 {
		t.Errorf("expected at least 2 pending steps, got %d", pendingCount)
	}
	if successCount < 2 {
		t.Errorf("expected at least 2 success steps, got %d", successCount)
	}
}

// TestLaunchOrchestrator_NoBeforeLaunchTasks 验证无前置任务时直接运行
func TestLaunchOrchestrator_NoBeforeLaunchTasks(t *testing.T) {
	t.Parallel()
	serverRunner := &mockServerRunner{
		startResult: &api.ServerResponse{
			ID:        "srv-1",
			State:     "running",
			StartedAt: time.Now(),
		},
	}
	config := makeValidConfig(t)
	config.Configuration.BeforeLaunchTasks = nil

	orch := NewLaunchOrchestrator(&mockBuildEngine{}, &mockDeployer{}, serverRunner,
		t.TempDir(), nil)

	result, err := orch.Execute(context.Background(), config)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected result, got nil")
	}
	if result.State != "running" {
		t.Errorf("state = %q, want running", result.State)
	}
}

// TestLaunchOrchestrator_DeployFailure 验证部署失败处理
func TestLaunchOrchestrator_DeployFailure(t *testing.T) {
	t.Parallel()
	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getResult:   &api.BuildResult{ID: "build-1", State: "success"},
	}
	deployer := &mockDeployer{
		publishErr: errors.New("deploy failed: disk full"),
	}

	orch := NewLaunchOrchestrator(buildEngine, deployer, &mockServerRunner{},
		t.TempDir(), nil)
	config := makeValidConfig(t)
	config.Configuration.BeforeLaunchTasks = []string{"build", "deploy"}

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for deploy failure")
	}
}

// TestLaunchOrchestrator_ServerStartFailure 验证服务启动失败处理
func TestLaunchOrchestrator_ServerStartFailure(t *testing.T) {
	t.Parallel()
	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getResult:   &api.BuildResult{ID: "build-1", State: "success"},
	}
	deployer := &mockDeployer{
		publishResult: &api.DeployResult{ID: "dep-1", State: "success"},
	}
	serverRunner := &mockServerRunner{
		startErr: errors.New("port 8080 already in use"),
	}

	orch := NewLaunchOrchestrator(buildEngine, deployer, serverRunner,
		t.TempDir(), nil)
	config := makeValidConfig(t)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for server start failure")
	}
}

// TestLaunchOrchestrator_WaitForBuildCancelled verifies build cancellation is handled.
func TestLaunchOrchestrator_WaitForBuildCancelled(t *testing.T) {
	t.Parallel()
	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getResult:   &api.BuildResult{ID: "build-1", State: "cancelled"},
	}

	orch := NewLaunchOrchestrator(buildEngine, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)
	config := makeValidConfig(t)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for cancelled build")
	}
}

// TestLaunchOrchestrator_WaitForBuildGetError verifies build get error handling.
func TestLaunchOrchestrator_WaitForBuildGetError(t *testing.T) {
	t.Parallel()
	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getErr:      errors.New("build not found"),
	}

	orch := NewLaunchOrchestrator(buildEngine, &mockDeployer{}, &mockServerRunner{},
		t.TempDir(), nil)
	config := makeValidConfig(t)

	_, err := orch.Execute(context.Background(), config)
	if err == nil {
		t.Fatal("expected error for build get error")
	}
}

// TestLaunchOrchestrator_WARDeploy verifies WAR deploy path.
func TestLaunchOrchestrator_WARDeploy(t *testing.T) {
	// Skip in parallel since it touches filesystem
	projectRoot := t.TempDir()
	warFile := filepath.Join(projectRoot, "app.war")
	if err := os.WriteFile(warFile, []byte("fake war"), 0o644); err != nil {
		t.Fatal(err)
	}

	config := api.LaunchOrchestratorConfig{
		Configuration: domain.TomcatRunConfiguration{
			ID:        "cfg-1",
			Name:      "Test WAR Config",
			Type:      "tomcat6",
			ProjectID: "project-1",
			Mode:      "run",
			Build: domain.RunConfigurationBuild{
				Type:  "javac",
				Clean: false,
			},
			Server: domain.RunConfigurationServer{
				HTTPPort:    8080,
				ContextPath: "/test",
			},
			Deploy: domain.RunConfigurationDeploy{
				Mode: "war",
			},
			BeforeLaunchTasks: []string{"build", "deploy"},
		},
		WorkspaceRoot: projectRoot,
		ProjectRoot:   projectRoot,
		ArtifactPath:  "app.war",
		JavaHome:      "/usr/lib/jvm/java-8",
	}

	buildEngine := &mockBuildEngine{
		startResult: &api.BuildResult{ID: "build-1", State: "queued"},
		getResult:   &api.BuildResult{ID: "build-1", State: "success"},
	}
	serverRunner := &mockServerRunner{
		startResult: &api.ServerResponse{
			ID:        "srv-1",
			State:     "running",
			StartedAt: time.Now(),
		},
	}

	orch := NewLaunchOrchestrator(buildEngine, &mockDeployer{}, serverRunner,
		t.TempDir(), nil)

	result, err := orch.Execute(context.Background(), config)
	if err != nil {
		t.Fatalf("Execute WAR deploy: %v", err)
	}
	if result == nil {
		t.Fatal("expected result")
	}
}

// TestCopyFile verifies file copy works correctly.
func TestCopyFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Errorf("content = %q, want hello", string(data))
	}
}

func TestCopyFile_NonexistentSource(t *testing.T) {
	err := copyFile("/nonexistent/src", "/tmp/dst")
	if err == nil {
		t.Fatal("expected error for nonexistent source")
	}
}

func TestCopyFile_Overwrite(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := os.WriteFile(src, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(src, dst); err != nil {
		t.Fatalf("copyFile: %v", err)
	}
	data, _ := os.ReadFile(dst)
	if string(data) != "new" {
		t.Errorf("content = %q, want new", string(data))
	}
}
// TestLaunchOrchestrator_AbsoluteArtifactDeploy verifies beforeLaunchTasks=[deploy]
// succeeds when ArtifactPath is already absolute (as produced by the run-config
// handler). Previously ResolveWithin rejected absolute paths and deploy always failed.
func TestLaunchOrchestrator_AbsoluteArtifactDeploy(t *testing.T) {
	projectRoot := t.TempDir()
	artifactDir := filepath.Join(projectRoot, "build", "classes")
	if err := os.MkdirAll(artifactDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(artifactDir, "App.class"), []byte{0xca, 0xfe}, 0o644); err != nil {
		t.Fatal(err)
	}

	config := api.LaunchOrchestratorConfig{
		Configuration: domain.TomcatRunConfiguration{
			ID:        "cfg-abs",
			Name:      "Abs Artifact",
			Type:      "tomcat6",
			ProjectID: "project-1",
			Mode:      "run",
			Server: domain.RunConfigurationServer{
				HTTPPort:    8080,
				ContextPath: "/test",
			},
			Deploy: domain.RunConfigurationDeploy{
				Mode: "exploded",
			},
			BeforeLaunchTasks: []string{"deploy"},
		},
		WorkspaceRoot: projectRoot,
		ProjectRoot:   projectRoot,
		ArtifactPath:  artifactDir,
		JavaHome:      "/usr/lib/jvm/java-8",
	}

	deployer := &mockDeployer{
		publishResult: &api.DeployResult{ID: "dep-1", State: "success"},
	}
	serverRunner := &mockServerRunner{
		startResult: &api.ServerResponse{
			ID:        "srv-1",
			State:     "running",
			StartedAt: time.Now(),
		},
	}
	orch := NewLaunchOrchestrator(&mockBuildEngine{}, deployer, serverRunner, t.TempDir(), nil)

	result, err := orch.Execute(context.Background(), config)
	if err != nil {
		t.Fatalf("Execute with absolute artifact: %v", err)
	}
	if result == nil || result.State != "running" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestResolveArtifactWithinRoot(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "webapp")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := resolveArtifactWithinRoot(root, inside)
	if err != nil {
		t.Fatalf("absolute inside: %v", err)
	}
	if got != filepath.Clean(inside) {
		t.Errorf("got %q, want %q", got, filepath.Clean(inside))
	}

	got, err = resolveArtifactWithinRoot(root, "webapp")
	if err != nil {
		t.Fatalf("relative: %v", err)
	}
	if got != filepath.Clean(inside) {
		t.Errorf("relative got %q, want %q", got, filepath.Clean(inside))
	}

	outside := filepath.Join(t.TempDir(), "other")
	if _, err := resolveArtifactWithinRoot(root, outside); err == nil {
		t.Fatal("expected error for path outside root")
	}
}
