package sql

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// TestParseConnectionString_SID tests parsing SID-based connection strings.
func TestParseConnectionString_SID(t *testing.T) {
	tests := []struct {
		name    string
		connStr string
		want    *ConnectionConfig
		wantErr bool
	}{
		{
			name:    "valid SID connection",
			connStr: "scott/tiger@localhost:1521/orcl",
			want: &ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				SID:            "orcl",
				Username:       "scott",
				Password:       "tiger",
				UseServiceName: false,
			},
			wantErr: false,
		},
		{
			name:    "valid SID without port",
			connStr: "scott/tiger@localhost/orcl",
			want: &ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				SID:            "orcl",
				Username:       "scott",
				Password:       "tiger",
				UseServiceName: false,
			},
			wantErr: false,
		},
		{
			name:    "valid service name connection",
			connStr: "scott/tiger@//localhost:1521/orcl.example.com",
			want: &ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				ServiceName:    "orcl.example.com",
				Username:       "scott",
				Password:       "tiger",
				UseServiceName: true,
			},
			wantErr: false,
		},
		{
			name:    "valid service name without port",
			connStr: "scott/tiger@//localhost/orcl.example.com",
			want: &ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				ServiceName:    "orcl.example.com",
				Username:       "scott",
				Password:       "tiger",
				UseServiceName: true,
			},
			wantErr: false,
		},
		{
			name:    "empty string",
			connStr: "",
			want:    nil,
			wantErr: true,
		},
		{
			name:    "missing @",
			connStr: "scott/tiger",
			want:    nil,
			wantErr: true,
		},
		{
			name:    "missing / in user/password",
			connStr: "scott@localhost:1521/orcl",
			want:    nil,
			wantErr: true,
		},
		{
			name:    "missing SID",
			connStr: "scott/tiger@localhost:1521",
			want:    nil,
			wantErr: true,
		},
		{
			name:    "password with special characters",
			connStr: "scott/p@ss/w0rd@localhost:1521/orcl",
			want: &ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				SID:            "orcl",
				Username:       "scott",
				Password:       "p@ss/w0rd",
				UseServiceName: false,
			},
			wantErr: false,
		},
		{
			name:    "IP address host",
			connStr: "admin/secret@192.168.1.100:1521/XE",
			want: &ConnectionConfig{
				Host:           "192.168.1.100",
				Port:           1521,
				SID:            "XE",
				Username:       "admin",
				Password:       "secret",
				UseServiceName: false,
			},
			wantErr: false,
		},
		{
			name:    "custom port",
			connStr: "user/pass@db.example.com:1530/PROD",
			want: &ConnectionConfig{
				Host:           "db.example.com",
				Port:           1530,
				SID:            "PROD",
				Username:       "user",
				Password:       "pass",
				UseServiceName: false,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseConnectionString(tt.connStr)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ParseConnectionString() expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Errorf("ParseConnectionString() unexpected error: %v", err)
				return
			}
			if got.Host != tt.want.Host {
				t.Errorf("Host = %q, want %q", got.Host, tt.want.Host)
			}
			if got.Port != tt.want.Port {
				t.Errorf("Port = %d, want %d", got.Port, tt.want.Port)
			}
			if got.SID != tt.want.SID {
				t.Errorf("SID = %q, want %q", got.SID, tt.want.SID)
			}
			if got.ServiceName != tt.want.ServiceName {
				t.Errorf("ServiceName = %q, want %q", got.ServiceName, tt.want.ServiceName)
			}
			if got.Username != tt.want.Username {
				t.Errorf("Username = %q, want %q", got.Username, tt.want.Username)
			}
			if got.Password != tt.want.Password {
				t.Errorf("Password = %q, want %q", got.Password, tt.want.Password)
			}
			if got.UseServiceName != tt.want.UseServiceName {
				t.Errorf("UseServiceName = %v, want %v", got.UseServiceName, tt.want.UseServiceName)
			}
		})
	}
}

// TestConnectionConfig_Validate tests the validation logic.
func TestConnectionConfig_Validate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     ConnectionConfig
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid SID config",
			cfg: ConnectionConfig{
				Host:     "localhost",
				Port:     1521,
				SID:      "orcl",
				Username: "scott",
				Password: "tiger",
			},
			wantErr: false,
		},
		{
			name: "valid service name config",
			cfg: ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				ServiceName:    "orcl.example.com",
				UseServiceName: true,
				Username:       "scott",
				Password:       "tiger",
			},
			wantErr: false,
		},
		{
			name: "missing host",
			cfg: ConnectionConfig{
				Port:     1521,
				SID:      "orcl",
				Username: "scott",
				Password: "tiger",
			},
			wantErr: true,
			errMsg:  "host is required",
		},
		{
			name: "invalid port (0)",
			cfg: ConnectionConfig{
				Host:     "localhost",
				Port:     0,
				SID:      "orcl",
				Username: "scott",
				Password: "tiger",
			},
			wantErr: true,
			errMsg:  "invalid port: 0",
		},
		{
			name: "invalid port (>65535)",
			cfg: ConnectionConfig{
				Host:     "localhost",
				Port:     99999,
				SID:      "orcl",
				Username: "scott",
				Password: "tiger",
			},
			wantErr: true,
			errMsg:  "invalid port: 99999",
		},
		{
			name: "missing username",
			cfg: ConnectionConfig{
				Host:     "localhost",
				Port:     1521,
				SID:      "orcl",
				Password: "tiger",
			},
			wantErr: true,
			errMsg:  "username is required",
		},
		{
			name: "missing password",
			cfg: ConnectionConfig{
				Host:     "localhost",
				Port:     1521,
				SID:      "orcl",
				Username: "scott",
			},
			wantErr: true,
			errMsg:  "password is required",
		},
		{
			name: "missing SID when not using service name",
			cfg: ConnectionConfig{
				Host:     "localhost",
				Port:     1521,
				Username: "scott",
				Password: "tiger",
			},
			wantErr: true,
			errMsg:  "SID is required when not using service name",
		},
		{
			name: "missing service name when using service name",
			cfg: ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				UseServiceName: true,
				Username:       "scott",
				Password:       "tiger",
			},
			wantErr: true,
			errMsg:  "service name is required when useServiceName is true",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if tt.wantErr {
				if err == nil {
					t.Errorf("Validate() expected error, got nil")
					return
				}
				if tt.errMsg != "" && err.Error() != tt.errMsg {
					t.Errorf("Validate() error = %q, want %q", err.Error(), tt.errMsg)
				}
			} else {
				if err != nil {
					t.Errorf("Validate() unexpected error: %v", err)
				}
			}
		})
	}
}

// TestConnectionConfig_ConnectionString tests connection string generation.
func TestConnectionConfig_ConnectionString(t *testing.T) {
	tests := []struct {
		name string
		cfg  ConnectionConfig
		want string
	}{
		{
			name: "SID connection",
			cfg: ConnectionConfig{
				Host:     "localhost",
				Port:     1521,
				SID:      "orcl",
				Username: "scott",
				Password: "tiger",
			},
			want: "scott/tiger@localhost:1521/orcl",
		},
		{
			name: "service name connection",
			cfg: ConnectionConfig{
				Host:           "localhost",
				Port:           1521,
				ServiceName:    "orcl.example.com",
				UseServiceName: true,
				Username:       "scott",
				Password:       "tiger",
			},
			want: "scott/tiger@//localhost:1521/orcl.example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.cfg.ConnectionString()
			if got != tt.want {
				t.Errorf("ConnectionString() = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestOracleErrorCode tests Oracle error code mapping.
func TestOracleErrorCode(t *testing.T) {
	tests := []struct {
		code int
		want string
	}{
		{1017, "invalid username/password; logon denied"},
		{12154, "TNS: could not resolve the connect identifier specified"},
		{12514, "TNS: listener does not currently know of service requested"},
		{12541, "TNS: no listener"},
		{942, "table or view does not exist"},
		{1403, "no data found"},
		{3113, "end-of-file on communication channel"},
		{99999, "Oracle error ORA-99999"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := OracleErrorCode(tt.code)
			if got != tt.want {
				t.Errorf("OracleErrorCode(%d) = %q, want %q", tt.code, got, tt.want)
			}
		})
	}
}

// TestFormatError tests error formatting.
func TestFormatError(t *testing.T) {
	result := FormatError(1017, "logon denied")
	expected := "ORA-01017: logon denied (invalid username/password; logon denied)"
	if result != expected {
		t.Errorf("FormatError() = %q, want %q", result, expected)
	}

	result2 := FormatError(99999, "custom error")
	expected2 := "ORA-99999: custom error"
	if result2 != expected2 {
		t.Errorf("FormatError() = %q, want %q", result2, expected2)
	}
}

// TestIsOracleErrorCode tests error code matching.
func TestIsOracleErrorCode(t *testing.T) {
	err := FormatError(1017, "logon denied")
	if !IsOracleErrorCode(errors.New(err), 1017) {
		t.Error("IsOracleErrorCode should return true for matching code")
	}
	if IsOracleErrorCode(errors.New(err), 942) {
		t.Error("IsOracleErrorCode should return false for non-matching code")
	}
	if IsOracleErrorCode(nil, 1017) {
		t.Error("IsOracleErrorCode should return false for nil error")
	}
}

// TestExecutor_Timeout tests timeout behavior.
func TestExecutor_Timeout(t *testing.T) {
	executor := NewOracleExecutor(100 * time.Millisecond)
	cfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// Test that the executor handles context cancellation
	result := executor.Execute(ctx, cfg, "SELECT 1 FROM DUAL", 100)
	if result == nil {
		t.Fatal("Execute() returned nil result")
	}

	// Test with empty query
	result2 := executor.Execute(context.Background(), cfg, "", 100)
	if result2 == nil {
		t.Fatal("Execute() returned nil result for empty query")
	}
	if result2.RowCount != 0 {
		t.Errorf("RowCount = %d, want 0 for empty query", result2.RowCount)
	}

	// Test connection test
	testResult := executor.TestConnection(context.Background(), cfg)
	if testResult.Success {
		t.Error("TestConnection should fail without Oracle client")
	}
}

// TestParseConnectionString_EdgeCases tests edge cases.
func TestParseConnectionString_EdgeCases(t *testing.T) {
	// Test with IPv6-like address — it gets parsed as a hostname
	cfg, err := ParseConnectionString("user/pass@[::1]:1521/orcl")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	} else {
		if cfg.Host != "[::1]" {
			t.Errorf("Host = %q, want [::1]", cfg.Host)
		}
		if cfg.Port != 1521 {
			t.Errorf("Port = %d, want 1521", cfg.Port)
		}
	}

	// Test with very long SID
	cfg, err = ParseConnectionString("user/pass@localhost:1521/" + strings.Repeat("x", 100))
	if err != nil {
		t.Errorf("Unexpected error for long SID: %v", err)
	} else if cfg.SID != strings.Repeat("x", 100) {
		t.Errorf("SID = %q, want long string", cfg.SID)
	}
}