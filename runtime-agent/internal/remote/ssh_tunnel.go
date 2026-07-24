// Package remote implements SSH tunnel connections for Phase 3+
// remote Linux agent functionality.
//
// Provides:
//   - SSH key-based and password authentication
//   - Local→remote port forwarding
//   - Connection keepalive
//   - Auto-reconnect with exponential backoff
//   - Connection status monitoring
package remote

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// SSHConnectionState represents the current state of an SSH tunnel.
type SSHConnectionState int32

const (
	SSHStateDisconnected SSHConnectionState = iota
	SSHStateConnecting
	SSHStateConnected
	SSHStateReconnecting
	SSHStateError
)

func (s SSHConnectionState) String() string {
	switch s {
	case SSHStateDisconnected:
		return "disconnected"
	case SSHStateConnecting:
		return "connecting"
	case SSHStateConnected:
		return "connected"
	case SSHStateReconnecting:
		return "reconnecting"
	case SSHStateError:
		return "error"
	default:
		return "unknown"
	}
}

// SSHAuthMethod represents an SSH authentication method.
type SSHAuthMethod int

const (
	SSHAuthPassword SSHAuthMethod = iota
	SSHAuthKeyFile
	SSHAuthKeyData
)

// SSHConfig holds the configuration for an SSH tunnel connection.
type SSHConfig struct {
	// Host is the remote SSH server address.
	Host string
	// Port is the SSH server port (default 22).
	Port int
	// User is the SSH username.
	User string
	// AuthMethod is the authentication method to use.
	AuthMethod SSHAuthMethod
	// Password is used when AuthMethod is SSHAuthPassword.
	Password string
	// KeyFile is the path to the private key file (SSHAuthKeyFile).
	KeyFile string
	// KeyData is the raw private key data (SSHAuthKeyData).
	KeyData []byte
	// KeyPassphrase is the passphrase for the private key (optional).
	KeyPassphrase string
	// KnownHostsFile is the path to a known_hosts file for host key verification.
	// If empty, host key verification is skipped (development only).
	KnownHostsFile string
	// LocalPort is the local port to forward to the remote agent port.
	LocalPort int
	// RemotePort is the remote agent port to forward to.
	RemotePort int
	// RemoteHost is the remote host to forward to (default "localhost").
	RemoteHost string
	// KeepAliveInterval is the interval for sending keepalive messages.
	KeepAliveInterval time.Duration
	// KeepAliveTimeout is the timeout for keepalive responses.
	KeepAliveTimeout time.Duration
	// MaxReconnectRetries is the maximum number of reconnection attempts.
	// 0 = unlimited, -1 = no reconnection.
	MaxReconnectRetries int
	// ReconnectBaseDelay is the base delay for exponential backoff.
	ReconnectBaseDelay time.Duration
	// ReconnectMaxDelay is the maximum delay between reconnection attempts.
	ReconnectMaxDelay time.Duration
	// Logger is the structured logger.
	Logger *log.Logger
}

// DefaultSSHConfig returns a default SSH configuration.
func DefaultSSHConfig() SSHConfig {
	return SSHConfig{
		Port:               22,
		RemotePort:         9443,
		RemoteHost:         "localhost",
		KeepAliveInterval:  30 * time.Second,
		KeepAliveTimeout:   10 * time.Second,
		MaxReconnectRetries: 5,
		ReconnectBaseDelay: 1 * time.Second,
		ReconnectMaxDelay:  30 * time.Second,
	}
}

// ConnectionStatus represents the current status of the SSH tunnel.
type ConnectionStatus struct {
	State            SSHConnectionState
	Host             string
	Port             int
	LocalPort        int
	ConnectedAt      time.Time
	ReconnectAttempt int
	LastError        string
	BytesSent        int64
	BytesReceived    int64
}

// SSHTunnel manages an SSH tunnel connection with port forwarding.
type SSHTunnel struct {
	mu         sync.RWMutex
	cfg        SSHConfig
	logger     *log.Logger
	client     *ssh.Client
	listener   net.Listener
	ctx        context.Context
	cancel     context.CancelFunc
	state      int32 // atomic access via SSHConnectionState
	connectedAt time.Time
	reconnectAttempt int
	lastError  string
	bytesSent  int64
	bytesRecv  int64
	onStatusChange func(ConnectionStatus)
}

// NewSSHTunnel creates a new SSH tunnel.
func NewSSHTunnel(cfg SSHConfig) (*SSHTunnel, error) {
	if cfg.Host == "" {
		return nil, fmt.Errorf("ssh_tunnel: host is required")
	}
	if cfg.User == "" {
		return nil, fmt.Errorf("ssh_tunnel: user is required")
	}
	if cfg.Port <= 0 {
		cfg.Port = 22
	}
	if cfg.RemotePort <= 0 {
		cfg.RemotePort = 9443
	}
	if cfg.RemoteHost == "" {
		cfg.RemoteHost = "localhost"
	}
	if cfg.KeepAliveInterval <= 0 {
		cfg.KeepAliveInterval = 30 * time.Second
	}
	if cfg.KeepAliveTimeout <= 0 {
		cfg.KeepAliveTimeout = 10 * time.Second
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New("ssh_tunnel")
	}

	return &SSHTunnel{
		cfg:    cfg,
		logger: cfg.Logger,
	}, nil
}

// OnStatusChange registers a callback for connection status changes.
func (t *SSHTunnel) OnStatusChange(fn func(ConnectionStatus)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.onStatusChange = fn
}

// Connect establishes the SSH connection and starts port forwarding.
func (t *SSHTunnel) Connect(ctx context.Context) error {
	t.ctx, t.cancel = context.WithCancel(ctx)
	t.setState(SSHStateConnecting)

	addr := fmt.Sprintf("%s:%d", t.cfg.Host, t.cfg.Port)
	t.logger.Info("connecting to SSH", log.Fields{
		"host": t.cfg.Host,
		"port": t.cfg.Port,
		"user": t.cfg.User,
	})

	authMethods, err := t.buildAuthMethods()
	if err != nil {
		t.setError(fmt.Errorf("ssh_tunnel: build auth: %w", err))
		return err
	}

	hostKeyCallback, err := t.buildHostKeyCallback()
	if err != nil {
		t.setError(fmt.Errorf("ssh_tunnel: host key callback: %w", err))
		return err
	}

	clientConfig := &ssh.ClientConfig{
		User:            t.cfg.User,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         30 * time.Second,
	}

	client, err := ssh.Dial("tcp", addr, clientConfig)
	if err != nil {
		t.setError(fmt.Errorf("ssh_tunnel: dial: %w", err))
		return err
	}
	t.client = client

	// Start port forwarding
	if err := t.startPortForwarding(); err != nil {
		client.Close()
		t.client = nil
		t.setError(fmt.Errorf("ssh_tunnel: port forward: %w", err))
		return err
	}

	t.connectedAt = time.Now()
	t.reconnectAttempt = 0
	t.setState(SSHStateConnected)

	t.logger.Info("SSH tunnel connected", log.Fields{
		"host":       t.cfg.Host,
		"local_port": t.cfg.LocalPort,
		"remote_port": t.cfg.RemotePort,
	})

	// Start keepalive
	go t.keepaliveLoop()

	// Wait for context cancellation or connection error
	go t.waitForDisconnect()

	return nil
}

// buildAuthMethods constructs SSH authentication methods from config.
func (t *SSHTunnel) buildAuthMethods() ([]ssh.AuthMethod, error) {
	switch t.cfg.AuthMethod {
	case SSHAuthPassword:
		if t.cfg.Password == "" {
			return nil, fmt.Errorf("ssh_tunnel: password is empty")
		}
		return []ssh.AuthMethod{ssh.Password(t.cfg.Password)}, nil
	case SSHAuthKeyFile:
		if t.cfg.KeyFile == "" {
			return nil, fmt.Errorf("ssh_tunnel: key file path is empty")
		}
		key, err := os.ReadFile(t.cfg.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("read key file: %w", err)
		}
		return t.parseKeyAuth(key)
	case SSHAuthKeyData:
		if len(t.cfg.KeyData) == 0 {
			return nil, fmt.Errorf("ssh_tunnel: key data is empty")
		}
		return t.parseKeyAuth(t.cfg.KeyData)
	default:
		if t.cfg.Password != "" {
			return []ssh.AuthMethod{ssh.Password(t.cfg.Password)}, nil
		}
		if t.cfg.KeyFile != "" {
			key, err := os.ReadFile(t.cfg.KeyFile)
			if err != nil {
				return nil, fmt.Errorf("read key file: %w", err)
			}
			return t.parseKeyAuth(key)
		}
		return nil, fmt.Errorf("ssh_tunnel: no authentication method configured")
	}
}

// parseKeyAuth parses a private key for SSH authentication.
func (t *SSHTunnel) parseKeyAuth(keyData []byte) ([]ssh.AuthMethod, error) {
	var signer ssh.Signer
	var err error

	if t.cfg.KeyPassphrase != "" {
		signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(t.cfg.KeyPassphrase))
	} else {
		signer, err = ssh.ParsePrivateKey(keyData)
	}
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
}

// buildHostKeyCallback returns a host key callback function.
// If KnownHostsFile is configured, it validates against the known_hosts file.
// Otherwise, it falls back to insecure mode (development only) with a warning.
func (t *SSHTunnel) buildHostKeyCallback() (ssh.HostKeyCallback, error) {
	if t.cfg.KnownHostsFile != "" {
		cb, err := knownhosts.New(t.cfg.KnownHostsFile)
		if err != nil {
			return nil, fmt.Errorf("ssh_tunnel: known_hosts file %s: %w", t.cfg.KnownHostsFile, err)
		}
		return cb, nil
	}

	// No KnownHostsFile configured — verify host key against the system
	// known_hosts file (~/.ssh/known_hosts) as a safe default. If that
	// also fails, fall back to insecure mode with a warning (acceptable
	// only for development environments where the user explicitly opts
	// in by not providing a known_hosts file).
	homeDir, err := os.UserHomeDir()
	if err == nil {
		systemKnownHosts := filepath.Join(homeDir, ".ssh", "known_hosts")
		if _, statErr := os.Stat(systemKnownHosts); statErr == nil {
			cb, khErr := knownhosts.New(systemKnownHosts)
			if khErr == nil {
				return cb, nil
			}
		}
	}
	t.logger.Warn("no KnownHostsFile configured; host key verification is disabled (INSECURE for production)", log.Fields{})
	return ssh.InsecureIgnoreHostKey(), nil
}

// startPortForwarding starts local port forwarding to the remote agent.
func (t *SSHTunnel) startPortForwarding() error {
	localAddr := fmt.Sprintf("127.0.0.1:%d", t.cfg.LocalPort)
	listener, err := net.Listen("tcp", localAddr)
	if err != nil {
		return fmt.Errorf("listen local: %w", err)
	}
	t.listener = listener

	remoteAddr := fmt.Sprintf("%s:%d", t.cfg.RemoteHost, t.cfg.RemotePort)

	go func() {
		for {
			localConn, err := listener.Accept()
			if err != nil {
				select {
				case <-t.ctx.Done():
					return
				default:
				}
				t.logger.Warn("port forward accept error", log.Fields{"error": err.Error()})
				return
			}

			go t.forwardConnection(localConn, remoteAddr)
		}
	}()

	return nil
}

// forwardConnection forwards a single connection through the SSH tunnel.
func (t *SSHTunnel) forwardConnection(localConn net.Conn, remoteAddr string) {
	defer localConn.Close()

	remoteConn, err := t.client.Dial("tcp", remoteAddr)
	if err != nil {
		t.logger.Warn("ssh dial remote failed", log.Fields{
			"remote": remoteAddr,
			"error":  err.Error(),
		})
		return
	}
	defer remoteConn.Close()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		n, _ := io.Copy(remoteConn, localConn)
		atomic.AddInt64(&t.bytesSent, n)
	}()

	go func() {
		defer wg.Done()
		n, _ := io.Copy(localConn, remoteConn)
		atomic.AddInt64(&t.bytesRecv, n)
	}()

	wg.Wait()
}

// keepaliveLoop sends periodic keepalive requests to keep the connection alive.
func (t *SSHTunnel) keepaliveLoop() {
	ticker := time.NewTicker(t.cfg.KeepAliveInterval)
	defer ticker.Stop()

	for {
		select {
		case <-t.ctx.Done():
			return
		case <-ticker.C:
			t.mu.RLock()
			client := t.client
			t.mu.RUnlock()

			if client == nil {
				return
			}

			_, _, err := client.SendRequest("keepalive@kairo", true, nil)
			if err != nil {
				t.logger.Warn("keepalive failed", log.Fields{"error": err.Error()})
				// Connection may be dead, trigger reconnect
				t.handleDisconnect()
				return
			}
		}
	}
}

// waitForDisconnect monitors the SSH connection and handles disconnection.
func (t *SSHTunnel) waitForDisconnect() {
	t.mu.RLock()
	client := t.client
	t.mu.RUnlock()

	if client == nil {
		return
	}

	// Wait for the client to disconnect
	err := client.Wait()
	if err != nil {
		t.logger.Warn("ssh client disconnected", log.Fields{"error": err.Error()})
	}
	t.handleDisconnect()
}

// handleDisconnect handles an SSH connection disconnect and attempts reconnection.
func (t *SSHTunnel) handleDisconnect() {
	t.mu.Lock()
	if t.client != nil {
		t.client.Close()
		t.client = nil
	}
	if t.listener != nil {
		t.listener.Close()
		t.listener = nil
	}
	t.mu.Unlock()

	if t.cfg.MaxReconnectRetries < 0 {
		t.setState(SSHStateDisconnected)
		return
	}

	t.attemptReconnect()
}

// attemptReconnect attempts to reconnect with exponential backoff.
func (t *SSHTunnel) attemptReconnect() {
	t.mu.Lock()
	t.reconnectAttempt++
	attempt := t.reconnectAttempt
	maxRetries := t.cfg.MaxReconnectRetries
	t.mu.Unlock()

	if maxRetries > 0 && attempt > maxRetries {
		t.setError(fmt.Errorf("ssh_tunnel: max reconnect retries (%d) reached", maxRetries))
		return
	}

	t.setState(SSHStateReconnecting)

	delay := t.cfg.ReconnectBaseDelay * time.Duration(1<<uint(min(attempt-1, 10)))
	if delay > t.cfg.ReconnectMaxDelay {
		delay = t.cfg.ReconnectMaxDelay
	}

	t.logger.Info("reconnecting SSH tunnel", log.Fields{
		"attempt": attempt,
		"delay":   delay.String(),
	})

	time.Sleep(delay)

	select {
	case <-t.ctx.Done():
		t.setState(SSHStateDisconnected)
		return
	default:
	}

	if err := t.Connect(t.ctx); err != nil {
		t.logger.Warn("reconnect failed", log.Fields{
			"attempt": attempt,
			"error":   err.Error(),
		})
	}
}

// Disconnect closes the SSH tunnel.
func (t *SSHTunnel) Disconnect() error {
	if t.cancel != nil {
		t.cancel()
	}

	t.mu.Lock()
	if t.listener != nil {
		t.listener.Close()
		t.listener = nil
	}
	if t.client != nil {
		err := t.client.Close()
		t.client = nil
		if err != nil {
			t.mu.Unlock()
			t.setState(SSHStateDisconnected)
			return err
		}
	}
	t.mu.Unlock()

	t.setState(SSHStateDisconnected)
	return nil
}

// ExecCommand executes a command on the remote host via SSH.
func (t *SSHTunnel) ExecCommand(ctx context.Context, cmd string) ([]byte, error) {
	t.mu.RLock()
	client := t.client
	t.mu.RUnlock()

	if client == nil {
		return nil, fmt.Errorf("ssh_tunnel: not connected")
	}

	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("ssh_tunnel: new session: %w", err)
	}
	defer session.Close()

	return session.CombinedOutput(cmd)
}

// Status returns the current connection status.
func (t *SSHTunnel) Status() ConnectionStatus {
	t.mu.RLock()
	defer t.mu.RUnlock()

	return ConnectionStatus{
		State:            SSHConnectionState(atomic.LoadInt32(&t.state)),
		Host:             t.cfg.Host,
		Port:             t.cfg.Port,
		LocalPort:        t.cfg.LocalPort,
		ConnectedAt:      t.connectedAt,
		ReconnectAttempt: t.reconnectAttempt,
		LastError:        t.lastError,
		BytesSent:        atomic.LoadInt64(&t.bytesSent),
		BytesReceived:    atomic.LoadInt64(&t.bytesRecv),
	}
}

// IsConnected returns true if the tunnel is currently connected.
func (t *SSHTunnel) IsConnected() bool {
	return SSHConnectionState(atomic.LoadInt32(&t.state)) == SSHStateConnected
}

// setState sets the connection state and triggers the status callback.
func (t *SSHTunnel) setState(state SSHConnectionState) {
	atomic.StoreInt32(&t.state, int32(state))
	t.mu.RLock()
	fn := t.onStatusChange
	t.mu.RUnlock()
	if fn != nil {
		fn(t.Status())
	}
}

// setError sets the error state and triggers the status callback.
func (t *SSHTunnel) setError(err error) {
	t.mu.Lock()
	t.lastError = err.Error()
	t.mu.Unlock()
	t.setState(SSHStateError)
	t.logger.Error("ssh tunnel error", log.Fields{"error": err.Error()})
}

// GenerateSSHKey generates a new ED25519 SSH key pair for testing.
func GenerateSSHKey() (privateKey []byte, publicKey []byte, err error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("generate ed25519 key: %w", err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		return nil, nil, fmt.Errorf("create ssh signer: %w", err)
	}

	publicKey = ssh.MarshalAuthorizedKey(signer.PublicKey())

	// Marshal the ed25519.PrivateKey (implements crypto.Signer) to OpenSSH PEM format
	pemBlock, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		return nil, nil, fmt.Errorf("marshal private key: %w", err)
	}
	privateKey = pem.EncodeToMemory(pemBlock)
	return privateKey, publicKey, nil
}

// GenerateED25519Key generates an ED25519 key pair for testing.
func GenerateED25519Key() (ssh.PublicKey, ssh.Signer, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("generate ed25519 key: %w", err)
	}

	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		return nil, nil, fmt.Errorf("create ssh signer: %w", err)
	}

	return signer.PublicKey(), signer, nil
}

// min returns the minimum of two integers.
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}