//go:build remote

package api

import (
	"context"
	"fmt"
	"sync"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/remote"
)

// sshDebugTunnel adapts remote.SSHTunnel to the debugTunnelManager interface.
// A single active tunnel is enforced — JDWP debugging is a 1:1 workflow.
type sshDebugTunnel struct {
	mu     sync.Mutex
	tunnel *remote.SSHTunnel
}

func init() {
	debugTunnel = &sshDebugTunnel{}
}

func (m *sshDebugTunnel) Connect(ctx context.Context, req DebugTunnelConnectRequest) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.tunnel != nil {
		return 0, fmt.Errorf("a debug tunnel is already active; disconnect first")
	}

	cfg := remote.DefaultSSHConfig()
	cfg.Host = req.Host
	if req.SSHPort > 0 {
		cfg.Port = req.SSHPort
	}
	cfg.User = req.User
	cfg.RemoteHost = "localhost"
	cfg.RemotePort = req.Port
	cfg.LocalPort = req.LocalPort
	// A debug session must not silently re-route after a network blip.
	cfg.MaxReconnectRetries = -1

	switch req.AuthType {
	case "ssh-key":
		cfg.AuthMethod = remote.SSHAuthKeyFile
		cfg.KeyFile = req.SSHKeyPath
	case "token":
		cfg.AuthMethod = remote.SSHAuthPassword
		cfg.Password = req.Token
	default:
		cfg.AuthMethod = remote.SSHAuthPassword
	}

	logger := log.New("debug_tunnel")
	cfg.Logger = logger

	tunnel, err := remote.NewSSHTunnel(cfg)
	if err != nil {
		return 0, err
	}
	tunnel.OnStatusChange(func(status remote.ConnectionStatus) {
		logger.Info("debug tunnel status", log.Fields{
			"state": status.State.String(),
			"host":  status.Host,
			"local": status.LocalPort,
		})
	})
	if err := tunnel.Connect(ctx); err != nil {
		return 0, err
	}
	m.tunnel = tunnel
	return tunnel.Status().LocalPort, nil
}

func (m *sshDebugTunnel) Disconnect() error {
	m.mu.Lock()
	tunnel := m.tunnel
	m.tunnel = nil
	m.mu.Unlock()
	if tunnel == nil {
		return nil
	}
	return tunnel.Disconnect()
}
