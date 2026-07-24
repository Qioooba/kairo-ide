package remote

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// TestNewSSHTunnel tests tunnel creation and validation.
func TestNewSSHTunnel(t *testing.T) {
	tests := []struct {
		name    string
		cfg     SSHConfig
		wantErr bool
	}{
		{
			name: "valid config",
			cfg: SSHConfig{
				Host:     "example.com",
				User:     "testuser",
				Password: "secret",
			},
			wantErr: false,
		},
		{
			name: "empty host",
			cfg: SSHConfig{
				User:     "testuser",
				Password: "secret",
			},
			wantErr: true,
		},
		{
			name: "empty user",
			cfg: SSHConfig{
				Host:     "example.com",
				Password: "secret",
			},
			wantErr: true,
		},
		{
			name: "defaults applied",
			cfg: SSHConfig{
				Host:     "example.com",
				User:     "testuser",
				Password: "secret",
				LocalPort: 0,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tunnel, err := NewSSHTunnel(tt.cfg)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if tunnel != nil {
					t.Error("tunnel should be nil on error")
				}
				return
			}
			if err != nil {
				t.Fatalf("NewSSHTunnel: %v", err)
			}
			if tunnel == nil {
				t.Fatal("tunnel should not be nil")
			}
			if tunnel.cfg.Port != 22 {
				t.Errorf("default port = %d, want 22", tunnel.cfg.Port)
			}
			if tunnel.cfg.RemotePort != 9443 {
				t.Errorf("default remote port = %d, want 9443", tunnel.cfg.RemotePort)
			}
		})
	}
}

// TestSSHTunnel_DefaultConfig tests default configuration values.
func TestSSHTunnel_DefaultConfig(t *testing.T) {
	cfg := DefaultSSHConfig()
	if cfg.Port != 22 {
		t.Errorf("Port = %d, want 22", cfg.Port)
	}
	if cfg.RemotePort != 9443 {
		t.Errorf("RemotePort = %d, want 9443", cfg.RemotePort)
	}
	if cfg.RemoteHost != "localhost" {
		t.Errorf("RemoteHost = %q, want localhost", cfg.RemoteHost)
	}
	if cfg.KeepAliveInterval != 30*time.Second {
		t.Errorf("KeepAliveInterval = %v, want 30s", cfg.KeepAliveInterval)
	}
	if cfg.MaxReconnectRetries != 5 {
		t.Errorf("MaxReconnectRetries = %d, want 5", cfg.MaxReconnectRetries)
	}
}

// TestSSHTunnel_Status tests initial and updated status.
func TestSSHTunnel_Status(t *testing.T) {
	tunnel, err := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})
	if err != nil {
		t.Fatalf("NewSSHTunnel: %v", err)
	}

	status := tunnel.Status()
	if status.State != SSHStateDisconnected {
		t.Errorf("initial state = %v, want disconnected", status.State)
	}
	if !status.ConnectedAt.IsZero() {
		t.Error("ConnectedAt should be zero initially")
	}
}

// TestSSHTunnel_IsConnected tests connection state check.
func TestSSHTunnel_IsConnected(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})

	if tunnel.IsConnected() {
		t.Error("should not be connected initially")
	}

	tunnel.setState(SSHStateConnected)
	if !tunnel.IsConnected() {
		t.Error("should be connected after state change")
	}
}

// TestSSHTunnel_StateTransitions tests state changes.
func TestSSHTunnel_StateTransitions(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})

	states := []SSHConnectionState{
		SSHStateConnecting,
		SSHStateConnected,
		SSHStateReconnecting,
		SSHStateError,
		SSHStateDisconnected,
	}

	for _, state := range states {
		tunnel.setState(state)
		if tunnel.Status().State != state {
			t.Errorf("state = %v, want %v", tunnel.Status().State, state)
		}
	}
}

// TestSSHTunnel_OnStatusChange tests status callback.
func TestSSHTunnel_OnStatusChange(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})

	called := false
	tunnel.OnStatusChange(func(status ConnectionStatus) {
		called = true
		if status.State != SSHStateConnected {
			t.Errorf("status state = %v, want connected", status.State)
		}
	})

	tunnel.setState(SSHStateConnected)
	if !called {
		t.Error("status callback was not called")
	}
}

// TestSSHTunnel_BuildAuthMethods_Password tests password auth.
func TestSSHTunnel_BuildAuthMethods_Password(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthPassword,
		Password:   "mypassword",
	})

	methods, err := tunnel.buildAuthMethods()
	if err != nil {
		t.Fatalf("buildAuthMethods: %v", err)
	}
	if len(methods) != 1 {
		t.Fatalf("expected 1 auth method, got %d", len(methods))
	}
}

// TestSSHTunnel_BuildAuthMethods_KeyFile_NotFound tests missing key file.
func TestSSHTunnel_BuildAuthMethods_KeyFile_NotFound(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyFile,
		KeyFile:    "/nonexistent/key.pem",
	})

	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for missing key file")
	}
}

// TestSSHTunnel_BuildAuthMethods_KeyData_Invalid tests invalid key data.
func TestSSHTunnel_BuildAuthMethods_KeyData_Invalid(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:       "example.com",
		User:       "testuser",
		AuthMethod: SSHAuthKeyData,
		KeyData:    []byte("not a valid key"),
	})

	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error for invalid key data")
	}
}

// TestSSHTunnel_NoAuthMethod tests no auth method configured.
func TestSSHTunnel_NoAuthMethod(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host: "example.com",
		User: "testuser",
	})

	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error when no auth method is configured")
	}
}

// TestSSHTunnel_Disconnect tests disconnection.
func TestSSHTunnel_Disconnect(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})

	// Set state to connected first
	tunnel.setState(SSHStateConnected)

	err := tunnel.Disconnect()
	if err != nil {
		t.Errorf("Disconnect: %v", err)
	}
	if tunnel.Status().State != SSHStateDisconnected {
		t.Errorf("state after disconnect = %v, want disconnected", tunnel.Status().State)
	}
}

// TestSSHTunnel_ExecCommand_NotConnected tests exec when not connected.
func TestSSHTunnel_ExecCommand_NotConnected(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})

	_, err := tunnel.ExecCommand(context.Background(), "ls")
	if err == nil {
		t.Fatal("expected error when not connected")
	}
}

// TestSSHConnectionState_String tests state string representation.
func TestSSHConnectionState_String(t *testing.T) {
	tests := []struct {
		state SSHConnectionState
		want  string
	}{
		{SSHStateDisconnected, "disconnected"},
		{SSHStateConnecting, "connecting"},
		{SSHStateConnected, "connected"},
		{SSHStateReconnecting, "reconnecting"},
		{SSHStateError, "error"},
		{SSHConnectionState(99), "unknown"},
	}

	for _, tt := range tests {
		if got := tt.state.String(); got != tt.want {
			t.Errorf("state %d String() = %q, want %q", tt.state, got, tt.want)
		}
	}
}

// TestSSHTunnel_LoggerDefault tests default logger assignment.
func TestSSHTunnel_LoggerDefault(t *testing.T) {
	tunnel, err := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
	})
	if err != nil {
		t.Fatalf("NewSSHTunnel: %v", err)
	}
	if tunnel.logger == nil {
		t.Error("logger should not be nil when not provided")
	}
}

// TestSSHTunnel_SetError tests error state setting.
func TestSSHTunnel_SetError(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:     "example.com",
		User:     "testuser",
		Password: "secret",
		Logger:   log.New("test"),
	})

	tunnel.setError(context.DeadlineExceeded)
	status := tunnel.Status()
	if status.State != SSHStateError {
		t.Errorf("state = %v, want error", status.State)
	}
	if status.LastError == "" {
		t.Error("last error should not be empty")
	}
}

// TestSSHConfig_EnvironmentAuth tests password from environment variable is not supported.
// This test verifies that auth methods are explicitly configured.
func TestSSHConfig_EnvironmentAuth(t *testing.T) {
	os.Setenv("KAIRO_SSH_PASSWORD", "env-secret")
	defer os.Unsetenv("KAIRO_SSH_PASSWORD")

	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host: "example.com",
		User: "testuser",
	})

	// No auth method configured, should fail
	_, err := tunnel.buildAuthMethods()
	if err == nil {
		t.Fatal("expected error when no auth method is configured")
	}
}

// TestSSHTunnel_Reconnect_Disabled tests reconnect disabled (max = -1).
func TestSSHTunnel_Reconnect_Disabled(t *testing.T) {
	tunnel, _ := NewSSHTunnel(SSHConfig{
		Host:                "example.com",
		User:                "testuser",
		Password:            "secret",
		Logger:              log.New("test"),
		MaxReconnectRetries: -1,
	})

	tunnel.setState(SSHStateConnected)
	tunnel.handleDisconnect()

	// Should go to disconnected state without attempting reconnect
	if tunnel.Status().State != SSHStateDisconnected {
		t.Errorf("state = %v, want disconnected when reconnect is disabled", tunnel.Status().State)
	}
}