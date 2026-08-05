// Package api is the HTTP layer of the Runtime Agent.
//
// Endpoints live under /api/v1. Every endpoint takes a
// RequestEnvelope and returns a ResponseEnvelope or an
// ErrorResponse. The wire shapes are owned by internal/api/protocol.
package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/jdkmanager"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
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
	secret      string
	requireAuth bool // when true, reject requests even if secret is unset

	// rateLimiter enforces per-IP request rate limiting.
	rateLimiter *RateLimiter

	// httpServer is the live *http.Server. It is created
	// lazily by ListenAndServe so Shutdown can be called by
	// the runtime-restart handler.
	httpServer *http.Server

	// restartConfig, if set, lets /api/v1/runtime/restart
	// spawn a fresh process. See SetRestartConfig.
	restartConfig RestartConfig

	// recentProjects tracks recently opened projects for the
	// welcome page. In-memory only; survives agent restarts
	// via the project catalog.
	recentProjects []recentProjectEntry

	// idempotencyCache dedupes POST build/deploy/start by
	// client requestId (BD-P1-2). Entries expire after a short TTL.
	idempotencyMu    sync.Mutex
	idempotencyCache map[string]idempotencyEntry

	// injected services
	Services *Services
}

type idempotencyEntry struct {
	status  int
	body    []byte
	expires time.Time
}

const idempotencyTTL = 5 * time.Minute
const idempotencyMaxEntries = 256

func (s *Server) lookupIdempotent(requestID string) (status int, body []byte, ok bool) {
	if requestID == "" {
		return 0, nil, false
	}
	s.idempotencyMu.Lock()
	defer s.idempotencyMu.Unlock()
	if s.idempotencyCache == nil {
		return 0, nil, false
	}
	ent, found := s.idempotencyCache[requestID]
	if !found {
		return 0, nil, false
	}
	if time.Now().After(ent.expires) {
		delete(s.idempotencyCache, requestID)
		return 0, nil, false
	}
	return ent.status, ent.body, true
}

func (s *Server) storeIdempotent(requestID string, status int, body []byte) {
	if requestID == "" {
		return
	}
	s.idempotencyMu.Lock()
	defer s.idempotencyMu.Unlock()
	if s.idempotencyCache == nil {
		s.idempotencyCache = make(map[string]idempotencyEntry)
	}
	now := time.Now()
	if len(s.idempotencyCache) >= idempotencyMaxEntries {
		for k, v := range s.idempotencyCache {
			if now.After(v.expires) {
				delete(s.idempotencyCache, k)
			}
		}
		for len(s.idempotencyCache) >= idempotencyMaxEntries {
			for k := range s.idempotencyCache {
				delete(s.idempotencyCache, k)
				break
			}
		}
	}
	copied := make([]byte, len(body))
	copy(copied, body)
	s.idempotencyCache[requestID] = idempotencyEntry{
		status:  status,
		body:    copied,
		expires: now.Add(idempotencyTTL),
	}
}

func writeIdempotentOK[P any](s *Server, w http.ResponseWriter, env protocol.RequestEnvelope, payload P) {
	resp := protocol.ResponseEnvelope{
		RequestID:     env.RequestID,
		CorrelationID: env.CorrelationID,
		OK:            true,
		Payload:       payload,
	}
	body, err := json.Marshal(resp)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: err.Error()})
		return
	}
	s.storeIdempotent(env.RequestID, http.StatusOK, body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func replayIdempotent(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Kairo-Idempotent-Replay", "1")
	w.WriteHeader(status)
	_, _ = w.Write(body)
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
	// RunConfigurationStore reads/writes .legacyflow/run-configurations.json.
	RunConfigurationStore RunConfigurationStore
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
	// DataDir is the agent's data directory for runtime artifacts
	// (deployment targets, server instances, etc.).
	DataDir string
	// Orchestrator executes before-launch tasks and starts the server.
	Orchestrator LaunchOrchestrator
	// CustomBuild executes custom build commands.
	CustomBuild *build.CustomBuildExecutor
	// JDKManager detects and reports the host JDK status for the
	// Java Debug Adapter (JDI Bridge). Optional: when nil,
	// /api/v1/debug/adapter/status returns a 500.
	JDKManager *jdkmanager.Manager
	// Sandbox authorizes filesystem paths against workspace roots.
	// Used by streaming search and other path-sensitive handlers.
	Sandbox *security.WorkspaceRoots
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
		rateLimiter: NewRateLimiter(0), // default 100 req/min
	}
	s.routes()
	return s
}

// SetRequireAuth enables mandatory authentication even when no
// secret is configured. When true and secret is empty, protected
// routes require a valid session token (Authorization: Bearer or
// X-Kairo-Session). Safe to call before ListenAndServe.
func (s *Server) SetRequireAuth(require bool) {
	s.requireAuth = require
}

// SetRateLimit configures the per-IP rate limit. A value <= 0
// disables rate limiting. Safe to call before ListenAndServe.
func (s *Server) SetRateLimit(perMinute int) {
	if perMinute <= 0 {
		if s.rateLimiter != nil {
			s.rateLimiter.Stop()
		}
		s.rateLimiter = nil
	} else {
		if s.rateLimiter != nil {
			s.rateLimiter.Stop()
		}
		s.rateLimiter = NewRateLimiter(perMinute)
	}
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

// BoundPort returns the TCP port the server is listening on.
// After Listen (or ListenAndServe with ":0"), this is the OS-assigned port.
func (s *Server) BoundPort() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.port
}

// Listen binds addr (host:port; port 0 = ephemeral) without serving.
// Callers that need the real port before Serve (agent-state.json) use this.
func (s *Server) Listen(addr string) (net.Listener, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	host, _, _ := splitHostPort(addr)
	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		_ = ln.Close()
		return nil, fmt.Errorf("unexpected listener address type %T", ln.Addr())
	}
	s.mu.Lock()
	s.bindAddr = host
	if s.bindAddr == "" {
		s.bindAddr = tcpAddr.IP.String()
	}
	s.port = tcpAddr.Port
	s.httpServer = &http.Server{
		Addr:              ln.Addr().String(),
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	s.mu.Unlock()
	s.logger.Info("http listen", log.Fields{"addr": ln.Addr().String()})
	return ln, nil
}

// Serve serves HTTP (or HTTPS) on an already-bound listener from Listen.
func (s *Server) Serve(ln net.Listener, tlsCert, tlsKey string) error {
	s.mu.Lock()
	srv := s.httpServer
	s.mu.Unlock()
	if srv == nil {
		return errors.New("Serve called before Listen")
	}
	if tlsCert != "" {
		s.logger.Info("http serve tls", log.Fields{"addr": ln.Addr().String()})
		return srv.ServeTLS(ln, tlsCert, tlsKey)
	}
	return srv.Serve(ln)
}

// ListenAndServe binds and serves. addr may use port 0 for an ephemeral port
// (DK-P1-2); BoundPort() then reports the OS-assigned port.
func (s *Server) ListenAndServe(addr string, tlsCert, tlsKey string) error {
	ln, err := s.Listen(addr)
	if err != nil {
		return err
	}
	return s.Serve(ln, tlsCert, tlsKey)
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

// middleware applies request ID, logging, audit, CORS, rate
// limiting, secret auth check, and recovery in that order.
func (s *Server) middleware(next http.Handler) http.Handler {
	// Inner handler: request ID, secret auth, logging, recovery.
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Kairo-Request-Id")
		if rid == "" {
			rid = newRequestID()
		}
		cid := r.Header.Get("X-Kairo-Correlation-Id")
		w.Header().Set("X-Kairo-Request-Id", rid)

		// Auth check: when a secret is configured, require
		// X-Kairo-Secret. When RequireAuth is set without a secret,
		// require a valid login session token instead. Health and
		// endpoints are exempt so the desktop host can poll during
		// boot. /api/v1/events and /api/v1/search/stream do their
		// own WebSocket subprotocol auth. OPTIONS (CORS preflight)
		// is exempt by design. Login remains reachable so clients
		// can obtain a session when RequireAuth is on.
		if (s.secret != "" || s.requireAuth) && r.Method != http.MethodOptions {
			switch r.URL.Path {
			case "/api/v1/health", "/api/v1/endpoints":
				// Public, by contract.
			case "/api/v1/events", "/api/v1/search/stream":
				// WebSocket auth is handled inside handleEvents / handleSearchStream.
			case "/api/v1/auth/login":
				// Must remain reachable to mint sessions under RequireAuth.
			default:
				if !s.authorizedRequest(r) {
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

	// Rate limiting after CORS but before auth so preflight
	// requests are not counted against the limit.
	var handler http.Handler = inner
	if s.rateLimiter != nil {
		handler = s.rateLimiter.RateLimitMiddleware(handler)
	}

	// CORS outermost so OPTIONS preflight gets proper CORS headers
	// before any auth or rate-limiting logic runs.
	return s.corsMiddleware(handler)
}

// authorizedRequest reports whether r carries valid credentials:
// matching X-Kairo-Secret when configured, otherwise a valid login
// session when RequireAuth is set (or when Auth is available and a
// session token is presented alongside an empty secret).
func (s *Server) authorizedRequest(r *http.Request) bool {
	if s.secret != "" {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Kairo-Secret")), []byte(s.secret)) == 1 {
			return true
		}
		// Secret configured: header must match. Session alone is not enough.
		return false
	}
	if !s.requireAuth {
		return true
	}
	token := sessionTokenFromRequest(r)
	if token == "" || s.Services == nil || s.Services.Auth == nil {
		return false
	}
	return s.Services.Auth.ValidateSession(token) == nil
}

func sessionTokenFromRequest(r *http.Request) string {
	if t := strings.TrimSpace(r.Header.Get("X-Kairo-Session")); t != "" {
		return t
	}
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, prefix) {
		return strings.TrimSpace(auth[len(prefix):])
	}
	return ""
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	allowedHeaders := "Content-Type, X-Kairo-Secret, X-Kairo-Session, Authorization, X-Kairo-Request-Id, X-Kairo-Workspace-Id, X-Kairo-CSRF"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if isSafeOrigin(origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			w.Header().Set("Access-Control-Allow-Headers", allowedHeaders)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isSafeOrigin delegates to security.IsSafeOrigin (exact hostname match).
func isSafeOrigin(origin string) bool {
	return security.IsSafeOrigin(origin)
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
	// Versioned Tomcat Run/Debug configuration persistence.
	s.router.HandleFunc("/api/v1/workspaces/{ws}/run-configurations", s.handleRunConfigurations)
	s.router.HandleFunc("/api/v1/workspaces/{ws}/run-configurations/{configuration}", s.handleRunConfigurationByID)
	s.router.HandleFunc("/api/v1/workspaces/{ws}/run-configurations/{configuration}/launch", s.handleRunConfigurationLaunch)
	// Projects
	s.router.HandleFunc("/api/v1/projects", s.handleProjects)
	s.router.HandleFunc("/api/v1/projects/", s.handleProjectByID)
	s.router.HandleFunc("/api/v1/projects/detect", s.handleProjectDetect)
	s.router.HandleFunc("/api/v1/projects/import", s.handleProjectImportNew)
	s.router.HandleFunc("/api/v1/projects/recent", s.handleProjectRecent)
	// Toolchains
	s.router.HandleFunc("/api/v1/toolchains", s.handleToolchains)
	s.router.HandleFunc("/api/v1/toolchains/import", s.handleToolchainImport)
	// Builds
	s.router.HandleFunc("/api/v1/builds", s.handleBuilds)
	s.router.HandleFunc("/api/v1/builds/", s.handleBuildByID)
	// Custom build
	s.router.HandleFunc("/api/v1/build/custom", s.handleCustomBuild)
	s.router.HandleFunc("/api/v1/build/custom/", s.handleCustomBuildSub)
	// Ant classpath
	s.router.HandleFunc("/api/v1/ant/classpath/analyze", s.handleAntClasspathAnalyze)
	// Deployments
	s.router.HandleFunc("/api/v1/deployments", s.handleDeployments)
	s.router.HandleFunc("/api/v1/deployments/", s.handleDeploymentByID)
	// Servers
	s.router.HandleFunc("/api/v1/servers", s.handleServers)
	s.router.HandleFunc("/api/v1/servers/", s.handleServerSub)
	// Search
	s.router.HandleFunc("/api/v1/search", s.handleSearch)
	s.router.HandleFunc("/api/v1/search/files", s.handleSearchFiles)
	s.router.HandleFunc("/api/v1/search/stream", s.handleSearchStream)
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
	s.router.HandleFunc("/api/v1/jdtls/distribution", s.handleJDTLSDistribution)
	// JDT project model generator for legacy projects.
	s.router.HandleFunc("/api/v1/jdtls/project", s.handleJDTProject)
	// Port diagnostics
	s.router.HandleFunc("/api/v1/diagnostics/port", s.handlePortDiagnostics)
	// Recovery - list recoverable servers
	s.router.HandleFunc("/api/v1/servers/recoverable", s.handleRecoverableServers)
	// Maven endpoints
	s.router.HandleFunc("/api/v1/maven/detect", s.handleMavenDetect)
	s.router.HandleFunc("/api/v1/maven/dependencies", s.handleMavenDependencies)
	s.router.HandleFunc("/api/v1/maven/run", s.handleMavenRun)
	// SQL — EXPERIMENTAL: Oracle 11g database operations
	s.router.HandleFunc("/api/v1/sql/execute", s.handleSQLExecute)
	s.router.HandleFunc("/api/v1/sql/test-connection", s.handleSQLTestConnection)
	// Debug adapter status
	s.router.HandleFunc("/api/v1/debug/adapter/status", s.handleDebugAdapterStatus)
	// JDK download
	s.router.HandleFunc("/api/v1/debug/jdk/download", s.handleJDKDownload)
	// Java run/detect main/test methods (IDEA-style one-click run)
	s.router.HandleFunc("/api/v1/java/run", s.handleRunJava)
	s.router.HandleFunc("/api/v1/java/detect", s.handleDetectJava)
	// Incremental compilation + HotSwap compile/redefine
	s.router.HandleFunc("/api/v1/jvm/compile-incremental", s.handleCompileIncremental)
	s.router.HandleFunc("/api/v1/jvm/compile", s.handleJvmCompile)
	s.router.HandleFunc("/api/v1/jvm/redefine", s.handleJvmRedefine)
	// Server context reload
	s.router.HandleFunc("/api/v1/servers/{serverId}/reload", s.handleServerReload)
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

	// 1. Spawn the fresh process FIRST (P0-13): if we instead
	//    shutdown the HTTP server first, ListenAndServe returns
	//    immediately, main() exits, and the goroutine running
	//    this function is killed before it can spawn the
	//    replacement. Spawn-then-shutdown guarantees the child
	//    is alive by the time we let the parent die.
	if !rc.NoExec && (rc.Executable != "" || rc.Args != nil) {
		exe := rc.Executable
		if exe == "" {
			if e, err := os.Executable(); err == nil {
				exe = e
			} else if s.logger != nil {
				s.logger.Error("restart: os.Executable failed", log.Fields{"err": err.Error()})
			}
		}
		fmt.Fprintf(os.Stderr, "[restart] spawning exe=%s argvLen=%d\n", exe, len(rc.Args))
		env := rc.Env
		if env == nil {
			env = os.Environ()
		}
		cmd := exec.Command(exe, rc.Args...)
		cmd.Env = env
		// P0-13: on Windows, attaching the new agent to the
		// current process's console / stdio means it dies the
		// moment we call os.Exit(0) below. Detach stdio so
		// the child survives past the parent's lifetime.
		cmd.Stdin = nil
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Start(); err != nil {
			fmt.Fprintf(os.Stderr, "[restart] spawn FAILED: %v\n", err)
			os.Exit(1)
			return
		}
		fmt.Fprintf(os.Stderr, "[restart] spawn OK pid=%d\n", cmd.Process.Pid)
		// Release so the child is not a zombie if the
		// reaper does not pick it up. cmd.Wait() would block;
		// Release() returns immediately.
		_ = cmd.Process.Release()
	}

	// 2. Call the user's shutdown hook (e.g. container.Shutdown).
	if rc.OnShutdown != nil {
		if err := rc.OnShutdown(ctx); err != nil && s.logger != nil {
			s.logger.Warn("restart: shutdown hook returned error", log.Fields{"err": err.Error()})
		}
	}

	// 3. Stop the HTTP server so the new process can bind the port.
	if err := s.Shutdown(ctx); err != nil && s.logger != nil {
		s.logger.Warn("restart: http shutdown returned error", log.Fields{"err": err.Error()})
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
	if e.Code == protocol.ErrUnsupported {
		status = http.StatusNotImplemented
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
