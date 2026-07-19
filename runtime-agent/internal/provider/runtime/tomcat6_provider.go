package runtime

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/catalinabase"
	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/proc"
	"github.com/kairo-ide/runtime-agent/internal/tomcat6"
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
	processFactory ProcessFactory
	preparer       catalinabase.Preparer
	cfg            Tomcat6ProviderConfig
}

type runningInstance struct {
	identity domain.ProcessIdentity
	plan     domain.RuntimePlan
	process  proc.ManagedProcess
	lease    *domain.PortLease
	gen      uint64
}

func NewTomcat6Provider(processFactory ProcessFactory, preparer catalinabase.Preparer, cfg Tomcat6ProviderConfig) *Tomcat6Provider {
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
		processFactory: processFactory,
		preparer:       preparer,
		cfg:            cfg,
	}
}

func (p *Tomcat6Provider) ID() string { return "tomcat6" }

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

func (p *Tomcat6Provider) Start(ctx context.Context, plan domain.RuntimePlan, logSink func(domain.LogLine)) (*domain.ProcessIdentity, *domain.PortLease, error) {
	if err := p.validatePlan(plan); err != nil {
		return nil, nil, err
	}

	p.mu.Lock()
	if _, exists := p.instances[plan.ServerID]; exists {
		p.mu.Unlock()
		return nil, nil, domain.ErrServerAlreadyRunning
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
		return nil, nil, fmt.Errorf("build command: %w", err)
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
		return nil, nil, fmt.Errorf("start process: %w", err)
	}

	lease := domain.NewPortLease(plan.HTTPPort, plan.ShutdownPort, plan.DebugPort, func() {})

	inst := &runningInstance{
		identity: obs.Identity,
		plan:     plan,
		process:  process,
		lease:    lease,
		gen:      gen,
	}

	p.mu.Lock()
	p.instances[plan.ServerID] = inst
	p.mu.Unlock()

	deadline := time.Now().Add(p.cfg.StartTimeout)
	readyErr := tomcat6.WaitForReady(ctx, plan.HTTPPort, deadline)
	if readyErr != nil {
		_ = p.ForceStop(ctx, obs.Identity)
		if logDisp != nil {
			logDisp.Dispose()
		}
		p.mu.Lock()
		delete(p.instances, plan.ServerID)
		p.mu.Unlock()
		return nil, nil, fmt.Errorf("readiness failed: %w", readyErr)
	}

	return &obs.Identity, lease, nil
}

func (p *Tomcat6Provider) GracefulStop(ctx context.Context, identity domain.ProcessIdentity) error {
	inst, err := p.findInstanceByIdentity(identity)
	if err != nil {
		return err
	}

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
	stopCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	err = inst.process.ForceStop(stopCtx, identity)
	p.cleanupInstance(inst)
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
			if i.lease != nil {
				i.lease.Release()
			}
			delete(p.instances, sid)
			return
		}
	}
}
