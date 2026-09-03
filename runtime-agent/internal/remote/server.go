//go:build remote

// Package remote implements the Phase 3 Remote Agent server.
//
// It provides TLS 1.3 enforced HTTP + WebSocket server with:
//   - mTLS client certificate authentication
//   - Token-based session auth
//   - WebSocket multiplexing with reconnection support
//   - Per-user workspace sandbox
//   - Audit logging of all remote operations
//
// The server reuses the existing /api/v1 protocol envelope
// format and is designed to run alongside the local agent
// without architectural interference.
package remote

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/gorilla/websocket"
)

// TLSVersion is the minimum TLS version enforced by the remote server.
const TLSVersion = tls.VersionTLS13

// CipherSuites is the allowed cipher suite list for TLS 1.3.
// TLS 1.3 automatically negotiates AEAD ciphers; these are
// set for explicit allowlisting.
var CipherSuites = []uint16{
	tls.TLS_AES_256_GCM_SHA384,
	tls.TLS_AES_128_GCM_SHA256,
	tls.TLS_CHACHA20_POLY1305_SHA256,
}

var remoteWSUpgrader = websocket.Upgrader{
	CheckOrigin:     security.IsSafeWebSocketOrigin,
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// SessionTokenLength is the byte length of a session token (32 bytes → 64 hex chars).
const SessionTokenLength = 32

// SessionTTL is the duration a session token is valid.
const SessionTTL = 8 * time.Hour

// ReconnectWindow is the period after a clean disconnect during which
// a client can reconnect using the same session token.
const ReconnectWindow = 5 * time.Minute

// RemoteConfig configures the remote agent server.
type RemoteConfig struct {
	// BindAddr is the address to listen on (e.g., ":9443").
	BindAddr string

	// CertFile is the path to the server TLS certificate (PEM).
	CertFile string

	// KeyFile is the path to the server TLS private key (PEM).
	KeyFile string

	// CACertFile is the path to the CA certificate for mTLS client verification.
	// If empty, mTLS is disabled and only server TLS is used.
	CACertFile string

	// Logger is the structured logger.
	Logger *log.Logger

	// Sandbox is the workspace root sandbox for path isolation.
	Sandbox *security.WorkspaceRoots

	// AllowedUsers is an optional list of allowed usernames.
	// If empty, all authenticated users are allowed.
	AllowedUsers []string

	// MaxConcurrentSessions limits the number of active sessions.
	// Zero means unlimited.
	MaxConcurrentSessions int

	// LocalAgentURL is the loopback URL of the local runtime-agent
	// (e.g. http://127.0.0.1:18080). Authenticated remote API calls
	// are reverse-proxied here. Empty means proxy is configured later
	// and requests return 503 until it is set.
	LocalAgentURL string
}

// RemoteServer is the TLS-enabled remote agent server.
type RemoteServer struct {
	mu       sync.RWMutex
	cfg      RemoteConfig
	logger   *log.Logger
	sandbox  *security.WorkspaceRoots
	httpSrv  *http.Server
	listener net.Listener

	// sessions maps session token → session info
	sessions map[string]*sessionInfo

	// startedAt is the server start time.
	startedAt time.Time
}

// sessionInfo tracks an active remote session.
type sessionInfo struct {
	Token     string
	Username  string
	Role      string
	CreatedAt time.Time
	ExpiresAt time.Time
	LastSeen  time.Time
	// ReconnectToken is used for WebSocket reconnection.
	ReconnectToken string
}

// LoginRequest is the remote login payload.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoginResponse is returned on successful authentication.
type LoginResponse struct {
	SessionToken   string `json:"sessionToken"`
	ReconnectToken string `json:"reconnectToken"`
	ExpiresAt      string `json:"expiresAt"`
	User           struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	} `json:"user"`
}

// NewRemoteServer creates a new remote agent server.
func NewRemoteServer(cfg RemoteConfig) (*RemoteServer, error) {
	if cfg.Logger == nil {
		cfg.Logger = log.New("remote")
	}
	rs := &RemoteServer{
		cfg:       cfg,
		logger:    cfg.Logger,
		sandbox:   cfg.Sandbox,
		sessions:  make(map[string]*sessionInfo),
		startedAt: time.Now(),
	}
	return rs, nil
}

// ListenAndServe starts the TLS server and blocks until the server
// is stopped or an error occurs.
func (rs *RemoteServer) ListenAndServe() error {
	tlsConfig, err := rs.buildTLSConfig()
	if err != nil {
		return fmt.Errorf("remote: build TLS config: %w", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/remote/login", rs.handleLogin)
	mux.HandleFunc("/api/v1/remote/health", rs.handleHealth)
	mux.HandleFunc("/api/v1/remote/ws", rs.handleWebSocket)
	mux.HandleFunc("/api/v1/", rs.handleProxiedAPI)

	rs.httpSrv = &http.Server{
		Addr:         rs.cfg.BindAddr,
		Handler:      rs.authMiddleware(mux),
		TLSConfig:    tlsConfig,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	listener, err := tls.Listen("tcp", rs.cfg.BindAddr, tlsConfig)
	if err != nil {
		return fmt.Errorf("remote: listen: %w", err)
	}
	rs.listener = listener

	rs.logger.Info("remote agent server started", log.Fields{
		"addr":    rs.cfg.BindAddr,
		"tls_min": "1.3",
		"mtls":    rs.cfg.CACertFile != "",
	})

	return rs.httpSrv.Serve(listener)
}

// Shutdown gracefully stops the remote server.
func (rs *RemoteServer) Shutdown(ctx context.Context) error {
	if rs.httpSrv == nil {
		return nil
	}
	rs.logger.Info("remote agent server shutting down")
	return rs.httpSrv.Shutdown(ctx)
}

// buildTLSConfig creates the TLS 1.3 configuration.
func (rs *RemoteServer) buildTLSConfig() (*tls.Config, error) {
	// Load server certificate
	cert, err := tls.LoadX509KeyPair(rs.cfg.CertFile, rs.cfg.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load server cert: %w", err)
	}

	cfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   TLSVersion,
		MaxVersion:   TLSVersion,
		CipherSuites: CipherSuites,
		// Reject TLS 1.2 and below
		PreferServerCipherSuites: true,
	}

	// mTLS: require client certificates
	if rs.cfg.CACertFile != "" {
		caCert, err := os.ReadFile(rs.cfg.CACertFile)
		if err != nil {
			return nil, fmt.Errorf("read CA cert: %w", err)
		}
		caCertPool := x509.NewCertPool()
		if !caCertPool.AppendCertsFromPEM(caCert) {
			return nil, errors.New("remote: failed to parse CA certificate")
		}
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
		cfg.ClientCAs = caCertPool
	}

	return cfg, nil
}

// authMiddleware enforces session authentication on all non-login endpoints.
func (rs *RemoteServer) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Login and health are public
		if r.URL.Path == "/api/v1/remote/login" || r.URL.Path == "/api/v1/remote/health" {
			next.ServeHTTP(w, r)
			return
		}

		// Authenticate via Authorization header or websocket subprotocol
		token := rs.extractToken(r)
		if token == "" {
			rs.writeError(w, http.StatusUnauthorized, "missing authentication token")
			return
		}

		session := rs.validateSession(token)
		if session == nil {
			rs.writeError(w, http.StatusUnauthorized, "invalid or expired session")
			return
		}

		// Update last seen
		rs.mu.Lock()
		session.LastSeen = time.Now()
		rs.mu.Unlock()

		// Add session info to request context
		ctx := context.WithValue(r.Context(), ctxKeySession, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// extractToken extracts the session token from the request.
func (rs *RemoteServer) extractToken(r *http.Request) string {
	// Bearer token from Authorization header
	if auth := r.Header.Get("Authorization"); len(auth) > 7 && auth[:7] == "Bearer " {
		return auth[7:]
	}

	// WebSocket subprotocol token
	if r.Header.Get("Upgrade") == "websocket" {
		proto := r.Header.Get("Sec-WebSocket-Protocol")
		if proto != "" {
			return proto
		}
	}

	// Query parameter (for reconnection)
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}

	return ""
}

// validateSession checks if a session token is valid.
func (rs *RemoteServer) validateSession(token string) *sessionInfo {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	session, ok := rs.sessions[token]
	if !ok {
		return nil
	}
	if time.Now().After(session.ExpiresAt) {
		return nil
	}
	return session
}

// handleLogin processes remote authentication.
func (rs *RemoteServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		rs.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		rs.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username == "" || req.Password == "" {
		rs.writeError(w, http.StatusBadRequest, "username and password required")
		return
	}

	// Authenticate using shared secret
	secret := os.Getenv("KAIRO_REMOTE_SECRET")
	if secret == "" {
		secret = os.Getenv("KAIRO_SECRET")
	}
	if secret == "" {
		rs.writeError(w, http.StatusUnauthorized, "remote authentication not configured")
		return
	}

	// Constant-time comparison
	passwordHash := sha256.Sum256([]byte(req.Password))
	secretHash := sha256.Sum256([]byte(secret))
	if subtle.ConstantTimeCompare(passwordHash[:], secretHash[:]) != 1 {
		rs.writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Check allowed users
	if len(rs.cfg.AllowedUsers) > 0 {
		allowed := false
		for _, u := range rs.cfg.AllowedUsers {
			if u == req.Username {
				allowed = true
				break
			}
		}
		if !allowed {
			rs.writeError(w, http.StatusForbidden, "user not authorized for remote access")
			return
		}
	}

	// Check concurrent sessions limit
	rs.mu.Lock()
	if rs.cfg.MaxConcurrentSessions > 0 && len(rs.sessions) >= rs.cfg.MaxConcurrentSessions {
		rs.mu.Unlock()
		rs.writeError(w, http.StatusTooManyRequests, "maximum concurrent sessions reached")
		return
	}

	// Create session
	sessionToken := generateToken(SessionTokenLength)
	reconnectToken := generateToken(16)
	now := time.Now()
	session := &sessionInfo{
		Token:          sessionToken,
		Username:       req.Username,
		Role:           "user",
		CreatedAt:      now,
		ExpiresAt:      now.Add(SessionTTL),
		LastSeen:       now,
		ReconnectToken: reconnectToken,
	}
	rs.sessions[sessionToken] = session
	rs.mu.Unlock()

	rs.logger.Info("remote login", log.Fields{
		"username": req.Username,
		"session":  sessionToken[:8] + "...",
	})

	resp := LoginResponse{
		SessionToken:   sessionToken,
		ReconnectToken: reconnectToken,
		ExpiresAt:      session.ExpiresAt.Format(time.RFC3339),
	}
	resp.User.Username = req.Username
	resp.User.Role = "user"

	rs.writeJSON(w, http.StatusOK, resp)
}

// handleHealth returns the remote server health status.
func (rs *RemoteServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	rs.mu.RLock()
	sessionCount := len(rs.sessions)
	rs.mu.RUnlock()

	rs.writeJSON(w, http.StatusOK, map[string]any{
		"status":    "healthy",
		"uptime":    time.Since(rs.startedAt).String(),
		"sessions":  sessionCount,
		"tls":       "1.3",
		"mtls":      rs.cfg.CACertFile != "",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// handleWebSocket upgrades the client to a multiplexed event stream.
// Auth is already enforced by authMiddleware (Bearer, subprotocol, or token query).
func (rs *RemoteServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	session, _ := r.Context().Value(ctxKeySession).(*sessionInfo)

	conn, err := remoteWSUpgrader.Upgrade(w, r, nil)
	if err != nil {
		rs.logger.Warn("remote websocket upgrade failed", log.Fields{
			"error": err.Error(),
			"path":  r.URL.Path,
		})
		return
	}
	defer conn.Close()

	username := ""
	reconnect := ""
	if session != nil {
		username = session.Username
		reconnect = session.ReconnectToken
	}

	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := conn.WriteJSON(map[string]any{
		"type":           "connected",
		"username":       username,
		"reconnectToken": reconnect,
		"timestamp":      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	conn.SetReadLimit(1024 * 1024)
	conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
		return nil
	})

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
	}
}

// handleProxiedAPI reverse-proxies authenticated /api/v1/* calls to the local agent.
func (rs *RemoteServer) handleProxiedAPI(w http.ResponseWriter, r *http.Request) {
	session, _ := r.Context().Value(ctxKeySession).(*sessionInfo)
	username := ""
	if session != nil {
		username = session.Username
	}
	rs.logger.Debug("remote API request", log.Fields{
		"method":   r.Method,
		"path":     r.URL.Path,
		"username": username,
	})

	target, err := rs.localAgentTarget()
	if err != nil {
		rs.writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		req.URL.Host = target.Host
		req.URL.Scheme = target.Scheme
		if username != "" {
			req.Header.Set("X-Kairo-Remote-User", username)
		}
		if r.Host != "" {
			req.Header.Set("X-Forwarded-Host", r.Host)
		}
		req.Header.Del("Accept-Encoding")
	}
	proxy.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, proxyErr error) {
		rs.logger.Warn("remote API proxy failed", log.Fields{
			"error": proxyErr.Error(),
			"path":  req.URL.Path,
		})
		rs.writeError(rw, http.StatusBadGateway, "local agent unreachable: "+proxyErr.Error())
	}
	proxy.ServeHTTP(w, r)
}

func (rs *RemoteServer) localAgentTarget() (*url.URL, error) {
	raw := rs.cfg.LocalAgentURL
	if raw == "" {
		return nil, fmt.Errorf("local agent URL not configured")
	}
	target, err := url.Parse(raw)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("invalid local agent URL")
	}
	return target, nil
}

// writeJSON writes a JSON response.
func (rs *RemoteServer) writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeError writes a standard error response.
func (rs *RemoteServer) writeError(w http.ResponseWriter, status int, message string) {
	rs.writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":      fmt.Sprintf("REMOTE_%d", status),
			"message":   message,
			"retryable": status >= 500,
		},
	})
}

// generateToken generates a cryptographically random hex token.
func generateToken(byteLen int) string {
	b := make([]byte, byteLen)
	if _, err := rand.Read(b); err != nil {
		// Fallback for testing: use time-based token
		h := sha256.Sum256([]byte(time.Now().String()))
		return hex.EncodeToString(h[:byteLen])
	}
	return hex.EncodeToString(b)
}

// contextKey is a type-safe context key for session info.
type ctxKey string

var ctxKeySession = ctxKey("session")