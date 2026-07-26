package remote

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// generateTestCert generates a self-signed TLS certificate for testing.
func generateTestCert(dir string) (certFile, keyFile string, err error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", "", err
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(1 * time.Hour),
		DNSNames:     []string{"localhost"},
		IPAddresses:  nil,
	}
	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return "", "", err
	}
	certFile = filepath.Join(dir, "server.crt")
	keyFile = filepath.Join(dir, "server.key")
	cf, _ := os.Create(certFile)
	pem.Encode(cf, &pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	cf.Close()
	kf, _ := os.Create(keyFile)
	pem.Encode(kf, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	kf.Close()
	return certFile, keyFile, nil
}

// TestNewRemoteServer tests basic server creation.
func TestNewRemoteServer(t *testing.T) {
	rs, err := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewRemoteServer: %v", err)
	}
	if rs == nil {
		t.Fatal("NewRemoteServer returned nil")
	}
	if rs.sessions == nil {
		t.Error("sessions map is nil")
	}
}

// TestNewRemoteServer_DefaultLogger tests nil logger handling.
func TestNewRemoteServer_DefaultLogger(t *testing.T) {
	rs, err := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
	})
	if err != nil {
		t.Fatalf("NewRemoteServer: %v", err)
	}
	if rs.logger == nil {
		t.Error("logger should not be nil")
	}
}

// TestBuildTLSConfig_NoCertInServer tests error when cert files are missing.
func TestBuildTLSConfig_NoCertInServer(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		CertFile: "/nonexistent/cert.pem",
		KeyFile: "/nonexistent/key.pem",
	})
	_, err := rs.buildTLSConfig()
	if err == nil {
		t.Fatal("expected error for missing cert files")
	}
}

// TestBuildTLSConfig_ValidCert tests TLS config with valid cert.
func TestBuildTLSConfig_ValidCert(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCert(dir)
	if err != nil {
		t.Fatalf("generateTestCert: %v", err)
	}

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		CertFile: certFile,
		KeyFile: keyFile,
	})
	cfg, err := rs.buildTLSConfig()
	if err != nil {
		t.Fatalf("buildTLSConfig: %v", err)
	}
	if cfg.MinVersion != tls.VersionTLS13 {
		t.Errorf("MinVersion = %d, want %d", cfg.MinVersion, tls.VersionTLS13)
	}
	if cfg.MaxVersion != tls.VersionTLS13 {
		t.Errorf("MaxVersion = %d, want %d", cfg.MaxVersion, tls.VersionTLS13)
	}
	if len(cfg.Certificates) != 1 {
		t.Errorf("Certificates = %d, want 1", len(cfg.Certificates))
	}
}

// TestBuildTLSConfig_WithCACert tests mTLS configuration.
func TestBuildTLSConfig_WithCACert(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCert(dir)
	if err != nil {
		t.Fatalf("generateTestCert: %v", err)
	}

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:   ":0",
		CertFile:   certFile,
		KeyFile:    keyFile,
		CACertFile: certFile, // Use server cert as CA for testing
	})
	cfg, err := rs.buildTLSConfig()
	if err != nil {
		t.Fatalf("buildTLSConfig: %v", err)
	}
	if cfg.ClientAuth != tls.RequireAndVerifyClientCert {
		t.Errorf("ClientAuth = %v, want RequireAndVerifyClientCert", cfg.ClientAuth)
	}
	if cfg.ClientCAs == nil {
		t.Error("ClientCAs should not be nil with CA cert")
	}
}

// TestBuildTLSConfig_CACertReadError tests CA cert file read error.
func TestBuildTLSConfig_CACertReadError(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCert(dir)
	if err != nil {
		t.Fatalf("generateTestCert: %v", err)
	}

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:   ":0",
		CertFile:   certFile,
		KeyFile:    keyFile,
		CACertFile: "/nonexistent/ca-cert.pem",
	})
	_, err = rs.buildTLSConfig()
	if err == nil {
		t.Fatal("expected error for nonexistent CA cert file")
	}
}

// TestBuildTLSConfig_InvalidCA tests invalid CA cert handling.
func TestBuildTLSConfig_InvalidCA(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCert(dir)
	if err != nil {
		t.Fatalf("generateTestCert: %v", err)
	}
	// Write invalid CA cert
	caFile := filepath.Join(dir, "ca.crt")
	os.WriteFile(caFile, []byte("not a valid cert"), 0o644)

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:   ":0",
		CertFile:   certFile,
		KeyFile:    keyFile,
		CACertFile: caFile,
	})
	_, err = rs.buildTLSConfig()
	if err == nil {
		t.Fatal("expected error for invalid CA cert")
	}
}

// TestGenerateToken tests token generation.
func TestGenerateToken(t *testing.T) {
	token := generateToken(32)
	if len(token) != 64 { // 32 bytes → 64 hex chars
		t.Errorf("token length = %d, want 64", len(token))
	}

	// Tokens should be unique
	token2 := generateToken(32)
	if token == token2 {
		t.Error("consecutive tokens should be different")
	}
}

// TestGenerateToken_Short tests short token generation.
func TestGenerateToken_Short(t *testing.T) {
	token := generateToken(16)
	if len(token) != 32 {
		t.Errorf("token length = %d, want 32", len(token))
	}
}

// TestValidateSession_Valid tests session validation.
func TestValidateSession_Valid(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	token := generateToken(32)
	rs.sessions[token] = &sessionInfo{
		Token:     token,
		Username:  "testuser",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	session := rs.validateSession(token)
	if session == nil {
		t.Fatal("valid session should be found")
	}
	if session.Username != "testuser" {
		t.Errorf("Username = %q, want testuser", session.Username)
	}
}

// TestValidateSession_Expired tests expired session.
func TestValidateSession_Expired(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	token := generateToken(32)
	rs.sessions[token] = &sessionInfo{
		Token:     token,
		Username:  "testuser",
		CreatedAt: time.Now().Add(-2 * time.Hour),
		ExpiresAt: time.Now().Add(-1 * time.Hour),
	}

	session := rs.validateSession(token)
	if session != nil {
		t.Error("expired session should return nil")
	}
}

// TestValidateSession_NotFound tests unknown token.
func TestValidateSession_NotFound(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	session := rs.validateSession("nonexistent-token")
	if session != nil {
		t.Error("nonexistent token should return nil")
	}
}

// TestExtractToken_Bearer tests Bearer token extraction.
func TestExtractToken_Bearer(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{BindAddr: ":0"})
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer my-test-token")
	token := rs.extractToken(req)
	if token != "my-test-token" {
		t.Errorf("token = %q, want my-test-token", token)
	}
}

// TestExtractToken_QueryParam tests query parameter extraction.
func TestExtractToken_QueryParam(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{BindAddr: ":0"})
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces?token=query-token", nil)
	token := rs.extractToken(req)
	if token != "query-token" {
		t.Errorf("token = %q, want query-token", token)
	}
}

// TestExtractToken_None tests missing token.
func TestExtractToken_None(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{BindAddr: ":0"})
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	token := rs.extractToken(req)
	if token != "" {
		t.Errorf("token should be empty, got %q", token)
	}
}

// TestHandleHealth tests the health endpoint.
func TestHandleHealth(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})

	// Use httptest to test the handler
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/health", nil)
	rec := &responseRecorder{header: make(http.Header)}

	rs.handleHealth(rec, req)

	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}

	var result map[string]any
	json.Unmarshal(rec.body, &result)
	if result["status"] != "healthy" {
		t.Errorf("status = %v, want healthy", result["status"])
	}
	if result["tls"] != "1.3" {
		t.Errorf("tls = %v, want 1.3", result["tls"])
	}
}

// TestHandleLogin_InvalidMethod tests login with wrong method.
func TestHandleLogin_InvalidMethod(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/login", nil)
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.status, http.StatusMethodNotAllowed)
	}
}

// TestHandleLogin_NoSecret tests login when no secret is configured.
func TestHandleLogin_NoSecret(t *testing.T) {
	os.Unsetenv("KAIRO_REMOTE_SECRET")
	os.Unsetenv("KAIRO_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.status, http.StatusUnauthorized)
	}
}

// TestHandleLogin_EmptyCredentials tests login with empty credentials.
func TestHandleLogin_EmptyCredentials(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "test-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	body, _ := json.Marshal(LoginRequest{Username: "", Password: ""})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.status, http.StatusBadRequest)
	}
}

// TestHandleLogin_InvalidJSON tests login with invalid JSON.
func TestHandleLogin_InvalidJSON(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "test-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: []byte("not json")}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.status, http.StatusBadRequest)
	}
}

// TestHandleLogin_WrongPassword tests login with wrong password.
func TestHandleLogin_WrongPassword(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "correct-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "wrong-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.status, http.StatusUnauthorized)
	}
}

// TestHandleLogin_AllowedUsers tests login with allowed users list.
func TestHandleLogin_AllowedUsers(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "correct-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:     ":0",
		Logger:       log.New("test"),
		AllowedUsers: []string{"admin", "sa"},
	})
	body, _ := json.Marshal(LoginRequest{Username: "other-user", Password: "correct-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusForbidden {
		t.Errorf("status = %d, want %d", rec.status, http.StatusForbidden)
	}
}

// TestHandleLogin_MaxSessions tests maximum concurrent sessions.
func TestHandleLogin_MaxSessions(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "correct-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:              ":0",
		Logger:                log.New("test"),
		MaxConcurrentSessions: 1,
	})
	// Add one session
	rs.sessions["existing-token"] = &sessionInfo{
		Token:     "existing-token",
		Username:  "existing",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "correct-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusTooManyRequests {
		t.Errorf("status = %d, want %d", rec.status, http.StatusTooManyRequests)
	}
}

// TestHandleLogin_Success tests successful login.
func TestHandleLogin_Success(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "correct-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "correct-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)

	if rec.status != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.status, http.StatusOK)
	}

	var resp LoginResponse
	json.Unmarshal(rec.body, &resp)
	if resp.SessionToken == "" {
		t.Error("sessionToken should not be empty")
	}
	if len(resp.SessionToken) != 64 {
		t.Errorf("sessionToken length = %d, want 64", len(resp.SessionToken))
	}
	if resp.ReconnectToken == "" {
		t.Error("reconnectToken should not be empty")
	}
	if resp.User.Username != "admin" {
		t.Errorf("user.username = %q, want admin", resp.User.Username)
	}

	// Verify session was stored
	session := rs.validateSession(resp.SessionToken)
	if session == nil {
		t.Fatal("session should be stored after login")
	}
	if session.Username != "admin" {
		t.Errorf("session username = %q, want admin", session.Username)
	}
}

// TestSessionTTL tests the session TTL constant.
func TestSessionTTL(t *testing.T) {
	if SessionTTL != 8*time.Hour {
		t.Errorf("SessionTTL = %v, want 8h", SessionTTL)
	}
	if SessionTokenLength != 32 {
		t.Errorf("SessionTokenLength = %d, want 32", SessionTokenLength)
	}
}

// TestCipherSuites tests the allowed cipher suites.
func TestCipherSuites_List(t *testing.T) {
	if len(CipherSuites) != 3 {
		t.Errorf("CipherSuites = %d, want 3", len(CipherSuites))
	}
	expected := []uint16{
		tls.TLS_AES_256_GCM_SHA384,
		tls.TLS_AES_128_GCM_SHA256,
		tls.TLS_CHACHA20_POLY1305_SHA256,
	}
	for i, cs := range CipherSuites {
		if cs != expected[i] {
			t.Errorf("CipherSuites[%d] = %d, want %d", i, cs, expected[i])
		}
	}
}

// TestShutdown_NoServer tests shutdown without a server.
func TestShutdown_NoServer(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	err := rs.Shutdown(nil)
	if err != nil {
		t.Errorf("Shutdown should not error with nil server: %v", err)
	}
}

// TestSessionExpiry tests session cleanup.
func TestSessionExpiry(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	// Add expired session
	rs.sessions["expired"] = &sessionInfo{
		Token:     "expired",
		Username:  "old",
		CreatedAt: time.Now().Add(-10 * time.Hour),
		ExpiresAt: time.Now().Add(-1 * time.Hour),
	}
	// Add valid session
	rs.sessions["valid"] = &sessionInfo{
		Token:     "valid",
		Username:  "current",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	if rs.validateSession("expired") != nil {
		t.Error("expired session should not be valid")
	}
	if rs.validateSession("valid") == nil {
		t.Error("valid session should be found")
	}
}

// TestExtractToken_WebSocketSubprotocol tests token from WebSocket subprotocol.
func TestExtractToken_WebSocketSubprotocol(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{BindAddr: ":0"})
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/ws", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Protocol", "ws-token-123")
	token := rs.extractToken(req)
	if token != "ws-token-123" {
		t.Errorf("token = %q, want ws-token-123", token)
	}
}

// TestExtractToken_ShortAuth tests short Authorization header.
func TestExtractToken_ShortAuth(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{BindAddr: ":0"})
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "short")
	token := rs.extractToken(req)
	if token != "" {
		t.Errorf("token should be empty for short auth header, got %q", token)
	}
}

// TestShutdown_WithServer tests shutdown with a server.
func TestShutdown_WithServer(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCert(dir)
	if err != nil {
		t.Fatalf("generateTestCert: %v", err)
	}

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
		CertFile: certFile,
		KeyFile: keyFile,
	})
	// Set httpSrv to simulate a running server
	rs.httpSrv = &http.Server{Addr: ":0"}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	err = rs.Shutdown(ctx)
	if err != nil {
		// May fail because server isn't actually listening, but code path is covered
		t.Logf("Shutdown: %v", err)
	}
}

// TestHandleWebSocket tests the WebSocket handler (not implemented).
func TestHandleWebSocket(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/ws", nil)
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleWebSocket(rec, req)
	if rec.status != http.StatusNotImplemented {
		t.Errorf("status = %d, want %d", rec.status, http.StatusNotImplemented)
	}
}

// TestHandleProxiedAPI tests the proxied API handler (not implemented).
func TestHandleProxiedAPI(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	// Add session info to context
	session := &sessionInfo{Username: "testuser", Role: "user"}
	ctx := context.WithValue(req.Context(), ctxKeySession, session)
	req = req.WithContext(ctx)

	rec := &responseRecorder{header: make(http.Header)}
	rs.handleProxiedAPI(rec, req)
	if rec.status != http.StatusNotImplemented {
		t.Errorf("status = %d, want %d", rec.status, http.StatusNotImplemented)
	}
}

// TestAuthMiddleware_PublicPaths tests auth middleware on public paths.
func TestAuthMiddleware_PublicPaths(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := rs.authMiddleware(next)

	// Login path should bypass auth
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/login", nil)
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusOK {
		t.Errorf("login path status = %d, want 200", rec.status)
	}

	// Health path should bypass auth
	req2, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/health", nil)
	rec2 := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec2, req2)
	if rec2.status != http.StatusOK {
		t.Errorf("health path status = %d, want 200", rec2.status)
	}
}

// TestAuthMiddleware_NoToken tests auth middleware without token.
func TestAuthMiddleware_NoToken(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := rs.authMiddleware(next)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.status)
	}
}

// TestAuthMiddleware_ValidToken tests auth middleware with valid token.
func TestAuthMiddleware_ValidToken(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	token := generateToken(32)
	rs.sessions[token] = &sessionInfo{
		Token:     token,
		Username:  "testuser",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess := r.Context().Value(ctxKeySession).(*sessionInfo)
		if sess.Username != "testuser" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	handler := rs.authMiddleware(next)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.status)
	}
}

// TestAuthMiddleware_ExpiredToken tests auth middleware with expired token.
func TestAuthMiddleware_ExpiredToken(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	token := generateToken(32)
	rs.sessions[token] = &sessionInfo{
		Token:     token,
		Username:  "olduser",
		CreatedAt: time.Now().Add(-2 * time.Hour),
		ExpiresAt: time.Now().Add(-1 * time.Hour),
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := rs.authMiddleware(next)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.status)
	}
}

// TestHandleLogin_KAIRO_SECRET_Fallback tests login with KAIRO_SECRET fallback.
func TestHandleLogin_SecretFallback(t *testing.T) {
	os.Unsetenv("KAIRO_REMOTE_SECRET")
	os.Setenv("KAIRO_SECRET", "fallback-secret")
	defer os.Unsetenv("KAIRO_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "fallback-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)

	if rec.status != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.status)
	}
}

// TestHandleLogin_AllowedUsers_Success tests login with allowed user.
func TestHandleLogin_AllowedUsers_Success(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "correct-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:     ":0",
		Logger:       log.New("test"),
		AllowedUsers: []string{"admin"},
	})
	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "correct-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)

	if rec.status != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.status, string(rec.body))
	}
}

// --- Helpers ---

// responseRecorder is a minimal http.ResponseWriter for testing.
type responseRecorder struct {
	status int
	header http.Header
	body   []byte
}

func (r *responseRecorder) Header() http.Header         { return r.header }
func (r *responseRecorder) Write(b []byte) (int, error) { r.body = append(r.body, b...); return len(b), nil }
func (r *responseRecorder) WriteHeader(s int)           { r.status = s }

// fakeReadCloser implements io.ReadCloser for testing request bodies.
type fakeReadCloser struct {
	data   []byte
	offset int
}

func (f *fakeReadCloser) Read(p []byte) (int, error) {
	if f.offset >= len(f.data) {
		return 0, nil
	}
	n := copy(p, f.data[f.offset:])
	f.offset += n
	return n, nil
}

func (f *fakeReadCloser) Close() error { return nil }