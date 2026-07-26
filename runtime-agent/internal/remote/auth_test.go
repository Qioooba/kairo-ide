package remote

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// generateTestCerts generates a self-signed TLS certificate and key for testing.
func generateTestCerts(dir string) (certFile, keyFile string, err error) {
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

// TestNewAuthenticator tests authenticator creation.
func TestNewAuthenticator(t *testing.T) {
	auth, err := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewAuthenticator: %v", err)
	}
	if auth == nil {
		t.Fatal("authenticator should not be nil")
	}
	if auth.sessions == nil {
		t.Error("sessions map should not be nil")
	}
	if auth.SessionCount() != 0 {
		t.Errorf("session count = %d, want 0", auth.SessionCount())
	}
}

// TestNewAuthenticator_DefaultLogger tests default logger.
func TestNewAuthenticator_DefaultLogger(t *testing.T) {
	auth, err := NewAuthenticator(AuthConfig{})
	if err != nil {
		t.Fatalf("NewAuthenticator: %v", err)
	}
	if auth.logger == nil {
		t.Error("logger should not be nil")
	}
}

// TestNewAuthenticator_WithAuditLog tests authenticator with audit log.
func TestNewAuthenticator_WithAuditLog(t *testing.T) {
	dir := t.TempDir()
	auditPath := filepath.Join(dir, "audit.log")

	auth, err := NewAuthenticator(AuthConfig{
		Logger:   log.New("test"),
		AuditLog: auditPath,
	})
	if err != nil {
		t.Fatalf("NewAuthenticator: %v", err)
	}
	defer auth.Close()

	if auth.auditLog == nil {
		t.Error("audit log should not be nil")
	}

	// Verify audit log file was created
	if _, err := os.Stat(auditPath); os.IsNotExist(err) {
		t.Error("audit log file was not created")
	}
}

// TestAuthenticatePassword_Success tests successful password authentication.
func TestAuthenticatePassword_Success(t *testing.T) {
	os.Setenv("KAIRO_REMOTE_SECRET", "test-secret")
	defer os.Unsetenv("KAIRO_REMOTE_SECRET")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "test-secret",
	})

	session, err := auth.AuthenticatePassword("admin", "test-secret", "127.0.0.1", "")
	if err != nil {
		t.Fatalf("AuthenticatePassword: %v", err)
	}
	if session == nil {
		t.Fatal("session should not be nil")
	}
	if session.Username != "admin" {
		t.Errorf("username = %q, want admin", session.Username)
	}
	if session.Token == "" {
		t.Error("token should not be empty")
	}
	if len(session.Token) != 64 { // 32 bytes → 64 hex
		t.Errorf("token length = %d, want 64", len(session.Token))
	}
}

// TestAuthenticatePassword_EmptyCredentials tests empty credentials.
func TestAuthenticatePassword_EmptyCredentials(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})

	_, err := auth.AuthenticatePassword("", "", "", "")
	if err == nil {
		t.Fatal("expected error for empty credentials")
	}
}

// TestAuthenticatePassword_WrongPassword tests wrong password.
func TestAuthenticatePassword_WrongPassword(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "correct",
	})

	_, err := auth.AuthenticatePassword("admin", "wrong", "127.0.0.1", "")
	if err == nil {
		t.Fatal("expected error for wrong password")
	}
}

// TestAuthenticatePassword_NoSecret tests no secret configured.
func TestAuthenticatePassword_NoSecret(t *testing.T) {
	os.Unsetenv("KAIRO_REMOTE_SECRET")
	os.Unsetenv("KAIRO_SECRET")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})

	_, err := auth.AuthenticatePassword("admin", "secret", "127.0.0.1", "")
	if err == nil {
		t.Fatal("expected error when no secret is configured")
	}
}

// TestAuthenticatePassword_SecretFallback tests KAIRO_SECRET env fallback.
func TestAuthenticatePassword_SecretFallback(t *testing.T) {
	os.Unsetenv("KAIRO_REMOTE_SECRET")
	os.Setenv("KAIRO_SECRET", "fallback-secret")
	defer os.Unsetenv("KAIRO_SECRET")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})

	session, err := auth.AuthenticatePassword("admin", "fallback-secret", "127.0.0.1", "")
	if err != nil {
		t.Fatalf("AuthenticatePassword: %v", err)
	}
	if session == nil {
		t.Fatal("session should not be nil")
	}
}

// TestAuthenticateToken_Valid tests valid token authentication.
func TestAuthenticateToken_Valid(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		TokenTTL:    1 * time.Hour,
	})

	session, _ := auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	validated, err := auth.AuthenticateToken(session.Token)
	if err != nil {
		t.Fatalf("AuthenticateToken: %v", err)
	}
	if validated.Username != "user" {
		t.Errorf("username = %q, want user", validated.Username)
	}
}

// TestAuthenticateToken_Invalid tests invalid token.
func TestAuthenticateToken_Invalid(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})

	_, err := auth.AuthenticateToken("invalid-token")
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
}

// TestAuthenticateToken_Expired tests expired token.
func TestAuthenticateToken_Expired(t *testing.T) {
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

// TestInvalidateSession tests session invalidation.
func TestInvalidateSession(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})

	session, _ := auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	auth.InvalidateSession(session.Token)

	_, err := auth.AuthenticateToken(session.Token)
	if err == nil {
		t.Fatal("expected error for invalidated token")
	}
}

// TestInvalidateSession_Unknown tests invalidating unknown token.
func TestInvalidateSession_Unknown(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})

	// Should not panic
	auth.InvalidateSession("unknown-token")
}

// TestCleanupExpiredSessions tests session cleanup.
func TestCleanupExpiredSessions(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		TokenTTL:    1 * time.Millisecond,
	})

	auth.AuthenticatePassword("user1", "secret", "127.0.0.1", "")
	time.Sleep(5 * time.Millisecond)

	auth.AuthenticatePassword("user2", "secret", "127.0.0.1", "")

	removed := auth.CleanupExpiredSessions()
	if removed < 1 {
		t.Errorf("removed = %d, want at least 1", removed)
	}
}

// TestSessionCount tests active session counting.
func TestSessionCount_Authenticator(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})

	if auth.SessionCount() != 0 {
		t.Errorf("initial count = %d, want 0", auth.SessionCount())
	}

	auth.AuthenticatePassword("user1", "secret", "127.0.0.1", "")
	if auth.SessionCount() != 1 {
		t.Errorf("count after 1 login = %d, want 1", auth.SessionCount())
	}

	auth.AuthenticatePassword("user2", "secret", "127.0.0.1", "")
	if auth.SessionCount() != 2 {
		t.Errorf("count after 2 logins = %d, want 2", auth.SessionCount())
	}
}

// TestMaxSessions tests maximum session limit.
func TestMaxSessions(t *testing.T) {
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

// TestBuildTLSConfig tests TLS configuration building.
func TestBuildTLSConfig(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile, err := generateTestCerts(dir)
	if err != nil {
		t.Fatalf("generateTestCerts: %v", err)
	}

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:   log.New("test"),
		CertFile: certFile,
		KeyFile: keyFile,
	})

	tlsCfg, err := auth.BuildTLSConfig()
	if err != nil {
		t.Fatalf("BuildTLSConfig: %v", err)
	}
	if tlsCfg == nil {
		t.Fatal("TLS config should not be nil")
	}
	if len(tlsCfg.Certificates) != 1 {
		t.Errorf("certificates = %d, want 1", len(tlsCfg.Certificates))
	}
}

// TestBuildTLSConfig_MissingCert tests missing certificate.
func TestBuildTLSConfig_MissingCert(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})

	_, err := auth.BuildTLSConfig()
	if err == nil {
		t.Fatal("expected error for missing certificate")
	}
}

// TestBuildTLSConfig_WithMTLS tests mTLS configuration.
func TestBuildTLSConfig_WithMTLS(t *testing.T) {
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
		CACertFile:  certFile, // Use server cert as CA for testing
	})

	tlsCfg, err := auth.BuildTLSConfig()
	if err != nil {
		t.Fatalf("BuildTLSConfig: %v", err)
	}
	if tlsCfg.ClientCAs == nil {
		t.Error("ClientCAs should not be nil with mTLS enabled")
	}
}

// TestBuildTLSConfig_InvalidCert tests invalid certificate.
func TestBuildTLSConfig_InvalidCert(t *testing.T) {
	dir := t.TempDir()
	certFile := filepath.Join(dir, "bad.crt")
	keyFile := filepath.Join(dir, "bad.key")
	os.WriteFile(certFile, []byte("not a cert"), 0o644)
	os.WriteFile(keyFile, []byte("not a key"), 0o644)

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:   log.New("test"),
		CertFile: certFile,
		KeyFile: keyFile,
	})

	_, err := auth.BuildTLSConfig()
	if err == nil {
		t.Fatal("expected error for invalid certificate")
	}
}

// TestGetSession tests session retrieval.
func TestGetSession(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
	})

	session, _ := auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	retrieved := auth.GetSession(session.Token)
	if retrieved == nil {
		t.Fatal("should retrieve session")
	}
	if retrieved.Username != "user" {
		t.Errorf("username = %q, want user", retrieved.Username)
	}
}

// TestGetSession_Unknown tests unknown session retrieval.
func TestGetSession_Unknown(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger: log.New("test"),
	})

	retrieved := auth.GetSession("unknown-token")
	if retrieved != nil {
		t.Error("should return nil for unknown token")
	}
}

// TestStartSessionCleanup tests background session cleanup.
func TestStartSessionCleanup(t *testing.T) {
	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		TokenTTL:    1 * time.Millisecond,
	})

	auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	time.Sleep(5 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	auth.StartSessionCleanup(ctx, 50*time.Millisecond)
	time.Sleep(200 * time.Millisecond)

	// Session should have been cleaned up
	if auth.SessionCount() != 0 {
		t.Errorf("sessions = %d, want 0 after cleanup", auth.SessionCount())
	}
}

// TestAuthSession_Fields tests AuthSession struct fields.
func TestAuthSession_Fields(t *testing.T) {
	session := &AuthSession{
		Token:      "test-token",
		Username:   "testuser",
		Role:       "admin",
		RemoteAddr: "192.168.1.1",
		CreatedAt:  time.Now(),
		ExpiresAt:  time.Now().Add(1 * time.Hour),
		LastSeen:   time.Now(),
		UserAgent:  "Kairo-IDE/1.0",
	}

	if session.Username != "testuser" {
		t.Errorf("Username = %q, want testuser", session.Username)
	}
	if session.Role != "admin" {
		t.Errorf("Role = %q, want admin", session.Role)
	}
	if session.RemoteAddr != "192.168.1.1" {
		t.Errorf("RemoteAddr = %q, want 192.168.1.1", session.RemoteAddr)
	}
}

// TestAuditOperation tests audit operation recording.
func TestAuditOperation(t *testing.T) {
	dir := t.TempDir()
	auditPath := filepath.Join(dir, "audit.log")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:   log.New("test"),
		AuditLog: auditPath,
	})
	defer auth.Close()

	auth.AuditOperation(context.Background(), "testuser", "file_read", "/etc/hosts", "denied", map[string]any{
		"reason": "permission_denied",
	})

	// Verify audit log has content
	data, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatalf("read audit log: %v", err)
	}
	if len(data) == 0 {
		t.Error("audit log should not be empty")
	}
}

// TestAuthenticatePassword_WithAuditLog_TriggersAuditEvent tests that
// AuthenticatePassword writes to the audit log when configured.
func TestAuthenticatePassword_WithAuditLog_TriggersAuditEvent(t *testing.T) {
	dir := t.TempDir()
	auditPath := filepath.Join(dir, "audit.log")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "test-secret",
		AuditLog:    auditPath,
	})
	defer auth.Close()

	// Successful login should trigger auditEvent
	_, err := auth.AuthenticatePassword("admin", "test-secret", "127.0.0.1", "")
	if err != nil {
		t.Fatalf("AuthenticatePassword: %v", err)
	}

	// Verify audit log has content
	data, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatalf("read audit log: %v", err)
	}
	if len(data) == 0 {
		t.Error("audit log should not be empty after login")
	}
}

// TestCleanupExpiredSessions_WithAuditLog tests CleanupExpiredSessions with audit log.
func TestCleanupExpiredSessions_WithAuditLog(t *testing.T) {
	dir := t.TempDir()
	auditPath := filepath.Join(dir, "audit.log")

	auth, _ := NewAuthenticator(AuthConfig{
		Logger:      log.New("test"),
		TokenSecret: "secret",
		TokenTTL:    1 * time.Millisecond,
		AuditLog:    auditPath,
	})
	defer auth.Close()

	// Create a session that will expire
	session, _ := auth.AuthenticatePassword("user", "secret", "127.0.0.1", "")
	time.Sleep(5 * time.Millisecond)

	// Invalidate the session, which triggers auditEvent
	auth.InvalidateSession(session.Token)

	// Verify audit log has content
	data, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatalf("read audit log: %v", err)
	}
	if len(data) == 0 {
		t.Error("audit log should not be empty after invalidation")
	}
}

// TestDefaultAuthConfig tests default configuration.
func TestDefaultAuthConfig(t *testing.T) {
	cfg := DefaultAuthConfig()
	if cfg.TokenTTL != 8*time.Hour {
		t.Errorf("TokenTTL = %v, want 8h", cfg.TokenTTL)
	}
	if cfg.MaxSessions != 100 {
		t.Errorf("MaxSessions = %d, want 100", cfg.MaxSessions)
	}
}