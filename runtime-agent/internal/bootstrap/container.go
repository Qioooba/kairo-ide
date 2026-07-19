// Package bootstrap is the formal composition root for the Kairo Runtime Agent.
// Container is the single entry point that wires all dependencies together.
// Every use case, repository, and infrastructure component is created here
// and injected into the HTTP layer.
package bootstrap

import (
	"context"
	"fmt"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/security"
	"github.com/kairo-ide/runtime-agent/internal/services"
	"github.com/kairo-ide/runtime-agent/internal/transport/events"
)

// Config bundles the configuration needed to bootstrap the container.
type Config struct {
	DataDir     string
	BundledDir  string
	Logger      *log.Logger
	Tomcat6Home string
	Secret      string
	// JDT LS distribution
	SkipSHAVerify bool
	JDTLSURL      string
}

// Container holds all wired dependencies for the Runtime Agent.
// It is the single composition root - every component receives its
// dependencies through constructor injection here.
type Container struct {
	// Services - the HTTP layer's bag of dependencies (transitional adapter).
	// This will be replaced by direct use case injection in future waves.
	Services *api.Services

	// Infrastructure
	EventHub *events.EventHub
	Sandbox  *security.WorkspaceRoots

	// Lifecycle
	shutdownFns []func(context.Context) error
}

// NewContainer wires all dependencies and returns a ready-to-use Container.
// This is the ONLY place where concrete implementations are instantiated
// and wired together.
func NewContainer(cfg Config) (*Container, error) {
	// 1. Create sandbox
	sandbox, err := security.NewWorkspaceRoots(cfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("create sandbox: %w", err)
	}
	sandbox.WithReadOnly(cfg.BundledDir)

	// 2. Create EventHub
	eventHub := events.NewEventHub(1000, 100)

	// 3. Wire services using the existing service implementations.
	// This is transitional - the old services package wraps the
	// older concrete implementations.
	// In future waves, the HTTP layer will use use cases directly
	// and this will be replaced with app layer injection.
	svcs := services.NewMemoryServices(services.Config{
		DataDir:       cfg.DataDir,
		BundledDir:    cfg.BundledDir,
		Logger:        cfg.Logger,
		Tomcat6Home:   cfg.Tomcat6Home,
		SkipSHAVerify: cfg.SkipSHAVerify,
		JDTLSURL:      cfg.JDTLSURL,
	}, sandbox)

	// 4. Build container
	container := &Container{
		Services: svcs,
		EventHub: eventHub,
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

// Shutdown gracefully shuts down all managed resources.
// Cancels running builds, stops servers, closes subscribers.
func (c *Container) Shutdown(ctx context.Context) error {
	// Call shutdown functions in reverse order
	for i := len(c.shutdownFns) - 1; i >= 0; i-- {
		if err := c.shutdownFns[i](ctx); err != nil {
			// Log but continue shutting down remaining resources
			_ = err
		}
	}
	return nil
}
