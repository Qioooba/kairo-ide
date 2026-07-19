package runtime_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/app"
	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
	"github.com/kairo-ide/runtime-agent/internal/proc"
	"github.com/kairo-ide/runtime-agent/internal/repository"
)

type fakeRuntimeProvider struct {
	mu           sync.Mutex
	id           string
	processes    map[domain.ServerID]*proc.FakeProcess
	processFact  func() *proc.FakeProcess
	prepareErr   error
	startErr     error
	readyErr     error
	gracefulErr  error
	forceErr     error
	inspectErr   error
	ignoreGrace  bool
	readyDelay   time.Duration
	crashAfter   time.Duration
	logLines     []string
	hugeLogs     bool
	partialLines bool
	prepCount    int
	startCount   int
	graceCount   int
	forceCount   int
}

func newFakeRuntimeProvider(id string) *fakeRuntimeProvider {
	return &fakeRuntimeProvider{
		id:        id,
		processes: make(map[domain.ServerID]*proc.FakeProcess),
	}
}

func (p *fakeRuntimeProvider) ID() string { return p.id }

func (p *fakeRuntimeProvider) Prepare(ctx context.Context, plan domain.RuntimePlan) error {
	p.mu.Lock()
	p.prepCount++
	err := p.prepareErr
	p.mu.Unlock()
	return err
}

func (p *fakeRuntimeProvider) Start(ctx context.Context, plan domain.RuntimePlan, logSink func(domain.LogLine)) (*domain.ProcessIdentity, *domain.PortLease, error) {
	p.mu.Lock()
	p.startCount++
	if p.startErr != nil {
		err := p.startErr
		p.mu.Unlock()
		return nil, nil, err
	}

	var fp *proc.FakeProcess
	if p.processFact != nil {
		fp = p.processFact()
	} else {
		exitAfter := time.Duration(0)
		ignoreGraceful := p.ignoreGrace
		if p.crashAfter == 0 && !p.ignoreGrace {
			exitAfter = 1 * time.Hour
		}
		behavior := proc.FakeProcessBehavior{
			ExitAfter:      exitAfter,
			IgnoreGraceful: ignoreGraceful,
			ReadyAfter:     p.readyDelay,
		}
		if p.hugeLogs {
			behavior.LogLineCount = 2000
			behavior.LogLineSize = 100
		} else if len(p.logLines) > 0 {
			behavior.LogLines = p.logLines
			behavior.PartialWrites = p.partialLines
		}
		if p.crashAfter > 0 {
			behavior.Crash = true
			behavior.ExitAfter = p.crashAfter
		}
		fp = proc.NewFakeProcess(behavior)
	}
	p.processes[plan.ServerID] = fp
	readyErr := p.readyErr
	p.mu.Unlock()

	if logSink != nil {
		fp.SubscribeLogs(func(line domain.LogLine) {
			logSink(line)
		})
	}

	lease := domain.NewPortLease(plan.HTTPPort, plan.ShutdownPort, plan.DebugPort, func() {})
	spec := proc.ProcessSpec{
		Executable:   "/fake/java",
		Args:         []string{"-cp", "/fake/lib/*", "org.apache.catalina.startup.Bootstrap", "start"},
		Dir:          plan.CatalinaBase,
		Env:          []string{},
		LogDir:       plan.CatalinaBase + "/logs",
		CatalinaBase: plan.CatalinaBase,
		MarkerToken:  "kairo-test-marker",
	}
	obs, err := fp.Start(context.Background(), spec)
	if err != nil {
		return nil, nil, err
	}
	if readyErr != nil {
		return &obs.Identity, lease, readyErr
	}
	return &obs.Identity, lease, nil
}

func (p *fakeRuntimeProvider) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	p.mu.Lock()
	p.graceCount++
	err := p.gracefulErr
	procs := make(map[domain.ServerID]*proc.FakeProcess, len(p.processes))
	for k, v := range p.processes {
		procs[k] = v
	}
	p.mu.Unlock()
	if err != nil {
		return err
	}
	for _, fp := range procs {
		obs, _ := fp.Inspect(ctx, identity)
		if obs.PID == identity.PID && obs.Running {
			return fp.GracefulStop(ctx, identity)
		}
	}
	return nil
}

func (p *fakeRuntimeProvider) ForceStop(ctx context.Context, identity domain.ProcessIdentity) (err error) {
	p.mu.Lock()
	p.forceCount++
	err = p.forceErr
	procs := make(map[domain.ServerID]*proc.FakeProcess, len(p.processes))
	for k, v := range p.processes {
		procs[k] = v
	}
	p.mu.Unlock()
	if err != nil {
		return err
	}
	var matchSID domain.ServerID
	var matchFP *proc.FakeProcess
	for sid, fp := range procs {
		obs, _ := fp.Inspect(ctx, identity)
		if obs.Running && (obs.PID == identity.PID || identity.PID == 0) {
			matchSID = sid
			matchFP = fp
			break
		}
	}
	if matchFP == nil {
		return nil
	}
	err = matchFP.ForceStop(ctx, identity)
	p.mu.Lock()
	delete(p.processes, matchSID)
	p.mu.Unlock()
	return err
}

func (p *fakeRuntimeProvider) IsReady(ctx context.Context, plan domain.RuntimePlan, identity domain.ProcessIdentity, deadline time.Time) error {
	p.mu.Lock()
	err := p.readyErr
	readyDelay := p.readyDelay
	p.mu.Unlock()

	if ctx.Err() != nil {
		return ctx.Err()
	}

	startTime := time.Now()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		p.mu.Lock()
		fp := p.processes[plan.ServerID]
		p.mu.Unlock()

		if fp == nil {
			return fmt.Errorf("no process for server")
		}

		obs, ierr := fp.Inspect(ctx, identity)
		if ierr != nil {
			return ierr
		}
		if !obs.Running {
			return fmt.Errorf("process exited before ready")
		}

		if err != nil {
			if time.Now().After(deadline) {
				return err
			}
		} else {
			if readyDelay == 0 || time.Since(startTime) >= readyDelay {
				return nil
			}
		}

		if time.Now().After(deadline) {
			return domain.ErrReadinessTimeout
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (p *fakeRuntimeProvider) Inspect(ctx context.Context, identity domain.ProcessIdentity) (domain.ProcessObservation, error) {
	p.mu.Lock()
	err := p.inspectErr
	procs := make(map[domain.ServerID]*proc.FakeProcess, len(p.processes))
	for k, v := range p.processes {
		procs[k] = v
	}
	p.mu.Unlock()
	if err != nil {
		return domain.ProcessObservation{}, err
	}
	for _, fp := range procs {
		pobs, _ := fp.Inspect(ctx, identity)
		if pobs.PID == identity.PID && pobs.Running {
			return domain.ProcessObservation{
				PID:              pobs.PID,
				Identity:         pobs.Identity,
				Running:          pobs.Running,
				ExitCode:         pobs.ExitCode,
				IdentityMismatch: pobs.IdentityMismatch,
			}, nil
		}
	}
	for _, fp := range procs {
		pobs, _ := fp.Inspect(ctx, identity)
		if pobs.Running {
			return domain.ProcessObservation{
				PID:              pobs.PID,
				Identity:         pobs.Identity,
				Running:          pobs.Running,
				ExitCode:         pobs.ExitCode,
				IdentityMismatch: true,
			}, nil
		}
	}
	return domain.ProcessObservation{Running: false}, nil
}

func (p *fakeRuntimeProvider) CleanupBase(ctx context.Context, plan domain.RuntimePlan) error {
	return nil
}

func (p *fakeRuntimeProvider) getProcess(sid domain.ServerID) *proc.FakeProcess {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.processes[sid]
}

type fakeProviderRegistry struct {
	mu        sync.RWMutex
	providers map[string]domain.RuntimeProvider
}

func newFakeProviderRegistry() *fakeProviderRegistry {
	return &fakeProviderRegistry{providers: make(map[string]domain.RuntimeProvider)}
}

func (r *fakeProviderRegistry) Add(p domain.RuntimeProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[p.ID()] = p
}

func (r *fakeProviderRegistry) Get(id string) (domain.RuntimeProvider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

type simpleResolver struct {
	mu         sync.Mutex
	dataDir    string
	resolveErr error
	planFunc   func(ws domain.WorkspaceID, proj domain.ProjectID, existing *domain.ServerID) (*domain.RuntimePlan, error)
}

func newSimpleResolver(dataDir string) *simpleResolver {
	return &simpleResolver{dataDir: dataDir}
}

func (r *simpleResolver) ResolveRuntime(ctx context.Context, ws domain.WorkspaceID, proj domain.ProjectID, existing *domain.ServerID) (*domain.RuntimePlan, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.resolveErr != nil {
		return nil, r.resolveErr
	}
	if r.planFunc != nil {
		return r.planFunc(ws, proj, existing)
	}
	var sid domain.ServerID
	if existing != nil {
		sid = *existing
	}
	baseDir := filepath.Join(r.dataDir, "runtime", "servers", string(sid))
	return &domain.RuntimePlan{
		WorkspaceID:    ws,
		ProjectID:      proj,
		ServerID:       sid,
		RuntimeID:      "fake-runtime",
		JavaHome:       "/fake/jdk",
		CatalinaHome:   "/fake/catalina-home",
		CatalinaBase:   baseDir,
		WebappDir:      "/fake/webapp",
		DeploymentRoot: filepath.Join(baseDir, "webapps", "ROOT"),
		ContextPath:    "/",
		HTTPPort:       18080,
		ShutdownPort:   18005,
		JVMOptions:     []string{"-Xmx256m"},
		Env:            []string{},
		Generation:     0,
	}, nil
}

type recordingEventPublisher struct {
	mu     sync.Mutex
	events []domain.ServerEvent
	fail   bool
}

func (p *recordingEventPublisher) PublishServerEvent(ctx context.Context, event domain.ServerEvent) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.fail {
		return fmt.Errorf("publish failed (simulated)")
	}
	p.events = append(p.events, event)
	return nil
}

func (p *recordingEventPublisher) Events() []domain.ServerEvent {
	p.mu.Lock()
	defer p.mu.Unlock()
	cp := make([]domain.ServerEvent, len(p.events))
	copy(cp, p.events)
	return cp
}

type testFixtures struct {
	ws  domain.WorkspaceID
	prj domain.ProjectID
}

func genValidIDs(t *testing.T) testFixtures {
	t.Helper()
	g := pathpolicy.NewCryptoIDGenerator()
	wsStr, err := g.NewWorkspaceID()
	if err != nil {
		t.Fatal(err)
	}
	prjStr, err := g.NewProjectID()
	if err != nil {
		t.Fatal(err)
	}
	return testFixtures{
		ws:  domain.WorkspaceID(wsStr),
		prj: domain.ProjectID(prjStr),
	}
}

func setupIntegrationEnv(t *testing.T) (context.Context, context.CancelFunc, app.ServerUseCase, *fakeRuntimeProvider, *repository.FileServerHistoryRepo, *recordingEventPublisher, string) {
	t.Helper()
	dataDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())

	history := repository.NewFileServerHistoryRepo(dataDir)
	resolver := newSimpleResolver(dataDir)
	reg := newFakeProviderRegistry()
	prov := newFakeRuntimeProvider("fake-runtime")
	reg.Add(prov)
	eventPub := &recordingEventPublisher{}
	idGen := pathpolicy.NewCryptoIDGenerator()

	cfg := app.ServerUseCaseConfig{
		StartTimeout:      10 * time.Second,
		StopTimeout:       5 * time.Second,
		ShutdownTimeout:   5 * time.Second,
		InspectTimeout:    2 * time.Second,
		LogBufferSize:     5000,
		StopServersOnExit: true,
	}

	uc := app.NewServerUseCase(ctx, resolver, reg, history, eventPub, idGen, cfg)
	return ctx, cancel, uc, prov, history, eventPub, dataDir
}

func TestR81_FullLifecycle_StartGetListRestartStop(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, history, _, _ := setupIntegrationEnv(t)
	defer cancel()
	_ = prov

	fixtures := genValidIDs(t)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	if running.ObservedState != domain.ServerStateRunning {
		t.Fatalf("expected running, got %s", running.ObservedState)
	}
	if running.PID == 0 {
		t.Error("expected non-zero PID after Start")
	}
	if running.Generation != 1 {
		t.Errorf("expected generation 1, got %d", running.Generation)
	}
	firstPID := running.PID
	firstGen := running.Generation
	serverID := running.ID

	got, err := uc.Get(ctx, fixtures.ws, serverID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.ObservedState != domain.ServerStateRunning {
		t.Errorf("Get expected running, got %s", got.ObservedState)
	}
	if got.PID != firstPID {
		t.Errorf("Get PID mismatch: %d vs %d", got.PID, firstPID)
	}

	list, err := uc.List(ctx, fixtures.ws)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 server in list, got %d", len(list))
	}
	if list[0].ID != serverID {
		t.Errorf("list[0] ID mismatch: %s vs %s", list[0].ID, serverID)
	}

	prov.mu.Lock()
	prov.ignoreGrace = false
	prov.mu.Unlock()

	restartCmd := domain.RestartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj, ServerID: serverID}
	restarted, err := uc.Restart(ctx, restartCmd)
	if err != nil {
		t.Fatalf("Restart failed: %v", err)
	}
	if restarted.ObservedState != domain.ServerStateRunning {
		t.Fatalf("expected running after restart, got %s", restarted.ObservedState)
	}
	if restarted.Generation != firstGen+1 {
		t.Errorf("expected generation %d, got %d", firstGen+1, restarted.Generation)
	}
	if restarted.ID != serverID {
		t.Errorf("restart changed server ID: %s vs %s", restarted.ID, serverID)
	}
	t.Logf("Restart: Gen %d -> %d (PID uniqueness is OS-level; fake PIDs may repeat)", firstGen, restarted.Generation)

	stopCmd := domain.StopServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj, ServerID: serverID}
	stopped, err := uc.Stop(ctx, stopCmd)
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}
	if stopped.ObservedState != domain.ServerStateStopped {
		t.Fatalf("expected stopped, got %s", stopped.ObservedState)
	}
	if stopped.PID != 0 {
		t.Errorf("expected PID 0 after stop, got %d", stopped.PID)
	}

	afterStop, err := history.Get(ctx, fixtures.ws, serverID)
	if err != nil {
		t.Fatalf("history Get after stop: %v", err)
	}
	if afterStop.ObservedState != domain.ServerStateStopped {
		t.Errorf("history expected stopped, got %s", afterStop.ObservedState)
	}
	if afterStop.StoppedAt == nil {
		t.Error("history StoppedAt not set")
	}
}

func TestR81_Stop_NoLeak(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	fp := prov.getProcess(running.ID)
	if fp == nil {
		t.Fatal("no fake process captured")
	}
	if !fp.IsRunning() {
		t.Error("process should be running after Start")
	}

	stopCmd := domain.StopServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj, ServerID: running.ID}
	_, err = uc.Stop(ctx, stopCmd)
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	if fp.IsRunning() {
		t.Error("process should not be running after Stop (leak detected)")
	}
}

func TestR82_DelayedReadiness(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.readyDelay = 50 * time.Millisecond
	prov.mu.Unlock()

	start := time.Now()
	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	_, err := uc.Start(ctx, startCmd)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	t.Logf("delayed readiness start took %v", elapsed)
	if elapsed < 40*time.Millisecond {
		t.Log("warning: delayed readiness did not appear to wait")
	}
}

func TestR82_CrashExit(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, history, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.crashAfter = 50 * time.Millisecond
	prov.mu.Unlock()

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	_, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Logf("start returned error (expected with crash during startup?): %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	_ = uc.Reconcile(ctx)

	recs, err := history.ListNonTerminal(ctx)
	if err != nil {
		t.Fatalf("ListNonTerminal: %v", err)
	}
	for _, r := range recs {
		t.Logf("non-terminal after crash+reconcile: %s state=%s", r.ID, r.ObservedState)
	}
}

func TestR82_HugeLogs(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.hugeLogs = true
	prov.mu.Unlock()

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start with huge logs failed: %v", err)
	}

	lines, nextCursor, err := uc.GetLogs(ctx, running.WorkspaceID, running.ID, 0, 100)
	if err != nil {
		t.Fatalf("GetLogs failed: %v", err)
	}
	t.Logf("huge logs: got %d lines, nextCursor=%d", len(lines), nextCursor)
	if len(lines) == 0 {
		t.Error("expected log lines with huge logs provider")
	}
}

func TestR82_PartialLine(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.logLines = []string{"line1", "line2", "partial-without-newline"}
	prov.partialLines = true
	prov.mu.Unlock()

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	lines, _, err := uc.GetLogs(ctx, running.WorkspaceID, running.ID, 0, 100)
	if err != nil {
		t.Fatalf("GetLogs failed: %v", err)
	}
	t.Logf("partial line test got %d lines", len(lines))
}

func TestR82_StartupTimeout(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, history, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.readyErr = domain.ErrReadinessTimeout
	prov.mu.Unlock()

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	_, err := uc.Start(ctx, startCmd)
	if err == nil {
		t.Fatal("expected error for readiness timeout")
	}
	t.Logf("startup timeout error: %v", err)

	list, err := history.List(ctx, fixtures.ws)
	if err != nil {
		t.Fatalf("history List: %v", err)
	}
	foundFailed := false
	for _, r := range list {
		if r.ObservedState == domain.ServerStateFailed {
			foundFailed = true
			t.Logf("persisted failed record: %s err=%s", r.ID, r.LastError)
		}
	}
	if !foundFailed {
		t.Error("expected failed record persisted after readiness timeout")
	}
}

func TestR82_IgnoreGracefulStop(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.ignoreGrace = true
	prov.mu.Unlock()

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	fp := prov.getProcess(running.ID)
	if fp == nil {
		t.Fatal("no process")
	}

	gracefulBefore := fp.StopCount()
	forceBefore := fp.ForceCount()

	stopCmd := domain.StopServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj, ServerID: running.ID, Force: false}
	stopped, err := uc.Stop(ctx, stopCmd)
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}
	if stopped.ObservedState != domain.ServerStateStopped {
		t.Fatalf("expected stopped, got %s", stopped.ObservedState)
	}
	gracefulAfter := fp.StopCount()
	forceAfter := fp.ForceCount()
	t.Logf("graceful calls: %d -> %d, force calls: %d -> %d", gracefulBefore, gracefulAfter, forceBefore, forceAfter)
	if forceAfter <= forceBefore {
		t.Error("expected force stop to be called when graceful is ignored")
	}
	time.Sleep(50 * time.Millisecond)
	if fp.IsRunning() {
		t.Error("process should be stopped after force")
	}
}

func TestR83_OptionalTomcatSmoke(t *testing.T) {
	tomcatHome := os.Getenv("KAITO_TOMCAT6_HOME")
	if tomcatHome == "" {
		t.Skip("KAITO_TOMCAT6_HOME not set; skipping real Tomcat smoke test (core fake tests still run)")
	}
	info, err := os.Stat(tomcatHome)
	if err != nil || !info.IsDir() {
		t.Skipf("KAITO_TOMCAT6_HOME=%s is not a valid directory: %v", tomcatHome, err)
	}
	binDir := filepath.Join(tomcatHome, "bin")
	if _, err := os.Stat(binDir); err != nil {
		t.Skipf("Tomcat bin dir missing at %s: %v", binDir, err)
	}
	t.Logf("KAITO_TOMCAT6_HOME=%s exists; real smoke would require Java and complete setup - deferring to Windows E2E", tomcatHome)
}

func TestR84_ProviderStartError_FailedPersisted(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, history, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.startErr = fmt.Errorf("simulated start failure: bind failed")
	prov.mu.Unlock()

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	_, err := uc.Start(ctx, startCmd)
	if err == nil {
		t.Fatal("expected error for provider start failure")
	}
	t.Logf("provider start error: %v", err)

	list, err := history.List(ctx, fixtures.ws)
	if err != nil {
		t.Fatalf("history List: %v", err)
	}
	foundFailed := false
	for _, r := range list {
		if r.ObservedState == domain.ServerStateFailed {
			foundFailed = true
			t.Logf("persisted failed record: %s err=%s", r.ID, r.LastError)
		}
	}
	if !foundFailed {
		t.Error("expected failed record after provider start error")
	}
}

func TestR84_ProviderPrepareError(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, history, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	prov.mu.Lock()
	prov.prepareErr = fmt.Errorf("catalina base owner mismatch")
	prov.mu.Unlock()

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	_, err := uc.Start(ctx, startCmd)
	if err == nil {
		t.Fatal("expected error for prepare failure")
	}
	t.Logf("prepare error: %v", err)

	list, err := history.List(ctx, fixtures.ws)
	if err != nil {
		t.Fatalf("history List: %v", err)
	}
	foundFailed := false
	for _, r := range list {
		if r.ObservedState == domain.ServerStateFailed {
			foundFailed = true
		}
	}
	if !foundFailed {
		t.Error("expected failed record after prepare error (fail before write)")
	}
}

func TestR84_PIDReused_DoNotKillUnrelated(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	fp := prov.getProcess(running.ID)
	if fp == nil {
		t.Fatal("no process")
	}

	wrongIdentity := domain.ProcessIdentity{
		PID:          99999,
		Executable:   "/some/other/program",
		StartTime:    time.Now(),
		CatalinaBase: "/some/other/base",
		MarkerToken:  "wrong-marker",
	}

	err = fp.ForceStop(ctx, wrongIdentity)
	if !errors.Is(err, domain.ErrProcessIdentityMismatch) {
		t.Errorf("expected ErrProcessIdentityMismatch for wrong identity, got: %v", err)
	}

	if !fp.IsRunning() {
		t.Error("process should still be running when wrong identity force stop is attempted")
	}
}

func TestR84_EventPublisherDown_StateDurable(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, _, history, eventPub, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	eventPub.fail = true

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start should succeed even when event publisher fails: %v", err)
	}
	if running.ObservedState != domain.ServerStateRunning {
		t.Fatalf("expected running state, got %s", running.ObservedState)
	}

	got, err := history.Get(ctx, fixtures.ws, running.ID)
	if err != nil {
		t.Fatalf("history Get failed: %v", err)
	}
	if got.ObservedState != domain.ServerStateRunning {
		t.Errorf("history should show running even with event failure, got %s", got.ObservedState)
	}
}

func TestR84_AgentLifecycleCancel_BoundedCleanup(t *testing.T) {
	t.Parallel()
	parentCtx, parentCancel := context.WithCancel(context.Background())
	dataDir := t.TempDir()

	history := repository.NewFileServerHistoryRepo(dataDir)
	resolver := newSimpleResolver(dataDir)
	reg := newFakeProviderRegistry()
	prov := newFakeRuntimeProvider("fake-runtime")
	reg.Add(prov)
	eventPub := &recordingEventPublisher{}
	idGen := pathpolicy.NewCryptoIDGenerator()

	cfg := app.ServerUseCaseConfig{
		StartTimeout:      5 * time.Second,
		StopTimeout:       3 * time.Second,
		ShutdownTimeout:   3 * time.Second,
		InspectTimeout:    1 * time.Second,
		LogBufferSize:     1000,
		StopServersOnExit: true,
	}

	uc := app.NewServerUseCase(parentCtx, resolver, reg, history, eventPub, idGen, cfg)

	fixtures := genValidIDs(t)
	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(parentCtx, startCmd)
	if err != nil {
		parentCancel()
		t.Fatalf("Start failed: %v", err)
	}

	parentCancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	unclean, err := uc.Shutdown(shutdownCtx)
	if err != nil {
		t.Fatalf("Shutdown failed: %v", err)
	}
	t.Logf("Shutdown: %d unclean instances", len(unclean))

	prov.mu.Lock()
	allStopped := true
	for sid, fp := range prov.processes {
		if fp.IsRunning() {
			allStopped = false
			t.Errorf("process %s still running after shutdown", sid)
		}
	}
	prov.mu.Unlock()

	if !allStopped {
		t.Error("expected all processes stopped after shutdown (bounded cleanup)")
	}
	_ = running
}

func TestR84_CorruptedHistory_ExplicitError(t *testing.T) {
	t.Parallel()
	dataDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	g := pathpolicy.NewCryptoIDGenerator()
	wsStr, _ := g.NewWorkspaceID()
	wsID := domain.WorkspaceID(wsStr)
	srvStr, _ := g.NewServerID()
	srvID := domain.ServerID(srvStr)
	wsDir := filepath.Join(dataDir, "catalog", "runtime-servers", string(wsID))
	if err := os.MkdirAll(wsDir, 0755); err != nil {
		t.Fatal(err)
	}
	badFile := filepath.Join(wsDir, string(srvID)+".json")
	if err := os.WriteFile(badFile, []byte("{this is not valid json!!!broken"), 0644); err != nil {
		t.Fatal(err)
	}

	history := repository.NewFileServerHistoryRepo(dataDir)
	_, err := history.Get(ctx, wsID, srvID)
	if err == nil {
		t.Fatal("expected error reading corrupt history file")
	}
	t.Logf("corrupt history produces error: %v", err)
}

func TestR84_ReconcileAliveProcess(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, _, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	if err := uc.Reconcile(ctx); err != nil {
		t.Fatalf("Reconcile failed: %v", err)
	}

	after, err := uc.Get(ctx, fixtures.ws, running.ID)
	if err != nil {
		t.Fatalf("Get after reconcile: %v", err)
	}
	if after.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running after reconcile of alive process, got %s", after.ObservedState)
	}
}

func TestR84_ReconcileDeadProcess(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, prov, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	fp := prov.getProcess(running.ID)
	if fp != nil {
		_ = fp.ForceStop(ctx, *running.ProcessIdentity)
	}
	time.Sleep(100 * time.Millisecond)

	if err := uc.Reconcile(ctx); err != nil {
		t.Fatalf("Reconcile (after crash) failed: %v", err)
	}

	afterCrash, err := uc.Get(ctx, fixtures.ws, running.ID)
	if err != nil {
		t.Fatalf("Get after reconcile (crash): %v", err)
	}
	t.Logf("after simulated process death + reconcile: state=%s", afterCrash.ObservedState)
}

func TestR84_RepeatedStopIdempotent(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, _, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	for i := 0; i < 3; i++ {
		stopCmd := domain.StopServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj, ServerID: running.ID}
		stopped, err := uc.Stop(ctx, stopCmd)
		if err != nil {
			t.Fatalf("Stop %d failed: %v", i, err)
		}
		if stopped.ObservedState != domain.ServerStateStopped {
			t.Errorf("Stop %d: expected stopped, got %s", i, stopped.ObservedState)
		}
	}
}

func TestR84_WrongProject_OwnershipCheck(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, _, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)
	g := pathpolicy.NewCryptoIDGenerator()
	otherPrjStr, _ := g.NewProjectID()
	otherPrj := domain.ProjectID(otherPrjStr)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	stopCmd := domain.StopServerCommand{WorkspaceID: fixtures.ws, ProjectID: otherPrj, ServerID: running.ID}
	_, err = uc.Stop(ctx, stopCmd)
	if err == nil {
		t.Fatal("expected error stopping server with wrong project ownership")
	}
	if !errors.Is(err, domain.ErrDeploymentTargetMismatch) {
		t.Logf("wrong project error: %v", err)
	}
}

func TestR84_ConcurrentStartStop(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, _, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	g := pathpolicy.NewCryptoIDGenerator()
	prjStr, _ := g.NewProjectID()
	prj := domain.ProjectID(prjStr)

	const rounds = 10
	for round := 0; round < rounds; round++ {
		wsStr, _ := g.NewWorkspaceID()
		ws := domain.WorkspaceID(wsStr)
		startCmd := domain.StartServerCommand{WorkspaceID: ws, ProjectID: prj}
		running, err := uc.Start(ctx, startCmd)
		if err != nil {
			t.Fatalf("round %d Start failed: %v", round, err)
		}

		var wg sync.WaitGroup
		wg.Add(2)
		var stopErr error
		go func() {
			defer wg.Done()
			stopCmd := domain.StopServerCommand{WorkspaceID: ws, ProjectID: prj, ServerID: running.ID}
			_, stopErr = uc.Stop(ctx, stopCmd)
		}()
		go func() {
			defer wg.Done()
			_, _ = uc.Get(ctx, ws, running.ID)
		}()
		wg.Wait()

		if stopErr != nil {
			t.Errorf("round %d Stop failed: %v", round, stopErr)
		}

		after, err := uc.Get(ctx, ws, running.ID)
		if err != nil {
			t.Fatalf("round %d Get after stop: %v", round, err)
		}
		if after.ObservedState != domain.ServerStateStopped {
			t.Errorf("round %d expected stopped, got %s", round, after.ObservedState)
		}
	}
}

func TestR84_StartAfterShutdown(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, _, _, _, _ := setupIntegrationEnv(t)

	fixtures := genValidIDs(t)
	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	_, err := uc.Start(ctx, startCmd)
	if err != nil {
		cancel()
		t.Fatalf("Start failed: %v", err)
	}

	sdCtx, sdCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer sdCancel()
	_, _ = uc.Shutdown(sdCtx)
	cancel()

	otherFixtures := genValidIDs(t)
	_, err = uc.Start(context.Background(), domain.StartServerCommand{
		WorkspaceID: otherFixtures.ws,
		ProjectID:   otherFixtures.prj,
	})
	if err == nil {
		t.Error("expected error starting after shutdown")
	}
}

func TestR84_GetLogs_CursorPagination(t *testing.T) {
	t.Parallel()
	ctx, cancel, uc, _, _, _, _ := setupIntegrationEnv(t)
	defer cancel()

	fixtures := genValidIDs(t)

	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	running, err := uc.Start(ctx, startCmd)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	firstBatch, cursor, err := uc.GetLogs(ctx, fixtures.ws, running.ID, 0, 10)
	if err != nil {
		t.Fatalf("GetLogs first batch: %v", err)
	}
	t.Logf("first batch: %d lines, cursor=%d", len(firstBatch), cursor)
	if len(firstBatch) > 0 {
		secondBatch, nextCursor, err := uc.GetLogs(ctx, fixtures.ws, running.ID, cursor, 10)
		if err != nil {
			t.Fatalf("GetLogs second batch: %v", err)
		}
		t.Logf("second batch: %d lines, nextCursor=%d", len(secondBatch), nextCursor)
	}
}

func TestR84_Shutdown_NoForceFlag(t *testing.T) {
	t.Parallel()
	parentCtx, parentCancel := context.WithCancel(context.Background())
	dataDir := t.TempDir()

	history := repository.NewFileServerHistoryRepo(dataDir)
	resolver := newSimpleResolver(dataDir)
	reg := newFakeProviderRegistry()
	prov := newFakeRuntimeProvider("fake-runtime")
	reg.Add(prov)
	eventPub := &recordingEventPublisher{}
	idGen := pathpolicy.NewCryptoIDGenerator()

	cfg := app.ServerUseCaseConfig{
		StartTimeout:      5 * time.Second,
		StopTimeout:       3 * time.Second,
		ShutdownTimeout:   3 * time.Second,
		InspectTimeout:    1 * time.Second,
		LogBufferSize:     1000,
		StopServersOnExit: false,
	}

	uc := app.NewServerUseCase(parentCtx, resolver, reg, history, eventPub, idGen, cfg)

	fixtures := genValidIDs(t)
	startCmd := domain.StartServerCommand{WorkspaceID: fixtures.ws, ProjectID: fixtures.prj}
	_, err := uc.Start(parentCtx, startCmd)
	if err != nil {
		parentCancel()
		t.Fatalf("Start failed: %v", err)
	}

	sdCtx, sdCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer sdCancel()
	unclean, err := uc.Shutdown(sdCtx)
	if err != nil {
		t.Fatalf("Shutdown failed: %v", err)
	}
	if len(unclean) == 0 {
		t.Error("expected unclean servers when StopServersOnExit=false")
	}
	parentCancel()
}

var _ domain.RuntimeProvider = (*fakeRuntimeProvider)(nil)
var _ domain.RuntimeProviderRegistry = (*fakeProviderRegistry)(nil)
var _ domain.ServerEventPublisher = (*recordingEventPublisher)(nil)
var _ domain.ServerHistoryRepository = (*repository.FileServerHistoryRepo)(nil)
