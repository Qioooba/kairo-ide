package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/catalinabase"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/proc"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/tomcat6"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

type ProcessFactory func() proc.ManagedProcess

type Tomcat6ProviderConfig struct {
	StartTimeout time.Duration
	StopTimeout  time.Duration
	GraceTimeout time.Duration
}

type Tomcat6Provider struct {
	mu             sync.RWMutex
	instances      map[domain.ServerID]*runningInstance
	watchers       map[domain.ServerID]*HotReloadWatcher
	processFactory ProcessFactory
	preparer       catalinabase.Preparer
	eventHub       *events.EventHub
	cfg            Tomcat6ProviderConfig
}

type serverStartedData struct {
	ServerID domain.ServerID `json:"serverId"`
	Port     int             `json:"port"`
	PID      int             `json:"pid"`
}

type runningInstance struct {
	identity domain.ProcessIdentity
	plan     domain.RuntimePlan
	process  proc.ManagedProcess
	gen      uint64
}

func NewTomcat6Provider(processFactory ProcessFactory, preparer catalinabase.Preparer, eventHub *events.EventHub, cfg Tomcat6ProviderConfig) *Tomcat6Provider {
	if cfg.StartTimeout <= 0 {
		cfg.StartTimeout = tomcat6.DefaultStartTimeout
	}
	if cfg.StopTimeout <= 0 {
		cfg.StopTimeout = tomcat6.DefaultStopTimeout
	}
	if cfg.GraceTimeout <= 0 {
		cfg.GraceTimeout = 15 * time.Second
	}
	if processFactory == nil {
		processFactory = func() proc.ManagedProcess { return proc.New() }
	}
	if preparer == nil {
		preparer = catalinabase.NewDefaultPreparer()
	}
	return &Tomcat6Provider{
		instances:      make(map[domain.ServerID]*runningInstance),
		watchers:       make(map[domain.ServerID]*HotReloadWatcher),
		processFactory: processFactory,
		preparer:       preparer,
		eventHub:       eventHub,
		cfg:            cfg,
	}
}

func (p *Tomcat6Provider) ID() string { return "tomcat6" }

// publishEvent publishes a server lifecycle event via EventHub if configured.
func (p *Tomcat6Provider) publishEvent(eventType events.EventType, workspaceID, message string, data json.RawMessage) {
	if p.eventHub == nil {
		return
	}
	p.eventHub.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: workspaceID,
		Message:     message,
		Data:        data,
	})
}

func (p *Tomcat6Provider) Prepare(ctx context.Context, plan domain.RuntimePlan) error {
	if err := p.validatePlan(plan); err != nil {
		return err
	}

	owner := catalinabase.OwnerMetadata{
		WorkspaceID: plan.WorkspaceID,
		ProjectID:   plan.ProjectID,
		ServerID:    plan.ServerID,
		RuntimeID:   plan.RuntimeID,
	}
	cbPlan := &catalinabase.Plan{
		Owner: owner,
		Layout: catalinabase.Layout{
			BaseDir:    plan.CatalinaBase,
			ConfDir:    plan.CatalinaBase + "/conf",
			LogsDir:    plan.CatalinaBase + "/logs",
			TempDir:    plan.CatalinaBase + "/temp",
			WorkDir:    plan.CatalinaBase + "/work",
			WebappsDir: plan.CatalinaBase + "/webapps",
			StateDir:   plan.CatalinaBase + "/state",
		},
	}
	if err := p.preparer.Prepare(cbPlan); err != nil {
		return fmt.Errorf("prepare catalina base: %w", err)
	}

	tcCfg := tomcat6.Config{
		CatalinaHome: plan.CatalinaHome,
		CatalinaBase: plan.CatalinaBase,
		JavaHome:     plan.JavaHome,
		HTTPPort:     plan.HTTPPort,
		ShutdownPort: plan.ShutdownPort,
		ContextPath:  plan.ContextPath,
		WebappDir:    plan.WebappDir,
		JVMOptions:   plan.JVMOptions,
		Env:          plan.Env,
	}
	if err := tomcat6.PrepareCatalinaBase(tcCfg); err != nil {
		return fmt.Errorf("prepare tomcat config: %w", err)
	}

	return nil
}

func (p *Tomcat6Provider) Start(ctx context.Context, plan domain.RuntimePlan, logSink func(domain.LogLine)) (*domain.ProcessIdentity, error) {
	if err := p.validatePlan(plan); err != nil {
		return nil, err
	}

	p.mu.Lock()
	if _, exists := p.instances[plan.ServerID]; exists {
		p.mu.Unlock()
		return nil, domain.ErrServerAlreadyRunning
	}
	p.mu.Unlock()

	tcCfg := tomcat6.Config{
		CatalinaHome: plan.CatalinaHome,
		CatalinaBase: plan.CatalinaBase,
		JavaHome:     plan.JavaHome,
		HTTPPort:     plan.HTTPPort,
		ShutdownPort: plan.ShutdownPort,
		ContextPath:  plan.ContextPath,
		WebappDir:    plan.WebappDir,
		JVMOptions:   plan.JVMOptions,
		Env:          plan.Env,
	}

	executable, args, env, err := tomcat6.BuildCommand(tcCfg)
	if err != nil {
		return nil, fmt.Errorf("build command: %w", err)
	}

	process := p.processFactory()
	gen := plan.Generation
	if gen == 0 {
		gen = 1
	}

	var logDisp proc.Disposable
	if logSink != nil {
		logDisp = process.SubscribeLogs(func(line domain.LogLine) {
			line.Generation = gen
			logSink(line)
		})
	}

	spec := proc.ProcessSpec{
		Executable:   executable,
		Args:         args,
		Dir:          plan.CatalinaBase,
		Env:          env,
		LogDir:       plan.CatalinaBase + "/logs",
		CatalinaBase: plan.CatalinaBase,
	}

	obs, err := process.Start(ctx, spec)
	if err != nil {
		if logDisp != nil {
			logDisp.Dispose()
		}
		return nil, fmt.Errorf("start process: %w", err)
	}

	inst := &runningInstance{
		identity: obs.Identity,
		plan:     plan,
		process:  process,
		gen:      gen,
	}

	p.mu.Lock()
	p.instances[plan.ServerID] = inst
	p.mu.Unlock()

	deadline := time.Now().Add(p.cfg.StartTimeout)
	readyErr := tomcat6.WaitForReady(ctx, plan.HTTPPort, deadline)
	if readyErr != nil {
		// Provider contract: Start must clean up any process it started
		// before returning an error. The UseCase owns the PortLease and
		// releases it separately on failure.
		_ = p.ForceStop(ctx, obs.Identity)
		if logDisp != nil {
			logDisp.Dispose()
		}
		p.mu.Lock()
		delete(p.instances, plan.ServerID)
		p.mu.Unlock()
		p.publishEvent(events.EventServerError, string(plan.WorkspaceID),
			fmt.Sprintf("Server %s readiness failed: %v", plan.ServerID, readyErr), nil)
		return nil, fmt.Errorf("readiness failed: %w", readyErr)
	}

	p.publishEvent(events.EventServerStarted, string(plan.WorkspaceID),
		fmt.Sprintf("Server %s started on port %d", plan.ServerID, plan.HTTPPort),
		jsonMarshal(serverStartedData{
			ServerID: plan.ServerID,
			Port:     plan.HTTPPort,
			PID:      obs.Identity.PID,
		}))

	// P0: start HotReloadWatcher for direct docBase mode (WebappDir is DocBase).
	// Static files are served directly from WebappDir, so DeploymentDir is
	// left empty to skip syncStaticFile copy. Java changes trigger compile
	// callback that syncs OutputDir/WEB-INF/classes if available.
	p.startWatcher(plan)

	return &obs.Identity, nil
}

func (p *Tomcat6Provider) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	inst, err := p.findInstanceByIdentity(identity)
	if err != nil {
		return err
	}
	p.stopWatcher(inst.plan.ServerID)

	shutdownErr := tomcat6.SendShutdown(inst.plan.ShutdownPort, 5*time.Second)

	waitCtx, waitCancel := context.WithTimeout(ctx, p.cfg.GraceTimeout)
	defer waitCancel()

	done := make(chan struct{})
	go func() {
		inst.process.Wait()
		close(done)
	}()

	select {
	case <-done:
		p.cleanupInstance(inst)
		p.publishEvent(events.EventServerStopped, string(inst.plan.WorkspaceID),
			fmt.Sprintf("Server %s stopped gracefully", inst.plan.ServerID), nil)
		return nil
	case <-waitCtx.Done():
		if shutdownErr != nil {
			return p.ForceStop(ctx, identity)
		}
		return p.ForceStop(ctx, identity)
	}
}

func (p *Tomcat6Provider) ForceStop(ctx context.Context, identity domain.ProcessIdentity) error {
	inst, err := p.findInstanceByIdentity(identity)
	if err != nil {
		return err
	}
	p.stopWatcher(inst.plan.ServerID)
	stopCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	err = inst.process.ForceStop(stopCtx, identity)
	p.cleanupInstance(inst)
	p.publishEvent(events.EventServerStopped, string(inst.plan.WorkspaceID),
		fmt.Sprintf("Server %s force stopped", inst.plan.ServerID), nil)
	return err
}

func (p *Tomcat6Provider) IsReady(ctx context.Context, plan domain.RuntimePlan, identity domain.ProcessIdentity, deadline time.Time) error {
	inst, err := p.findInstanceByIdentity(identity)
	if err != nil {
		return err
	}
	inspectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	obs, err := inst.process.Inspect(inspectCtx, identity)
	if err != nil {
		return err
	}
	if !obs.Running {
		return fmt.Errorf("process not running")
	}
	return tomcat6.WaitForReady(ctx, plan.HTTPPort, deadline)
}

func (p *Tomcat6Provider) Inspect(ctx context.Context, identity domain.ProcessIdentity) (domain.ProcessObservation, error) {
	inst, err := p.findInstanceByIdentity(identity)
	if err != nil {
		return domain.ProcessObservation{Running: false}, err
	}
	inspectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	obs, err := inst.process.Inspect(inspectCtx, identity)
	if err != nil {
		return domain.ProcessObservation{}, err
	}
	return domain.ProcessObservation{
		PID:              obs.PID,
		Identity:         obs.Identity,
		Running:          obs.Running,
		ExitCode:         obs.ExitCode,
		IdentityMismatch: obs.IdentityMismatch,
	}, nil
}

func (p *Tomcat6Provider) CleanupBase(ctx context.Context, plan domain.RuntimePlan) error {
	p.mu.Lock()
	if inst, exists := p.instances[plan.ServerID]; exists {
		inspectCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		obs, _ := inst.process.Inspect(inspectCtx, inst.identity)
		cancel()
		if obs.Running {
			p.mu.Unlock()
			return fmt.Errorf("cannot cleanup base: server still running")
		}
		delete(p.instances, plan.ServerID)
	}
	p.mu.Unlock()
	p.stopWatcher(plan.ServerID)
	return nil
}

func (p *Tomcat6Provider) validatePlan(plan domain.RuntimePlan) error {
	if plan.CatalinaHome == "" {
		return fmt.Errorf("catalina home is required")
	}
	if plan.CatalinaBase == "" {
		return fmt.Errorf("catalina base is required")
	}
	if plan.JavaHome == "" {
		return fmt.Errorf("java home is required")
	}
	if plan.WebappDir == "" {
		return fmt.Errorf("webapp dir is required")
	}
	if plan.HTTPPort <= 0 {
		return fmt.Errorf("http port is required")
	}
	if plan.ShutdownPort <= 0 {
		return fmt.Errorf("shutdown port is required")
	}
	return nil
}

func (p *Tomcat6Provider) findInstanceByIdentity(identity domain.ProcessIdentity) (*runningInstance, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, inst := range p.instances {
		if inst.identity.Equal(identity) {
			return inst, nil
		}
	}
	return nil, domain.ErrServerNotFound
}

func (p *Tomcat6Provider) cleanupInstance(inst *runningInstance) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for sid, i := range p.instances {
		if i == inst {
			delete(p.instances, sid)
			return
		}
	}
}

func (p *Tomcat6Provider) startWatcher(plan domain.RuntimePlan) {
	cfg := DefaultHotReloadConfig()
	cfg.WebappDir = plan.WebappDir
	// Direct docBase mode: WebappDir is served directly, no DeploymentDir copy needed.
	cfg.DeploymentDir = ""
	cfg.SourceDirs = plan.SourceDirs
	cfg.OutputDir = plan.OutputDir
	cfg.PollInterval = 2 * time.Second
	watcher := NewHotReloadWatcher(cfg)
	watcher.SetEventHub(p.eventHub, string(plan.WorkspaceID), string(plan.ServerID))
	// Compile callback: sync OutputDir .class files to WebappDir/WEB-INF/classes
	// (incremental javac is triggered via frontend HotDeployService -> /api/v1/jvm/compile-incremental).
	// This callback ensures compiled output is visible to Tomcat's classloader.
	watcher.SetCompileCallback(func(ctx context.Context, changedFiles []string) error {
		if cfg.OutputDir == "" || cfg.WebappDir == "" {
			return nil
		}
		// Best-effort: copy any .class files that changed in OutputDir to WEB-INF/classes.
		// Full javac is handled by BuildUseCase/incremental API; watcher just syncs artifacts.
		return syncCompiledClasses(cfg.OutputDir, cfg.WebappDir)
	})
	watcher.Start(context.Background())
	p.mu.Lock()
	p.watchers[plan.ServerID] = watcher
	p.mu.Unlock()
}

func (p *Tomcat6Provider) stopWatcher(serverID domain.ServerID) {
	p.mu.Lock()
	watcher, ok := p.watchers[serverID]
	if ok {
		delete(p.watchers, serverID)
	}
	p.mu.Unlock()
	if watcher != nil {
		watcher.Stop()
	}
}

// syncCompiledClasses copies .class files from outputDir to webappDir/WEB-INF/classes preserving relative paths.
func syncCompiledClasses(outputDir, webappDir string) error {
	targetBase := filepath.Join(webappDir, "WEB-INF", "classes")
	return filepath.Walk(outputDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(path), ".class") {
			return nil
		}
		rel, err := filepath.Rel(outputDir, path)
		if err != nil {
			return nil
		}
		if strings.HasPrefix(rel, "..") {
			return nil
		}
		target := filepath.Join(targetBase, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return nil
		}
		src, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer src.Close()
		dst, err := os.Create(target)
		if err != nil {
			return nil
		}
		defer dst.Close()
		_, _ = io.Copy(dst, src)
		return nil
	})
}

// ReloadContext triggers a Tomcat context reload for the given server by
// touching the WEB-INF/web.xml file. This causes Tomcat to reload the web
// application context without restarting the entire server.
// Note: On Java 9+, this may be unstable due to reflection restrictions.
func (p *Tomcat6Provider) ReloadContext(ctx context.Context, serverID domain.ServerID) error {
	p.mu.RLock()
	inst, ok := p.instances[serverID]
	p.mu.RUnlock()
	if !ok {
		return domain.ErrServerNotFound
	}

	webXML := inst.plan.WebappDir + "/WEB-INF/web.xml"
	now := time.Now()
	if err := os.Chtimes(webXML, now, now); err != nil {
		return fmt.Errorf("touch web.xml for context reload: %w", err)
	}

	p.publishEvent(events.EventHotReloadStatus, string(inst.plan.WorkspaceID),
		"Context reload triggered",
		jsonMarshal(map[string]string{
			"serverId": string(serverID),
			"status":   string(HotReloadSynced),
		}))

	return nil
}

// jsonMarshal marshals a value to json.RawMessage, panicking on error
// (only used for known-safe structs).
func jsonMarshal(v any) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		panic("jsonMarshal: " + err.Error())
	}
	return data
}
