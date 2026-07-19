package app

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

type IDGenerator interface {
	NewServerID() (string, error)
}

type RuntimePlanResolver interface {
	ResolveRuntime(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, existingServerID *domain.ServerID) (*domain.RuntimePlan, error)
}

type serverLogBuffer struct {
	mu    sync.Mutex
	lines []domain.LogLine
	cap   int
	seq   uint64 // next sequence number to assign
	start int    // ring buffer start index
	count int    // number of entries in the ring
}

func newServerLogBuffer(cap int) *serverLogBuffer {
	if cap <= 0 {
		cap = 10000
	}
	return &serverLogBuffer{
		lines: make([]domain.LogLine, cap),
		cap:   cap,
	}
}

func (b *serverLogBuffer) Append(line domain.LogLine) {
	b.mu.Lock()
	defer b.mu.Unlock()
	line.Sequence = b.seq
	b.seq++

	// Evict oldest if full
	if b.count == b.cap {
		b.lines[b.start] = line
		b.start = (b.start + 1) % b.cap
	} else {
		b.lines[(b.start+b.count)%b.cap] = line
		b.count++
	}
}

// Read returns log lines starting after the given cursor (sequence number).
// cursor=0 means "from the beginning". Returns the lines, the next cursor
// (sequence number after the last returned line), and gap=true if the
// requested cursor is older than the oldest entry still in the buffer
// (meaning some log lines were lost due to ring buffer overflow).
func (b *serverLogBuffer) Read(cursor int, limit int) ([]domain.LogLine, int, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.count == 0 {
		return nil, 0, false
	}

	// The oldest sequence number still in the buffer.
	minSeq := b.lines[b.start].Sequence
	// The next sequence number (one past the newest).
	nextSeq := b.seq

	// Convert cursor (int) to uint64 for comparison.
	cursorSeq := uint64(cursor)

	var gap bool
	if cursorSeq < minSeq {
		// Client's cursor is older than what we have — they missed lines.
		gap = true
		cursorSeq = minSeq // start from the oldest available
	}
	if cursorSeq >= nextSeq {
		// Client is already up to date.
		return nil, int(nextSeq), false
	}

	// Find the starting index in the ring buffer.
	// offset from start = cursorSeq - minSeq
	offset := int(cursorSeq - minSeq)
	startIdx := (b.start + offset) % b.cap

	// How many entries from startIdx to end?
	available := int(nextSeq - cursorSeq)
	if limit > 0 && limit < available {
		available = limit
	}

	result := make([]domain.LogLine, available)
	for i := 0; i < available; i++ {
		result[i] = b.lines[(startIdx+i)%b.cap]
	}

	return result, int(cursorSeq + uint64(available)), gap
}

func (b *serverLogBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.count
}

type noopEventPublisher struct{}

func (n *noopEventPublisher) PublishServerEvent(ctx context.Context, event domain.ServerEvent) error {
	return nil
}

type serverUseCaseImpl struct {
	lifecycleCtx    context.Context
	lifecycleCancel context.CancelFunc
	planResolver    RuntimePlanResolver
	providerReg     domain.RuntimeProviderRegistry
	history         domain.ServerHistoryRepository
	eventPublisher  domain.ServerEventPublisher
	idGenerator     IDGenerator
	cfg             ServerUseCaseConfig
	portAllocator   domain.PortAllocator

	shutdownFlag atomic.Bool
	opLocks      sync.Map
	logBuffers   sync.Map

	mu              sync.Mutex
	activeLeases    map[domain.ServerID]*domain.PortLease
	activeProviders map[domain.ServerID]domain.RuntimeProvider
}

func NewServerUseCase(
	lifecycleCtx context.Context,
	planResolver RuntimePlanResolver,
	providerRegistry domain.RuntimeProviderRegistry,
	history domain.ServerHistoryRepository,
	eventPublisher domain.ServerEventPublisher,
	idGenerator IDGenerator,
	cfg ServerUseCaseConfig,
) ServerUseCase {
	if cfg.StartTimeout <= 0 {
		cfg.StartTimeout = 120 * time.Second
	}
	if cfg.StopTimeout <= 0 {
		cfg.StopTimeout = 30 * time.Second
	}
	if cfg.ShutdownTimeout <= 0 {
		cfg.ShutdownTimeout = 30 * time.Second
	}
	if cfg.InspectTimeout <= 0 {
		cfg.InspectTimeout = 5 * time.Second
	}
	if cfg.LogBufferSize <= 0 {
		cfg.LogBufferSize = 10000
	}
	// Product rule: Agent exit MUST stop all Tomcat processes it manages.
	// Cross-lifecycle process recovery is intentionally NOT supported. If
	// an Agent starts a Tomcat, that process belongs to that Agent
	// lifecycle only. See ADR-0011 Section 9 for the rationale.
	cfg.StopServersOnExit = true
	if eventPublisher == nil {
		eventPublisher = &noopEventPublisher{}
	}

	ctx, cancel := context.WithCancel(lifecycleCtx)

	uc := &serverUseCaseImpl{
		lifecycleCtx:    ctx,
		lifecycleCancel: cancel,
		planResolver:    planResolver,
		providerReg:     providerRegistry,
		history:         history,
		eventPublisher:  eventPublisher,
		idGenerator:     idGenerator,
		cfg:             cfg,
		portAllocator:   defaultPortAllocator(cfg.PortAllocator),
		activeLeases:    make(map[domain.ServerID]*domain.PortLease),
		activeProviders: make(map[domain.ServerID]domain.RuntimeProvider),
	}
	return uc
}

func (uc *serverUseCaseImpl) getOpLock(serverID domain.ServerID) *sync.Mutex {
	actual, _ := uc.opLocks.LoadOrStore(serverID, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

// storeLease records an active PortLease for a server. The lease must be
// released when the server stops, fails, or is restarted.
func (uc *serverUseCaseImpl) storeLease(serverID domain.ServerID, lease *domain.PortLease) {
	uc.mu.Lock()
	uc.activeLeases[serverID] = lease
	uc.mu.Unlock()
}

// releaseLease releases and removes the PortLease associated with serverID,
// if any. Safe to call when no lease is held.
func (uc *serverUseCaseImpl) releaseLease(serverID domain.ServerID) {
	uc.mu.Lock()
	if lease, ok := uc.activeLeases[serverID]; ok {
		lease.Release()
		delete(uc.activeLeases, serverID)
	}
	uc.mu.Unlock()
}

// allocateAndStoreLease reserves ports for a server, overrides the plan with
// the allocated port numbers, and stores the lease in activeLeases. If
// allocation fails the plan is unchanged and no lease is stored.
func (uc *serverUseCaseImpl) allocateAndStoreLease(serverID domain.ServerID, plan *domain.RuntimePlan) (*domain.PortLease, error) {
	lease, err := uc.portAllocator.Allocate(plan.HTTPPort, plan.ShutdownPort, plan.DebugPort)
	if err != nil {
		return nil, fmt.Errorf("allocate ports: %w", err)
	}
	plan.HTTPPort = lease.HTTPPort
	plan.ShutdownPort = lease.ShutdownPort
	plan.DebugPort = lease.DebugPort
	uc.storeLease(serverID, lease)
	return lease, nil
}

func (uc *serverUseCaseImpl) getLogBuffer(serverID domain.ServerID) *serverLogBuffer {
	actual, _ := uc.logBuffers.LoadOrStore(serverID, newServerLogBuffer(uc.cfg.LogBufferSize))
	return actual.(*serverLogBuffer)
}

func (uc *serverUseCaseImpl) saveRecord(ctx context.Context, record *domain.ServerRecord) error {
	record.UpdatedAt = domain.UTCNow()
	return uc.history.Save(ctx, *record)
}

func (uc *serverUseCaseImpl) publishStateChange(ctx context.Context, record *domain.ServerRecord, oldState, newState domain.ServerState, msg string, recoverable bool) {
	event := domain.ServerEvent{
		WorkspaceID: record.WorkspaceID,
		ProjectID:   record.ProjectID,
		ServerID:    record.ID,
		Generation:  record.Generation,
		Type:        domain.ServerEventStateChanged,
		OldState:    &oldState,
		NewState:    &newState,
		Message:     msg,
		Time:        domain.UTCNow(),
		Recoverable: recoverable,
	}
	_ = uc.eventPublisher.PublishServerEvent(ctx, event)
}

func (uc *serverUseCaseImpl) publishEvent(ctx context.Context, record *domain.ServerRecord, eventType domain.ServerEventType, msg string, recoverable bool) {
	event := domain.ServerEvent{
		WorkspaceID: record.WorkspaceID,
		ProjectID:   record.ProjectID,
		ServerID:    record.ID,
		Generation:  record.Generation,
		Type:        eventType,
		Message:     msg,
		Time:        domain.UTCNow(),
		Recoverable: recoverable,
	}
	_ = uc.eventPublisher.PublishServerEvent(ctx, event)
}

func (uc *serverUseCaseImpl) validateIDs(ws domain.WorkspaceID, project domain.ProjectID, srv *domain.ServerID) error {
	if string(ws) == "" {
		return fmt.Errorf("workspace id is required")
	}
	if string(project) == "" && srv != nil {
		// Get/List/Logs don't require project ID
	}
	if srv != nil && string(*srv) == "" {
		return fmt.Errorf("server id cannot be empty when specified")
	}
	return nil
}

func (uc *serverUseCaseImpl) getProviderForRuntime(runtimeID string) (domain.RuntimeProvider, error) {
	prov, ok := uc.providerReg.Get(runtimeID)
	if !ok {
		return nil, fmt.Errorf("%w: %s", domain.ErrUnsupportedRuntime, runtimeID)
	}
	return prov, nil
}

func (uc *serverUseCaseImpl) Start(ctx context.Context, cmd domain.StartServerCommand) (*domain.ServerRecord, error) {
	if uc.shutdownFlag.Load() {
		return nil, fmt.Errorf("server is shutting down")
	}

	if err := uc.validateIDs(cmd.WorkspaceID, cmd.ProjectID, cmd.ServerID); err != nil {
		return nil, err
	}

	var targetServerID domain.ServerID
	if cmd.ServerID != nil {
		targetServerID = *cmd.ServerID
	} else {
		idStr, err := uc.idGenerator.NewServerID()
		if err != nil {
			return nil, fmt.Errorf("generate server id: %w", err)
		}
		targetServerID = domain.ServerID(idStr)
	}

	opLock := uc.getOpLock(targetServerID)
	opLock.Lock()
	defer opLock.Unlock()

	existing, err := uc.history.Get(ctx, cmd.WorkspaceID, targetServerID)
	if err != nil && err != domain.ErrServerNotFound {
		return nil, fmt.Errorf("check existing server: %w", err)
	}
	if existing != nil {
		if existing.ObservedState == domain.ServerStateRunning || existing.ObservedState == domain.ServerStateStarting || existing.ObservedState == domain.ServerStatePreparing {
			cp := existing.DeepCopy()
			return &cp, fmt.Errorf("%w: %s", domain.ErrServerAlreadyRunning, targetServerID)
		}
	}

	plan, err := uc.planResolver.ResolveRuntime(ctx, cmd.WorkspaceID, cmd.ProjectID, &targetServerID)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime plan: %w", err)
	}
	plan.Generation = 1
	if existing != nil {
		plan.Generation = existing.Generation + 1
	}

	prov, err := uc.getProviderForRuntime(plan.RuntimeID)
	if err != nil {
		return nil, err
	}

	uc.mu.Lock()
	uc.activeProviders[targetServerID] = prov
	uc.mu.Unlock()

	now := domain.UTCNow()
	record := &domain.ServerRecord{
		ID:            targetServerID,
		WorkspaceID:   cmd.WorkspaceID,
		ProjectID:     cmd.ProjectID,
		DesiredState:  domain.DesiredServerStateRunning,
		ObservedState: domain.ServerStatePreparing,
		Generation:    plan.Generation,
		RuntimePlan:   *plan,
		StartedAt:     &now,
		UpdatedAt:     now,
	}

	oldState := domain.ServerStateStopped
	if existing != nil {
		oldState = existing.ObservedState
	}

	if err := uc.saveRecord(ctx, record); err != nil {
		uc.mu.Lock()
		delete(uc.activeProviders, targetServerID)
		uc.mu.Unlock()
		return nil, fmt.Errorf("persist preparing state: %w", err)
	}
	uc.publishStateChange(ctx, record, oldState, domain.ServerStatePreparing, "preparing server", false)

	logBuf := uc.getLogBuffer(targetServerID)
	logSink := func(line domain.LogLine) {
		line.Generation = record.Generation
		logBuf.Append(line)
	}

	if err := prov.Prepare(ctx, *plan); err != nil {
		uc.failStart(ctx, record, targetServerID, fmt.Sprintf("prepare failed: %v", err), true)
		return nil, fmt.Errorf("provider prepare: %w", err)
	}

	// Allocate ports now that preparation succeeded. The lease is stored in
	// activeLeases before Start so that any subsequent failure path can
	// release it through releaseLease().
	if _, err := uc.allocateAndStoreLease(targetServerID, plan); err != nil {
		uc.failStart(ctx, record, targetServerID, fmt.Sprintf("allocate ports: %v", err), true)
		return nil, fmt.Errorf("allocate ports: %w", err)
	}
	record.RuntimePlan = *plan

	record.ObservedState = domain.ServerStateStarting
	if err := uc.saveRecord(ctx, record); err != nil {
		uc.failStart(ctx, record, targetServerID, fmt.Sprintf("persist starting state: %v", err), true)
		return nil, fmt.Errorf("persist starting state: %w", err)
	}
	uc.publishStateChange(ctx, record, domain.ServerStatePreparing, domain.ServerStateStarting, "starting server", false)

	startDeadline := time.Now().Add(uc.cfg.StartTimeout)
	startCtx, startCancel := context.WithDeadline(ctx, startDeadline)
	defer startCancel()

	// Provider contract: Start must clean up any process it started before
	// returning an error. The UseCase owns the PortLease and releases it
	// separately on failure.
	identity, startErr := prov.Start(startCtx, *plan, logSink)
	if startErr != nil {
		uc.releaseLease(targetServerID)
		uc.failStart(ctx, record, targetServerID, fmt.Sprintf("start failed: %v", startErr), true)
		return nil, fmt.Errorf("provider start: %w", startErr)
	}

	readyErr := prov.IsReady(startCtx, *plan, *identity, startDeadline)
	if readyErr != nil {
		failCtx, failCancel := context.WithTimeout(context.Background(), uc.cfg.StopTimeout)
		_ = prov.ForceStop(failCtx, *identity)
		failCancel()
		uc.releaseLease(targetServerID)
		uc.failStart(ctx, record, targetServerID, fmt.Sprintf("readiness failed: %v", readyErr), true)
		return nil, fmt.Errorf("readiness: %w", readyErr)
	}

	record.ObservedState = domain.ServerStateRunning
	record.PID = identity.PID
	record.ProcessIdentity = identity
	record.LastError = ""
	if err := uc.saveRecord(ctx, record); err != nil {
		// P0-4 fix: if we cannot persist the Running state we must not
		// report success. Stop the process we just started and return a
		// failure so the persisted state matches reality.
		failMsg := fmt.Sprintf("persist running state: %v", err)
		stopCtx, stopCancel := context.WithTimeout(context.Background(), uc.cfg.StopTimeout)
		_ = prov.ForceStop(stopCtx, *identity)
		stopCancel()
		uc.releaseLease(targetServerID)
		uc.failStart(ctx, record, targetServerID, failMsg, true)
		return nil, fmt.Errorf("persist running state: %w", err)
	}

	uc.publishStateChange(ctx, record, domain.ServerStateStarting, domain.ServerStateRunning, "server running", false)
	uc.publishEvent(ctx, record, domain.ServerEventStarted, "server started successfully", false)

	result := record.DeepCopy()
	return &result, nil
}

// failStart is the single failure path for Start: it records the Failed
// state with the given message, publishes a Failed event, and removes the
// server from activeProviders and activeLeases.
func (uc *serverUseCaseImpl) failStart(ctx context.Context, record *domain.ServerRecord, serverID domain.ServerID, msg string, recoverable bool) {
	now := domain.UTCNow()
	record.ObservedState = domain.ServerStateFailed
	record.LastError = msg
	record.StoppedAt = &now
	_ = uc.saveRecord(context.Background(), record)
	uc.publishEvent(ctx, record, domain.ServerEventFailed, msg, recoverable)
	uc.mu.Lock()
	delete(uc.activeProviders, serverID)
	uc.mu.Unlock()
	uc.releaseLease(serverID)
}

func (uc *serverUseCaseImpl) Stop(ctx context.Context, cmd domain.StopServerCommand) (*domain.ServerRecord, error) {
	if err := uc.validateIDs(cmd.WorkspaceID, cmd.ProjectID, &cmd.ServerID); err != nil {
		return nil, err
	}

	opLock := uc.getOpLock(cmd.ServerID)
	opLock.Lock()
	defer opLock.Unlock()

	record, err := uc.history.Get(ctx, cmd.WorkspaceID, cmd.ServerID)
	if err != nil {
		return nil, fmt.Errorf("get server: %w", err)
	}
	if record.ProjectID != cmd.ProjectID {
		return nil, fmt.Errorf("%w: server %s does not belong to project %s", domain.ErrDeploymentTargetMismatch, cmd.ServerID, cmd.ProjectID)
	}

	if record.ObservedState == domain.ServerStateStopped {
		cp := record.DeepCopy()
		return &cp, nil
	}

	if record.ObservedState == domain.ServerStateFailed || record.ObservedState == domain.ServerStateCrashed {
		record.ObservedState = domain.ServerStateStopped
		record.DesiredState = domain.DesiredServerStateStopped
		now := domain.UTCNow()
		record.StoppedAt = &now
		if err := uc.saveRecord(ctx, record); err != nil {
			return nil, fmt.Errorf("persist stopped state: %w", err)
		}
		uc.publishEvent(ctx, record, domain.ServerEventStopped, "server stopped", false)
		cp := record.DeepCopy()
		return &cp, nil
	}

	prov, err := uc.getProviderForRuntime(record.RuntimePlan.RuntimeID)
	if err != nil {
		uc.mu.Lock()
		if cachedProv, ok := uc.activeProviders[cmd.ServerID]; ok {
			prov = cachedProv
		}
		uc.mu.Unlock()
		if prov == nil {
			return nil, err
		}
	}

	oldState := record.ObservedState
	record.ObservedState = domain.ServerStateStopping
	record.DesiredState = domain.DesiredServerStateStopped
	if err := uc.saveRecord(ctx, record); err != nil {
		return nil, fmt.Errorf("persist stopping state: %w", err)
	}
	uc.publishStateChange(ctx, record, oldState, domain.ServerStateStopping, "stopping server", false)

	stopDeadline := time.Now().Add(uc.cfg.StopTimeout)
	stopCtx, stopCancel := context.WithDeadline(ctx, stopDeadline)
	defer stopCancel()

	var stopErr error
	if record.ProcessIdentity != nil {
		if cmd.Force {
			stopErr = prov.ForceStop(stopCtx, *record.ProcessIdentity)
		} else {
			stopErr = prov.GracefulStop(stopCtx, *record.ProcessIdentity)
		}
	}

	if stopErr != nil && !cmd.Force {
		forceCtx, forceCancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
		if record.ProcessIdentity != nil {
			_ = prov.ForceStop(forceCtx, *record.ProcessIdentity)
		}
		forceCancel()
	}

	uc.mu.Lock()
	if lease, ok := uc.activeLeases[cmd.ServerID]; ok {
		lease.Release()
		delete(uc.activeLeases, cmd.ServerID)
	}
	delete(uc.activeProviders, cmd.ServerID)
	uc.mu.Unlock()

	now := domain.UTCNow()
	record.StoppedAt = &now
	record.ObservedState = domain.ServerStateStopped
	record.PID = 0
	record.ProcessIdentity = nil
	record.LastError = ""
	if stopErr != nil {
		record.LastError = fmt.Sprintf("stop error: %v", stopErr)
	}

	if err := uc.saveRecord(ctx, record); err != nil {
		return nil, fmt.Errorf("persist stopped state: %w", err)
	}

	uc.publishStateChange(ctx, record, domain.ServerStateStopping, domain.ServerStateStopped, record.LastError, stopErr != nil)
	uc.publishEvent(ctx, record, domain.ServerEventStopped, "server stopped", stopErr != nil)

	result := record.DeepCopy()
	return &result, nil
}

func (uc *serverUseCaseImpl) Restart(ctx context.Context, cmd domain.RestartServerCommand) (*domain.ServerRecord, error) {
	if uc.shutdownFlag.Load() {
		return nil, fmt.Errorf("server is shutting down")
	}

	if err := uc.validateIDs(cmd.WorkspaceID, cmd.ProjectID, &cmd.ServerID); err != nil {
		return nil, err
	}

	opLock := uc.getOpLock(cmd.ServerID)
	opLock.Lock()
	defer opLock.Unlock()

	existing, err := uc.history.Get(ctx, cmd.WorkspaceID, cmd.ServerID)
	if err != nil {
		return nil, fmt.Errorf("get existing server: %w", err)
	}
	if existing.ProjectID != cmd.ProjectID {
		return nil, fmt.Errorf("%w: server %s does not belong to project %s", domain.ErrDeploymentTargetMismatch, cmd.ServerID, cmd.ProjectID)
	}

	prov, err := uc.getProviderForRuntime(existing.RuntimePlan.RuntimeID)
	if err != nil {
		uc.mu.Lock()
		if cachedProv, ok := uc.activeProviders[cmd.ServerID]; ok {
			prov = cachedProv
		}
		uc.mu.Unlock()
		if prov == nil {
			return nil, err
		}
	}

	prevObservedState := existing.ObservedState
	existing.ObservedState = domain.ServerStateRestarting
	existing.DesiredState = domain.DesiredServerStateRunning
	if err := uc.saveRecord(ctx, existing); err != nil {
		return nil, fmt.Errorf("persist restarting state: %w", err)
	}
	uc.publishStateChange(ctx, existing, prevObservedState, domain.ServerStateRestarting, "restarting server", false)

	now := domain.UTCNow()
	if prevObservedState != domain.ServerStateStopped && prevObservedState != domain.ServerStateFailed && prevObservedState != domain.ServerStateCrashed {
		stopCtx, stopCancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
		stopErr := error(nil)
		if existing.ProcessIdentity != nil {
			stopErr = prov.GracefulStop(stopCtx, *existing.ProcessIdentity)
		}
		if stopErr != nil {
			forceCtx, forceCancel := context.WithTimeout(ctx, uc.cfg.StopTimeout)
			if existing.ProcessIdentity != nil {
				_ = prov.ForceStop(forceCtx, *existing.ProcessIdentity)
			}
			forceCancel()
		}
		stopCancel()

		uc.mu.Lock()
		if lease, ok := uc.activeLeases[cmd.ServerID]; ok {
			lease.Release()
			delete(uc.activeLeases, cmd.ServerID)
		}
		uc.mu.Unlock()
	}
	existing.StoppedAt = &now
	existing.ProcessIdentity = nil
	existing.PID = 0

	newPlan, err := uc.planResolver.ResolveRuntime(ctx, cmd.WorkspaceID, cmd.ProjectID, &cmd.ServerID)
	if err != nil {
		existing.ObservedState = domain.ServerStateFailed
		existing.LastError = fmt.Sprintf("re-resolve plan failed: %v", err)
		_ = uc.saveRecord(context.Background(), existing)
		uc.publishEvent(ctx, existing, domain.ServerEventFailed, existing.LastError, true)
		return nil, fmt.Errorf("resolve runtime plan for restart: %w", err)
	}
	newPlan.Generation = existing.Generation + 1

	existing.RuntimePlan = *newPlan
	existing.Generation = newPlan.Generation

	logBuf := uc.getLogBuffer(cmd.ServerID)
	logSink := func(line domain.LogLine) {
		line.Generation = newPlan.Generation
		logBuf.Append(line)
	}

	if err := prov.Prepare(ctx, *newPlan); err != nil {
		uc.failStart(ctx, existing, cmd.ServerID, fmt.Sprintf("prepare after restart failed: %v", err), true)
		return nil, fmt.Errorf("provider prepare during restart: %w", err)
	}

	// Allocate ports now that preparation succeeded. The lease is stored in
	// activeLeases before Start so that any subsequent failure path can
	// release it through releaseLease().
	if _, err := uc.allocateAndStoreLease(cmd.ServerID, newPlan); err != nil {
		uc.failStart(ctx, existing, cmd.ServerID, fmt.Sprintf("allocate ports during restart: %v", err), true)
		return nil, fmt.Errorf("allocate ports during restart: %w", err)
	}
	existing.RuntimePlan = *newPlan

	existing.ObservedState = domain.ServerStateStarting
	if err := uc.saveRecord(ctx, existing); err != nil {
		uc.failStart(ctx, existing, cmd.ServerID, fmt.Sprintf("persist starting state during restart: %v", err), true)
		return nil, fmt.Errorf("persist starting state during restart: %w", err)
	}
	uc.publishStateChange(ctx, existing, domain.ServerStateRestarting, domain.ServerStateStarting, "starting after restart", false)

	startDeadline := time.Now().Add(uc.cfg.StartTimeout)
	startCtx, startCancel := context.WithDeadline(ctx, startDeadline)
	defer startCancel()

	// Provider contract: Start must clean up any process it started before
	// returning an error. The UseCase owns the PortLease and releases it
	// separately on failure.
	identity, startErr := prov.Start(startCtx, *newPlan, logSink)
	if startErr != nil {
		uc.releaseLease(cmd.ServerID)
		uc.failStart(ctx, existing, cmd.ServerID, fmt.Sprintf("start after restart failed: %v", startErr), true)
		return nil, fmt.Errorf("provider start during restart: %w", startErr)
	}

	readyErr := prov.IsReady(startCtx, *newPlan, *identity, startDeadline)
	if readyErr != nil {
		failCtx, failCancel := context.WithTimeout(context.Background(), uc.cfg.StopTimeout)
		_ = prov.ForceStop(failCtx, *identity)
		failCancel()
		uc.releaseLease(cmd.ServerID)
		uc.failStart(ctx, existing, cmd.ServerID, fmt.Sprintf("readiness after restart failed: %v", readyErr), true)
		return nil, fmt.Errorf("readiness during restart: %w", readyErr)
	}

	now = domain.UTCNow()
	existing.ObservedState = domain.ServerStateRunning
	existing.PID = identity.PID
	existing.ProcessIdentity = identity
	existing.StartedAt = &now
	existing.StoppedAt = nil
	existing.LastError = ""

	if err := uc.saveRecord(ctx, existing); err != nil {
		// P0-4 fix: if we cannot persist the Running state we must not
		// report success. Stop the process we just started and return a
		// failure so the persisted state matches reality.
		failMsg := fmt.Sprintf("persist running state during restart: %v", err)
		stopCtx, stopCancel := context.WithTimeout(context.Background(), uc.cfg.StopTimeout)
		_ = prov.ForceStop(stopCtx, *identity)
		stopCancel()
		uc.releaseLease(cmd.ServerID)
		uc.failStart(ctx, existing, cmd.ServerID, failMsg, true)
		return nil, fmt.Errorf("persist running state during restart: %w", err)
	}

	uc.publishStateChange(ctx, existing, domain.ServerStateStarting, domain.ServerStateRunning, "server running after restart", false)
	uc.publishEvent(ctx, existing, domain.ServerEventStarted, "server restarted successfully", false)

	result := existing.DeepCopy()
	return &result, nil
}

func (uc *serverUseCaseImpl) Get(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID) (*domain.ServerRecord, error) {
	if err := uc.validateIDs(ws, "", &srv); err != nil {
		return nil, err
	}

	record, err := uc.history.Get(ctx, ws, srv)
	if err != nil {
		return nil, err
	}

	if record.WorkspaceID != ws {
		return nil, domain.ErrServerNotFound
	}

	if !record.ObservedState.IsTerminal() && record.ProcessIdentity != nil && record.DesiredState == domain.DesiredServerStateRunning {
		inspectCtx, inspectCancel := context.WithTimeout(ctx, uc.cfg.InspectTimeout)
		defer inspectCancel()

		prov, err := uc.getProviderForRuntime(record.RuntimePlan.RuntimeID)
		if err == nil {
			obs, inspectErr := prov.Inspect(inspectCtx, *record.ProcessIdentity)
			if inspectErr != nil || !obs.Running {
				opLock := uc.getOpLock(srv)
				opLock.Lock()
				fresh, getErr := uc.history.Get(ctx, ws, srv)
				if getErr == nil && fresh.ObservedState == record.ObservedState && fresh.DesiredState == domain.DesiredServerStateRunning {
					record.ObservedState = domain.ServerStateCrashed
					record.StoppedAt = timePtr(domain.UTCNow())
					record.LastError = "process not running"
					_ = uc.saveRecord(context.Background(), record)
				} else if getErr == nil {
					record = fresh
				}
				opLock.Unlock()
			} else if obs.IdentityMismatch {
				opLock := uc.getOpLock(srv)
				opLock.Lock()
				fresh, getErr := uc.history.Get(ctx, ws, srv)
				if getErr == nil && fresh.ObservedState == record.ObservedState {
					record.ObservedState = domain.ServerStateFailed
					record.LastError = "process identity mismatch"
					_ = uc.saveRecord(context.Background(), record)
				} else if getErr == nil {
					record = fresh
				}
				opLock.Unlock()
			}
		}
	}

	result := record.DeepCopy()
	return &result, nil
}

func (uc *serverUseCaseImpl) List(ctx context.Context, ws domain.WorkspaceID) ([]*domain.ServerRecord, error) {
	if string(ws) == "" {
		return nil, fmt.Errorf("workspace id is required")
	}

	records, err := uc.history.List(ctx, ws)
	if err != nil {
		return nil, err
	}

	result := make([]*domain.ServerRecord, 0, len(records))
	inspectCtx, inspectCancel := context.WithTimeout(ctx, uc.cfg.InspectTimeout)
	defer inspectCancel()

	for i := range records {
		rec := records[i]
		if rec.WorkspaceID != ws {
			continue
		}

		if !rec.ObservedState.IsTerminal() && rec.ProcessIdentity != nil && rec.DesiredState == domain.DesiredServerStateRunning {
			prov, provErr := uc.getProviderForRuntime(rec.RuntimePlan.RuntimeID)
			if provErr == nil {
				obs, inspectErr := prov.Inspect(inspectCtx, *rec.ProcessIdentity)
				if inspectErr != nil || !obs.Running {
					opLock := uc.getOpLock(rec.ID)
					opLock.Lock()
					fresh, getErr := uc.history.Get(ctx, ws, rec.ID)
					if getErr == nil && fresh.ObservedState == rec.ObservedState && fresh.DesiredState == domain.DesiredServerStateRunning {
						rec.ObservedState = domain.ServerStateCrashed
						rec.StoppedAt = timePtr(domain.UTCNow())
						_ = uc.saveRecord(context.Background(), &rec)
					} else if getErr == nil {
						rec = *fresh
					}
					opLock.Unlock()
				} else if obs.IdentityMismatch {
					opLock := uc.getOpLock(rec.ID)
					opLock.Lock()
					fresh, getErr := uc.history.Get(ctx, ws, rec.ID)
					if getErr == nil && fresh.ObservedState == rec.ObservedState {
						rec.ObservedState = domain.ServerStateFailed
						rec.LastError = "process identity mismatch"
						_ = uc.saveRecord(context.Background(), &rec)
					} else if getErr == nil {
						rec = *fresh
					}
					opLock.Unlock()
				}
			}
		}

		cp := rec.DeepCopy()
		result = append(result, &cp)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})

	return result, nil
}

// Reconcile runs at Agent startup to clean up stale state from the previous
// Agent lifecycle.
//
// Product rule (ADR-0011 Section 9): Agent exit MUST stop all Tomcat
// processes it manages. The previous Agent's Shutdown already force-stopped
// every non-terminal server. Therefore on the next Agent startup any
// persisted non-terminal record points to a process that was killed by the
// previous shutdown. We do NOT attempt to "re-attach" to such processes.
// We mark them Crashed (if desired running) or Stopped (if desired stopped)
// and release any leftover lease state.
//
// This intentionally avoids PID-reuse and identity-mismatch risks across
// Agent lifecycles. The trade-off is that an Agent crash (not a clean
// Shutdown) may leave orphaned Tomcat processes; those are reported as
// Crashed and must be cleaned up by the user or by a future
// process-reaper.
func (uc *serverUseCaseImpl) Reconcile(ctx context.Context) error {
	records, err := uc.history.ListNonTerminal(ctx)
	if err != nil {
		return err
	}

	for _, rec := range records {
		if rec.ObservedState.IsTerminal() {
			continue
		}

		// The previous Agent lifecycle stopped every server it owned, so
		// this record's process is gone. Mark it accordingly and release
		// any stale lease bookkeeping.
		now := domain.UTCNow()
		rec.StoppedAt = &now
		rec.PID = 0
		rec.ProcessIdentity = nil

		if rec.DesiredState == domain.DesiredServerStateRunning {
			rec.ObservedState = domain.ServerStateCrashed
			rec.LastError = "agent restarted; previously-managed process was stopped on prior agent shutdown"
			_ = uc.saveRecord(context.Background(), rec)
			uc.releaseLease(rec.ID)
			uc.publishEvent(ctx, rec, domain.ServerEventCrashed, rec.LastError, true)
		} else {
			rec.ObservedState = domain.ServerStateStopped
			rec.LastError = ""
			_ = uc.saveRecord(context.Background(), rec)
			uc.releaseLease(rec.ID)
			uc.publishEvent(ctx, rec, domain.ServerEventReconciled, "agent restarted; server marked stopped", false)
		}
	}

	return nil
}

func (uc *serverUseCaseImpl) Shutdown(ctx context.Context) ([]*domain.ServerRecord, error) {
	uc.shutdownFlag.Store(true)
	uc.lifecycleCancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), uc.cfg.ShutdownTimeout)
	defer shutdownCancel()

	var unclean []*domain.ServerRecord

	records, err := uc.history.ListNonTerminal(shutdownCtx)
	if err != nil {
		return nil, err
	}

	for _, rec := range records {
		if rec.ObservedState.IsTerminal() {
			continue
		}

		// Product rule (ADR-0011 Section 9): StopServersOnExit is forced
		// true by NewServerUseCase. Every non-terminal server MUST be
		// stopped here so that no Kairo-managed Tomcat outlives the Agent
		// process that started it.
		prov, provErr := uc.getProviderForRuntime(rec.RuntimePlan.RuntimeID)
		if provErr != nil {
			cp := rec.DeepCopy()
			unclean = append(unclean, &cp)
			continue
		}

		stopCtx, stopCancel := context.WithTimeout(shutdownCtx, uc.cfg.StopTimeout)
		if rec.ProcessIdentity != nil {
			_ = prov.ForceStop(stopCtx, *rec.ProcessIdentity)
		} else {
			_ = prov.ForceStop(stopCtx, domain.ProcessIdentity{})
		}
		stopCancel()

		uc.mu.Lock()
		if lease, ok := uc.activeLeases[rec.ID]; ok {
			lease.Release()
			delete(uc.activeLeases, rec.ID)
		}
		uc.mu.Unlock()

		rec.ObservedState = domain.ServerStateStopped
		rec.DesiredState = domain.DesiredServerStateStopped
		rec.StoppedAt = timePtr(domain.UTCNow())
		rec.PID = 0
		rec.ProcessIdentity = nil
		_ = uc.saveRecord(context.Background(), rec)
	}

	return unclean, nil
}

func (uc *serverUseCaseImpl) GetLogs(ctx context.Context, ws domain.WorkspaceID, srv domain.ServerID, cursor int, limit int) ([]domain.LogLine, int, bool, error) {
	if err := uc.validateIDs(ws, "", &srv); err != nil {
		return nil, 0, false, err
	}

	record, err := uc.history.Get(ctx, ws, srv)
	if err != nil {
		return nil, 0, false, err
	}
	if record.WorkspaceID != ws {
		return nil, 0, false, domain.ErrServerNotFound
	}

	logBuf := uc.getLogBuffer(srv)
	lines, nextCursor, gap := logBuf.Read(cursor, limit)
	return lines, nextCursor, gap, nil
}

func timePtr(t time.Time) *time.Time {
	return &t
}
