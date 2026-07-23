package services

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

// StepStatus represents the status of an orchestration step.
type StepStatus string

const (
	StepPending StepStatus = "pending"
	StepRunning StepStatus = "running"
	StepSuccess StepStatus = "success"
	StepFailed  StepStatus = "failed"
)

// StepProgress reports the progress of a single orchestration step.
type StepProgress struct {
	Step   string     `json:"step"`
	Status StepStatus `json:"status"`
	Error  string     `json:"error,omitempty"`
}

// ProgressReporter is called for each step status change.
type ProgressReporter func(StepProgress)

// launchOrchestrator implements api.LaunchOrchestrator.
type launchOrchestrator struct {
	buildEngine  api.BuildEngine
	deployer     api.Deployer
	serverRunner api.ServerRunner
	dataDir      string
	progress     ProgressReporter
}

// NewLaunchOrchestrator creates a new LaunchOrchestrator.
func NewLaunchOrchestrator(
	buildEngine api.BuildEngine,
	deployer api.Deployer,
	serverRunner api.ServerRunner,
	dataDir string,
	progress ProgressReporter,
) api.LaunchOrchestrator {
	return &launchOrchestrator{
		buildEngine:  buildEngine,
		deployer:     deployer,
		serverRunner: serverRunner,
		dataDir:      dataDir,
		progress:     progress,
	}
}

// Execute runs the before-launch tasks and starts the server.
func (o *launchOrchestrator) Execute(ctx context.Context, config api.LaunchOrchestratorConfig) (*api.ServerResponse, error) {
	tasks := config.Configuration.BeforeLaunchTasks
	if tasks == nil {
		tasks = []string{}
	}

	// Report all steps as pending initially.
	steps := append([]string{}, tasks...)
	steps = append(steps, "run")
	for _, step := range steps {
		o.report(StepProgress{Step: step, Status: StepPending})
	}

	for _, step := range steps {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		o.report(StepProgress{Step: step, Status: StepRunning})

		var err error
		var server *api.ServerResponse
		switch step {
		case "build":
			err = o.executeBuild(ctx, config)
		case "deploy":
			err = o.executeDeploy(ctx, config)
		case "run":
			server, err = o.executeRun(ctx, config)
		}

		if err != nil {
			o.report(StepProgress{Step: step, Status: StepFailed, Error: err.Error()})
			return nil, fmt.Errorf("step %s failed: %w", step, err)
		}
		o.report(StepProgress{Step: step, Status: StepSuccess})
		if server != nil {
			return server, nil
		}
	}

	return nil, fmt.Errorf("unexpected end of orchestration: no run step executed")
}

func (o *launchOrchestrator) report(p StepProgress) {
	if o.progress != nil {
		o.progress(p)
	}
}

func (o *launchOrchestrator) executeBuild(ctx context.Context, config api.LaunchOrchestratorConfig) error {
	cfg := config.Configuration
	buildType := cfg.Build.Type

	switch buildType {
	case "javac":
		return o.executeJavacBuild(ctx, config)
	case "ant":
		return fmt.Errorf("ant build is not yet supported by the orchestrator")
	case "custom":
		return fmt.Errorf("custom build execution is not yet supported by the orchestrator")
	default:
		return fmt.Errorf("unknown build type: %s", buildType)
	}
}

func (o *launchOrchestrator) executeJavacBuild(ctx context.Context, config api.LaunchOrchestratorConfig) error {
	cfg := config.Configuration
	outputDir := filepath.Join(config.ProjectRoot, "build", "classes")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return fmt.Errorf("create build output directory: %w", err)
	}
	if cfg.Build.Clean {
		if err := os.RemoveAll(outputDir); err != nil {
			return fmt.Errorf("clean build output: %w", err)
		}
		if err := os.MkdirAll(outputDir, 0o755); err != nil {
			return fmt.Errorf("recreate build output: %w", err)
		}
	}
	req := api.BuildRequest{
		ProjectID:   cfg.ProjectID,
		ProjectRoot: config.ProjectRoot,
		Toolchain:   config.JavaHome,
		SourceLevel: "1.6",
		TargetLevel: "1.6",
		OutputDir:   outputDir,
		Clean:       cfg.Build.Clean,
	}
	result, err := o.buildEngine.Start(req)
	if err != nil {
		return fmt.Errorf("start build: %w", err)
	}
	return o.waitForBuild(ctx, result.ID)
}

func (o *launchOrchestrator) waitForBuild(ctx context.Context, buildID string) error {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			// Cancel the build and return the context error.
			_, _ = o.buildEngine.Cancel(context.Background(), buildID)
			return ctx.Err()
		case <-ticker.C:
		}
		result, err := o.buildEngine.Get(buildID)
		if err != nil {
			return fmt.Errorf("get build status: %w", err)
		}
		switch result.State {
		case "success":
			return nil
		case "failure":
			return fmt.Errorf("build failed: %s", result.Error)
		case "cancelled":
			return fmt.Errorf("build was cancelled")
		}
	}
}

func (o *launchOrchestrator) executeDeploy(ctx context.Context, config api.LaunchOrchestratorConfig) error {
	cfg := config.Configuration
	deployMode := cfg.Deploy.Mode

	switch deployMode {
	case "exploded":
		return o.executeExplodedDeploy(ctx, config)
	case "war":
		return o.executeWARDeploy(ctx, config)
	default:
		return fmt.Errorf("unknown deploy mode: %s", deployMode)
	}
}

func (o *launchOrchestrator) executeExplodedDeploy(ctx context.Context, config api.LaunchOrchestratorConfig) error {
	cfg := config.Configuration
	artifact := config.ArtifactPath
	policy := pathpolicy.NewDefaultPathPolicy()

	// Validate artifact is within project root.
	if _, err := policy.ResolveWithin(config.ProjectRoot, filepath.ToSlash(artifact)); err != nil {
		return fmt.Errorf("artifact path safety check failed: %w", err)
	}

	info, err := os.Stat(artifact)
	if err != nil {
		return fmt.Errorf("artifact not found: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("artifact is not a directory for exploded deploy")
	}

	// Determine deployment target: the Tomcat webapps directory.
	// We deploy to a location under the agent's data directory so the
	// server runner can use it as webappDir.
	contextName := strings.TrimPrefix(cfg.Server.ContextPath, "/")
	if contextName == "" {
		contextName = "ROOT"
	}
	deployID := "deploy_" + shortID()
	target := filepath.Join(o.dataDir, "runtime", deployID, "webapps", contextName)

	// Clean old deployment directory.
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("clean old deployment: %w", err)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return fmt.Errorf("create deployment target: %w", err)
	}

	// Use the deployer to sync artifacts to the target.
	_, err = o.deployer.Publish(api.DeployRequest{
		ProjectID: cfg.ProjectID,
		What:      "all",
		Source:    artifact,
		Target:    target,
		Mode:      "mirror",
		Trigger:   "manual",
	})
	if err != nil {
		return fmt.Errorf("deploy exploded artifact: %w", err)
	}

	return nil
}

func (o *launchOrchestrator) executeWARDeploy(ctx context.Context, config api.LaunchOrchestratorConfig) error {
	cfg := config.Configuration
	artifact := config.ArtifactPath
	policy := pathpolicy.NewDefaultPathPolicy()

	// Validate artifact is within project root.
	if _, err := policy.ResolveWithin(config.ProjectRoot, filepath.ToSlash(artifact)); err != nil {
		return fmt.Errorf("artifact path safety check failed: %w", err)
	}

	info, err := os.Stat(artifact)
	if err != nil {
		return fmt.Errorf("WAR file not found: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("artifact is not a regular file for WAR deploy")
	}
	if !strings.HasSuffix(strings.ToLower(artifact), ".war") {
		return fmt.Errorf("artifact must be a .war file")
	}

	// Determine deployment target.
	contextName := strings.TrimPrefix(cfg.Server.ContextPath, "/")
	if contextName == "" {
		contextName = "ROOT"
	}
	deployID := "deploy_" + shortID()
	targetDir := filepath.Join(o.dataDir, "runtime", deployID, "webapps")
	targetFile := filepath.Join(targetDir, contextName+".war")

	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fmt.Errorf("create deployment target directory: %w", err)
	}

	// Clean old deployment.
	_ = os.Remove(targetFile)

	// Copy WAR file.
	if err := copyFile(artifact, targetFile); err != nil {
		return fmt.Errorf("copy WAR file: %w", err)
	}

	return nil
}

func (o *launchOrchestrator) executeRun(ctx context.Context, config api.LaunchOrchestratorConfig) (*api.ServerResponse, error) {
	cfg := config.Configuration
	debug := cfg.Mode == "debug"
	debugPort := 0
	if debug {
		debugPort = cfg.Server.DebugPort
	}
	server, err := o.serverRunner.Start(api.StartServerRequest{
		ProjectID:    cfg.ProjectID,
		Debug:        debug,
		JavaHome:     config.JavaHome,
		WebappDir:    config.ArtifactPath,
		ContextPath:  cfg.Server.ContextPath,
		HTTPPort:     cfg.Server.HTTPPort,
		DebugPort:    debugPort,
		DebugSuspend: debug && cfg.Suspend,
		JVMOptions:   append([]string(nil), cfg.VMOptions...),
		Env:          config.Env,
	})
	if err != nil {
		return nil, fmt.Errorf("start server: %w", err)
	}
	return server, nil
}

// copyFile copies a file from src to dst preserving permissions.
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	dstFile, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, srcInfo.Mode())
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}