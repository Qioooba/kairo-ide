package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/transport/events"
)

// EventPublisher is the interface for publishing build events.
type EventPublisher interface {
	Publish(event events.Event)
}

type buildUseCaseImpl struct {
	mu       sync.Mutex
	builds   map[domain.BuildID]*runningBuild
	history  domain.BuildHistoryRepository
	projects domain.ProjectRepository
	resolver domain.PlanResolver
	eventHub EventPublisher
	antProv  domain.BuildProvider
	javacProv domain.BuildProvider
}

type runningBuild struct {
	run    domain.BuildRun
	cancel context.CancelFunc
	done   chan struct{}
}

// NewBuildUseCase creates a new BuildUseCase implementation.
func NewBuildUseCase(
	history domain.BuildHistoryRepository,
	projects domain.ProjectRepository,
	resolver domain.PlanResolver,
	eventHub EventPublisher,
	antProv domain.BuildProvider,
	javacProv domain.BuildProvider,
) BuildUseCase {
	return &buildUseCaseImpl{
		builds:    make(map[domain.BuildID]*runningBuild),
		history:   history,
		projects:  projects,
		resolver:  resolver,
		eventHub:  eventHub,
		antProv:   antProv,
		javacProv: javacProv,
	}
}

// generateBuildID creates a new unique BuildID using crypto/rand.
func generateBuildID() domain.BuildID {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// Fallback: use timestamp-based ID
		ts := time.Now().UnixNano()
		return domain.BuildID(hex.EncodeToString([]byte{
			byte(ts >> 56), byte(ts >> 48), byte(ts >> 40), byte(ts >> 32),
			byte(ts >> 24), byte(ts >> 16), byte(ts >> 8), byte(ts),
		}))
	}
	return domain.BuildID(hex.EncodeToString(b[:]))
}

func (uc *buildUseCaseImpl) Start(ctx context.Context, cmd StartBuildCommand) (*domain.BuildRun, error) {
	// 1. Generate BuildID
	id := generateBuildID()

	// 2. Resolve project from repository
	project, err := uc.projects.Get(ctx, cmd.WorkspaceID, cmd.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	// 3. Resolve BuildPlan from PlanResolver
	plan, err := uc.resolver.ResolveBuild(ctx, cmd.WorkspaceID, cmd.ProjectID, cmd.Intent, cmd.Clean)
	if err != nil {
		return nil, fmt.Errorf("resolve build plan: %w", err)
	}

	// 4. Create BuildRun with state "queued"
	run := domain.BuildRun{
		ID:          id,
		WorkspaceID: cmd.WorkspaceID,
		ProjectID:   cmd.ProjectID,
		State:       domain.BuildStateQueued,
		StartTime:   time.Now(),
	}

	// 5. Create cancellable context
	buildCtx, cancel := context.WithCancel(context.Background())

	// 6. Store runningBuild with cancel function
	rb := &runningBuild{
		run:    run,
		cancel: cancel,
		done:   make(chan struct{}),
	}

	uc.mu.Lock()
	uc.builds[id] = rb
	uc.mu.Unlock()

	// 7. Launch goroutine to execute build async
	go uc.executeBuild(buildCtx, rb, plan, project)

	// 8. Return BuildRun immediately (state "queued")
	return &run, nil
}

func (uc *buildUseCaseImpl) Get(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) (*domain.BuildRun, error) {
	// Check running builds first
	uc.mu.Lock()
	rb, ok := uc.builds[buildID]
	uc.mu.Unlock()

	if ok {
		run := rb.run
		if run.WorkspaceID != workspaceID {
			return nil, fmt.Errorf("build %s not found in workspace %s", buildID, workspaceID)
		}
		return &run, nil
	}

	// Fall back to persisted history
	return uc.history.Get(ctx, workspaceID, buildID)
}

func (uc *buildUseCaseImpl) List(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]domain.BuildRun, error) {
	// Get persisted runs
	runs, err := uc.history.List(ctx, workspaceID, projectID, limit)
	if err != nil {
		return nil, err
	}

	// Add running builds
	uc.mu.Lock()
	for _, rb := range uc.builds {
		if rb.run.WorkspaceID == workspaceID {
			if projectID == "" || rb.run.ProjectID == projectID {
				runs = append(runs, rb.run)
			}
		}
	}
	uc.mu.Unlock()

	// Return most recent first
	if limit > 0 && len(runs) > limit {
		runs = runs[len(runs)-limit:]
	}
	return runs, nil
}

func (uc *buildUseCaseImpl) Cancel(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) error {
	uc.mu.Lock()
	rb, ok := uc.builds[buildID]
	uc.mu.Unlock()

	if !ok {
		return fmt.Errorf("build %s not found", buildID)
	}

	if rb.run.WorkspaceID != workspaceID {
		return fmt.Errorf("build %s not found in workspace %s", buildID, workspaceID)
	}

	// Cancel the context - this will terminate the Ant/javac process
	rb.cancel()

	// Wait for the goroutine to finish
	select {
	case <-rb.done:
	case <-time.After(10 * time.Second):
		return fmt.Errorf("build cancel timed out")
	}

	return nil
}

func (uc *buildUseCaseImpl) executeBuild(ctx context.Context, rb *runningBuild, plan *domain.BuildPlan, project *domain.Project) {
	defer close(rb.done)

	// Transition to running
	rb.run.State = domain.BuildStateRunning
	uc.eventHub.Publish(events.Event{
		Type:        events.EventBuildStarted,
		WorkspaceID: string(rb.run.WorkspaceID),
		Data: map[string]interface{}{
			"buildId":   string(rb.run.ID),
			"projectId": string(rb.run.ProjectID),
		},
	})

	// Select provider
	var provider domain.BuildProvider
	if project.BuildTool == "ant" {
		provider = uc.antProv
	} else {
		provider = uc.javacProv
	}

	// Validate before build
	if provider != nil {
		if err := provider.Validate(ctx, *project, domain.Toolchain{}); err != nil {
			rb.run.State = domain.BuildStateFailed
			rb.run.Summary = fmt.Sprintf("Validation failed: %v", err)
			rb.run.EndTime = timePtr(time.Now())
			_ = uc.history.Save(ctx, rb.run)
			uc.eventHub.Publish(events.Event{
				Type:        events.EventBuildFailed,
				WorkspaceID: string(rb.run.WorkspaceID),
				Data: map[string]interface{}{
					"buildId": string(rb.run.ID),
					"error":   rb.run.Summary,
				},
			})
			return
		}
	}

	// Execute build
	output, err := provider.Build(ctx, *plan, uc.eventSink(rb.run.ID))
	now := time.Now()
	rb.run.EndTime = &now

	if err != nil {
		rb.run.State = domain.BuildStateFailed
		rb.run.Summary = fmt.Sprintf("Build failed: %v", err)
	} else if output.ExitCode == 0 {
		rb.run.State = domain.BuildStateSucceeded
		rb.run.Summary = "Build succeeded"
	} else {
		rb.run.State = domain.BuildStateFailed
		rb.run.Summary = fmt.Sprintf("Build exited with code %d", output.ExitCode)
	}

	// Persist to history
	_ = uc.history.Save(ctx, rb.run)

	// Publish completion event
	uc.eventHub.Publish(events.Event{
		Type:        events.EventBuildCompleted,
		WorkspaceID: string(rb.run.WorkspaceID),
		Data: map[string]interface{}{
			"buildId": string(rb.run.ID),
			"summary": rb.run.Summary,
			"state":   string(rb.run.State),
		},
	})

	// Clean up from running builds
	uc.mu.Lock()
	delete(uc.builds, rb.run.ID)
	uc.mu.Unlock()
}

// eventSink creates a BuildEventSink that publishes build progress events.
func (uc *buildUseCaseImpl) eventSink(buildID domain.BuildID) domain.BuildEventSink {
	return func(event domain.BuildEvent) {
		event.BuildID = buildID
		event.Time = time.Now()
		uc.eventHub.Publish(events.Event{
			Type:        events.EventBuildProgress,
			WorkspaceID: string(buildID), // workspaceID is not available here, use buildID as fallback
			Data:        event,
		})
	}
}

// timePtr returns a pointer to the given time.
func timePtr(t time.Time) *time.Time {
	return &t
}

// resolvePath joins root with a relative path and returns the absolute path.
func resolvePath(root, rel string) string {
	if rel == "" {
		return root
	}
	return root + "/" + rel
}