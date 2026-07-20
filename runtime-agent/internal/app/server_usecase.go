package app

import (
	"context"
	"fmt"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// StartServerCommand is the typed command to start a server.
type StartServerCommand struct {
	WorkspaceID domain.WorkspaceID
	ProjectID   domain.ProjectID
	ServerID    *domain.ServerID
}

// StopServerCommand is the typed command to stop a server.
type StopServerCommand struct {
	WorkspaceID domain.WorkspaceID
	ServerID    domain.ServerID
	Force       bool
}

// RestartServerCommand is the typed command to restart a server.
type RestartServerCommand struct {
	WorkspaceID domain.WorkspaceID
	ServerID    domain.ServerID
}

// ServerUseCaseConfig holds configuration for ServerUseCase.
type ServerUseCaseConfig struct {
	StartTimeout   time.Duration
	StopTimeout    time.Duration
	ReadinessCheck time.Duration
}

// DefaultServerUseCaseConfig returns sensible defaults.
func DefaultServerUseCaseConfig() ServerUseCaseConfig {
	return ServerUseCaseConfig{
		StartTimeout:   60 * time.Second,
		StopTimeout:    15 * time.Second,
		ReadinessCheck: 30 * time.Second,
	}
}

// ServerUseCase handles server lifecycle operations through the typed app layer.
// RuntimePlan is resolved from Project, Toolchain, Tomcat distribution, PortAllocator.
// CatalinaBase uses random ServerID (UUID), not raw ProjectID.
// Start/stop timeout from config.
type ServerUseCase struct {
	projectRepo     domain.ProjectRepository
	serverRepo      domain.ServerHistoryRepository
	portAlloc       domain.PortAllocator
	runtimeProvider domain.RuntimeProvider
	resolver        *PlanResolver
	eventHub        *events.EventHub
	cfg             ServerUseCaseConfig
}

// NewServerUseCase creates a new ServerUseCase.
func NewServerUseCase(
	projectRepo domain.ProjectRepository,
	serverRepo domain.ServerHistoryRepository,
	portAlloc domain.PortAllocator,
	runtimeProvider domain.RuntimeProvider,
	resolver *PlanResolver,
	eventHub *events.EventHub,
	cfg ServerUseCaseConfig,
) *ServerUseCase {
	return &ServerUseCase{
		projectRepo:     projectRepo,
		serverRepo:      serverRepo,
		portAlloc:       portAlloc,
		runtimeProvider: runtimeProvider,
		resolver:        resolver,
		eventHub:        eventHub,
		cfg:             cfg,
	}
}

// Start initiates a server for a project.
// It resolves a RuntimePlan, allocates ports, and starts the runtime.
func (uc *ServerUseCase) Start(ctx context.Context, cmd StartServerCommand) (*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if cmd.WorkspaceID == "" {
		return nil, fmt.Errorf("%w: workspaceId is required", domain.ErrInvalidInput)
	}
	if cmd.ProjectID == "" {
		return nil, fmt.Errorf("%w: projectId is required", domain.ErrInvalidInput)
	}

	project, err := uc.projectRepo.Get(ctx, cmd.WorkspaceID, cmd.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	runtimePlan, err := uc.resolver.ResolveRuntime(ctx, *project)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime plan: %w", err)
	}

	// Allocate ports
	portLease, err := uc.portAlloc.Allocate(0, 0, 0)
	if err != nil {
		return nil, fmt.Errorf("allocate ports: %w", err)
	}
	defer func() {
		// If we fail after allocating ports, release them
		if err != nil {
			portLease.Release()
		}
	}()

	runtimePlan.Port = portLease.HTTPPort

	// Generate server ID from UUID
	serverID := domain.ServerID(fmt.Sprintf("srv_%d", time.Now().UnixNano()))
	now := domain.UTCNow()

	domainPlan := domain.RuntimePlan{
		WorkspaceID:    cmd.WorkspaceID,
		ProjectID:      cmd.ProjectID,
		ServerID:       serverID,
		RuntimeID:      project.RuntimeID,
		JavaHome:       runtimePlan.JavaHome,
		CatalinaBase:   runtimePlan.CatalinaBase,
		WebappDir:      runtimePlan.WebappDir,
		DeploymentRoot: runtimePlan.CatalinaBase + "/webapps/" + project.ContextPath,
		ContextPath:    runtimePlan.ContextPath,
		HTTPPort:       runtimePlan.Port,
		ShutdownPort:   portLease.ShutdownPort,
		DebugPort:      portLease.DebugPort,
		Generation:     1,
	}

	record := domain.ServerRecord{
		ID:            serverID,
		WorkspaceID:   cmd.WorkspaceID,
		ProjectID:     cmd.ProjectID,
		DesiredState:  domain.DesiredServerStateRunning,
		ObservedState: domain.ServerStatePreparing,
		Generation:    1,
		UpdatedAt:     now,
		RuntimePlan:   domainPlan,
	}

	if err := uc.serverRepo.Save(ctx, record); err != nil {
		return nil, fmt.Errorf("save server record: %w", err)
	}

	uc.eventHub.Publish(events.Event{
		Type:        events.EventServerStarted,
		WorkspaceID: string(cmd.WorkspaceID),
		Message:     fmt.Sprintf("Server %s preparing", serverID),
		Data:        record,
	})

	// Start the runtime asynchronously
	go uc.startRuntime(context.Background(), record, portLease)

	return &record, nil
}

// startRuntime launches the runtime process and updates the record.
func (uc *ServerUseCase) startRuntime(ctx context.Context, record domain.ServerRecord, portLease *domain.PortLease) {
	defer portLease.Release()

	// Transition to starting
	now := domain.UTCNow()
	record.ObservedState = domain.ServerStateStarting
	record.StartedAt = &now
	record.UpdatedAt = now
	if err := uc.serverRepo.Save(ctx, record); err != nil {
		return
	}

	// Create domain RuntimePlan from the resolved plan
	plan := record.RuntimePlan

	// Prepare the runtime
	if uc.runtimeProvider != nil {
		if err := uc.runtimeProvider.Prepare(ctx, plan); err != nil {
			record.ObservedState = domain.ServerStateFailed
			record.LastError = fmt.Sprintf("prepare failed: %v", err)
			record.UpdatedAt = domain.UTCNow()
			uc.serverRepo.Save(context.Background(), record)
			uc.eventHub.Publish(events.Event{
				Type:        events.EventServerError,
				WorkspaceID: string(record.WorkspaceID),
				Message:     fmt.Sprintf("Server %s prepare failed: %v", record.ID, err),
			})
			return
		}

		// Start the runtime
		logSink := func(logLine domain.LogLine) {
			// Log lines could be accumulated here
		}

		pi, err := uc.runtimeProvider.Start(ctx, plan, logSink)
		if err != nil {
			record.ObservedState = domain.ServerStateFailed
			record.LastError = fmt.Sprintf("start failed: %v", err)
			record.UpdatedAt = domain.UTCNow()
			uc.serverRepo.Save(context.Background(), record)
			uc.eventHub.Publish(events.Event{
				Type:        events.EventServerError,
				WorkspaceID: string(record.WorkspaceID),
				Message:     fmt.Sprintf("Server %s start failed: %v", record.ID, err),
			})
			return
		}

		record.PID = pi.PID
		record.ProcessIdentity = pi
	}

	// Transition to running
	record.ObservedState = domain.ServerStateRunning
	record.UpdatedAt = domain.UTCNow()
	if err := uc.serverRepo.Save(ctx, record); err != nil {
		return
	}

	uc.eventHub.Publish(events.Event{
		Type:        events.EventServerStarted,
		WorkspaceID: string(record.WorkspaceID),
		Message:     fmt.Sprintf("Server %s running (PID=%d)", record.ID, record.PID),
		Data:        record,
	})
}

// Stop stops a running server. Supports force mode.
func (uc *ServerUseCase) Stop(ctx context.Context, cmd StopServerCommand) (*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if cmd.WorkspaceID == "" {
		return nil, fmt.Errorf("%w: workspaceId is required", domain.ErrInvalidInput)
	}
	if cmd.ServerID == "" {
		return nil, fmt.Errorf("%w: serverId is required", domain.ErrInvalidInput)
	}

	record, err := uc.serverRepo.Get(ctx, cmd.WorkspaceID, cmd.ServerID)
	if err != nil {
		return nil, err
	}

	record.DesiredState = domain.DesiredServerStateStopped
	record.ObservedState = domain.ServerStateStopping
	record.UpdatedAt = domain.UTCNow()

	if err := uc.serverRepo.Save(ctx, *record); err != nil {
		return nil, fmt.Errorf("save server record: %w", err)
	}

	// Graceful stop
	if uc.runtimeProvider != nil && record.ProcessIdentity != nil {
		stopCtx, cancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
		defer cancel()

		err := uc.runtimeProvider.GracefulStop(stopCtx, *record.ProcessIdentity)
		if err != nil && cmd.Force {
			// Force stop
			forceCtx, forceCancel := context.WithTimeout(context.Background(), uc.cfg.StopTimeout)
			defer forceCancel()
			_ = uc.runtimeProvider.ForceStop(forceCtx, *record.ProcessIdentity)
		}
	}

	record.ObservedState = domain.ServerStateStopped
	now := domain.UTCNow()
	record.StoppedAt = &now
	record.UpdatedAt = now
	record.PID = 0
	record.ProcessIdentity = nil

	if err := uc.serverRepo.Save(ctx, *record); err != nil {
		return nil, fmt.Errorf("save server record: %w", err)
	}

	uc.eventHub.Publish(events.Event{
		Type:        events.EventServerStopped,
		WorkspaceID: string(cmd.WorkspaceID),
		Message:     fmt.Sprintf("Server %s stopped", cmd.ServerID),
	})

	return record, nil
}

// Restart is atomic: save plan → graceful stop → force if needed → start → return new state.
// UI only calls /restart, never loops Stop/Start itself.
func (uc *ServerUseCase) Restart(ctx context.Context, cmd RestartServerCommand) (*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if cmd.WorkspaceID == "" {
		return nil, fmt.Errorf("%w: workspaceId is required", domain.ErrInvalidInput)
	}
	if cmd.ServerID == "" {
		return nil, fmt.Errorf("%w: serverId is required", domain.ErrInvalidInput)
	}

	record, err := uc.serverRepo.Get(ctx, cmd.WorkspaceID, cmd.ServerID)
	if err != nil {
		return nil, err
	}

	// Save plan
	record.ObservedState = domain.ServerStateRestarting
	record.UpdatedAt = domain.UTCNow()
	if err := uc.serverRepo.Save(ctx, *record); err != nil {
		return nil, fmt.Errorf("save restarting state: %w", err)
	}

	uc.eventHub.Publish(events.Event{
		Type:        events.EventServerStarted, // restarting counts as a start event
		WorkspaceID: string(cmd.WorkspaceID),
		Message:     fmt.Sprintf("Server %s restarting", cmd.ServerID),
	})

	// Graceful stop
	if uc.runtimeProvider != nil && record.ProcessIdentity != nil {
		stopCtx, stopCancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
		defer stopCancel()

		if err := uc.runtimeProvider.GracefulStop(stopCtx, *record.ProcessIdentity); err != nil {
			// Force stop
			forceCtx, forceCancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
			defer forceCancel()
			_ = uc.runtimeProvider.ForceStop(forceCtx, *record.ProcessIdentity)
		}
	}

	// Start new process
	plan := record.RuntimePlan
	plan.Generation = record.Generation + 1

	if uc.runtimeProvider != nil {
		if err := uc.runtimeProvider.Prepare(ctx, plan); err != nil {
			record.ObservedState = domain.ServerStateFailed
			record.LastError = fmt.Sprintf("restart prepare failed: %v", err)
			record.UpdatedAt = domain.UTCNow()
			uc.serverRepo.Save(ctx, *record)
			return nil, fmt.Errorf("restart prepare: %w", err)
		}

		logSink := func(logLine domain.LogLine) {}
		pi, err := uc.runtimeProvider.Start(ctx, plan, logSink)
		if err != nil {
			record.ObservedState = domain.ServerStateFailed
			record.LastError = fmt.Sprintf("restart start failed: %v", err)
			record.UpdatedAt = domain.UTCNow()
			uc.serverRepo.Save(ctx, *record)
			return nil, fmt.Errorf("restart start: %w", err)
		}

		record.PID = pi.PID
		record.ProcessIdentity = pi
	}

	// Return new state
	record.ObservedState = domain.ServerStateRunning
	record.DesiredState = domain.DesiredServerStateRunning
	record.Generation = plan.Generation
	now := domain.UTCNow()
	record.StartedAt = &now
	record.UpdatedAt = now

	if err := uc.serverRepo.Save(ctx, *record); err != nil {
		return nil, fmt.Errorf("save restarted state: %w", err)
	}

	uc.eventHub.Publish(events.Event{
		Type:        events.EventServerStarted,
		WorkspaceID: string(cmd.WorkspaceID),
		Message:     fmt.Sprintf("Server %s restarted (PID=%d, gen=%d)", cmd.ServerID, record.PID, record.Generation),
		Data:        record,
	})

	return record, nil
}

// Get retrieves a server record.
func (uc *ServerUseCase) Get(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return uc.serverRepo.Get(ctx, workspaceID, serverID)
}

// List retrieves all server records for a workspace.
func (uc *ServerUseCase) List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return uc.serverRepo.List(ctx, workspaceID)
}

// ListByProject retrieves server records for a project.
func (uc *ServerUseCase) ListByProject(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) ([]*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return uc.serverRepo.ListByProject(ctx, workspaceID, projectID, 50)
}

// Delete stops and removes a server record.
func (uc *ServerUseCase) Delete(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	record, err := uc.serverRepo.Get(ctx, workspaceID, serverID)
	if err != nil {
		return err
	}

	// Stop if running
	if !record.ObservedState.IsTerminal() && uc.runtimeProvider != nil && record.ProcessIdentity != nil {
		stopCtx, stopCancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
		defer stopCancel()
		_ = uc.runtimeProvider.GracefulStop(stopCtx, *record.ProcessIdentity)
	}

	return uc.serverRepo.Delete(ctx, workspaceID, serverID)
}

// Reconcile checks saved server records against real PIDs, marking stale records.
func (uc *ServerUseCase) Reconcile(ctx context.Context) error {
	records, err := uc.serverRepo.ListNonTerminal(ctx)
	if err != nil {
		return fmt.Errorf("list non-terminal: %w", err)
	}

	for _, record := range records {
		if record == nil || record.ProcessIdentity == nil {
			continue
		}

		if uc.runtimeProvider != nil {
			obs, err := uc.runtimeProvider.Inspect(ctx, *record.ProcessIdentity)
			if err != nil || !obs.Running {
				// Process is no longer running
				record.ObservedState = domain.ServerStateCrashed
				now := domain.UTCNow()
				record.StoppedAt = &now
				record.UpdatedAt = now
				record.PID = 0
				record.ProcessIdentity = nil
				uc.serverRepo.Save(ctx, *record)

				uc.eventHub.Publish(events.Event{
					Type:        events.EventServerError,
					WorkspaceID: string(record.WorkspaceID),
					Message:     fmt.Sprintf("Server %s crashed (PID not found)", record.ID),
				})
			}
		}
	}

	return nil
}

// Shutdown stops all child processes.
func (uc *ServerUseCase) Shutdown(ctx context.Context) error {
	records, err := uc.serverRepo.ListNonTerminal(ctx)
	if err != nil {
		return fmt.Errorf("list non-terminal: %w", err)
	}

	for _, record := range records {
		if record == nil || record.ProcessIdentity == nil {
			continue
		}

		if uc.runtimeProvider != nil {
			forceCtx, cancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
			defer cancel()
			_ = uc.runtimeProvider.ForceStop(forceCtx, *record.ProcessIdentity)
		}

		record.ObservedState = domain.ServerStateStopped
		now := domain.UTCNow()
		record.StoppedAt = &now
		record.UpdatedAt = now
		record.PID = 0
		record.ProcessIdentity = nil
		uc.serverRepo.Save(ctx, *record)
	}

	return nil
}
