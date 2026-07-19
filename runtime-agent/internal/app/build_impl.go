package app

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

const (
	persistenceTimeout = 10 * time.Second
)

type runningBuild struct {
	mu       sync.RWMutex
	run      domain.BuildRun
	cancel   context.CancelFunc
	done     chan struct{}
	termOnce sync.Once
}

func (rb *runningBuild) getRun() domain.BuildRun {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return rb.run.DeepCopy()
}

func (rb *runningBuild) updateRun(fn func(*domain.BuildRun)) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	fn(&rb.run)
}

func (rb *runningBuild) tryTransition(from, to domain.BuildState) bool {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	if rb.run.State != from {
		return false
	}
	if !rb.run.State.CanTransitionTo(to) {
		return false
	}
	rb.run.State = to
	return true
}

func (rb *runningBuild) forceTransition(to domain.BuildState) bool {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	if !rb.run.State.CanTransitionTo(to) {
		return false
	}
	rb.run.State = to
	return true
}

func (rb *runningBuild) markPersistenceFailed(err error) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.run.Summary = fmt.Sprintf("%s (persistence failed: %v)", rb.run.Summary, err)
	diag := domain.BuildDiagnostic{
		Severity: "error",
		Message:  fmt.Sprintf("persistence failed: %v", err),
	}
	rb.run.Diagnostics = append(rb.run.Diagnostics, diag)
}

type buildUseCaseImpl struct {
	lifecycleCtx    context.Context
	lifecycleCancel context.CancelFunc

	mu        sync.RWMutex
	running   map[domain.BuildID]*runningBuild
	history   domain.BuildHistoryRepository
	resolver  domain.PlanResolver
	registry  domain.BuildProviderRegistry
	publisher BuildEventPublisher
	idGen     pathpolicy.IDGenerator
}

func NewBuildUseCase(
	lifecycleCtx context.Context,
	history domain.BuildHistoryRepository,
	resolver domain.PlanResolver,
	registry domain.BuildProviderRegistry,
	publisher BuildEventPublisher,
	idGen pathpolicy.IDGenerator,
) BuildUseCase {
	if lifecycleCtx == nil {
		panic("lifecycleCtx is nil")
	}
	if history == nil {
		panic("history is nil")
	}
	if resolver == nil {
		panic("resolver is nil")
	}
	if registry == nil {
		panic("registry is nil")
	}
	if publisher == nil {
		panic("publisher is nil")
	}
	if idGen == nil {
		panic("idGen is nil")
	}

	ctx, cancel := context.WithCancel(lifecycleCtx)
	uc := &buildUseCaseImpl{
		lifecycleCtx:    ctx,
		lifecycleCancel: cancel,
		running:         make(map[domain.BuildID]*runningBuild),
		history:         history,
		resolver:        resolver,
		registry:        registry,
		publisher:       publisher,
		idGen:           idGen,
	}
	go uc.watchLifecycle()
	return uc
}

func (uc *buildUseCaseImpl) watchLifecycle() {
	<-uc.lifecycleCtx.Done()
	uc.mu.RLock()
	builds := make([]*runningBuild, 0, len(uc.running))
	for _, rb := range uc.running {
		builds = append(builds, rb)
	}
	uc.mu.RUnlock()
	for _, rb := range builds {
		rb.cancel()
	}
}

func (uc *buildUseCaseImpl) Shutdown(ctx context.Context) error {
	uc.lifecycleCancel()
	uc.mu.RLock()
	builds := make([]*runningBuild, 0, len(uc.running))
	for _, rb := range uc.running {
		builds = append(builds, rb)
	}
	uc.mu.RUnlock()
	for _, rb := range builds {
		select {
		case <-rb.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (uc *buildUseCaseImpl) persistenceContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), persistenceTimeout)
}

func (uc *buildUseCaseImpl) publishEvent(ctx context.Context, evt domain.BuildEvent) error {
	return uc.publisher.PublishBuildEvent(ctx, evt)
}

func (uc *buildUseCaseImpl) Start(ctx context.Context, cmd StartBuildCommand) (*domain.BuildRun, error) {
	plan, err := uc.resolver.ResolveBuild(ctx, cmd.WorkspaceID, cmd.ProjectID, cmd.Intent, cmd.Clean, cmd.SelectedFiles)
	if err != nil {
		return nil, fmt.Errorf("resolve build: %w", err)
	}

	provider, ok := uc.registry.Get(plan.BuildTool)
	if !ok {
		return nil, fmt.Errorf("%w: %s", domain.ErrUnsupportedBuildTool, plan.BuildTool)
	}

	idStr, err := uc.idGen.NewBuildID()
	if err != nil {
		return nil, fmt.Errorf("generate build id: %w", err)
	}
	buildID := domain.BuildID(idStr)

	now := domain.UTCNow()
	run := domain.BuildRun{
		ID:          buildID,
		WorkspaceID: cmd.WorkspaceID,
		ProjectID:   cmd.ProjectID,
		State:       domain.BuildStateQueued,
		QueuedAt:    now,
	}

	buildCtx, cancel := context.WithCancel(uc.lifecycleCtx)
	rb := &runningBuild{
		run:    run,
		cancel: cancel,
		done:   make(chan struct{}),
	}

	persistCtx, persistCancel := uc.persistenceContext()
	defer persistCancel()
	if err := uc.history.Save(persistCtx, run); err != nil {
		cancel()
		close(rb.done)
		return nil, fmt.Errorf("persist queued build: %w", err)
	}

	uc.mu.Lock()
	uc.running[buildID] = rb
	uc.mu.Unlock()

	queuedEvt := domain.BuildEvent{
		WorkspaceID: run.WorkspaceID,
		ProjectID:   run.ProjectID,
		BuildID:     run.ID,
		Type:        domain.BuildEventQueued,
		State:       run.State,
		Message:     "Build queued",
		Time:        domain.UTCNow(),
	}
	_ = uc.publishEvent(context.Background(), queuedEvt)

	go uc.executeBuild(buildCtx, rb, plan, provider)

	result := run.DeepCopy()
	return &result, nil
}

func (uc *buildUseCaseImpl) Get(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) (*domain.BuildRun, error) {
	uc.mu.RLock()
	rb, ok := uc.running[buildID]
	uc.mu.RUnlock()

	if ok {
		run := rb.getRun()
		if run.WorkspaceID != workspaceID {
			return nil, domain.ErrBuildNotFound
		}
		result := run.DeepCopy()
		return &result, nil
	}

	histRun, err := uc.history.Get(ctx, workspaceID, buildID)
	if err != nil {
		return nil, err
	}
	result := histRun.DeepCopy()
	return &result, nil
}

func buildRunSortKey(run domain.BuildRun) time.Time {
	if run.StartedAt != nil {
		return *run.StartedAt
	}
	return run.QueuedAt
}

func (uc *buildUseCaseImpl) List(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]domain.BuildRun, error) {
	histRuns, err := uc.history.List(ctx, workspaceID, projectID, 0)
	if err != nil {
		return nil, err
	}

	merged := make(map[domain.BuildID]domain.BuildRun)
	for _, run := range histRuns {
		merged[run.ID] = run
	}

	uc.mu.RLock()
	for _, rb := range uc.running {
		run := rb.getRun()
		if run.WorkspaceID == workspaceID {
			if projectID == "" || run.ProjectID == projectID {
				merged[run.ID] = run
			}
		}
	}
	uc.mu.RUnlock()

	runs := make([]domain.BuildRun, 0, len(merged))
	for _, run := range merged {
		runs = append(runs, run.DeepCopy())
	}

	sort.Slice(runs, func(i, j int) bool {
		ti := buildRunSortKey(runs[i])
		tj := buildRunSortKey(runs[j])
		return ti.After(tj)
	})

	if limit > 0 && len(runs) > limit {
		runs = runs[:limit]
	}

	return runs, nil
}

func (uc *buildUseCaseImpl) Cancel(ctx context.Context, workspaceID domain.WorkspaceID, buildID domain.BuildID) error {
	uc.mu.RLock()
	rb, ok := uc.running[buildID]
	uc.mu.RUnlock()

	if ok {
		run := rb.getRun()
		if run.WorkspaceID != workspaceID {
			return domain.ErrBuildNotFound
		}

		if run.IsTerminal() {
			return nil
		}

		rb.cancel()

		select {
		case <-rb.done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	histRun, err := uc.history.Get(ctx, workspaceID, buildID)
	if err != nil {
		return domain.ErrBuildNotFound
	}

	if histRun.IsTerminal() {
		return nil
	}

	return domain.ErrBuildNotFound
}

func (uc *buildUseCaseImpl) executeBuild(ctx context.Context, rb *runningBuild, plan *domain.BuildPlan, provider domain.BuildProvider) {
	defer close(rb.done)

	select {
	case <-ctx.Done():
		uc.finishCancelled(rb)
		return
	default:
	}

	if !rb.tryTransition(domain.BuildStateQueued, domain.BuildStateRunning) {
		uc.finishCancelled(rb)
		return
	}

	now := domain.UTCNow()
	rb.updateRun(func(r *domain.BuildRun) {
		r.StartedAt = &now
	})

	run := rb.getRun()
	persistCtx, persistCancel := uc.persistenceContext()
	err := uc.history.Save(persistCtx, run)
	persistCancel()
	if err != nil {
		rb.markPersistenceFailed(err)
		pEvt := domain.BuildEvent{
			WorkspaceID: run.WorkspaceID,
			ProjectID:   run.ProjectID,
			BuildID:     run.ID,
			Type:        domain.BuildEventPersistenceFailed,
			State:       run.State,
			Message:     fmt.Sprintf("failed to persist running state: %v", err),
			Time:        domain.UTCNow(),
		}
		_ = uc.publishEvent(context.Background(), pEvt)
	}

	startedEvt := domain.BuildEvent{
		WorkspaceID: run.WorkspaceID,
		ProjectID:   run.ProjectID,
		BuildID:     run.ID,
		Type:        domain.BuildEventStarted,
		State:       run.State,
		Message:     "Build started",
		Time:        domain.UTCNow(),
	}
	_ = uc.publishEvent(context.Background(), startedEvt)

	select {
	case <-ctx.Done():
		uc.finishCancelled(rb)
		return
	default:
	}

	if err := provider.Validate(ctx, *plan); err != nil {
		rb.updateRun(func(r *domain.BuildRun) {
			r.Summary = fmt.Sprintf("Validation failed: %v", err)
		})
		uc.finishFailed(rb)
		return
	}

	sink := func(event domain.BuildEvent) {
		event.WorkspaceID = plan.WorkspaceID
		event.ProjectID = plan.ProjectID
		event.BuildID = rb.getRun().ID
		if event.Time.IsZero() {
			event.Time = domain.UTCNow()
		}
		_ = uc.publisher.PublishBuildEvent(ctx, event)
	}
	logLine := func(stream domain.Stream, line string) {}

	output, buildErr := provider.Build(ctx, *plan, sink, logLine)
	endTime := domain.UTCNow()

	select {
	case <-ctx.Done():
		rb.updateRun(func(r *domain.BuildRun) {
			t := endTime
			r.FinishedAt = &t
			r.Summary = "Build cancelled"
		})
		uc.finishCancelled(rb)
		return
	default:
	}

	rb.updateRun(func(r *domain.BuildRun) {
		t := endTime
		r.FinishedAt = &t
	})

	if buildErr != nil {
		rb.updateRun(func(r *domain.BuildRun) {
			r.Summary = fmt.Sprintf("Build failed: %v", buildErr)
			if output != nil {
				r.Diagnostics = append(r.Diagnostics, output.Diagnostics...)
				code := output.ExitCode
				r.ExitCode = &code
			}
		})
		uc.finishFailed(rb)
		return
	}

	exitCode := 0
	var diags []domain.BuildDiagnostic
	if output != nil {
		exitCode = output.ExitCode
		diags = output.Diagnostics
	}
	rb.updateRun(func(r *domain.BuildRun) {
		r.Diagnostics = append(r.Diagnostics, diags...)
		code := exitCode
		r.ExitCode = &code
	})

	if exitCode == 0 {
		rb.updateRun(func(r *domain.BuildRun) {
			r.Summary = "Build succeeded"
		})
		uc.finishSucceeded(rb)
	} else {
		rb.updateRun(func(r *domain.BuildRun) {
			r.Summary = fmt.Sprintf("Build exited with code %d", exitCode)
		})
		uc.finishFailed(rb)
	}
}

func (uc *buildUseCaseImpl) finishSucceeded(rb *runningBuild) {
	rb.forceTransition(domain.BuildStateSucceeded)
	uc.persistPublishCleanup(rb, domain.BuildEventSucceeded, "Build succeeded")
}

func (uc *buildUseCaseImpl) finishFailed(rb *runningBuild) {
	rb.forceTransition(domain.BuildStateFailed)
	run := rb.getRun()
	uc.persistPublishCleanup(rb, domain.BuildEventFailed, run.Summary)
}

func (uc *buildUseCaseImpl) finishCancelled(rb *runningBuild) {
	now := domain.UTCNow()
	rb.updateRun(func(r *domain.BuildRun) {
		if r.FinishedAt == nil {
			t := now
			r.FinishedAt = &t
		}
		if r.Summary == "" {
			r.Summary = "Build cancelled"
		}
	})
	rb.forceTransition(domain.BuildStateCancelled)
	uc.persistPublishCleanup(rb, domain.BuildEventCancelled, "Build cancelled")
}

func (uc *buildUseCaseImpl) persistPublishCleanup(rb *runningBuild, eventType domain.BuildEventType, message string) {
	rb.termOnce.Do(func() {
		run := rb.getRun()

		persistCtx, persistCancel := uc.persistenceContext()
		saveErr := uc.history.Save(persistCtx, run)
		persistCancel()

		if saveErr != nil {
			rb.markPersistenceFailed(saveErr)
			run = rb.getRun()
			pEvt := domain.BuildEvent{
				WorkspaceID: run.WorkspaceID,
				ProjectID:   run.ProjectID,
				BuildID:     run.ID,
				Type:        domain.BuildEventPersistenceFailed,
				State:       run.State,
				Message:     fmt.Sprintf("failed to persist terminal state: %v", saveErr),
				Time:        domain.UTCNow(),
			}
			_ = uc.publishEvent(context.Background(), pEvt)
			return
		}

		evt := domain.BuildEvent{
			WorkspaceID: run.WorkspaceID,
			ProjectID:   run.ProjectID,
			BuildID:     run.ID,
			Type:        eventType,
			State:       run.State,
			Message:     message,
			Time:        domain.UTCNow(),
		}
		_ = uc.publishEvent(context.Background(), evt)

		uc.mu.Lock()
		delete(uc.running, run.ID)
		uc.mu.Unlock()
	})
}
