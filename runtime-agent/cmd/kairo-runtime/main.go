// Command kairo-runtime is the Kairo Runtime Agent — the
// execution core of the Kairo IDE. It speaks the /api/v1 wire
// protocol defined in packages/protocol/src/index.ts.
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/bootstrap"
	"github.com/kairo-ide/runtime-agent/internal/config"
	"github.com/kairo-ide/runtime-agent/internal/log"
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
	defer container.Shutdown(context.Background())

	srv := api.NewServer(container.Services, logger, auditLog, agentVersion, cfg.Secret)

	// Remote mode is not available in this release. Only loopback
	// addresses are allowed.
	host := cfg.BindAddress
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("remote mode is not available in this release. Please bind to 127.0.0.1 only")
	}

	addr := fmt.Sprintf("%s:%d", cfg.BindAddress, cfg.Port)
	return srv.ListenAndServe(addr, cfg.TLSCert, cfg.TLSKey)
}