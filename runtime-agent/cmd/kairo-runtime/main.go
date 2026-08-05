// Command kairo-runtime is the Kairo Runtime Agent — the
// execution core of the Kairo IDE. It speaks the /api/v1 wire
// protocol defined in packages/protocol/src/index.ts.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	stdlog "log"
	"net"
	"net/http"
	_ "net/http/pprof"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/bootstrap"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/config"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/tomcat6"
)

// agentState is written to <dataDir>/agent-state.json on startup so
// other processes (Desktop, Browser launcher) can discover the running
// agent and reuse it instead of starting a duplicate.
type agentState struct {
	Port        int    `json:"port"`
	PID         int    `json:"pid"`
	BindAddress string `json:"bindAddress"`
	StartedAt   string `json:"startedAt"`
}

func writeAgentState(dataDir string, st agentState) {
	statePath := filepath.Join(dataDir, "agent-state.json")
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		stdlog.Printf("WARN: failed to marshal agent state: %v", err)
		return
	}
	// Owner-only (0600). Remove any prior file first so OpenFile's
	// mode is applied — mode is ignored when truncating an existing
	// file that may still be world-readable from older releases.
	_ = os.Remove(statePath)
	f, err := os.OpenFile(statePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		stdlog.Printf("WARN: failed to write agent state file %s: %v", statePath, err)
		return
	}
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil {
		stdlog.Printf("WARN: failed to write agent state file %s: %v", statePath, writeErr)
		_ = os.Remove(statePath)
		return
	}
	if closeErr != nil {
		stdlog.Printf("WARN: failed to close agent state file %s: %v", statePath, closeErr)
		return
	}
	stdlog.Printf("agent state written to %s (port=%d, pid=%d)", statePath, st.Port, st.PID)
}

func removeAgentState(dataDir string) {
	statePath := filepath.Join(dataDir, "agent-state.json")
	if err := os.Remove(statePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		stdlog.Printf("WARN: failed to remove agent state file %s: %v", statePath, err)
	}
}

const (
	agentVersion           = "0.1.0"
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
	// KAIRO-RC-WEB-242: fall back to the bundled Tomcat 6 when
	// KAIRO_TOMCAT6_HOME is unset — previously the server runner
	// received an empty home and every Start failed with
	// "Tomcat 6 not bundled" even when bundled/tomcat6 was prepared.
	tomcat6Home := os.Getenv("KAIRO_TOMCAT6_HOME")
	if tomcat6Home == "" {
		if home, err := tomcat6.FindCatalinaHome(cfg.Bundled()); err == nil {
			tomcat6Home = home
		}
	}

	container, err := bootstrap.NewContainer(bootstrap.Config{
		DataDir:           cfg.DataDir,
		BundledDir:        cfg.Bundled(),
		Logger:            logger,
		Tomcat6Home:       tomcat6Home,
		Secret:            cfg.Secret,
		SkipSHAVerify:     cfg.SkipSHAVerify,
		JDTLSURL:          cfg.JDTLSURL,
		TomcatDefaultPort: cfg.TomcatDefaultPort,
		JDWPDefaultPort:   cfg.JDWPDefaultPort,
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
	// Configure per-IP rate limiting from config. A value <= 0 disables
	// limiting, which is what browser E2E runs use to avoid WebSocket
	// and rapid API polling from being throttled.
	srv.SetRateLimit(cfg.RateLimit)
	srv.SetRequireAuth(cfg.RequireAuth)

	// Remote mode is not available in this release. Only loopback
	// addresses are allowed.
	host := cfg.BindAddress
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		stdlog.Fatalf("remote mode is not available in this release. Please bind to 127.0.0.1 only")
	}

	// Write agent state after bind so port 0 resolves to the real
	// OS-assigned port (DK-P1-2). Desktop polls this file for discovery.
	addr := fmt.Sprintf("%s:%d", cfg.BindAddress, cfg.Port)
	ln, err := srv.Listen(addr)
	if err != nil {
		shutCtx, cancel := context.WithTimeout(context.Background(), restartShutdownTimeout)
		defer cancel()
		_ = container.Shutdown(shutCtx)
		stdlog.Fatalf("listen: %v", err)
	}
	boundPort := srv.BoundPort()
	writeAgentState(cfg.DataDir, agentState{
		Port:        boundPort,
		PID:         os.Getpid(),
		BindAddress: cfg.BindAddress,
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	defer removeAgentState(cfg.DataDir)

	// Wire restart after bind so --port 0 is replaced with the concrete
	// OS-assigned port (otherwise /api/v1/runtime/restart would rebind
	// a different ephemeral port).
	srv.SetRestartConfig(api.RestartConfig{
		Args:            withPinnedPort(originalArgs, boundPort),
		ShutdownTimeout: restartShutdownTimeout,
		OnShutdown:      container.Shutdown,
	})

	if err := srv.Serve(ln, cfg.TLSCert, cfg.TLSKey); err != nil {
		// Serve returning != nil usually means the
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
		// Serve returning != nil means the server
		// stopped (e.g. TLS misconfigured).
		// Make sure the container's resources are released
		// before we exit.
		shutCtx, cancel := context.WithTimeout(context.Background(), restartShutdownTimeout)
		defer cancel()
		_ = container.Shutdown(shutCtx)
		stdlog.Fatalf("server error: %v", err)
	}
}

// withPinnedPort rewrites --port in args to the concrete bound port.
// Used after Listen so ephemeral (--port 0) restarts stay on the same port.
func withPinnedPort(args []string, port int) []string {
	out := make([]string, len(args))
	copy(out, args)
	portStr := fmt.Sprintf("%d", port)
	for i := 0; i < len(out); i++ {
		if out[i] == "--port" && i+1 < len(out) {
			out[i+1] = portStr
			return out
		}
		if len(out[i]) > 7 && out[i][:7] == "--port=" {
			out[i] = "--port=" + portStr
			return out
		}
	}
	return append(out, "--port", portStr)
}
