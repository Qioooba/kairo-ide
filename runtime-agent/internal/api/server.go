// Package api is the HTTP layer of the Runtime Agent.
//
// Endpoints live under /api/v1. Every endpoint takes a
// RequestEnvelope and returns a ResponseEnvelope or an
// ErrorResponse. The wire shapes are owned by internal/api/protocol.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/log"
)

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

	// injected services
	Services *Services
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
}

// NewServer creates a Server.
func NewServer(services *Services, l *log.Logger, a *audit.Log, version string) *Server {
	s := &Server{
		logger:   l,
		audit:    a,
		router:   http.NewServeMux(),
		started:  time.Now(),
		version:  version,
		Services: services,
	}
	s.routes()
	return s
}

// Handler returns the underlying http.Handler. Useful in tests.
func (s *Server) Handler() http.Handler { return s.router }

// ListenAndServe starts the HTTP server. addr is "host:port".
func (s *Server) ListenAndServe(addr string, tlsCert, tlsKey string) error {
	s.mu.Lock()
	host, port, _ := splitHostPort(addr)
	s.bindAddr = host
	if n, err := strconv.Atoi(port); err == nil {
		s.port = n
	}
	s.mu.Unlock()

	srv := &http.Server{
		Addr:    addr,
		Handler: s.middleware(s.router),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	s.logger.Info("http listen", log.Fields{"addr": addr, "tls": tlsCert != ""})
	if tlsCert != "" {
		return srv.ListenAndServeTLS(tlsCert, tlsKey)
	}
	return srv.ListenAndServe()
}

// middleware applies request ID, logging, audit, CORS, and
// recovery in that order.
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Kairo-Request-Id")
		if rid == "" {
			rid = newRequestID()
		}
		cid := r.Header.Get("X-Kairo-Correlation-Id")
		w.Header().Set("X-Kairo-Request-Id", rid)

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
	// Workspaces
	s.router.HandleFunc("/api/v1/workspaces", s.handleWorkspaces)
	s.router.HandleFunc("/api/v1/workspaces/", s.handleWorkspacesSub)
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
	// Auth
	s.router.HandleFunc("/api/v1/auth/login", s.handleLogin)
	s.router.HandleFunc("/api/v1/auth/logout", s.handleLogout)
	// Audit
	s.router.HandleFunc("/api/v1/audit", s.handleAudit)
	// WebSocket events
	s.router.HandleFunc("/api/v1/events", s.handleEvents)
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

func randomID(n int) string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, n)
	for i := range b {
		b[i] = alphabet[time.Now().UnixNano()%int64(len(alphabet))]
		time.Sleep(time.Microsecond)
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
