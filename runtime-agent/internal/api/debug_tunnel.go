package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

// DebugTunnelConnectRequest is the payload for POST /api/v1/debug/tunnel/connect.
type DebugTunnelConnectRequest struct {
	// Host is the remote SSH/JDWP host.
	Host string `json:"host"`
	// Port is the remote JDWP port to forward to (via the SSH server host).
	Port int `json:"port"`
	// SSHPort is the remote SSH server port (default 22).
	SSHPort int `json:"sshPort,omitempty"`
	// User is the SSH username.
	User string `json:"user,omitempty"`
	// AuthType selects the auth scheme: none | ssh-key | token (password).
	AuthType string `json:"authType,omitempty"`
	// SSHKeyPath is the private key path for authType=ssh-key.
	SSHKeyPath string `json:"sshKeyPath,omitempty"`
	// Token is used as the SSH password for authType=token.
	Token string `json:"token,omitempty"`
	// LocalPort pins the local tunnel port; 0 picks an ephemeral port.
	LocalPort int `json:"localPort,omitempty"`
}

// DebugTunnelConnectResponse reports the established local tunnel endpoint.
type DebugTunnelConnectResponse struct {
	Success   bool   `json:"success"`
	LocalPort int    `json:"localPort"`
	Error     string `json:"error,omitempty"`
}

// DebugTunnelDisconnectResponse acknowledges teardown.
type DebugTunnelDisconnectResponse struct {
	Success bool `json:"success"`
}

// debugTunnelManager abstracts the tagged SSH implementation so the default
// build (without `-tags remote`) can still serve a clear "not built in" error.
type debugTunnelManager interface {
	Connect(ctx context.Context, req DebugTunnelConnectRequest) (int, error)
	Disconnect() error
}

type unavailableDebugTunnel struct{}

func (unavailableDebugTunnel) Connect(_ context.Context, _ DebugTunnelConnectRequest) (int, error) {
	return 0, fmt.Errorf("remote debug tunnel requires the agent built with -tags remote")
}

func (unavailableDebugTunnel) Disconnect() error { return nil }

var debugTunnel debugTunnelManager = unavailableDebugTunnel{}

// handleDebugTunnelConnect handles POST /api/v1/debug/tunnel/connect.
func (s *Server) handleDebugTunnelConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "method not allowed"})
		return
	}

	env := protocol.RequestEnvelope{}
	req := DebugTunnelConnectRequest{}
	if err := decodeEnvelopePayload(r, &env, &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "invalid request body: " + err.Error()})
		return
	}
	if req.Host == "" || req.Port <= 0 {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "host and port are required"})
		return
	}
	if req.AuthType == "ssh-key" && req.SSHKeyPath == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "sshKeyPath required for ssh-key auth"})
		return
	}
	if req.User == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "user is required for the SSH tunnel"})
		return
	}

	localPort, err := debugTunnel.Connect(r.Context(), req)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "tunnel connect failed: " + err.Error()})
		return
	}
	writeOK(w, env, DebugTunnelConnectResponse{Success: true, LocalPort: localPort})
}

// handleDebugTunnelDisconnect handles POST /api/v1/debug/tunnel/disconnect.
func (s *Server) handleDebugTunnelDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "method not allowed"})
		return
	}

	env := protocol.RequestEnvelope{}
	_ = decodeEnvelopePayload(r, &env, &struct{}{})
	if err := debugTunnel.Disconnect(); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "tunnel disconnect failed: " + err.Error()})
		return
	}
	writeOK(w, env, DebugTunnelDisconnectResponse{Success: true})
}
