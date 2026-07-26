// Package bootstrap is the formal composition root for the Kairo Runtime Agent.
// Container is the single entry point that wires all dependencies together.
// Every use case, repository, and infrastructure component is created here
// and injected into the HTTP layer.
package bootstrap

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/services"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// Container holds all wired dependencies for the runtime agent.
type Container struct {
	// Services — composed service layer (transitional)
	Services *api.Services

	// Infrastructure
	EventHub *events.EventHub
	// EventBus is the api.EventBus adapter that the
	// /api/v1/events WebSocket handler drives. It wraps
	// EventHub and is the only piece of the EventHub
	// surface exposed to the api layer (the api package
	// itself does not import the events package, so the
	// interface keeps the dependency one-way).
	EventBus *events.EventBusAdapter
	Sandbox  *security.WorkspaceRoots

	// Repositories (exposed for direct use in tests)
	WorkspaceRepo domain.WorkspaceRepository
	ProjectRepo   domain.ProjectRepository
	ToolchainRepo domain.ToolchainRepository
	BuildHistory  domain.BuildHistoryRepository
	ServerHistory domain.ServerHistoryRepository

	shutdownFns []func(context.Context) error
}

// Config holds bootstrap configuration.
type Config struct {
	DataDir           string
	BundledDir        string
	Logger            *log.Logger
	Tomcat6Home       string
	Secret            string
	SkipSHAVerify     bool
	JDTLSURL          string
	TomcatDefaultPort int
	JDWPDefaultPort   int
}

// NewContainer builds and wires all dependencies.
func NewContainer(cfg Config) (*Container, error) {
	if cfg.DataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("get home dir: %w", err)
		}
		cfg.DataDir = filepath.Join(home, ".kairo", "runtime-agent")
	}

	// === Infrastructure ===
	eventHub := events.NewEventHub(1000, 100)
	sandbox, err := security.NewWorkspaceRoots()
	if err != nil {
		return nil, fmt.Errorf("create sandbox: %w", err)
	}

	// 2a. Create the EventBus adapter that the /api/v1/events
	//     WebSocket handler will use. Without this, the HTTP
	//     layer's handleEvents returns 500 "EventBus not
	//     configured" and the browser WS connection times out
	//     (P0-8: WS auth subprotocol negotiation failed).
	eventBus := &events.EventBusAdapter{Hub: eventHub}

	// 3. Wire services using the existing service implementations.
	// This is transitional - the old services package wraps the
	// older concrete implementations.
	// In future waves, the HTTP layer will use use cases directly
	// and this will be replaced with app layer injection.
	svcs := services.NewMemoryServices(services.Config{
		DataDir:           cfg.DataDir,
		BundledDir:        cfg.BundledDir,
		Logger:            cfg.Logger,
		Tomcat6Home:       cfg.Tomcat6Home,
		SkipSHAVerify:     cfg.SkipSHAVerify,
		JDTLSURL:          cfg.JDTLSURL,
		TomcatDefaultPort: cfg.TomcatDefaultPort,
		JDWPDefaultPort:   cfg.JDWPDefaultPort,
	}, sandbox)

	// 4. Build container
	container := &Container{
		Services: svcs,
		EventHub: eventHub,
		EventBus: eventBus,
		Sandbox:  sandbox,
		shutdownFns: []func(context.Context) error{
			func(ctx context.Context) error {
				cfg.Logger.Info("container shutdown complete", nil)
				return nil
			},
		},
	}

	return container, nil
}

// Shutdown gracefully stops all services.
func (c *Container) Shutdown(ctx context.Context) error {
	// Run shutdown functions in reverse order
	for i := len(c.shutdownFns) - 1; i >= 0; i-- {
		if err := c.shutdownFns[i](ctx); err != nil {
			return err
		}
	}
	return nil
}
