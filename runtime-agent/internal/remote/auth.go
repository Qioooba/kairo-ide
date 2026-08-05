//go:build remote

// Package remote implements security authentication enhancements
// for Phase 3+ remote Linux agent functionality.
//
// Provides:
//   - Mutual TLS (mTLS) configuration
//   - Token-based authentication
//   - Session management
//   - Audit logging for remote operations
package remote

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// AuthConfig configures the authentication system.
type AuthConfig struct {
	// EnableMTLS enables mutual TLS authentication.
	EnableMTLS bool
	// CACertFile is the path to the CA certificate for mTLS.
	CACertFile string
	// CertFile is the path to the server TLS certificate.
	CertFile string
	// KeyFile is the path to the server TLS private key.
	KeyFile string
	// TokenSecret is the shared secret for token-based auth.
	TokenSecret string
	// TokenTTL is the duration a token is valid.
	TokenTTL time.Duration
	// MaxSessions limits the number of concurrent sessions.
	MaxSessions int
	// AuditLog is the path to the audit log file.
	AuditLog string
	// Logger is the structured logger.
	Logger *log.Logger
}

// DefaultAuthConfig returns a default auth configuration.
func DefaultAuthConfig() AuthConfig {
	return AuthConfig{
		TokenTTL:    8 * time.Hour,
		MaxSessions: 100,
	}
}

// Authenticator handles authentication and session management.
type Authenticator struct {
	mu       sync.RWMutex
	cfg      AuthConfig
	logger   *log.Logger
	sessions map[string]*AuthSession
	auditLog *audit.Log
}

// AuthSession represents an authenticated session.
type AuthSession struct {
	Token      string    `json:"token"`
	Username   string    `json:"username"`
	Role       string    `json:"role"`
	RemoteAddr string    `json:"remoteAddr"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	LastSeen   time.Time `json:"lastSeen"`
	UserAgent  string    `json:"userAgent,omitempty"`
}

// NewAuthenticator creates a new authenticator.
func NewAuthenticator(cfg AuthConfig) (*Authenticator, error) {
	if cfg.Logger == nil {
		cfg.Logger = log.New("auth")
	}
	if cfg.TokenTTL <= 0 {
		cfg.TokenTTL = 8 * time.Hour
	}

	a := &Authenticator{
		cfg:      cfg,
		logger:   cfg.Logger,
		sessions: make(map[string]*AuthSession),
	}

	if cfg.AuditLog != "" {
		al, err := audit.New(cfg.AuditLog)
		if err != nil {
			return nil, fmt.Errorf("auth: open audit log: %w", err)
		}
		a.auditLog = al
	}

	return a, nil
}

// Close closes the authenticator and its audit log.
func (a *Authenticator) Close() error {
	if a.auditLog != nil {
		return a.auditLog.Close()
	}
	return nil
}

// BuildTLSConfig creates a TLS 1.3 configuration with optional mTLS.
func (a *Authenticator) BuildTLSConfig() (*tls.Config, error) {
	if a.cfg.CertFile == "" || a.cfg.KeyFile == "" {
		return nil, fmt.Errorf("auth: server certificate and key are required for TLS")
	}

	cert, err := tls.LoadX509KeyPair(a.cfg.CertFile, a.cfg.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("auth: load server cert: %w", err)
	}

	cfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
		MaxVersion:   tls.VersionTLS13,
		CipherSuites: []uint16{
			tls.TLS_AES_256_GCM_SHA384,
			tls.TLS_AES_128_GCM_SHA256,
			tls.TLS_CHACHA20_POLY1305_SHA256,
		},
		PreferServerCipherSuites: true,
	}

	// mTLS: require client certificates
	if a.cfg.EnableMTLS && a.cfg.CACertFile != "" {
		caCert, err := os.ReadFile(a.cfg.CACertFile)
		if err != nil {
			return nil, fmt.Errorf("auth: read CA cert: %w", err)
		}
		caCertPool := x509.NewCertPool()
		if !caCertPool.AppendCertsFromPEM(caCert) {
			return nil, fmt.Errorf("auth: failed to parse CA certificate")
		}
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
		cfg.ClientCAs = caCertPool
	}

	return cfg, nil
}

// AuthenticateToken validates a token and returns the associated session.
func (a *Authenticator) AuthenticateToken(token string) (*AuthSession, error) {
	a.mu.RLock()
	session, ok := a.sessions[token]
	a.mu.RUnlock()

	if !ok {
		a.auditEvent("token_validation", "", "denied", log.Fields{"reason": "unknown_token"})
		return nil, fmt.Errorf("auth: invalid token")
	}

	if time.Now().After(session.ExpiresAt) {
		a.auditEvent("token_validation", session.Username, "denied", log.Fields{"reason": "expired"})
		return nil, fmt.Errorf("auth: token expired")
	}

	// Update last seen
	a.mu.Lock()
	session.LastSeen = time.Now()
	a.mu.Unlock()

	a.auditEvent("token_validation", session.Username, "ok", nil)
	return session, nil
}

// AuthenticatePassword authenticates a user with username and password.
func (a *Authenticator) AuthenticatePassword(username, password, remoteAddr, userAgent string) (*AuthSession, error) {
	if username == "" || password == "" {
		a.auditEvent("login", username, "denied", log.Fields{"reason": "empty_credentials"})
		return nil, fmt.Errorf("auth: username and password are required")
	}

	// Verify password against shared secret
	secret := a.cfg.TokenSecret
	if secret == "" {
		secret = os.Getenv("KAIRO_REMOTE_SECRET")
	}
	if secret == "" {
		secret = os.Getenv("KAIRO_SECRET")
	}
	if secret == "" {
		a.auditEvent("login", username, "denied", log.Fields{"reason": "no_secret_configured"})
		return nil, fmt.Errorf("auth: authentication not configured")
	}

	passwordHash := sha256.Sum256([]byte(password))
	secretHash := sha256.Sum256([]byte(secret))
	if subtle.ConstantTimeCompare(passwordHash[:], secretHash[:]) != 1 {
		a.auditEvent("login", username, "denied", log.Fields{"reason": "invalid_password"})
		return nil, fmt.Errorf("auth: invalid credentials")
	}

	// Check session limit
	a.mu.Lock()
	if a.cfg.MaxSessions > 0 && len(a.sessions) >= a.cfg.MaxSessions {
		a.mu.Unlock()
		a.auditEvent("login", username, "denied", log.Fields{"reason": "max_sessions"})
		return nil, fmt.Errorf("auth: maximum concurrent sessions reached")
	}

	// Create session
	session := &AuthSession{
		Token:      a.generateToken(),
		Username:   username,
		Role:       "user",
		RemoteAddr: remoteAddr,
		CreatedAt:  time.Now(),
		ExpiresAt:  time.Now().Add(a.cfg.TokenTTL),
		LastSeen:   time.Now(),
		UserAgent:  userAgent,
	}
	a.sessions[session.Token] = session
	a.mu.Unlock()

	a.logger.Info("user authenticated", log.Fields{
		"username": username,
		"addr":     remoteAddr,
	})
	a.auditEvent("login", username, "ok", log.Fields{"remote_addr": remoteAddr})

	return session, nil
}

// InvalidateSession removes a session by token.
func (a *Authenticator) InvalidateSession(token string) {
	a.mu.Lock()
	session, ok := a.sessions[token]
	if ok {
		delete(a.sessions, token)
	}
	a.mu.Unlock()

	if ok {
		a.auditEvent("logout", session.Username, "ok", nil)
		a.logger.Info("session invalidated", log.Fields{
			"username": session.Username,
		})
	}
}

// CleanupExpiredSessions removes expired sessions.
func (a *Authenticator) CleanupExpiredSessions() int {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := time.Now()
	removed := 0
	for token, session := range a.sessions {
		if now.After(session.ExpiresAt) {
			delete(a.sessions, token)
			removed++
		}
	}

	if removed > 0 {
		a.logger.Debug("cleaned up expired sessions", log.Fields{"count": removed})
	}

	return removed
}

// SessionCount returns the number of active sessions.
func (a *Authenticator) SessionCount() int {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return len(a.sessions)
}

// GetSession returns the session for a token without updating last seen.
func (a *Authenticator) GetSession(token string) *AuthSession {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.sessions[token]
}

// generateToken generates a cryptographically random token.
func (a *Authenticator) generateToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// Fallback: use time-based hash
		h := sha256.Sum256([]byte(time.Now().String()))
		return hex.EncodeToString(h[:])
	}
	return hex.EncodeToString(b)
}

// auditEvent records an audit event for a remote operation.
func (a *Authenticator) auditEvent(action, username, result string, fields log.Fields) {
	if a.auditLog == nil {
		return
	}

	evt := audit.Event{
		Ts:        time.Now().UTC().Format(time.RFC3339Nano),
		Level:     "info",
		Component: "remote-auth",
		UserID:    username,
		Action:    action,
		Result:    result,
		Fields:    map[string]any(fields),
	}

	if err := a.auditLog.Append(evt); err != nil {
		a.logger.Warn("failed to write audit event", log.Fields{"error": err.Error()})
	}
}

// AuditOperation records an audit event for a remote operation.
func (a *Authenticator) AuditOperation(ctx context.Context, username, action, target, result string, fields map[string]any) {
	if a.auditLog == nil {
		return
	}

	evt := audit.Event{
		Ts:        time.Now().UTC().Format(time.RFC3339Nano),
		Level:     "info",
		Component: "remote-operation",
		UserID:    username,
		Action:    action,
		Target:    target,
		Result:    result,
		Fields:    fields,
	}

	if err := a.auditLog.Append(evt); err != nil {
		a.logger.Warn("failed to write audit event", log.Fields{"error": err.Error()})
	}
}

// StartSessionCleanup starts a background goroutine that periodically
// cleans up expired sessions.
func (a *Authenticator) StartSessionCleanup(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				a.CleanupExpiredSessions()
			}
		}
	}()
}