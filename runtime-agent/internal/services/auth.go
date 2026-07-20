package services

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// ----------------- Authenticator (disk) -----------------

type diskAuthenticator struct {
	mu     sync.Mutex
	dir    string
	logger *log.Logger
}

func newDiskAuthenticator(dataDir string, logger *log.Logger) *diskAuthenticator {
	dir := filepath.Join(dataDir, "auth")
	_ = os.MkdirAll(dir, 0o755)
	return &diskAuthenticator{dir: dir, logger: logger}
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

	// 从环境变量读取凭证配置
	authUser := os.Getenv("KAIRO_AUTH_USER")
	authPassHash := os.Getenv("KAIRO_AUTH_PASSWORD") // SHA256 hex hash
	sharedSecret := os.Getenv("KAIRO_SECRET")

	if authUser != "" {
		// 配置了用户名+密码哈希验证
		if req.Username != authUser {
			return nil, fmt.Errorf("invalid credentials")
		}
		expectedHash := authPassHash
		if expectedHash == "" {
			// 未配置密码哈希，允许任意密码
			a.logger.Warn("KAIRO_AUTH_USER set but KAIRO_AUTH_PASSWORD not set, accepting any password")
		} else {
			hash := sha256.Sum256([]byte(req.Password))
			actualHash := hex.EncodeToString(hash[:])
			if actualHash != expectedHash {
				return nil, fmt.Errorf("invalid credentials")
			}
		}
	} else if sharedSecret != "" {
		// 配置了 shared secret
		if req.Password != sharedSecret {
			return nil, fmt.Errorf("invalid credentials")
		}
	} else {
		// 开发模式：未配置任何凭证，允许任意登录但打印警告
		a.logger.Warn("no auth credentials configured (set KAIRO_AUTH_USER/KAIRO_AUTH_PASSWORD or KAIRO_SECRET), accepting any login")
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("generate session token: %w", err)
	}
	csrf := make([]byte, 16)
	if _, err := rand.Read(csrf); err != nil {
		return nil, fmt.Errorf("generate csrf token: %w", err)
	}
	return json.Marshal(map[string]any{
		"sessionToken": hex.EncodeToString(tokenBytes),
		"csrfToken":    hex.EncodeToString(csrf),
		"user": map[string]any{
			"id":       "u_" + req.Username,
			"username": req.Username,
			"role":     "user",
		},
		"expiresAt": time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
	})
}

func (a *diskAuthenticator) Logout(r *http.Request, w http.ResponseWriter) error {
	return nil
}