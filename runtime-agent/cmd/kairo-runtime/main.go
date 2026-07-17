// Command kairo-runtime is the Kairo Runtime Agent — the
// execution core of the Kairo IDE. It speaks the /api/v1 wire
// protocol defined in packages/protocol/src/index.ts.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/config"
	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/security"
	"github.com/kairo-ide/runtime-agent/internal/services"
)

const agentVersion = "0.1.0"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "kairo-runtime:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, _, err := config.Bind(os.Args[1:])
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

	// Sandbox: in dev we use the DataDir; in server form the
	// per-user home is added later. Bundled/ is read-only.
	sandbox, err := security.NewWorkspaceRoots(cfg.DataDir)
	if err != nil {
		return err
	}
	sandbox.WithReadOnly(cfg.Bundled())

	// Wire the in-memory services with real implementations of
	// toolchain / search / encoding / build.
	svcs := services.NewMemoryServices(cfg.DataDir, cfg.Bundled(), sandbox)

	srv := api.NewServer(svcs, logger, auditLog, agentVersion)
	addr := fmt.Sprintf("%s:%d", cfg.BindAddress, cfg.Port)
	return srv.ListenAndServe(addr, cfg.TLSCert, cfg.TLSKey)
}
