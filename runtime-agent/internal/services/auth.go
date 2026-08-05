package services

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

const (
	sessionTTL          = 8 * time.Hour
	authSessionHeader   = "X-Kairo-Session"
	authBearerPrefix    = "Bearer "
)

// authSession is an in-memory login session issued by diskAuthenticator.
type authSession struct {
	Username  string
	ExpiresAt time.Time
}

// ----------------- Authenticator (disk) -----------------

type diskAuthenticator struct {
	mu       sync.Mutex
	dir      string
	logger   *log.Logger
	sessions map[string]*authSession // token → session
}

func newDiskAuthenticator(dataDir string, logger *log.Logger) *diskAuthenticator {
	dir := filepath.Join(dataDir, "auth")
	_ = os.MkdirAll(dir, 0o755)
	return &diskAuthenticator{
		dir:      dir,
		logger:   logger,
		sessions: make(map[string]*authSession),
	}
}

// localSecret returns the shared local auth secret. Prefer
// KAIRO_LOCAL_SECRET (canonical, matches config/desktop host);
// fall back to KAIRO_SECRET for older env configs.
func localSecret() string {
	if v := os.Getenv("KAIRO_LOCAL_SECRET"); v != "" {
		return v
	}
	return os.Getenv("KAIRO_SECRET")
}

func (a *diskAuthenticator) Login(payload json.RawMessage, w http.ResponseWriter) (json.RawMessage, error) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Username == "" || req.Password == "" {
		return nil, errors.New("username and password required")
	}

	authUser := os.Getenv("KAIRO_AUTH_USER")
	authPassHash := os.Getenv("KAIRO_AUTH_PASSWORD") // SHA256 hex hash
	sharedSecret := localSecret()

	switch {
	case authUser != "":
		if authPassHash == "" {
			return nil, errors.New("authentication not configured: KAIRO_AUTH_PASSWORD required when KAIRO_AUTH_USER is set")
		}
		if req.Username != authUser {
			return nil, fmt.Errorf("invalid credentials")
		}
		hash := sha256.Sum256([]byte(req.Password))
		actualHash := hex.EncodeToString(hash[:])
		if subtle.ConstantTimeCompare([]byte(actualHash), []byte(authPassHash)) != 1 {
			return nil, fmt.Errorf("invalid credentials")
		}
	case sharedSecret != "":
		if subtle.ConstantTimeCompare([]byte(req.Password), []byte(sharedSecret)) != 1 {
			return nil, fmt.Errorf("invalid credentials")
		}
	default:
		return nil, errors.New("authentication not configured: set KAIRO_AUTH_USER/KAIRO_AUTH_PASSWORD or KAIRO_LOCAL_SECRET")
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("generate session token: %w", err)
	}
	csrf := make([]byte, 16)
	if _, err := rand.Read(csrf); err != nil {
		return nil, fmt.Errorf("generate csrf token: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)
	expiresAt := time.Now().Add(sessionTTL)

	a.mu.Lock()
	a.sessions[token] = &authSession{Username: req.Username, ExpiresAt: expiresAt}
	a.mu.Unlock()

	return json.Marshal(map[string]any{
		"sessionToken": token,
		"csrfToken":    hex.EncodeToString(csrf),
		"user": map[string]any{
			"id":       "u_" + req.Username,
			"username": req.Username,
			"role":     "user",
		},
		"expiresAt": expiresAt.UTC().Format(time.RFC3339),
	})
}

// ValidateSession reports whether token is a known, non-expired session.
func (a *diskAuthenticator) ValidateSession(token string) error {
	if token == "" {
		return errors.New("session token required")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	sess, ok := a.sessions[token]
	if !ok {
		return errors.New("invalid session")
	}
	if time.Now().After(sess.ExpiresAt) {
		delete(a.sessions, token)
		return errors.New("session expired")
	}
	return nil
}

func (a *diskAuthenticator) Logout(r *http.Request, w http.ResponseWriter) error {
	token := extractSessionToken(r)
	if token == "" {
		return nil
	}
	a.mu.Lock()
	delete(a.sessions, token)
	a.mu.Unlock()
	return nil
}

func extractSessionToken(r *http.Request) string {
	if r == nil {
		return ""
	}
	if t := strings.TrimSpace(r.Header.Get(authSessionHeader)); t != "" {
		return t
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, authBearerPrefix) {
		return strings.TrimSpace(strings.TrimPrefix(auth, authBearerPrefix))
	}
	return ""
}
