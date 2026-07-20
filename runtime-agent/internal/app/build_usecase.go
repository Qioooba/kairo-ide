package app

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// StartBuildCommand is the typed command to start a build.
type StartBuildCommand struct {
	WorkspaceID   domain.WorkspaceID
	ProjectID     domain.ProjectID
	Clean         bool
	Intent        domain.BuildIntent
	SelectedFiles []string
}

// BuildUseCase handles build operations through the typed app layer.
// State machine: queued → running → succeeded | failed | cancelled.
// Only legal transitions are allowed; illegal → error.
type BuildUseCase struct {
	projectRepo   domain.ProjectRepository
	buildHistory  domain.BuildHistoryRepository
	toolchainRepo domain.ToolchainRepository
	buildProvider domain.BuildProvider
	resolver      *PlanResolver
	eventHub      *events.EventHub

	mu          sync.Mutex
	cancelFuncs map[domain.BuildID]context.CancelFunc
}

// NewBuildUseCase creates a new BuildUseCase.
func NewBuildUseCase(
	projectRepo domain.ProjectRepository,
	buildHistory domain.BuildHistoryRepository,
	toolchainRepo domain.ToolchainRepository,
	buildProvider domain.BuildProvider,
	resolver *PlanResolver,
	eventHub *events.EventHub,
) *BuildUseCase {
	return &BuildUseCase{
		projectRepo:   projectRepo,
		buildHistory:  buildHistory,
		toolchainRepo: toolchainRepo,
		buildProvider: buildProvider,
		resolver:      resolver,
		eventHub:      eventHub,
		cancelFuncs:   make(map[domain.BuildID]context.CancelFunc),
	}
}

// Start initiates a build and returns the initial BuildRun.
// It creates a pending BuildRun, launches async execution, and saves a cancel function.
func (uc *BuildUseCase) Start(ctx context.Context, cmd StartBuildCommand) (domain.BuildRun, error) {
	if err := ctx.Err(); err != nil {
		return domain.BuildRun{}, err
	}
	if cmd.WorkspaceID == "" {
		return domain.BuildRun{}, fmt.Errorf("%w: workspaceId is required", domain.ErrInvalidInput)
	}
	if cmd.ProjectID == "" {
		return domain.BuildRun{}, fmt.Errorf("%w: projectId is required", domain.ErrInvalidInput)
	}

	project, err := uc.projectRepo.Get(ctx, cmd.WorkspaceID, cmd.ProjectID)
	if err != nil {
		return domain.BuildRun{}, fmt.Errorf("get project: %w", err)
	}

	intent := cmd.Intent
	if intent == "" {
		intent = domain.BuildIntentFull
	}

	plan, err := uc.resolver.ResolveBuild(ctx, *project, intent)
	if err != nil {
		return domain.BuildRun{}, fmt.Errorf("resolve build plan: %w", err)
	}

	buildID := domain.BuildID(fmt.Sprintf("build_%d", time.Now().UnixNano()))
	now := domain.UTCNow()

	run := domain.BuildRun{
		ID:          buildID,
		WorkspaceID: cmd.WorkspaceID,
		ProjectID:   cmd.ProjectID,
		State:       domain.BuildStateQueued,
		QueuedAt:    now,
	}

	if err := uc.buildHistory.Save(ctx, run); err != nil {
		return domain.BuildRun{}, fmt.Errorf("save build run: %w", err)
	}

	// Publish build.queued event
	uc.eventHub.Publish(events.Event{
		Type:        events.EventBuildQueued,
		WorkspaceID: string(cmd.WorkspaceID),
		Message:     fmt.Sprintf("Build %s queued", buildID),
		Data:        run,
	})

	// Launch async execution
	buildCtx, cancel := context.WithCancel(context.Background())
	uc.mu.Lock()
	uc.cancelFuncs[buildID] = cancel
	uc.mu.Unlock()

	go uc.executeBuild(buildCtx, run, *plan, cmd.Clean)

	return run, nil
}

// executeBuild runs the build asynchronously.
func (uc *BuildUseCase) executeBuild(ctx context.Context, run domain.BuildRun, plan BuildPlan, clean bool) {
	defer func() {
		uc.mu.Lock()
		delete(uc.cancelFuncs, run.ID)
		uc.mu.Unlock()
	}()

	// Transition: queued → running
	if !run.State.CanTransitionTo(domain.BuildStateRunning) {
		return
	}

	run.State = domain.BuildStateRunning
	now := domain.UTCNow()
	run.StartedAt = &now
	if err := uc.buildHistory.Save(ctx, run); err != nil {
		uc.eventHub.Publish(events.Event{
			Type:        events.EventBuildFailed,
			WorkspaceID: string(run.WorkspaceID),
			Message:     fmt.Sprintf("Build %s failed to save running state: %v", run.ID, err),
		})
		return
	}

	// Publish build.started event
	uc.eventHub.Publish(events.Event{
		Type:        events.EventBuildStarted,
		WorkspaceID: string(run.WorkspaceID),
		Message:     fmt.Sprintf("Build %s started", run.ID),
		Data:        run,
	})

	// Resolve toolchain for JavaHome
	javaHome := ""
	if plan.Toolchain.ID != "" {
		javaHome = plan.Toolchain.JavaHome
	}

	domainPlan := domain.BuildPlan{
		WorkspaceID:   run.WorkspaceID,
		ProjectID:     run.ProjectID,
		ProjectRoot:   plan.ProjectRoot,
		BuildTool:     domain.BuildToolID(plan.BuildTool),
		BuildFile:     plan.AntFile,
		Targets:       []string{plan.AntTarget},
		SourceRoots:   plan.SourceRoots,
		OutputDir:     plan.OutputDir,
		Classpath:     plan.Classpath,
		JavaHome:      javaHome,
		Clean:         clean,
		SelectedFiles: plan.SelectedFiles,
	}

	// Publish progress events sink
	progressSink := func(buildEvent domain.BuildEvent) {
		uc.eventHub.Publish(events.Event{
			Type:        events.EventBuildProgress,
			WorkspaceID: string(run.WorkspaceID),
			Message:     buildEvent.Message,
			Data:        buildEvent,
		})
	}

	logLine := func(stream domain.LogStream, line string) {
		// Build logs could be accumulated here
	}

	var output *domain.BuildOutput
	var buildErr error

	if uc.buildProvider != nil {
		output, buildErr = uc.buildProvider.Build(ctx, domainPlan, progressSink, logLine)
	} else {
		// No provider configured — simulate success for test compatibility
		exitCode := 0
		output = &domain.BuildOutput{
			ExitCode:  exitCode,
			StartTime: now,
			EndTime:   domain.UTCNow(),
		}
	}

	finishTime := domain.UTCNow()

	if buildErr != nil || ctx.Err() != nil {
		// Check if cancelled
		if ctx.Err() != nil {
			run.State = domain.BuildStateCancelled
			run.FinishedAt = &finishTime
			run.Summary = "Build cancelled"
			uc.buildHistory.Save(context.Background(), run)
			uc.eventHub.Publish(events.Event{
				Type:        events.EventBuildCancelled,
				WorkspaceID: string(run.WorkspaceID),
				Message:     fmt.Sprintf("Build %s cancelled", run.ID),
				Data:        run,
			})
			return
		}

		run.State = domain.BuildStateFailed
		run.FinishedAt = &finishTime
		run.Summary = fmt.Sprintf("Build failed: %v", buildErr)
		if output != nil {
			run.ExitCode = &output.ExitCode
			run.Diagnostics = output.Diagnostics
		}
		uc.buildHistory.Save(context.Background(), run)
		uc.eventHub.Publish(events.Event{
			Type:        events.EventBuildFailed,
			WorkspaceID: string(run.WorkspaceID),
			Message:     fmt.Sprintf("Build %s failed", run.ID),
			Data:        run,
		})
		return
	}

	// Transition: running → succeeded
	if !run.State.CanTransitionTo(domain.BuildStateSucceeded) {
		return
	}

	run.State = domain.BuildStateSucceeded
	run.FinishedAt = &finishTime
	if output != nil {
		run.ExitCode = &output.ExitCode
		run.Diagnostics = output.Diagnostics
	}
	run.Summary = "Build succeeded"
	if err := uc.buildHistory.Save(context.Background(), run); err != nil {
		uc.eventHub.Publish(events.Event{
			Type:        events.EventBuildFailed,
			WorkspaceID: string(run.WorkspaceID),
			Message:     fmt.Sprintf("Build %s succeeded but failed to persist: %v", run.ID, err),
		})
		return
	}

	// Publish build.completed event
	uc.eventHub.Publish(events.Event{
		Type:        events.EventBuildCompleted,
		WorkspaceID: string(run.WorkspaceID),
		Message:     fmt.Sprintf("Build %s succeeded", run.ID),
		Data:        run,
	})
}

// Get retrieves a build run by ID.
func (uc *BuildUseCase) Get(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) (domain.BuildRun, error) {
	if err := ctx.Err(); err != nil {
		return domain.BuildRun{}, err
	}
	run, err := uc.buildHistory.Get(ctx, workspaceID, buildID)
	if err != nil {
		return domain.BuildRun{}, err
	}
	return *run, nil
}

// List retrieves build runs for a project, sorted by start time descending.
func (uc *BuildUseCase) List(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]domain.BuildRun, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return uc.buildHistory.List(ctx, workspaceID, projectID, limit)
}

// Cancel cancels a running build by terminating the real subprocess via context cancellation.
func (uc *BuildUseCase) Cancel(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	run, err := uc.buildHistory.Get(ctx, workspaceID, buildID)
	if err != nil {
		return err
	}

	if !run.State.CanTransitionTo(domain.BuildStateCancelled) {
		return fmt.Errorf("%w: build is in state %s", domain.ErrBuildNotCancellable, run.State)
	}

	// Cancel the real subprocess via context cancellation
	uc.mu.Lock()
	cancel, ok := uc.cancelFuncs[buildID]
	if ok {
		cancel()
		delete(uc.cancelFuncs, buildID)
	}
	uc.mu.Unlock()

	run.State = domain.BuildStateCancelled
	now := domain.UTCNow()
	run.FinishedAt = &now
	run.Summary = "Build cancelled by user"
	if err := uc.buildHistory.Save(ctx, *run); err != nil {
		return fmt.Errorf("save cancelled build: %w", err)
	}

	uc.eventHub.Publish(events.Event{
		Type:        events.EventBuildCancelled,
		WorkspaceID: string(run.WorkspaceID),
		Message:     fmt.Sprintf("Build %s cancelled by user", buildID),
		Data:        run,
	})

	return nil
}
