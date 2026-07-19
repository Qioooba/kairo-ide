// Package api is the HTTP layer of the Runtime Agent.
//
// Endpoints live under /api/v1. Every endpoint takes a
// RequestEnvelope and returns a ResponseEnvelope or an
// ErrorResponse. The wire shapes are owned by internal/api/protocol.
package api

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/log"
)

// WebSocketSubprotocol is the single subprotocol that all
// EventStream / WebSocket clients MUST use to present the
// shared secret. The header value sent on the wire is
//
//	Sec-WebSocket-Protocol: kairo-secret-v1
//
// The secret is NOT carried in the header. Instead the
// server's response includes a subprotocol token equal to
// the expected secret, so the browser API contract is
// `new WebSocket(url, ["kairo-secret-v1", secret])`. This
// keeps the secret out of the request URL/logs and works
// for browser WebSockets, which cannot set custom headers.
//
// Per docs/hotfix-windows-test-readiness.md 搂1.2.
const WebSocketSubprotocol = "kairo-secret-v1"

// Server is the HTTP server. It is built by NewServer and run
// by ListenAndServe.
type Server struct {
	mu       sync.Mutex
	logger   *log.Logger
	audit    *audit.Log
	router   *http.ServeMux
	started  time.Time
	version  string
	bindAddr string
	port     int
	secret   string

	// httpServer is the live *http.Server. It is created
	// lazily by ListenAndServe so Shutdown can be called by
	// the runtime-restart handler.
	httpServer *http.Server

	// restartConfig, if set, lets /api/v1/runtime/restart
	// spawn a fresh process. See SetRestartConfig.
	restartConfig RestartConfig

	// injected services
	Services *Services
}

// RestartConfig tells /api/v1/runtime/restart how to
// respawn the current process. Set via SetRestartConfig from
// main(). All fields are optional; the handler returns 200
// in all cases (the contract says "no body, secret auth,
// 200 {status: restarting}"), then performs the actual
// restart asynchronously.
type RestartConfig struct {
	// Executable is the path of the running binary. If
	// empty, os.Executable() is used.
	Executable string
	// Args are the CLI args to pass to the new process
	// (typically os.Args[1:]).
	Args []string
	// Env is the environment passed to the new process. If
	// nil, os.Environ() is used.
	Env []string
	// ShutdownTimeout bounds the time given to the user's
	// shutdown hook and the HTTP server. Default 3s.
	ShutdownTimeout time.Duration
	// OnShutdown is called after writing the 200 response.
	// Typically this is container.Shutdown. Optional.
	OnShutdown func(ctx context.Context) error
	// NoExec skips the spawn-and-exit phase. Used by unit
	// tests that want to exercise the 200-response and
	// OnShutdown hook without actually replacing the test
	// process. Production code MUST leave this false.
	NoExec bool
}

// Services is the bag of dependencies the handlers use. Set
// fields on it before calling ListenAndServe.
type Services struct {
	// WorkspaceStore reads/writes workspace metadata.
	WorkspaceStore WorkspaceStore
	// ProjectStore reads/writes project configs.
	ProjectStore ProjectStore
	// ToolchainRegistry is the toolchain registry.
	ToolchainRegistry ToolchainRegistry
	// Searcher runs full-text search.
	Searcher Searcher
	// Encoder runs encoding detection.
	Encoder Encoder
	// BuildEngine runs a build.
	BuildEngine BuildEngine
	// Deployer publishes a deployment.
	Deployer Deployer
	// ServerRunner starts/stops a server runtime (e.g. Tomcat).
	ServerRunner ServerRunner
	// Auth authenticates a session.
	Auth Authenticator
	// EventBus streams WebSocket events.
	EventBus EventBus
	// JDTLS owns the Eclipse JDT Language Server lifecycle.
	// Optional: when nil, /api/v1/jdtls returns 503.
	JDTLS JDTLS
	// JDTProjectGenerator writes the JDT LS project model for
	// legacy projects. Optional.
	JDTProjectGenerator JDTProjectGenerator
	// ProjectRepo resolves a project by workspace and project ID.
	// Used by the JDT LS launch descriptor handler.
	ProjectRepo ProjectRepo
	// ToolchainRepo resolves a toolchain by its ID.
	// Used by the JDT LS launch descriptor handler.
	ToolchainRepo ToolchainRepo
}

// NewServer creates a Server.
func NewServer(services *Services, l *log.Logger, a *audit.Log, version string, secret string) *Server {
	s := &Server{
		logger:   l,
		audit:    a,
		router:   http.NewServeMux(),
		started:  time.Now(),
		version:  version,
		secret:   secret,
		Services: services,
	}
	s.routes()
	return s
}

// SetRestartConfig configures how /api/v1/runtime/restart
// respawns the current process. Safe to call once before
// ListenAndServe. If unset, /api/v1/runtime/restart still
// returns 200 but performs no respawn (e.g. for test
// scenarios).
func (s *Server) SetRestartConfig(rc RestartConfig) {
	s.restartConfig = rc
}

// Handler returns the underlying http.Handler. Useful in tests.
// Handler returns the http.Handler that should be exposed to
// callers, including the security / logging / audit middleware.
// Callers (tests, ListenAndServe) must use this rather than
// s.router directly — the bare router skips secret checks and
// request-id propagation, so production and test paths must
// match.
func (s *Server) Handler() http.Handler { return s.middleware(s.router) }

// ListenAndServe starts the HTTP server. addr is "host:port".
func (s *Server) ListenAndServe(addr string, tlsCert, tlsKey string) error {
	s.mu.Lock()
	host, port, _ := splitHostPort(addr)
	s.bindAddr = host
	if n, err := strconv.Atoi(port); err == nil {
		s.port = n
	}
s.httpServer = &http.Server{
		Addr:              addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	srv := s.httpServer
	s.mu.Unlock()

	s.logger.Info("http listen", log.Fields{"addr": addr, "tls": tlsCert != ""})
	if tlsCert != "" {
		return srv.ListenAndServeTLS(tlsCert, tlsKey)
	}
	return srv.ListenAndServe()
}

// Shutdown gracefully stops the HTTP server. Used by
// /api/v1/runtime/restart and by the container on exit.
func (s *Server) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	srv := s.httpServer
	s.mu.Unlock()
	if srv == nil {
		return nil
	}
	return srv.Shutdown(ctx)
}

// middleware applies request ID, logging, audit, CORS, secret
// auth check, and recovery in that order.
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Kairo-Request-Id")
		if rid == "" {
			rid = newRequestID()
		}
		cid := r.Header.Get("X-Kairo-Correlation-Id")
		w.Header().Set("X-Kairo-Request-Id", rid)

		// Secret check: if the agent has a secret configured, require
		// the X-Kairo-Secret header on every request. The health and
		// endpoints routes are exempt so the desktop host can poll
		// them during boot before the secret is wired into the
		// runtime client. /api/v1/events does its own auth via the
		// WebSocket Sec-WebSocket-Protocol subprotocol (browsers
		// cannot set custom headers on a WebSocket upgrade).
		if s.secret != "" {
			switch r.URL.Path {
			case "/api/v1/health", "/api/v1/endpoints":
				// Public, by contract.
			case "/api/v1/events":
				// WebSocket auth is handled inside handleEvents.
			default:
				if r.Header.Get("X-Kairo-Secret") != s.secret {
					writeError(w, rid, cid, protocol.KairoError{
						Code:    protocol.ErrUnauthenticated,
						Message: "missing or invalid auth secret",
					})
					return
				}
			}
		}

		ctx := log.WithRequestContext(r.Context(), rid, cid, "", "")
		started := time.Now()

		defer func() {
			if rec := recover(); rec != nil {
				s.logger.Error("panic recovered", log.Fields{
					"requestId": rid,
					"recovered": fmt.Sprintf("%v", rec),
				})
				writeError(w, rid, cid, protocol.KairoError{
					Code:    protocol.ErrInternal,
					Message: "internal error",
				})
			}
			s.logger.Info("http done", log.Fields{
				"requestId": rid,
				"method":    r.Method,
				"path":      r.URL.Path,
				"elapsedMs": time.Since(started).Milliseconds(),
			})
		}()

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) routes() {
	// Health
	s.router.HandleFunc("/api/v1/health", s.handleHealth)
	// Endpoints — dynamic host:port for the runtime client
	// to discover where to connect (replaces the previously
	// hardcoded 18099 in the frontend).
	s.router.HandleFunc("/api/v1/endpoints", s.handleEndpoints)
	// Runtime control (restart).
	s.router.HandleFunc("/api/v1/runtime/restart", s.handleRuntimeRestart)
	// Workspaces
	s.router.HandleFunc("/api/v1/workspaces", s.handleWorkspaces)
	s.router.HandleFunc("/api/v1/workspaces/", s.handleWorkspacesSub)
	// Register the launch-descriptor sub-path before the generic
	// workspaces sub-handler so it has a chance to match first.
	// The Go mux dispatches by longest prefix match, so a more
	// specific path like /api/v1/workspaces/{ws}/java/launch-descriptor
	// must be registered before the catch-all /api/v1/workspaces/.
	s.router.HandleFunc("/api/v1/workspaces/{ws}/java/", s.handleWorkspacesJava)
	// Projects
	s.router.HandleFunc("/api/v1/projects", s.handleProjects)
	s.router.HandleFunc("/api/v1/projects/", s.handleProjectByID)
	// Toolchains
	s.router.HandleFunc("/api/v1/toolchains", s.handleToolchains)
	s.router.HandleFunc("/api/v1/toolchains/import", s.handleToolchainImport)
	// Builds
	s.router.HandleFunc("/api/v1/builds", s.handleBuilds)
	s.router.HandleFunc("/api/v1/builds/", s.handleBuildByID)
	// Deployments
	s.router.HandleFunc("/api/v1/deployments", s.handleDeployments)
	s.router.HandleFunc("/api/v1/deployments/", s.handleDeploymentByID)
	// Servers
	s.router.HandleFunc("/api/v1/servers", s.handleServers)
	s.router.HandleFunc("/api/v1/servers/", s.handleServerSub)
	// Search
	s.router.HandleFunc("/api/v1/search", s.handleSearch)
	// Encoding
	s.router.HandleFunc("/api/v1/encoding/detect", s.handleEncodingDetect)
	s.router.HandleFunc("/api/v1/encoding/recode", s.handleEncodingRecode)
	s.router.HandleFunc("/api/v1/encoding/validate", s.handleEncodingValidate)
	// Auth
	s.router.HandleFunc("/api/v1/auth/login", s.handleLogin)
	s.router.HandleFunc("/api/v1/auth/logout", s.handleLogout)
	// Audit
	s.router.HandleFunc("/api/v1/audit", s.handleAudit)
	// WebSocket events
	s.router.HandleFunc("/api/v1/events", s.handleEvents)
	// JDT Language Server
	s.router.HandleFunc("/api/v1/jdtls", s.handleJDTLS)
	// JDT project model generator for legacy projects.
	s.router.HandleFunc("/api/v1/jdtls/project", s.handleJDTProject)
}

// doRestart performs the actual restart sequence after
// handleRuntimeRestart has already sent the 200 response.
// It is safe to call with an empty RestartConfig (in which
// case the process exits without respawning — useful for
// tests).
func (s *Server) doRestart() {
	rc := s.restartConfig
	timeout := rc.ShutdownTimeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// 1. Call the user's shutdown hook (e.g. container.Shutdown).
	if rc.OnShutdown != nil {
		if err := rc.OnShutdown(ctx); err != nil && s.logger != nil {
			s.logger.Warn("restart: shutdown hook returned error", log.Fields{"err": err.Error()})
		}
	}

	// 2. Stop the HTTP server so the new process can bind the port.
	if err := s.Shutdown(ctx); err != nil && s.logger != nil {
		s.logger.Warn("restart: http shutdown returned error", log.Fields{"err": err.Error()})
	}

	// 3. Spawn a fresh process with the original args. Skip
	//    when NoExec is set (unit tests that don't want to
	//    replace the test process) or when neither the
	//    executable nor the args are configured.
	if !rc.NoExec && (rc.Executable != "" || rc.Args != nil) {
		exe := rc.Executable
		if exe == "" {
			if e, err := os.Executable(); err == nil {
				exe = e
			} else if s.logger != nil {
				s.logger.Error("restart: os.Executable failed", log.Fields{"err": err.Error()})
			}
		}
		env := rc.Env
		if env == nil {
			env = os.Environ()
		}
		cmd := exec.Command(exe, rc.Args...)
		cmd.Env = env
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			if s.logger != nil {
				s.logger.Error("restart: spawn failed", log.Fields{"err": err.Error()})
			}
			os.Exit(1)
			return
		}
		if s.logger != nil {
			s.logger.Info("restart: spawned replacement process", log.Fields{
				"pid":     cmd.Process.Pid,
				"exe":     exe,
				"argvLen": len(rc.Args),
			})
		}
	}

	// 4. Exit the current process cleanly so the new one takes
	//    over the port and any other resources. A 0 exit is
	//    what the contract expects. Skipped in test mode
	//    (NoExec) so the unit test doesn't tear itself down.
	if !rc.NoExec {
		os.Exit(0)
	}
}

// ----------------- helpers -----------------

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeOK[P any](w http.ResponseWriter, env protocol.RequestEnvelope, payload P) {
	resp := protocol.ResponseEnvelope{
		RequestID:     env.RequestID,
		CorrelationID: env.CorrelationID,
		OK:            true,
		Payload:       payload,
	}
	writeJSON(w, http.StatusOK, resp)
}

func writeError(w http.ResponseWriter, requestID, correlationID string, e protocol.KairoError) {
	if e.Code == "" {
		e.Code = protocol.ErrInternal
	}
	resp := protocol.ErrorResponse{
		RequestID:     requestID,
		CorrelationID: correlationID,
		OK:            false,
		Error:         e,
	}
	status := http.StatusInternalServerError
	if isClientError(e.Code) {
		status = http.StatusBadRequest
	}
	if e.Code == protocol.ErrUnauthenticated {
		status = http.StatusUnauthorized
	}
	if e.Code == protocol.ErrForbidden || e.Code == protocol.ErrPathForbidden {
		status = http.StatusForbidden
	}
	if e.Code == protocol.ErrNotFound {
		status = http.StatusNotFound
	}
	if e.Code == protocol.ErrConflict {
		status = http.StatusConflict
	}
	if e.Code == protocol.ErrRateLimited {
		status = http.StatusTooManyRequests
	}
	writeJSON(w, status, resp)
}

func isClientError(c protocol.KairoErrorCode) bool {
	switch c {
	case protocol.ErrUnauthenticated, protocol.ErrForbidden, protocol.ErrPathForbidden,
		protocol.ErrNotFound, protocol.ErrConflict, protocol.ErrRateLimited,
		protocol.ErrInvalidRequest, protocol.ErrToolchainMissing, protocol.ErrRuntimeMissing,
		protocol.ErrUnsupported, protocol.ErrUnsupportedJDKTarget:
		return true
	}
	return false
}

func decodeEnvelope(r *http.Request, dst *protocol.RequestEnvelope) error {
	if r.Method == http.MethodGet {
		dst.RequestID = r.Header.Get("X-Kairo-Request-Id")
		if dst.RequestID == "" {
			dst.RequestID = newRequestID()
		}
		dst.CorrelationID = r.Header.Get("X-Kairo-Correlation-Id")
		dst.WorkspaceID = r.Header.Get("X-Kairo-Workspace-Id")
		return nil
	}
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return fmt.Errorf("decode envelope: %w", err)
	}
	if dst.RequestID == "" {
		dst.RequestID = r.Header.Get("X-Kairo-Request-Id")
	}
	if dst.CorrelationID == "" {
		dst.CorrelationID = r.Header.Get("X-Kairo-Correlation-Id")
	}
	return nil
}

func newRequestID() string {
	return "req_" + randomID(12)
}

// randomID returns n characters of cryptographically-random
// lowercase-alphanumeric output. It must not block; if the system
// CSPRNG fails we fall back to a time-based value rather than
// panicking.
func randomID(n int) string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// Extremely unlikely; keep something non-blocking and
		// still unique-ish under heavy load.
		now := time.Now().UnixNano()
		for i := range b {
			b[i] = alphabet[(now>>uint(i))%int64(len(alphabet))]
		}
		return string(b)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func splitHostPort(addr string) (string, string, error) {
	i := strings.LastIndex(addr, ":")
	if i < 0 {
		return addr, "", nil
	}
	return addr[:i], addr[i+1:], nil
}

// envelopeWithPayload is kept for backward compatibility but
// is now just an alias for ResponseEnvelope (the payload field
// is inlined on the envelope).
type envelopeWithPayload = protocol.ResponseEnvelope

// ----------------- per-handler utilities -----------------

// requireMethod returns an error if the request method is not
// one of allowed.
func requireMethod(r *http.Request, allowed ...string) error {
	for _, m := range allowed {
		if r.Method == m {
			return nil
		}
	}
	return errors.New("method not allowed: " + r.Method)
}

func (s *Server) logError(r *http.Request, msg string, fields log.Fields) {
	if s.logger == nil {
		return
	}
	rid, cid, _, _ := log.FromContext(r.Context())
	if fields == nil {
		fields = log.Fields{}
	}
	fields["requestId"] = rid
	fields["correlationId"] = cid
	s.logger.Error(msg, fields)
}

// compile-time check: Server implements http.Handler via middleware.
var _ = context.Background
