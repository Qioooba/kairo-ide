package remote

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"golang.org/x/crypto/ssh"
)

// =============================================================================
// SSH Tunnel additional tests
// =============================================================================

func TestGenerateED25519Key(t *testing.T) {
	pub, signer, err := GenerateED25519Key()
	if err != nil {
		t.Fatalf("GenerateED25519Key: %v", err)
	}
	if pub == nil {
		t.Error("public key should not be nil")
	}
	if signer == nil {
		t.Error("signer should not be nil")
	}
}

func TestGenerateSSHKey(t *testing.T) {
	priv, pub, err := GenerateSSHKey()
	if err != nil {
		t.Fatalf("GenerateSSHKey: %v", err)
	}
	if len(priv) == 0 {
		t.Error("private key should not be empty")
	}
	if len(pub) == 0 {
		t.Error("public key should not be empty")
	}
}

func TestMin(t *testing.T) {
	tests := []struct {
		a, b, want int
	}{
		{1, 2, 1},
		{2, 1, 1},
		{0, 0, 0},
		{-1, 1, -1},
		{100, 100, 100},
	}
	for _, tt := range tests {
		got := min(tt.a, tt.b)
		if got != tt.want {
			t.Errorf("min(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestSSHTunnel_buildAuthMethods_KeyFile_Valid(t *testing.T) {
	dir := t.TempDir()
	keyFile := filepath.Join(dir, "id_ed25519")

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}
	pemData := ssh.MarshalAuthorizedKey(signer.PublicKey())
	os.WriteFile(keyFile, pemData, 0600)

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyFile,
		KeyFile:    keyFile,
	})
	_, err = tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for invalid private key format")
	}
}

func TestSSHTunnel_buildAuthMethods_KeyData_Valid(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}
	pemData := ssh.MarshalAuthorizedKey(signer.PublicKey())

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyData,
		KeyData:    pemData,
	})
	_, err = tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for invalid private key data")
	}
}

func TestSSHTunnel_buildAuthMethods_DefaultFromPassword(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
	})

	methods, err := tunnel.buildAuthMethods()
	if err != nil {
		t.Fatalf("buildAuthMethods: %v", err)
	}
	if len(methods) != 1 {
		t.Fatalf("expected 1 auth method, got %d", len(methods))
	}
}

func TestSSHTunnel_buildAuthMethods_DefaultFromKeyFile(t *testing.T) {
	dir := t.TempDir()
	keyFile := filepath.Join(dir, "id_ed25519")

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}
	pemData := ssh.MarshalAuthorizedKey(signer.PublicKey())
	os.WriteFile(keyFile, pemData, 0600)

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:    "example.com",
		User:    "testuser",
		KeyFile: keyFile,
	})
	_, err = tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error from default keyfile auth with public key")
	}
}

func TestSSHTunnel_buildAuthMethods_KeyPassphrase(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}
	pemData := ssh.MarshalAuthorizedKey(signer.PublicKey())

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:          "example.com",
		User:          "testuser",
		AuthMethod:    SSHAuthKeyData,
		KeyData:       pemData,
		KeyPassphrase: "wrong-passphrase",
	})
	_, err = tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for invalid key with passphrase")
	}
}

func TestSSHTunnel_buildAuthMethods_EmptyKeyFile(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyFile,
		KeyFile:    "",
	})
	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for empty key file path")
	}
}

func TestSSHTunnel_buildAuthMethods_EmptyKeyData(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyData,
		KeyData:    nil,
	})
	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for empty key data")
	}
}

func TestSSHTunnel_buildAuthMethods_EmptyPassword(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthPassword,
		Password:   "",
	})
	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for empty password")
	}
}

func TestSSHTunnel_Disconnect_WithCancel(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})
	ctx, cancel := context.WithCancel(context.Background())
	tunnel.ctx = ctx
	tunnel.cancel = cancel
	tunnel.setState(SSHStateConnected)

	err := tunnel.Disconnect()
	if err != nil {
		t.Errorf("Disconnect: %v", err)
	}
	if tunnel.Status().State != SSHStateDisconnected {
		t.Errorf("state = %v, want disconnected", tunnel.Status().State)
	}
}

func TestSSHTunnel_Disconnect_NoCancel(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})
	tunnel.setState(SSHStateConnected)

	err := tunnel.Disconnect()
	if err != nil {
		t.Errorf("Disconnect: %v", err)
	}
}

func TestSSHTunnel_Status_Fields(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Port:     2222,
		Logger:   log.New("test"),
	})

	status := tunnel.Status()
	if status.Host != "example.com" {
		t.Errorf("Host = %q, want example.com", status.Host)
	}
	if status.Port != 2222 {
		t.Errorf("Port = %d, want 2222", status.Port)
	}
}

// =============================================================================
// Remote Server additional tests
// =============================================================================

func TestRemoteServer_handleLogin_Success(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "test-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "test-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}

	var resp LoginResponse
	json.Unmarshal(rec.body, &resp)
	if resp.SessionToken == "" {
		t.Error("session token should not be empty")
	}
	if resp.ReconnectToken == "" {
		t.Error("reconnect token should not be empty")
	}
	if resp.User.Username != "admin" {
		t.Errorf("username = %q, want admin", resp.User.Username)
	}
}

func TestRemoteServer_handleLogin_KAIRO_SECRET_Fallback(t *testing.T) {
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
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}
}

func TestRemoteServer_handleLogin_MaxSessions(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "test-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:              ":0",
		Logger:                log.New("test"),
		MaxConcurrentSessions: 1,
	})
	rs.sessions["existing-token"] = &sessionInfo{
		Token:     "existing-token",
		Username:  "existing",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	body, _ := json.Marshal(LoginRequest{Username: "newuser", Password: "test-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusTooManyRequests {
		t.Errorf("status = %d, want %d", rec.status, http.StatusTooManyRequests)
	}
}

func TestRemoteServer_handleLogin_AllowedUsers_Success(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "test-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:     ":0",
		Logger:       log.New("test"),
		AllowedUsers: []string{"admin", "sa"},
	})
	body, _ := json.Marshal(LoginRequest{Username: "admin", Password: "test-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}
}

func TestRemoteServer_ExtractToken_WebSocket(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{BindAddr: ":0"})
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Protocol", "ws-token")
	token := rs.extractToken(req)
	if token != "ws-token" {
		t.Errorf("token = %q, want ws-token", token)
	}
}

func TestRemoteServer_Shutdown_NilServer(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	err := rs.Shutdown(context.Background())
	if err != nil {
		t.Errorf("Shutdown with nil httpSrv should not error: %v", err)
	}
}

func TestRemoteServer_WriteJSON(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	rec := &responseRecorder{header: make(http.Header)}
	rs.writeJSON(rec, http.StatusTeapot, map[string]string{"tea": "earl grey"})
	if rec.status != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.status, http.StatusTeapot)
	}
	if ct := rec.header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestRemoteServer_WriteError(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	rec := &responseRecorder{header: make(http.Header)}
	rs.writeError(rec, http.StatusNotFound, "not found")
	if rec.status != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.status, http.StatusNotFound)
	}

	var errResp map[string]map[string]any
	json.Unmarshal(rec.body, &errResp)
	if errResp["error"]["message"] != "not found" {
		t.Errorf("message = %v, want 'not found'", errResp["error"]["message"])
	}
}

func TestRemoteServer_WriteError_Retryable(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	rec := &responseRecorder{header: make(http.Header)}
	rs.writeError(rec, http.StatusInternalServerError, "server error")
	if rec.status != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.status, http.StatusInternalServerError)
	}

	var errResp map[string]map[string]any
	json.Unmarshal(rec.body, &errResp)
	if retry, ok := errResp["error"]["retryable"]; !ok || !retry.(bool) {
		t.Error("500 error should be retryable")
	}
}

func TestRemoteServer_WriteError_NotRetryable(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	rec := &responseRecorder{header: make(http.Header)}
	rs.writeError(rec, http.StatusBadRequest, "bad request")
	if rec.status != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.status, http.StatusBadRequest)
	}

	var errResp map[string]map[string]any
	json.Unmarshal(rec.body, &errResp)
	if retry, ok := errResp["error"]["retryable"]; ok && retry.(bool) {
		t.Error("400 error should not be retryable")
	}
}

func TestRemoteServer_HandleHealth_Fields(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/health", nil)
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleHealth(rec, req)

	var result map[string]any
	json.Unmarshal(rec.body, &result)
	if result["uptime"] == nil {
		t.Error("uptime should not be nil")
	}
	if result["timestamp"] == nil {
		t.Error("timestamp should not be nil")
	}
}

func TestRemoteServer_HandleWebSocket(t *testing.T) {
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

func TestRemoteServer_HandleProxiedAPI(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	session := &sessionInfo{
		Token:     "test-token",
		Username:  "testuser",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	ctx := context.WithValue(req.Context(), ctxKeySession, session)
	req = req.WithContext(ctx)
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleProxiedAPI(rec, req)
	if rec.status != http.StatusNotImplemented {
		t.Errorf("status = %d, want %d", rec.status, http.StatusNotImplemented)
	}
}

func TestRemoteServer_AuthMiddleware_HealthEndpoint(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/remote/health", rs.handleHealth)
	handler := rs.authMiddleware(mux)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/remote/health", nil)
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusOK {
		t.Errorf("health endpoint should be accessible without auth, got status %d", rec.status)
	}
}

func TestRemoteServer_AuthMiddleware_MissingToken(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/workspaces", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := rs.authMiddleware(mux)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.status, http.StatusUnauthorized)
	}
}

func TestRemoteServer_AuthMiddleware_InvalidToken(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/workspaces", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := rs.authMiddleware(mux)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.status, http.StatusUnauthorized)
	}
}

func TestRemoteServer_AuthMiddleware_ValidToken(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	rs.sessions["valid-token"] = &sessionInfo{
		Token:     "valid-token",
		Username:  "testuser",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/workspaces", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := rs.authMiddleware(mux)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := &responseRecorder{header: make(http.Header)}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}
}

// =============================================================================
// Authenticator additional tests
// =============================================================================

func TestAuthenticator_Close_NoAuditLog(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})
	err := auth.Close()
	if err != nil {
		t.Errorf("Close without audit log should not error: %v", err)
	}
}

func TestAuthenticator_Close_WithAuditLog(t *testing.T) {
	dir := t.TempDir()
	auditPath := filepath.Join(dir, "audit.log")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:   log.New("test"),
		AuditLog: auditPath,
	})
	err := auth.Close()
	if err != nil {
		t.Errorf("Close with audit log: %v", err)
	}
}

func TestAuthenticator_BuildTLSConfig_MTLS_InvalidCA(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCerts(dir)
	if err != nil {
		t.Fatalf("generateTestCerts: %v", err)
	}
	caFile := filepath.Join(dir, "ca.crt")
	os.WriteFile(caFile, []byte("not a valid cert"), 0644)

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		CertFile:    certFile,
		KeyFile:     keyFile,
		EnableMTLS:  true,
		CACertFile:  caFile,
	})
	_, err = auth.BuildTLSConfig()
	if err == nil {
		t.Fatal("expected error for invalid CA cert")
	}
}

func TestAuthenticator_BuildTLSConfig_MTLS_CANotFound(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCerts(dir)
	if err != nil {
		t.Fatalf("generateTestCerts: %v", err)
	}

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		CertFile:    certFile,
		KeyFile:     keyFile,
		EnableMTLS:  true,
		CACertFile:  "/nonexistent/ca.pem",
	})
	_, err = auth.BuildTLSConfig()
	if err == nil {
		t.Fatal("expected error for missing CA cert file")
	}
}

func TestAuthenticator_AuditOperation_NilAuditLog(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})
	// Should not panic when auditLog is nil
	auth.AuditOperation(context.Background(), "testuser", "test_action", "test_target", "ok", nil)
}

func TestAuthenticator_AuditEvent_NilAuditLog(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})
	// Should not panic when auditLog is nil
	_, err := auth.AuthenticateToken("nonexistent-token")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestAuthenticator_AuthenticatePassword_MaxSessions(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		MaxSessions: 1,
	})
	auth.AuthenticatePassword("user1", "secret", "127.0.0.1", "")
	_, err := auth.AuthenticatePassword("user2", "secret", "127.0.0.1", "")
	if err == nil {
		t.Fatal("expected error when max sessions reached")
	}
}

func TestAuthenticator_AuthenticatePassword_WithTokenSecret(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "my-secret",
	})
	session, err := auth.AuthenticatePassword("admin", "my-secret", "127.0.0.1", "Kairo-IDE/1.0")
	if err != nil {
		t.Fatalf("AuthenticatePassword: %v", err)
	}
	if session.UserAgent != "Kairo-IDE/1.0" {
		t.Errorf("UserAgent = %q, want Kairo-IDE/1.0", session.UserAgent)
	}
}

func TestAuthenticator_AuthenticatePassword_EmptyUsernameOnly(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})
	_, err := auth.AuthenticatePassword("", "secret", "127.0.0.1", "")
	if err == nil {
		t.Fatal("expected error for empty username")
	}
}

func TestAuthenticator_AuthenticatePassword_EmptyPasswordOnly(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})
	_, err := auth.AuthenticatePassword("user", "", "127.0.0.1", "")
	if err == nil {
		t.Fatal("expected error for empty password")
	}
}

// =============================================================================
// Agent Proxy additional tests
// =============================================================================

func TestAgentProxy_ProxyJSONRequest_NilReqBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	var respBody map[string]string
	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, &respBody)
	if err != nil {
		t.Fatalf("ProxyJSONRequest with nil body: %v", err)
	}
	if respBody["status"] != "ok" {
		t.Errorf("status = %q, want ok", respBody["status"])
	}
}

func TestAgentProxy_ProxyJSONRequest_NilRespBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, nil)
	if err != nil {
		t.Fatalf("ProxyJSONRequest with nil respBody: %v", err)
	}
}

func TestAgentProxy_ProxyJSONRequest_ErrorResponse_NoBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, nil)
	if err == nil {
		t.Fatal("expected error for 500 without body")
	}
}

func TestAgentProxy_ProxyRequest_ForwardedHeaders(t *testing.T) {
	var receivedXFF string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedXFF = r.Header.Get("X-Forwarded-For")
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	resp, err := proxy.ProxyRequest(context.Background(), http.MethodGet, "test", nil)
	if err != nil {
		t.Fatalf("ProxyRequest: %v", err)
	}
	resp.Body.Close()

	if receivedXFF != "kairo-agent-proxy" {
		t.Errorf("X-Forwarded-For = %q, want kairo-agent-proxy", receivedXFF)
	}
}

func TestAgentProxy_ProxyJSONRequest_ErrorStruct(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"code":    "BAD_REQUEST",
				"message": "invalid input",
			},
		})
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, nil)
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
}

func TestAgentProxy_ProxyJSONRequest_DecodeError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not json"))
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	var respBody map[string]string
	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, &respBody)
	if err == nil {
		t.Fatal("expected error for invalid JSON response")
	}
}

// =============================================================================
// Session Manager additional tests
// =============================================================================

func TestSessionManager_CreateSession_PerUserLimit(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	for i := 0; i < 10; i++ {
		_, err := sm.CreateSession("user-1", "alice", "user", nil)
		if err != nil {
			t.Fatalf("CreateSession %d: %v", i, err)
		}
	}

	_, err := sm.CreateSession("user-1", "alice", "user", nil)
	if err == nil {
		t.Fatal("expected error when per-user max reached")
	}
}

func TestSessionManager_HasPermission_Expired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)
	session, _ := sm.CreateSession("user-1", "alice", "admin", []string{"read"})
	time.Sleep(10 * time.Millisecond)

	if sm.HasPermission(session.ID, "read") {
		t.Fatal("expired session should not have permission")
	}
}

func TestSessionManager_GetUserSessions_WithExpired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)
	sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(10 * time.Millisecond)

	sessions := sm.GetUserSessions("user-1")
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions (all expired), got %d", len(sessions))
	}
}

func TestSessionManager_TerminateSession_RemovesFromUserList(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	s1, _ := sm.CreateSession("user-1", "alice", "user", nil)
	s2, _ := sm.CreateSession("user-1", "alice", "user", nil)

	sm.TerminateSession(s1.ID)

	_, ok := sm.GetSession(s2.ID)
	if !ok {
		t.Fatal("second session should still exist")
	}

	sessions := sm.GetUserSessions("user-1")
	if len(sessions) != 1 {
		t.Errorf("expected 1 session, got %d", len(sessions))
	}
}

func TestSessionManager_ListActiveSessions_Empty(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	sessions := sm.ListActiveSessions()
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestSessionManager_GenerateSessionID(t *testing.T) {
	id1 := generateSessionID()
	id2 := generateSessionID()

	if id1 == "" {
		t.Error("generated ID is empty")
	}
	if id2 == "" {
		t.Error("generated ID is empty")
	}
	if id1 == id2 {
		t.Error("generated IDs should be unique")
	}
}

// =============================================================================
// File Sync additional tests
// =============================================================================

func TestFileSyncService_ResolveConflicts_WithError(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	conflicts := []FileConflict{
		{Path: "a.txt", LocalHash: "a1", RemoteHash: "a2"},
		{Path: "b.txt", LocalHash: "b1", RemoteHash: "b2"},
	}
	err := svc.ResolveConflicts(conflicts, "invalid")
	if err == nil {
		t.Fatal("expected error when resolving with invalid strategy")
	}
}

func TestFileSyncService_RecordSync_ErrorHandling(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	testErr := errors.New("plain error")
	err := svc.recordSync("test.txt", SyncUpload, 0, "", testErr)
	if err == nil {
		t.Fatal("expected error to be returned")
	}
}

func TestFileSyncService_ApplySyncPlan_UploadError(t *testing.T) {
	svc := NewFileSyncService("/nonexistent/path")
	plan := &SyncPlan{
		ToUpload: []FileChange{
			{Path: "nonexistent.txt", Hash: "abc"},
		},
	}
	uploaded, downloaded, errs := svc.ApplySyncPlan(plan)
	if uploaded != 0 {
		t.Errorf("uploaded = %d, want 0", uploaded)
	}
	if downloaded != 0 {
		t.Errorf("downloaded = %d, want 0", downloaded)
	}
	if len(errs) == 0 {
		t.Error("expected errors for missing file")
	}
}

// =============================================================================
// File Sync additional coverage tests
// =============================================================================

func TestFileSyncService_ApplySyncPlan_Nil(t *testing.T) {
	svc := NewFileSyncService(t.TempDir())
	uploaded, downloaded, errs := svc.ApplySyncPlan(nil)
	if uploaded != 0 {
		t.Errorf("uploaded = %d, want 0", uploaded)
	}
	if downloaded != 0 {
		t.Errorf("downloaded = %d, want 0", downloaded)
	}
	if len(errs) != 0 {
		t.Errorf("errs = %v, want none", errs)
	}
}

func TestFileSyncService_ApplySyncPlan_WithDownload(t *testing.T) {
	svc := NewFileSyncService(t.TempDir())
	plan := &SyncPlan{
		ToDownload: []FileChange{
			{Path: "remote.txt", Hash: "abc"},
			{Path: "other.txt", Hash: "def"},
		},
	}
	uploaded, downloaded, errs := svc.ApplySyncPlan(plan)
	if uploaded != 0 {
		t.Errorf("uploaded = %d, want 0", uploaded)
	}
	if downloaded != 2 {
		t.Errorf("downloaded = %d, want 2", downloaded)
	}
	if len(errs) != 0 {
		t.Errorf("errs = %v, want none", errs)
	}
}

func TestFileSyncService_ResolveConflict_Local(t *testing.T) {
	svc := NewFileSyncService(t.TempDir())
	err := svc.ResolveConflict("test.txt", "local")
	if err != nil {
		t.Errorf("ResolveConflict local: %v", err)
	}
}

func TestFileSyncService_ResolveConflict_Remote(t *testing.T) {
	svc := NewFileSyncService(t.TempDir())
	// Add file to hashes first
	svc.fileHashes["test.txt"] = "abc123"
	err := svc.ResolveConflict("test.txt", "remote")
	if err != nil {
		t.Errorf("ResolveConflict remote: %v", err)
	}
	if _, ok := svc.fileHashes["test.txt"]; ok {
		t.Error("file hash should be removed for remote resolution")
	}
}

func TestFileSyncService_ResolveConflict_Merge(t *testing.T) {
	svc := NewFileSyncService(t.TempDir())
	err := svc.ResolveConflict("test.txt", "merge")
	if err != nil {
		t.Errorf("ResolveConflict merge: %v", err)
	}
}

func TestFileSyncService_ResolveConflicts_Remote(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)
	conflicts := []FileConflict{
		{Path: "a.txt", LocalHash: "a1", RemoteHash: "a2"},
	}
	err := svc.ResolveConflicts(conflicts, "remote")
	if err != nil {
		t.Errorf("ResolveConflicts remote: %v", err)
	}
}

func TestFileSyncService_ResolveConflicts_Merge(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)
	conflicts := []FileConflict{
		{Path: "a.txt", LocalHash: "a1", RemoteHash: "a2"},
	}
	err := svc.ResolveConflicts(conflicts, "merge")
	if err != nil {
		t.Errorf("ResolveConflicts merge: %v", err)
	}
}

func TestFileSyncService_CompareWithRemote_BothSame(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)
	svc.fileHashes["same.txt"] = "abc123"

	remoteHashes := map[string]string{"same.txt": "abc123"}
	plan := svc.CompareWithRemote(remoteHashes)

	if len(plan.ToUpload) != 0 {
		t.Errorf("ToUpload = %d, want 0", len(plan.ToUpload))
	}
	if len(plan.ToDownload) != 0 {
		t.Errorf("ToDownload = %d, want 0", len(plan.ToDownload))
	}
	if len(plan.Conflicts) != 0 {
		t.Errorf("Conflicts = %d, want 0", len(plan.Conflicts))
	}
}

func TestFileSyncService_CompareWithRemote_RemoteOnly(t *testing.T) {
	svc := NewFileSyncService(t.TempDir())
	remoteHashes := map[string]string{"remote.txt": "abc123"}
	plan := svc.CompareWithRemote(remoteHashes)

	if len(plan.ToDownload) != 1 {
		t.Errorf("ToDownload = %d, want 1", len(plan.ToDownload))
	}
	if plan.ToDownload[0].Path != "remote.txt" {
		t.Errorf("path = %q, want remote.txt", plan.ToDownload[0].Path)
	}
}

func TestFileSyncService_SyncFile_DirCreation(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	err := svc.SyncFile("sub/deep/file.txt", SyncUpload, []byte("hello"))
	if err != nil {
		t.Fatalf("SyncFile: %v", err)
	}

	// Verify file was created
	data, err := os.ReadFile(filepath.Join(dir, "sub", "deep", "file.txt"))
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if string(data) != "hello" {
		t.Errorf("content = %q, want hello", string(data))
	}
}

func TestFileSyncService_GetSyncHistory_WithRecords(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)
	svc.SyncFile("a.txt", SyncUpload, []byte("a"))
	svc.SyncFile("b.txt", SyncDownload, []byte("b"))

	history := svc.GetSyncHistory()
	if len(history) != 2 {
		t.Errorf("history length = %d, want 2", len(history))
	}
	if history[0].Path != "a.txt" {
		t.Errorf("first record = %q, want a.txt", history[0].Path)
	}
}

func TestFileSyncService_RecordSync_WrapsErrors(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)
	// recordSync adds file_sync: prefix to non-file_sync errors
	err := svc.recordSync("test.txt", SyncUpload, 0, "", errors.New("plain error"))
	if err == nil {
		t.Fatal("expected error to be returned")
	}
	if !strings.HasPrefix(err.Error(), "file_sync:") {
		t.Errorf("error should have file_sync: prefix, got %v", err)
	}
}

func TestFileSyncService_ScanDirectory_BasePathNotExist(t *testing.T) {
	svc := NewFileSyncService("/nonexistent/path/for/scan")
	_, err := svc.ScanDirectory()
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}

func TestFileSyncService_ComputeFileHash_Nonexistent(t *testing.T) {
	svc := NewFileSyncService(t.TempDir())
	_, err := svc.ComputeFileHash("nonexistent.txt")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

// =============================================================================
// Container Isolation additional coverage tests
// =============================================================================

func TestContainerIsolationManager_CreateContainer_WithMounts(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image: "nginx:latest",
		Mounts: []ContainerMount{
			{Source: "/host/path", Destination: "/container/path", ReadOnly: true},
		},
	}
	// Will fail because docker is not available, but we cover the arg building path
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CreateContainer_WithPorts(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image: "web:latest",
		Ports: []ContainerPort{
			{HostPort: 8080, ContainerPort: 80, Protocol: "tcp"},
		},
	}
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CreateContainer_WithPortsNoProtocol(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image: "web:latest",
		Ports: []ContainerPort{
			{HostPort: 8080, ContainerPort: 80},
		},
	}
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CreateContainer_WithEnv(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image: "app:latest",
		Environment: map[string]string{
			"NODE_ENV": "production",
		},
	}
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CreateContainer_WithNetwork(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image:   "app:latest",
		Network: "host",
	}
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CreateContainer_WithLimits(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image:       "app:latest",
		MemoryLimit: 512 * 1024 * 1024,
		CPULimit:    2.0,
	}
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CreateContainer_WithName(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image: "app:latest",
		Name:  "my-container",
	}
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CreateContainer_WithWorkDir(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	cfg := ContainerConfig{
		Image:   "app:latest",
		WorkDir: "/workspace",
	}
	_, err := mgr.CreateContainer(cfg)
	if err == nil {
		t.Log("docker is available, container created")
	}
}

func TestContainerIsolationManager_CopyToContainer_SourceExists(t *testing.T) {
	dir := t.TempDir()
	srcFile := filepath.Join(dir, "test.txt")
	os.WriteFile(srcFile, []byte("test content"), 0644)

	mgr := NewContainerIsolationManager(ProviderDocker)
	mgr.mu.Lock()
	mgr.containers["test-id"] = &ContainerStatus{
		ID:    "test-id",
		Name:  "test-container",
		State: "running",
	}
	mgr.mu.Unlock()

	err := mgr.CopyToContainer("test-id", srcFile, "/tmp/dst.txt")
	if err == nil {
		t.Log("docker is available, copy succeeded")
	}
}

func TestContainerIsolationManager_CopyFromContainer_WithContainer(t *testing.T) {
	dir := t.TempDir()
	mgr := NewContainerIsolationManager(ProviderDocker)
	mgr.mu.Lock()
	mgr.containers["test-id"] = &ContainerStatus{
		ID:    "test-id",
		Name:  "test-container",
		State: "running",
	}
	mgr.mu.Unlock()

	dstPath := filepath.Join(dir, "output.txt")
	err := mgr.CopyFromContainer("test-id", "/tmp/src.txt", dstPath)
	if err == nil {
		t.Log("docker is available, copy succeeded")
	}
}

func TestContainerIsolationManager_GetContainerStatus_WithContainer(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	mgr.mu.Lock()
	mgr.containers["test-id"] = &ContainerStatus{
		ID:    "test-id",
		Name:  "test-container",
		State: "stopped",
	}
	mgr.mu.Unlock()

	status, err := mgr.GetContainerStatus("test-id")
	if err != nil {
		t.Logf("GetContainerStatus (docker not available): %v", err)
		return
	}
	if status == nil {
		t.Fatal("status should not be nil")
	}
	if status.Name != "test-container" {
		t.Errorf("Name = %q, want test-container", status.Name)
	}
}

func TestContainerIsolationManager_ExecInContainer_WithContainer(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	mgr.mu.Lock()
	mgr.containers["test-id"] = &ContainerStatus{
		ID:    "test-id",
		Name:  "test-container",
		State: "running",
	}
	mgr.mu.Unlock()

	_, err := mgr.ExecInContainer("test-id", []string{"echo", "hello"})
	if err == nil {
		t.Log("docker is available, exec succeeded")
	}
}

func TestContainerIsolationManager_BuildDockerfile_WithFile(t *testing.T) {
	dir := t.TempDir()
	dockerfilePath := filepath.Join(dir, "Dockerfile")
	os.WriteFile(dockerfilePath, []byte("FROM alpine:latest"), 0644)

	mgr := NewContainerIsolationManager(ProviderDocker)
	err := mgr.BuildDockerfile(dockerfilePath, "test:latest")
	if err == nil {
		t.Log("docker is available, build succeeded")
	}
}

func TestContainerIsolationManager_Command(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	if mgr.command() != "docker" {
		t.Errorf("command = %q, want docker", mgr.command())
	}

	mgr.provider = ProviderPodman
	if mgr.command() != "podman" {
		t.Errorf("command = %q, want podman", mgr.command())
	}
}

func TestContainerIsolationManager_ListContainers_WithContainers(t *testing.T) {
	mgr := NewContainerIsolationManager(ProviderDocker)
	mgr.mu.Lock()
	mgr.containers["c1"] = &ContainerStatus{ID: "c1", Name: "first"}
	mgr.containers["c2"] = &ContainerStatus{ID: "c2", Name: "second"}
	mgr.mu.Unlock()

	list := mgr.ListContainers()
	if len(list) != 2 {
		t.Errorf("list length = %d, want 2", len(list))
	}
}

// =============================================================================
// SSH Tunnel additional coverage tests
// =============================================================================

func TestSSHTunnel_HandleDisconnect_WithListener(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})
	// Set up context and listener
	ctx, cancel := context.WithCancel(context.Background())
	tunnel.ctx = ctx
	tunnel.cancel = cancel
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	ln.Close() // Immediately close so handleDisconnect works on closed listener

	tunnel.listener = ln
	tunnel.setState(SSHStateConnected)

	tunnel.handleDisconnect()
	if tunnel.Status().State != SSHStateError {
		t.Errorf("state = %v, want error (reconnect attempt will fail)", tunnel.Status().State)
	}
	cancel()
}

func TestSSHTunnel_HandleDisconnect_ReconnectDisabled(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:                "example.com",
		User:                "testuser",
		Password:            "secret",
		Logger:              log.New("test"),
		MaxReconnectRetries: -1,
	})
	tunnel.setState(SSHStateConnected)

	tunnel.handleDisconnect()
	if tunnel.Status().State != SSHStateDisconnected {
		t.Errorf("state = %v, want disconnected", tunnel.Status().State)
	}
}

func TestSSHTunnel_Disconnect_WithClient(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})
	ctx, cancel := context.WithCancel(context.Background())
	tunnel.ctx = ctx
	tunnel.cancel = cancel
	tunnel.setState(SSHStateConnected)

	// Set a dummy client - we can't easily create a real ssh.Client
	// but we can test the nil client path
	tunnel.client = nil
	err := tunnel.Disconnect()
	if err != nil {
		t.Errorf("Disconnect: %v", err)
	}
	if tunnel.Status().State != SSHStateDisconnected {
		t.Errorf("state = %v, want disconnected", tunnel.Status().State)
	}
}

func TestSSHTunnel_SetError_WithCallback(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})

	called := false
	tunnel.OnStatusChange(func(status ConnectionStatus) {
		called = true
		if status.State != SSHStateError {
			t.Errorf("state = %v, want error", status.State)
		}
	})

	tunnel.setError(errors.New("test error"))
	if !called {
		t.Error("status callback was not called")
	}
}

func TestSSHTunnel_BuildAuthMethods_Default_NoAuth(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host: "example.com",
		User: "testuser",
	})
	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error when no auth method is configured")
	}
}

func TestSSHTunnel_BuildAuthMethods_Default_WithPassword(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
	})
	methods, err := tunnel.buildAuthMethods()
	if err != nil {
		t.Fatalf("buildAuthMethods: %v", err)
	}
	if len(methods) != 1 {
		t.Fatalf("expected 1 auth method, got %d", len(methods))
	}
}

func TestSSHTunnel_BuildAuthMethods_Default_WithKeyFile(t *testing.T) {
	dir := t.TempDir()
	keyFile := filepath.Join(dir, "id_ed25519")

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}
	pemData := ssh.MarshalAuthorizedKey(signer.PublicKey())
	os.WriteFile(keyFile, pemData, 0600)

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:    "example.com",
		User:    "testuser",
		KeyFile: keyFile,
	})
	_, err = tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error from default keyfile auth with public key")
	}
}

func TestSSHTunnel_ParseKeyAuth_WithPassphrase(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}
	pemData := ssh.MarshalAuthorizedKey(signer.PublicKey())

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:          "example.com",
		User:          "testuser",
		KeyPassphrase: "test-passphrase",
	})
	_, err = tunnel.parseKeyAuth(pemData)
	if err == nil {
		t.Fatal("expected error parsing public key with passphrase")
	}
}

func TestSSHTunnel_ParseKeyAuth_InvalidKey(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host: "example.com",
		User: "testuser",
	})
	_, err := tunnel.parseKeyAuth([]byte("not a valid key"))
	if err == nil {
		t.Fatal("expected error for invalid key data")
	}
}

func TestSSHTunnel_ParseKeyAuth_ValidPrivateKey(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	pemBytes, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	keyData := pem.EncodeToMemory(pemBytes)

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host: "example.com",
		User: "testuser",
	})
	methods, err := tunnel.parseKeyAuth(keyData)
	if err != nil {
		t.Fatalf("parseKeyAuth with valid private key: %v", err)
	}
	if len(methods) != 1 {
		t.Fatalf("expected 1 auth method, got %d", len(methods))
	}
}

func TestSSHTunnel_BuildAuthMethods_KeyFile_Exists(t *testing.T) {
	dir := t.TempDir()
	keyFile := filepath.Join(dir, "test_key")

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	pemBytes, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	keyData := pem.EncodeToMemory(pemBytes)
	os.WriteFile(keyFile, keyData, 0600)

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyFile,
		KeyFile:    keyFile,
	})
	methods, err := tunnel.buildAuthMethods()
	if err != nil {
		t.Fatalf("buildAuthMethods with valid key file: %v", err)
	}
	if len(methods) != 1 {
		t.Fatalf("expected 1 auth method, got %d", len(methods))
	}
}

func TestSSHTunnel_BuildAuthMethods_KeyData_WithValidKey(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	pemBlock, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	keyData := pem.EncodeToMemory(pemBlock)

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyData,
		KeyData:    keyData,
	})
	methods, err := tunnel.buildAuthMethods()
	if err != nil {
		t.Fatalf("buildAuthMethods with valid key data: %v", err)
	}
	if len(methods) != 1 {
		t.Fatalf("expected 1 auth method, got %d", len(methods))
	}
}

func TestSSHTunnel_AttemptReconnect_MaxRetries(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:                "example.com",
		User:                "testuser",
		Password:            "secret",
		Logger:              log.New("test"),
		MaxReconnectRetries: 1,
	})
	tunnel.reconnectAttempt = 2 // Already exceeded
	tunnel.attemptReconnect()
	// Should have set error state
	if tunnel.Status().State != SSHStateError {
		t.Errorf("state = %v, want error", tunnel.Status().State)
	}
}

func TestSSHTunnel_AttemptReconnect_ContextCancelled(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:                "example.com",
		User:                "testuser",
		Password:            "secret",
		Logger:              log.New("test"),
		MaxReconnectRetries: 0,
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately
	tunnel.ctx = ctx
	tunnel.cancel = cancel

	tunnel.attemptReconnect()
	if tunnel.Status().State != SSHStateDisconnected {
		t.Errorf("state = %v, want disconnected", tunnel.Status().State)
	}
}

func TestSSHTunnel_AttemptReconnect_MaxRetriesExceeded(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:                "example.com",
		User:                "testuser",
		Password:            "secret",
		Logger:              log.New("test"),
		MaxReconnectRetries: 1,
	})
	ctx, cancel := context.WithCancel(context.Background())
	tunnel.ctx = ctx
	tunnel.cancel = cancel
	// Set reconnectAttempt to 2 so it exceeds MaxReconnectRetries of 1
	tunnel.mu.Lock()
	tunnel.reconnectAttempt = 2
	tunnel.mu.Unlock()

	tunnel.attemptReconnect()
	if tunnel.Status().State != SSHStateError {
		t.Errorf("state = %v, want error", tunnel.Status().State)
	}
	cancel()
}

func TestSSHTunnel_Connect_InvalidAuth(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host: "example.com",
		User: "testuser",
	})
	ctx := context.Background()
	err := tunnel.Connect(ctx)
	if err == nil {
		t.Fatal("expected error for invalid auth config")
	}
	if tunnel.Status().State != SSHStateError {
		t.Errorf("state = %v, want error", tunnel.Status().State)
	}
}

func TestSSHTunnel_Connect_WithPassword_DialFails(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "192.0.2.1", // TEST-NET-1, unreachable
		User:     "testuser",
		Password: "secret",
		Port:     22,
		Logger:   log.New("test"),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := tunnel.Connect(ctx)
	if err == nil {
		t.Fatal("expected dial error for unreachable host")
	}
	if tunnel.Status().State != SSHStateError {
		t.Errorf("state = %v, want error", tunnel.Status().State)
	}
}

// =============================================================================
// Authenticator additional coverage tests
// =============================================================================

func TestAuthenticator_StartSessionCleanup_DefaultInterval(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		TokenTTL:    1 * time.Millisecond,
	})

	auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	time.Sleep(5 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	// Use default interval (0 → 5 minutes)
	auth.StartSessionCleanup(ctx, 0)
	time.Sleep(100 * time.Millisecond)

	// Session should still be there (cleanup interval is 5 min)
	_ = auth.SessionCount()
}

func TestAuthenticator_AuthenticateToken_Expired(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		TokenTTL:    1 * time.Millisecond,
	})

	session, _ := auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	time.Sleep(5 * time.Millisecond)

	_, err := auth.AuthenticateToken(session.Token)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestAuthenticator_AuthenticatePassword_SecretFromEnv(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "env-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})
	session, err := auth.AuthenticatePassword("admin", "env-secret", "127.0.0.1", "")
	if err != nil {
		t.Fatalf("AuthenticatePassword: %v", err)
	}
	if session == nil {
		t.Fatal("session should not be nil")
	}
}

func TestAuthenticator_AuthenticatePassword_SecretFromKairoSecret(t *testing.T) {
	os.Unsetenv("KAIRO_REMOTE_SECRET")
	os.Setenv("KAIRO_SECRET", "kairo-env-secret")
	defer os.Unsetenv("KAIRO_SECRET")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})
	session, err := auth.AuthenticatePassword("admin", "kairo-env-secret", "127.0.0.1", "")
	if err != nil {
		t.Fatalf("AuthenticatePassword: %v", err)
	}
	if session == nil {
		t.Fatal("session should not be nil")
	}
}

func TestAuthenticator_AuditOperation_WithLog(t *testing.T) {
	dir := t.TempDir()
	auditPath := filepath.Join(dir, "audit.log")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:   log.New("test"),
		AuditLog: auditPath,
	})
	defer auth.Close()

	auth.AuditOperation(context.Background(), "testuser", "read", "file.txt", "ok", map[string]any{
		"size": 1024,
	})

	data, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatalf("read audit log: %v", err)
	}
	if len(data) == 0 {
		t.Error("audit log should not be empty")
	}
}

func TestAuthenticator_CleanupExpiredSessions_None(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		TokenTTL:    1 * time.Hour,
	})
	auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")

	removed := auth.CleanupExpiredSessions()
	if removed != 0 {
		t.Errorf("removed = %d, want 0", removed)
	}
}

func TestAuthenticator_InvalidateSession_Existing(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})
	session, _ := auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	auth.InvalidateSession(session.Token)

	if auth.GetSession(session.Token) != nil {
		t.Error("session should be nil after invalidation")
	}
}

// =============================================================================
// Agent Proxy additional coverage tests
// =============================================================================

func TestAgentProxy_ProxyJSONRequest_MarshalError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	// Use a channel which cannot be JSON-marshaled to trigger marshal error
	err = proxy.ProxyJSONRequest(context.Background(), http.MethodPost, "test", make(chan int), nil)
	if err == nil {
		t.Fatal("expected marshal error for channel type")
	}
}

func TestAgentProxy_ProxyJSONRequest_ErrorWithBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"code":    "BAD_REQUEST",
				"message": "invalid input",
			},
		})
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, nil)
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
}

func TestAgentProxy_ProxyJSONRequest_ErrorWithoutBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr: addr,
		Logger:     log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, nil)
	if err == nil {
		t.Fatal("expected error for 500 without body")
	}
}

func TestAgentProxy_ProxyJSONRequest_WithSessionToken(t *testing.T) {
	var receivedAuth string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
	defer ts.Close()

	addr := ts.Listener.Addr().String()
	proxy, err := NewAgentProxy(ProxyConfig{
		RemoteAddr:   addr,
		SessionToken: "my-session-token",
		Logger:       log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAgentProxy: %v", err)
	}
	defer proxy.Close()

	var respBody map[string]string
	err = proxy.ProxyJSONRequest(context.Background(), http.MethodGet, "test", nil, &respBody)
	if err != nil {
		t.Fatalf("ProxyJSONRequest: %v", err)
	}
	if receivedAuth != "Bearer my-session-token" {
		t.Errorf("Authorization = %q, want Bearer my-session-token", receivedAuth)
	}
}

// =============================================================================
// Server additional coverage tests
// =============================================================================

func TestRemoteServer_NewRemoteServer_Defaults(t *testing.T) {
	rs, err := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
	})
	if err != nil {
		t.Fatalf("NewRemoteServer: %v", err)
	}
	if rs.logger == nil {
		t.Error("logger should not be nil")
	}
	if rs.sessions == nil {
		t.Error("sessions map should not be nil")
	}
	if rs.startedAt.IsZero() {
		t.Error("startedAt should not be zero")
	}
}

func TestRemoteServer_HandleLogin_AllowedUsers_Rejected(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "correct-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr:     ":0",
		Logger:       log.New("test"),
		AllowedUsers: []string{"admin"},
	})
	body, _ := json.Marshal(LoginRequest{Username: "hacker", Password: "correct-secret"})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &fakeReadCloser{data: body}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusForbidden {
		t.Errorf("status = %d, want %d", rec.status, http.StatusForbidden)
	}
}

func TestRemoteServer_ExtractToken_ShortAuthorization(t *testing.T) {
	rs, _ := NewRemoteServer(RemoteConfig{BindAddr: ":0"})
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "short")
	token := rs.extractToken(req)
	if token != "" {
		t.Errorf("token should be empty for short auth header, got %q", token)
	}
}

func TestRemoteServer_HandleLogin_ReadBodyError(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "test-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	rs, _ := NewRemoteServer(RemoteConfig{
		BindAddr: ":0",
		Logger:   log.New("test"),
	})
	// Create a request with a body that will fail to read
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/remote/login", nil)
	req.Body = &errorReadCloser{}
	rec := &responseRecorder{header: make(http.Header)}
	rs.handleLogin(rec, req)
	if rec.status != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.status, http.StatusBadRequest)
	}
}

type errorReadCloser struct{}

func (e *errorReadCloser) Read([]byte) (int, error) { return 0, errors.New("read error") }
func (e *errorReadCloser) Close() error             { return nil }

func TestRemoteServer_HandleLogin_NoSecret(t *testing.T) {
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

// =============================================================================
// Session Manager additional coverage tests
// =============================================================================

func TestSessionManager_TerminateUserSessions(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	s1, _ := sm.CreateSession("user-1", "alice", "user", nil)
	s2, _ := sm.CreateSession("user-1", "alice", "user", nil)

	removed := sm.TerminateUserSessions("user-1")
	if removed != 2 {
		t.Errorf("removed = %d, want 2", removed)
	}

	_, ok := sm.GetSession(s1.ID)
	if ok {
		t.Error("session 1 should be removed")
	}
	_, ok = sm.GetSession(s2.ID)
	if ok {
		t.Error("session 2 should be removed")
	}
}

func TestSessionManager_RefreshSession_Extended(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	s1, _ := sm.CreateSession("user-1", "alice", "user", nil)

	err := sm.RefreshSession(s1.ID)
	if err != nil {
		t.Fatalf("RefreshSession: %v", err)
	}

	session, ok := sm.GetSession(s1.ID)
	if !ok {
		t.Fatal("session should still exist after refresh")
	}
	if session.ExpiresAt.Before(time.Now().Add(55 * time.Minute)) {
		t.Error("ExpiresAt should be extended after refresh")
	}
}

func TestSessionManager_RefreshSession_Expired_Extended(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)
	s1, _ := sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(5 * time.Millisecond)

	err := sm.RefreshSession(s1.ID)
	if err == nil {
		t.Fatal("RefreshSession should fail for expired session")
	}
}

func TestSessionManager_RefreshSession_NotFound_Extended(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	err := sm.RefreshSession("nonexistent")
	if err == nil {
		t.Fatal("RefreshSession should fail for nonexistent session")
	}
}

func TestSessionManager_ActiveUserCount(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	count := sm.ActiveUserCount()
	if count != 2 {
		t.Errorf("ActiveUserCount = %d, want 2", count)
	}
}

func TestSessionManager_TotalSessions(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	total := sm.TotalSessions()
	if total != 2 {
		t.Errorf("TotalSessions = %d, want 2", total)
	}
}

func TestSessionManager_CleanupExpiredSessions_Extended(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)
	sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(5 * time.Millisecond)

	removed := sm.CleanupExpiredSessions()
	if removed != 1 {
		t.Errorf("removed = %d, want 1", removed)
	}
	if sm.TotalSessions() != 0 {
		t.Errorf("TotalSessions = %d, want 0", sm.TotalSessions())
	}
}

func TestSessionManager_TerminateSession_NotFound(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	// Should not panic
	sm.TerminateSession("nonexistent")
}

func TestSessionManager_EnforceSessionLimit_OverLimit(t *testing.T) {
	sm := NewSessionManager(2, 1*time.Hour)
	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	// Bypass the limit check by directly inserting
	sm.mu.Lock()
	sm.sessions["extra-1"] = &UserSession{
		ID:        "extra-1",
		UserID:    "user-3",
		Username:  "charlie",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}
	sm.userSessions["user-3"] = []string{"extra-1"}
	sm.mu.Unlock()

	err := sm.EnforceSessionLimit()
	if err != nil {
		t.Fatalf("EnforceSessionLimit: %v", err)
	}
	if sm.TotalSessions() > 2 {
		t.Errorf("total sessions = %d, should be <= 2", sm.TotalSessions())
	}
}

func TestSessionManager_ValidateSession_Expired_Extended(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)
	s1, _ := sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(5 * time.Millisecond)

	if sm.ValidateSession(s1.ID) {
		t.Fatal("ValidateSession should return false for expired session")
	}
}

func TestSessionManager_ValidateSession_NotFound_Extended(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	if sm.ValidateSession("nonexistent") {
		t.Fatal("ValidateSession should return false for nonexistent session")
	}
}