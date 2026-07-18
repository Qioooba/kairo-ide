package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/proc"
	"github.com/kairo-ide/runtime-agent/internal/repository"
	"github.com/kairo-ide/runtime-agent/internal/transport/events"
)

// ErrRestartStopFailed indicates the restart failed during the stop phase.
type ErrRestartStopFailed struct {
	Phase       string
	Recoverable bool
	Cause       error
}

func (e *ErrRestartStopFailed) Error() string {
	return fmt.Sprintf("restart failed at %s phase: %v", e.Phase, e.Cause)
}

// ErrRestartStartFailed indicates the restart failed during the start phase.
type ErrRestartStartFailed struct {
	Phase       string
	Recoverable bool
	Cause       error
}

func (e *ErrRestartStartFailed) Error() string {
	return fmt.Sprintf("restart failed at %s phase: %v", e.Phase, e.Cause)
}

// serverUseCaseImpl implements ServerUseCase.
type serverUseCaseImpl struct {
	mu          sync.RWMutex
	provider    domain.RuntimeProvider
	history     domain.ServerHistoryRepository
	eventHub    *events.EventHub
	configDir   string
	cfg         ServerUseCaseConfig
	activePlans map[domain.ServerID]*domain.RuntimePlan
}

// NewServerUseCase creates a new ServerUseCase implementation.
func NewServerUseCase(
	provider domain.RuntimeProvider,
	history domain.ServerHistoryRepository,
	eventHub *events.EventHub,
	configDir string,
	cfg ServerUseCaseConfig,
) ServerUseCase {
	if cfg.StartTimeout <= 0 {
		cfg.StartTimeout = 60 * time.Second
	}
	if cfg.StopTimeout <= 0 {
		cfg.StopTimeout = 30 * time.Second
	}
	return &serverUseCaseImpl{
		provider:    provider,
		history:     history,
		eventHub:    eventHub,
		configDir:   configDir,
		cfg:         cfg,
		activePlans: make(map[domain.ServerID]*domain.RuntimePlan),
	}
}

func (uc *serverUseCaseImpl) Start(ctx context.Context, cmd StartServerCommand) (*domain.ServerInstance, error) {
	// Resolve the project root from the repository.
	projectRoot, err := resolveProjectRootFromRepo(uc.configDir, string(cmd.WorkspaceID), string(cmd.ProjectID))
	if err != nil {
		return nil, fmt.Errorf("resolve project root: %w", err)
	}

	cfg, err := repository.LoadProjectConfig(projectRoot)
	if err != nil {
		cfg = &repository.ProjectConfig{}
	}

	// Build project domain object with resolved absolute paths
	project := domain.Project{
		ID:            cmd.ProjectID,
		WorkspaceID:   cmd.WorkspaceID,
		SourceRoots:   cfg.SourceRoots,
		ResourceRoots: cfg.ResourceRoots,
		WebappDir:     cfg.WebappDir,
		OutputDir:     cfg.OutputDir,
		SourceLevel:   cfg.SourceLevel,
		Encoding:      cfg.Encoding,
		BuildTool:     cfg.BuildTool,
		ContextPath:   cfg.ContextPath,
	}

	// Prepare: resolve RuntimePlan from project
	plan, err := uc.provider.Prepare(ctx, project)
	if err != nil {
		return nil, fmt.Errorf("prepare: %w", err)
	}

	// Resolve JavaHome from toolchain repository or environment
	tc, err := resolveJavaHome(uc.configDir)
	if err != nil {
		return nil, fmt.Errorf("resolve toolchain: %w", err)
	}
	plan.JavaHome = tc

	// Resolve AbsoluteWebappDir from project root
	plan.AbsoluteWebappDir = resolvePath(projectRoot, cfg.WebappDir)

	// Generate a random ServerID for the CatalinaBase directory name.
	// Never use the raw ProjectID — it may contain special characters
	// or collide across projects.
	serverID, err := generateServerID()
	if err != nil {
		return nil, fmt.Errorf("generate server id: %w", err)
	}
	plan.ServerID = serverID

	// Set CatalinaBase - use a unique directory per server instance.
	catalinaBase := filepath.Join(os.TempDir(), "kairo-tomcat6", string(serverID))
	if err := os.MkdirAll(catalinaBase, 0755); err != nil {
		return nil, fmt.Errorf("create catalina base: %w", err)
	}
	plan.CatalinaBase = catalinaBase

	// Start the server with timeout
	startCtx, cancel := context.WithTimeout(ctx, uc.cfg.StartTimeout)
	defer cancel()

	inst, err := uc.provider.Start(startCtx, *plan)
	if err != nil {
		return nil, fmt.Errorf("start server: %w", err)
	}

	inst.WorkspaceID = cmd.WorkspaceID
	inst.ProjectID = cmd.ProjectID
	inst.LastPlan = plan

	uc.mu.Lock()
	uc.activePlans[inst.ID] = plan
	uc.mu.Unlock()

	// Persist to history
	if uc.history != nil {
		_ = uc.history.Save(ctx, *inst)
	}

	// Publish event
	uc.publishServerEvent(string(cmd.WorkspaceID), inst.ID, events.EventServerStarted, inst)

	return inst, nil
}

func (uc *serverUseCaseImpl) Stop(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID, force bool) error {
	uc.mu.Lock()
	delete(uc.activePlans, serverID)
	uc.mu.Unlock()

	stopCtx, cancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
	defer cancel()

	err := uc.provider.Stop(stopCtx, serverID, force)
	if err != nil {
		// Try force stop on graceful failure
		if !force {
			_ = uc.provider.Stop(stopCtx, serverID, true)
		}
	}

	// Update history
	if uc.history != nil {
		inst := &domain.ServerInstance{
			ID:          serverID,
			WorkspaceID: workspaceID,
			State:       domain.ServerStateStopped,
		}
		_ = uc.history.Save(ctx, *inst)
	}

	// Publish event
	uc.publishServerEvent(string(workspaceID), serverID, events.EventServerStopped, nil)

	return err
}

func (uc *serverUseCaseImpl) Restart(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerInstance, error) {
	// 1. Get current server from history
	inst, err := uc.provider.Inspect(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("inspect server: %w", err)
	}

	// 2. Save the original plan for restart
	uc.mu.RLock()
	plan, hasPlan := uc.activePlans[serverID]
	uc.mu.RUnlock()

	if !hasPlan {
		// Try to recover from history
		if uc.history != nil {
			histInst, histErr := uc.history.Get(ctx, workspaceID, serverID)
			if histErr == nil && histInst.LastPlan != nil {
				plan = histInst.LastPlan
				hasPlan = true
			}
		}
	}

	if !hasPlan {
		if inst.State == domain.ServerStateStopped {
			return nil, fmt.Errorf("server %s is not running and no saved plan available", serverID)
		}
		// Create a minimal plan from the current instance
		plan = &domain.RuntimePlan{
			ServerID: serverID,
		}
	}

	// 3. Stop gracefully
	stopCtx, stopCancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
	defer stopCancel()

	stopErr := uc.provider.Stop(stopCtx, serverID, false)
	if stopErr != nil {
		// Try force stop if graceful fails
		_ = uc.provider.Stop(stopCtx, serverID, true)
	}

	// 4. Wait for the process to actually exit
	if err := uc.waitForStop(ctx, serverID); err != nil {
		return nil, &ErrRestartStopFailed{
			Phase:       "stop",
			Recoverable: true,
			Cause:       fmt.Errorf("stop failed: %w", err),
		}
	}

	// 5. Generate a new ServerID for the new instance
	newServerID, err := generateServerID()
	if err != nil {
		return nil, fmt.Errorf("generate new server id: %w", err)
	}
	plan.ServerID = newServerID

	// Generate a new CatalinaBase
	catalinaBase := filepath.Join(os.TempDir(), "kairo-tomcat6", string(newServerID))
	if err := os.MkdirAll(catalinaBase, 0755); err != nil {
		return nil, fmt.Errorf("create catalina base: %w", err)
	}
	plan.CatalinaBase = catalinaBase

	// 6. Start with the same plan
	startCtx, startCancel := context.WithTimeout(ctx, uc.cfg.StartTimeout)
	defer startCancel()

	newInst, startErr := uc.provider.Start(startCtx, *plan)
	if startErr != nil {
		return nil, &ErrRestartStartFailed{
			Phase:       "start",
			Recoverable: true,
			Cause:       startErr,
		}
	}

	newInst.WorkspaceID = workspaceID
	newInst.ProjectID = inst.ProjectID
	newInst.LastPlan = plan

	uc.mu.Lock()
	uc.activePlans[newInst.ID] = plan
	delete(uc.activePlans, serverID)
	uc.mu.Unlock()

	// Persist to history
	if uc.history != nil {
		_ = uc.history.Save(ctx, *newInst)
	}

	// Publish event
	uc.publishServerEvent(string(workspaceID), newInst.ID, events.EventServerStarted, newInst)

	return newInst, nil
}

func (uc *serverUseCaseImpl) Get(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerInstance, error) {
	inst, err := uc.provider.Inspect(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("inspect server: %w", err)
	}
	inst.WorkspaceID = workspaceID
	return inst, nil
}

func (uc *serverUseCaseImpl) List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.ServerInstance, error) {
	uc.mu.RLock()
	defer uc.mu.RUnlock()

	var result []domain.ServerInstance
	for serverID := range uc.activePlans {
		inst, err := uc.provider.Inspect(ctx, serverID)
		if err != nil {
			inst = &domain.ServerInstance{
				ID:    serverID,
				State: domain.ServerStateStopped,
			}
		}
		inst.WorkspaceID = workspaceID
		result = append(result, *inst)
	}
	return result, nil
}

// Reconcile checks all persisted server records and marks stale ones as crashed.
// Should be called on Agent startup.
func (uc *serverUseCaseImpl) Reconcile(ctx context.Context) error {
	if uc.history == nil {
		return nil
	}

	// Load all servers from history. We iterate over all workspaces
	// by listing known workspace directories.
	workspaces, err := repository.LoadWorkspaces(uc.configDir)
	if err != nil {
		return fmt.Errorf("load workspaces for reconciliation: %w", err)
	}

	for _, ws := range workspaces {
		servers, listErr := uc.history.List(ctx, ws.ID)
		if listErr != nil {
			continue
		}

		for _, s := range servers {
			if s.State == domain.ServerStateRunning || s.State == domain.ServerStateStarting {
				// Check if the process is still alive
				if s.PID > 0 && !proc.IsAlive(s.PID) {
					s.State = domain.ServerStateCrashed
					s.Error = "Process no longer exists"
					_ = uc.history.Save(ctx, s)
					uc.publishServerEvent(string(ws.ID), s.ID, events.EventServerError, &s)
				}
			}
		}
	}
	return nil
}

// waitForStop polls the provider until the server is stopped.
func (uc *serverUseCaseImpl) waitForStop(ctx context.Context, serverID domain.ServerID) error {
	deadline := time.Now().Add(uc.cfg.StopTimeout)
	for time.Now().Before(deadline) {
		inst, err := uc.provider.Inspect(ctx, serverID)
		if err != nil || inst.State == domain.ServerStateStopped || inst.State == domain.ServerStateCrashed {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("server %s did not stop within %v", serverID, uc.cfg.StopTimeout)
}

// publishServerEvent publishes a server state change event through EventHub.
func (uc *serverUseCaseImpl) publishServerEvent(workspaceID string, serverID domain.ServerID, eventType events.EventType, data interface{}) {
	if uc.eventHub == nil {
		return
	}
	uc.eventHub.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: workspaceID,
		Data:        data,
	})
}

// Recoverable checks if the restart error is recoverable (server is still running).
func Recoverable(err error) bool {
	if e, ok := err.(*ErrRestartStopFailed); ok {
		return e.Recoverable
	}
	if e, ok := err.(*ErrRestartStartFailed); ok {
		return e.Recoverable
	}
	return false
}

// RestartPhase returns the phase where restart failed, or empty string.
func RestartPhase(err error) string {
	if e, ok := err.(*ErrRestartStopFailed); ok {
		return e.Phase
	}
	if e, ok := err.(*ErrRestartStartFailed); ok {
		return e.Phase
	}
	return ""
}

// generateServerID creates a random hex-encoded server ID for use as a
// directory name. Never uses the raw ProjectID.
func generateServerID() (domain.ServerID, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate random server id: %w", err)
	}
	return domain.ServerID(hex.EncodeToString(b)), nil
}

// resolveJavaHome resolves the Java home path from toolchain repository or environment.
func resolveJavaHome(configDir string) (string, error) {
	// Try to find from toolchain repository
	toolchains, err := repository.LoadToolchains(configDir)
	if err == nil && len(toolchains) > 0 {
		return toolchains[0].JavaHome, nil
	}
	// Fall back to JAVA_HOME environment variable
	if javaHome := os.Getenv("JAVA_HOME"); javaHome != "" {
		return javaHome, nil
	}
	return "", fmt.Errorf("no toolchain found and JAVA_HOME not set")
}

// resolveProjectRootFromRepo resolves the project root directory from the repository.
func resolveProjectRootFromRepo(configDir, workspaceID, projectID string) (string, error) {
	workspaces, err := repository.LoadWorkspaces(configDir)
	if err != nil {
		return "", fmt.Errorf("load workspaces: %w", err)
	}
	for _, ws := range workspaces {
		if string(ws.ID) == workspaceID {
			projectRoot := ws.Root
			if _, err := os.Stat(repository.ProjectConfigPath(projectRoot)); err == nil {
				return projectRoot, nil
			}
			// Try subdirectory matching
			entries, err := os.ReadDir(projectRoot)
			if err != nil {
				continue
			}
			for _, entry := range entries {
				if entry.IsDir() {
					subPath := projectRoot + "/" + entry.Name()
					if _, err := os.Stat(repository.ProjectConfigPath(subPath)); err == nil {
						return subPath, nil
					}
				}
			}
		}
	}
	return "", fmt.Errorf("project %s not found in workspace %s", projectID, workspaceID)
}