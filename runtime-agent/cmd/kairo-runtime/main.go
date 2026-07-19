// Command kairo-runtime is the Kairo Runtime Agent — the
// execution core of the Kairo IDE. It speaks the /api/v1 wire
// protocol defined in packages/protocol/src/index.ts.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/bootstrap"
	"github.com/kairo-ide/runtime-agent/internal/config"
	"github.com/kairo-ide/runtime-agent/internal/log"
)

const agentVersion = "0.1.0"

// restartShutdownTimeout bounds the time the runtime-restart
// handler gives to the container's Shutdown and the HTTP
// server before it spawns the new process and exits. Per
// docs/hotfix-windows-test-readiness.md 搂3 the agent must
// return within a few seconds; 3s matches the contract.
const restartShutdownTimeout = 3 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "kairo-runtime:", err)
		os.Exit(1)
	}
}

func run() error {
	// Capture the original CLI args before config.Bind consumes
	// them. /api/v1/runtime/restart uses this slice to respawn
	// the agent with the same flags (e.g. --config, --port).
	originalArgs := os.Args[1:]

	cfg, _, err := config.Bind(originalArgs)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.Bundled(), 0o755); err != nil {
		return err
	}
	logger := log.New("agent").WithLevel(log.ParseLevel(cfg.LogLevel))
	logger.Info("starting kairo-runtime", log.Fields{
		"version": agentVersion,
		"config":  cfg.String(),
	})

	// Audit log: in dev we log to <DataDir>/audit.log.ndjson.
	auditLog, err := audit.New(filepath.Join(cfg.DataDir, "audit.log.ndjson"))
	if err != nil {
		return fmt.Errorf("open audit log: %w", err)
	}
	defer auditLog.Close()

	// Bootstrap the composition root container.
	// This is the single entry point that wires all dependencies.
	container, err := bootstrap.NewContainer(bootstrap.Config{
		DataDir:       cfg.DataDir,
		BundledDir:    cfg.Bundled(),
		Logger:        logger,
		Tomcat6Home:   os.Getenv("KAIRO_TOMCAT6_HOME"),
		Secret:        cfg.Secret,
		SkipSHAVerify: cfg.SkipSHAVerify,
		JDTLSURL:      cfg.JDTLSURL,
	})
	if err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	// NOTE: we no longer `defer container.Shutdown` here.
	// /api/v1/runtime/restart is the new shutdown path; it
	// calls container.Shutdown under a 3s timeout, then
	// os.Exit(0) — so the deferred shutdown would otherwise
	// run twice on the happy path. The container is also
	// explicitly shut down when ListenAndServe returns (e.g.
	// the listener errored out) below.

	srv := api.NewServer(container.Services, logger, auditLog, agentVersion, cfg.Secret)

	// Wire the restart handler so POST /api/v1/runtime/restart
	// can respawn this process. Executable is resolved lazily
	// (os.Executable) inside api.Server.doRestart — by then
	// any symlink/rename has settled, so the respawned process
	// always points to the right binary.
	srv.SetRestartConfig(api.RestartConfig{
		Args:            originalArgs,
		ShutdownTimeout: restartShutdownTimeout,
		OnShutdown:      container.Shutdown,
	})

	// Remote mode is not available in this release. Only loopback
	// addresses are allowed.
	host := cfg.BindAddress
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("remote mode is not available in this release. Please bind to 127.0.0.1 only")
	}

	addr := fmt.Sprintf("%s:%d", cfg.BindAddress, cfg.Port)
if err := srv.ListenAndServe(addr, cfg.TLSCert, cfg.TLSKey); err != nil {
		// ListenAndServe returning != nil usually means the
		// server stopped (e.g. port in use, TLS misconfigured).
		// But http.ErrServerClosed is the normal return value
		// after a graceful Shutdown — including the one
		// /api/v1/runtime/restart triggers. If we treat that
		// as a fatal error here, we race with the restart
		// goroutine which is about to spawn a replacement
		// process and os.Exit(0): main.run() would os.Exit(1)
		// first, killing the new process before it can bind
		// the port. So treat ErrServerClosed as a clean
		// shutdown.
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		// ListenAndServe returning != nil means the server
		// stopped (e.g. port in use, TLS misconfigured).
		// Make sure the container's resources are released
		// before we exit.
		shutCtx, cancel := context.WithTimeout(context.Background(), restartShutdownTimeout)
		defer cancel()
		_ = container.Shutdown(shutCtx)
		return err
	}
	return nil
}
