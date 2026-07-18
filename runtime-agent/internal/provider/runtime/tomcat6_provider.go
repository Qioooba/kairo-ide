package runtime

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/proc"
	"github.com/kairo-ide/runtime-agent/internal/tomcat6"
)

// Tomcat6Config holds configuration for the Tomcat6 runtime provider.
type Tomcat6Config struct {
	StartTimeout time.Duration
	StopTimeout  time.Duration
	JavaHome     string
	CatalinaHome string
	DataDir      string
}

// Tomcat6Provider implements RuntimeProvider for Apache Tomcat 6.
type Tomcat6Provider struct {
	mu         sync.RWMutex
	instances  map[domain.ServerID]*tomcat6.Instance
	bundledDir string
	cfg        Tomcat6Config
}

// NewTomcat6Provider creates a new Tomcat6Provider.
func NewTomcat6Provider(bundledDir string, cfg Tomcat6Config) *Tomcat6Provider {
	if cfg.StartTimeout <= 0 {
		cfg.StartTimeout = 60 * time.Second
	}
	if cfg.StopTimeout <= 0 {
		cfg.StopTimeout = 30 * time.Second
	}
	return &Tomcat6Provider{
		instances:  make(map[domain.ServerID]*tomcat6.Instance),
		bundledDir: bundledDir,
		cfg:        cfg,
	}
}

func (p *Tomcat6Provider) ID() string { return "tomcat6" }

func (p *Tomcat6Provider) Prepare(ctx context.Context, project domain.Project) (*domain.RuntimePlan, error) {
	catalinaHome, err := tomcat6.FindCatalinaHome(p.bundledDir)
	if err != nil {
		return nil, fmt.Errorf("find catalina home: %w", err)
	}

	plan := &domain.RuntimePlan{
		ServerID:         domain.ServerID(project.ID),
		JavaHome:         "", // resolved from toolchain at start time
		CatalinaHome:     catalinaHome,
		CatalinaBase:     "", // set during Start
		HTTPPort:         0,  // auto
		ShutdownPort:     0,  // auto
		ContextPath:      project.ContextPath,
		AbsoluteWebappDir: project.WebappDir, // relative; resolved by caller
		JVMOptions:       []string{},
	}

	return plan, nil
}

func (p *Tomcat6Provider) Start(ctx context.Context, plan domain.RuntimePlan) (*domain.ServerInstance, error) {
	spec := tomcat6.Spec{
		ID:           string(plan.ServerID),
		JavaHome:     plan.JavaHome,
		CatalinaHome: plan.CatalinaHome,
		CatalinaBase: plan.CatalinaBase,
		HTTPPort:     plan.HTTPPort,
		ShutdownPort: plan.ShutdownPort,
		ContextPath:  plan.ContextPath,
		WebappDir:    plan.AbsoluteWebappDir,
		JVMOptions:   plan.JVMOptions,
	}

	inst, err := tomcat6.Start(ctx, spec)
	if err != nil {
		return nil, fmt.Errorf("start tomcat6: %w", err)
	}

	p.mu.Lock()
	p.instances[plan.ServerID] = inst
	p.mu.Unlock()

	return &domain.ServerInstance{
		ID:          plan.ServerID,
		WorkspaceID: "", // set by caller
		ProjectID:   "", // set by caller
		State:       domain.ServerStateRunning,
		HTTPPort:    inst.Ports().HTTP,
		PID:         inst.PID(),
		StartTime:   inst.StartedAt(),
	}, nil
}

func (p *Tomcat6Provider) Stop(ctx context.Context, id domain.ServerID, force bool) error {
	p.mu.Lock()
	inst, ok := p.instances[id]
	if !ok {
		p.mu.Unlock()
		return fmt.Errorf("server %s not found", id)
	}
	delete(p.instances, id)
	p.mu.Unlock()

	if force {
		return inst.ForceStop()
	}
	return inst.Stop(p.cfg.StopTimeout)
}

func (p *Tomcat6Provider) Inspect(ctx context.Context, id domain.ServerID) (*domain.ServerInstance, error) {
	p.mu.RLock()
	inst, ok := p.instances[id]
	p.mu.RUnlock()

	if !ok {
		return &domain.ServerInstance{
			ID:    id,
			State: domain.ServerStateStopped,
		}, nil
	}

	// Check if process is alive
	if !proc.IsAlive(inst.PID()) {
		p.mu.Lock()
		delete(p.instances, id)
		p.mu.Unlock()
		return &domain.ServerInstance{
			ID:    id,
			State: domain.ServerStateStopped,
		}, nil
	}

	state := mapState(inst.State())

	return &domain.ServerInstance{
		ID:        id,
		State:     state,
		HTTPPort:  inst.Ports().HTTP,
		PID:       inst.PID(),
		StartTime: inst.StartedAt(),
	}, nil
}

// mapState converts tomcat6 instance state to domain server state.
func mapState(s string) domain.ServerState {
	switch s {
	case "starting":
		return domain.ServerStateStarting
	case "running":
		return domain.ServerStateRunning
	case "stopping":
		return domain.ServerStateStopping
	case "crashed":
		return domain.ServerStateCrashed
	default:
		return domain.ServerStateStopped
	}
}