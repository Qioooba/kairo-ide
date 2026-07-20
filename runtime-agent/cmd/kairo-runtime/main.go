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
	_ "net/http/pprof"
	"os"
	"path/filepath"
	"runtime"
	"time"
	stdlog "log"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/bootstrap"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/config"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

const (
	agentVersion          = "0.1.0"
	restartShutdownTimeout = 30 * time.Second
)

func main() {
	// Capture the original CLI args before config.Bind consumes
	// them. /api/v1/runtime/restart uses this slice to respawn
	// the agent with the same flags (e.g. --config, --port).
	originalArgs := os.Args[1:]

	cfg, _, err := config.Bind(originalArgs)
	if err != nil {
		stdlog.Fatalf("config error: %v", err)
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		stdlog.Fatalf("create data dir: %v", err)
	}
	if err := os.MkdirAll(cfg.Bundled(), 0o755); err != nil {
		stdlog.Fatalf("create bundled dir: %v", err)
	}
	logger := log.New("agent").WithLevel(log.ParseLevel(cfg.LogLevel))
	logger.Info("starting kairo-runtime", log.Fields{
		"version": agentVersion,
		"config":  cfg.String(),
	})

	// Dev-mode diagnostics: pprof + periodic memstats.
	if os.Getenv("KAIRO_DEV") == "1" {
		go func() {
			logger.Info("pprof listening on 127.0.0.1:6060", nil)
			http.ListenAndServe("127.0.0.1:6060", nil)
		}()
		go func() {
			ticker := time.NewTicker(60 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				var m runtime.MemStats
				runtime.ReadMemStats(&m)
				logger.Info("memstats", map[string]any{
					"heapAllocMB":  m.HeapAlloc / 1024 / 1024,
					"numGoroutine": runtime.NumGoroutine(),
					"numGC":        m.NumGC,
				})
			}
		}()
	}

	// Audit log: in dev we log to <DataDir>/audit.log.ndjson.
	auditLog, err := audit.New(filepath.Join(cfg.DataDir, "audit.log.ndjson"))
	if err != nil {
		stdlog.Fatalf("open audit log: %v", err)
	}
	defer auditLog.Close()

	// P0-4 security hardening: when the Desktop host spawns this
	// agent (KAIRO_DESKTOP=1), auth is non-negotiable — the loopback
	// socket is still reachable by any local user and the per-
	// session secret is what prevents a hostile local process from
	// driving the agent. The Desktop host sets KAIRO_LOCAL_SECRET
	// in the env (main.js in apps/desktop); we verify the secret
	// is non-empty in that mode and fail fast otherwise so a
	// misconfigured host never runs an unauthenticated agent.
	if os.Getenv("KAIRO_DESKTOP") == "1" {
		if cfg.Secret == "" {
			stdlog.Fatalf("KAIRO_DESKTOP=1 but no secret configured (set --secret or KAIRO_LOCAL_SECRET)")
		}
		logger.Info("desktop mode: secret auth enforced on all non-public endpoints", log.Fields{
			"secretBytes": len(cfg.Secret),
		})
	}

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
		stdlog.Fatalf("bootstrap: %v", err)
	}
	// NOTE: we no longer `defer container.Shutdown` here.
	// /api/v1/runtime/restart is the new shutdown path; it
	// calls container.Shutdown under a 3s timeout, then
	// os.Exit(0) — so the deferred shutdown would otherwise
	// run twice on the happy path. The container is also
	// explicitly shut down when ListenAndServe returns (e.g.
	// the listener errored out) below.

	// Wire the WebSocket EventBus. The adapter wraps the
	// EventHub created by bootstrap and is what the api
	// layer's /api/v1/events handler drives. Without this
	// wiring, handleEvents returns 500 "EventBus not
	// configured" and the browser WS connection times out
	// (P0-8).
	if container.Services != nil {
		container.Services.EventBus = container.EventBus
	}

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
		stdlog.Fatalf("remote mode is not available in this release. Please bind to 127.0.0.1 only")
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
			return
		}
		// ListenAndServe returning != nil means the server
		// stopped (e.g. port in use, TLS misconfigured).
		// Make sure the container's resources are released
		// before we exit.
		shutCtx, cancel := context.WithTimeout(context.Background(), restartShutdownTimeout)
		defer cancel()
		_ = container.Shutdown(shutCtx)
		stdlog.Fatalf("server error: %v", err)
	}
}