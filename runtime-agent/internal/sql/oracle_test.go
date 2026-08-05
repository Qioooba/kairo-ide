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

	// Stub Execute must fail honestly (Instant Client missing), not empty success.
	result := executor.Execute(ctx, cfg, "SELECT 1 FROM DUAL", 100)
	if result == nil {
		t.Fatal("Execute() returned nil result")
	}
	if result.Error == "" {
		t.Fatal("Execute() should set Error without Instant Client")
	}
	if !strings.Contains(result.Error, "Instant Client") {
		t.Errorf("Execute Error = %q, want Instant Client message", result.Error)
	}

	// Test with empty query
	result2 := executor.Execute(context.Background(), cfg, "", 100)
	if result2 == nil {
		t.Fatal("Execute() returned nil result for empty query")
	}
	if result2.RowCount != 0 {
		t.Errorf("RowCount = %d, want 0 for empty query", result2.RowCount)
	}
	if result2.Error == "" {
		t.Fatal("Execute() empty query should set Error")
	}

	// Test connection test
	testResult := executor.TestConnection(context.Background(), cfg)
	if testResult.Success {
		t.Error("TestConnection should fail without Oracle client")
	}
	if !strings.Contains(testResult.Error, "Instant Client") {
		t.Errorf("TestConnection Error = %q, want Instant Client message", testResult.Error)
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

// TestParseConnectionString_InvalidPort tests invalid port parsing.
func TestParseConnectionString_InvalidPort(t *testing.T) {
	_, err := ParseConnectionString("user/pass@localhost:abc/orcl")
	if err == nil {
		t.Error("expected error for invalid port")
	}
}

// TestNewOracleExecutor_ZeroTimeout tests default timeout.
func TestNewOracleExecutor_ZeroTimeout(t *testing.T) {
	e := NewOracleExecutor(0)
	if e.defaultTimeout != 30*time.Second {
		t.Errorf("defaultTimeout = %v, want 30s", e.defaultTimeout)
	}
}

// TestDefaultPoolConfig tests default pool configuration.
func TestDefaultPoolConfig(t *testing.T) {
	cfg := DefaultPoolConfig()
	if cfg.MaxConnections != 10 {
		t.Errorf("MaxConnections = %d, want 10", cfg.MaxConnections)
	}
	if cfg.MinConnections != 2 {
		t.Errorf("MinConnections = %d, want 2", cfg.MinConnections)
	}
	if cfg.MaxIdleTime != 5*time.Minute {
		t.Errorf("MaxIdleTime = %v, want 5m", cfg.MaxIdleTime)
	}
	if cfg.MaxLifetime != 30*time.Minute {
		t.Errorf("MaxLifetime = %v, want 30m", cfg.MaxLifetime)
	}
	if cfg.ConnectionTimeout != 10*time.Second {
		t.Errorf("ConnectionTimeout = %v, want 10s", cfg.ConnectionTimeout)
	}
}

// TestNewPool tests pool creation.
func TestNewPool(t *testing.T) {
	cfg := DefaultPoolConfig()
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)
	if p == nil {
		t.Fatal("NewPool returned nil")
	}
	if p.config.MaxConnections != 10 {
		t.Errorf("MaxConnections = %d, want 10", p.config.MaxConnections)
	}
}

// TestPool_Acquire tests acquiring connections.
func TestPool_Acquire(t *testing.T) {
	cfg := DefaultPoolConfig()
	cfg.MaxConnections = 2
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}

	// Acquire first connection
	conn1, err := p.Acquire(context.Background(), connCfg)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if conn1 == nil {
		t.Fatal("Acquire returned nil connection")
	}
	if !conn1.InUse {
		t.Error("connection should be in use")
	}

	// Acquire second connection
	conn2, err := p.Acquire(context.Background(), connCfg)
	if err != nil {
		t.Fatalf("Acquire second: %v", err)
	}
	if conn2.ID == conn1.ID {
		t.Error("connections should have different IDs")
	}

	// Third acquire should timeout (max=2, both in use)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err = p.Acquire(ctx, connCfg)
	if err == nil {
		t.Error("expected timeout error")
	}
}

// TestPool_Acquire_Closed tests acquiring from closed pool.
func TestPool_Acquire_Closed(t *testing.T) {
	cfg := DefaultPoolConfig()
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)
	p.Close()

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}
	_, err := p.Acquire(context.Background(), connCfg)
	if err == nil {
		t.Error("expected error acquiring from closed pool")
	}
}

// TestPool_Release tests releasing connections.
func TestPool_Release(t *testing.T) {
	cfg := DefaultPoolConfig()
	cfg.MaxConnections = 3
	cfg.MinConnections = 1
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}

	conn1, _ := p.Acquire(context.Background(), connCfg)
	conn2, _ := p.Acquire(context.Background(), connCfg)

	// Release one
	p.Release(conn1)
	if conn1.InUse {
		t.Error("connection should not be in use after release")
	}

	// Should be able to re-acquire
	conn3, err := p.Acquire(context.Background(), connCfg)
	if err != nil {
		t.Fatalf("re-acquire: %v", err)
	}
	if conn3.ID != conn1.ID {
		t.Errorf("should reuse released connection, got %s", conn3.ID)
	}
	_ = conn2
}

// TestPool_Stats tests pool statistics.
func TestPool_Stats(t *testing.T) {
	cfg := DefaultPoolConfig()
	cfg.MaxConnections = 5
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}

	// Acquire 2 connections
	conn1, _ := p.Acquire(context.Background(), connCfg)
	conn2, _ := p.Acquire(context.Background(), connCfg)

	stats := p.Stats()
	if stats["total"] != 2 {
		t.Errorf("total = %d, want 2", stats["total"])
	}
	if stats["inUse"] != 2 {
		t.Errorf("inUse = %d, want 2", stats["inUse"])
	}
	if stats["idle"] != 0 {
		t.Errorf("idle = %d, want 0", stats["idle"])
	}
	if stats["max"] != 5 {
		t.Errorf("max = %d, want 5", stats["max"])
	}

	// Release one
	p.Release(conn1)
	stats = p.Stats()
	if stats["inUse"] != 1 {
		t.Errorf("inUse after release = %d, want 1", stats["inUse"])
	}
	if stats["idle"] != 1 {
		t.Errorf("idle after release = %d, want 1", stats["idle"])
	}
	_ = conn2
}

// TestPool_Close tests pool close.
func TestPool_Close(t *testing.T) {
	cfg := DefaultPoolConfig()
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}
	p.Acquire(context.Background(), connCfg)

	p.Close()
	stats := p.Stats()
	if stats["total"] != 0 {
		t.Errorf("total after close = %d, want 0", stats["total"])
	}
}

// TestParseParameterizedQuery tests parameter extraction.
func TestParseParameterizedQuery(t *testing.T) {
	tests := []struct {
		name     string
		sql      string
		wantNum  int
		wantName string
	}{
		{"single param", "SELECT * FROM users WHERE id = :userId", 1, "userId"},
		{"multiple params", "SELECT * FROM users WHERE id = :userId AND name = :userName", 2, "userId"},
		{"at sign params", "SELECT * FROM users WHERE id = @userId", 1, "userId"},
		{"mixed params", "SELECT * FROM t WHERE a = :p1 AND b = @p2", 2, "p1"},
		{"no params", "SELECT * FROM users", 0, ""},
		{"duplicate params", "SELECT * FROM t WHERE a = :id OR b = :id", 1, "id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pq := ParseParameterizedQuery(tt.sql)
			if len(pq.Parameters) != tt.wantNum {
				t.Errorf("Parameters = %d, want %d", len(pq.Parameters), tt.wantNum)
			}
			if tt.wantNum > 0 && pq.Parameters[0].Name != tt.wantName {
				t.Errorf("first param = %q, want %q", pq.Parameters[0].Name, tt.wantName)
			}
		})
	}
}

// TestBindParams tests parameter binding.
func TestBindParams(t *testing.T) {
	tests := []struct {
		name    string
		sql     string
		params  map[string]any
		want    string
		wantErr bool
	}{
		{
			name:   "bind string param",
			sql:    "SELECT * FROM users WHERE name = :userName",
			params: map[string]any{"userName": "John"},
			want:   "SELECT * FROM users WHERE name = 'John'",
		},
		{
			name:   "bind int param",
			sql:    "SELECT * FROM users WHERE id = :userId",
			params: map[string]any{"userId": 42},
			want:   "SELECT * FROM users WHERE id = 42",
		},
		{
			name:   "bind multiple params",
			sql:    "SELECT * FROM t WHERE a = :p1 AND b = :p2",
			params: map[string]any{"p1": 1, "p2": "test"},
			want:   "SELECT * FROM t WHERE a = 1 AND b = 'test'",
		},
		{
			name:   "bind at-sign param",
			sql:    "SELECT * FROM users WHERE id = @userId",
			params: map[string]any{"userId": 100},
			want:   "SELECT * FROM users WHERE id = 100",
		},
		{
			name:    "missing param",
			sql:     "SELECT * FROM users WHERE id = :userId",
			params:  map[string]any{"wrongName": 1},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pq := ParseParameterizedQuery(tt.sql)
			got, err := pq.BindParams(tt.params)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("BindParams: %v", err)
			}
			if got != tt.want {
				t.Errorf("BindParams = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestEscapeParamValue tests parameter value escaping.
func TestEscapeParamValue(t *testing.T) {
	tests := []struct {
		name    string
		value   any
		want    string
		wantErr bool
	}{
		{"nil", nil, "NULL", false},
		{"int", 42, "42", false},
		{"int64", int64(999), "999", false},
		{"float64", 3.14, "3.14", false},
		{"bool true", true, "1", false},
		{"bool false", false, "0", false},
		{"string", "hello", "'hello'", false},
		{"string with quote", "it's", "'it''s'", false},
		{"nul byte", "a\x00b", "", true},
		{"unsupported", struct{ X int }{1}, "", true},
		{"time", time.Date(2024, 1, 15, 10, 30, 0, 0, time.UTC), "TO_DATE('2024-01-15 10:30:00', 'YYYY-MM-DD HH24:MI:SS')", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := escapeParamValue(tt.value)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("escapeParamValue: %v", err)
			}
			if got != tt.want {
				t.Errorf("escapeParamValue = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPrepareNamed(t *testing.T) {
	pq := ParseParameterizedQuery("SELECT * FROM users WHERE id = :userId AND name = :userName")
	sql, binds, err := pq.PrepareNamed(map[string]any{"userId": 42, "userName": "Ada"})
	if err != nil {
		t.Fatalf("PrepareNamed: %v", err)
	}
	if sql != pq.SQL {
		t.Errorf("SQL mutated: %q", sql)
	}
	if len(binds) != 2 {
		t.Fatalf("binds = %d, want 2", len(binds))
	}
	_, _, err = pq.PrepareNamed(map[string]any{"userId": 1})
	if err == nil {
		t.Fatal("expected error for missing param")
	}
	_, _, err = pq.PrepareNamed(map[string]any{"userId": 1, "userName": "x", "extra": 3})
	if err == nil {
		t.Fatal("expected error for unknown param")
	}
	_, _, err = pq.PrepareNamed(map[string]any{"userId": "a\x00b", "userName": "x"})
	if err == nil {
		t.Fatal("expected error for NUL byte")
	}
}

// TestStreamingResultSet tests streaming result set functionality.
func TestStreamingResultSet(t *testing.T) {
	columns := []ColumnDef{{Name: "id", Type: "NUMBER"}, {Name: "name", Type: "VARCHAR2"}}

	t.Run("Next reads rows", func(t *testing.T) {
		rowChan := make(chan map[string]any, 2)
		errChan := make(chan error, 1)
		rowChan <- map[string]any{"id": 1, "name": "Alice"}
		rowChan <- map[string]any{"id": 2, "name": "Bob"}
		close(rowChan)

		srs := NewStreamingResultSet(columns, rowChan, errChan, 2)
		row1, err := srs.Next()
		if err != nil || row1 == nil {
			t.Fatalf("Next: err=%v, row=%v", err, row1)
		}
		if row1["id"] != 1 {
			t.Errorf("row1 id = %v, want 1", row1["id"])
		}

		row2, err := srs.Next()
		if err != nil || row2 == nil {
			t.Fatalf("Next second: err=%v, row=%v", err, row2)
		}

		// Third call should return nil (channel closed)
		row3, err := srs.Next()
		if err != nil || row3 != nil {
			t.Errorf("Next third: err=%v, row=%v, want nil,nil", err, row3)
		}

		if !srs.IsClosed() {
			t.Error("stream should be closed after exhaustion")
		}
	})

	t.Run("Consumed counts rows", func(t *testing.T) {
		rowChan := make(chan map[string]any, 2)
		errChan := make(chan error, 1)
		rowChan <- map[string]any{"id": 1}
		rowChan <- map[string]any{"id": 2}
		close(rowChan)

		srs := NewStreamingResultSet(columns, rowChan, errChan, 2)
		srs.Next()
		if srs.Consumed() != 1 {
			t.Errorf("Consumed = %d, want 1", srs.Consumed())
		}
		srs.Next()
		if srs.Consumed() != 2 {
			t.Errorf("Consumed = %d, want 2", srs.Consumed())
		}
	})

	t.Run("CollectAll reads all rows", func(t *testing.T) {
		rowChan := make(chan map[string]any, 3)
		errChan := make(chan error, 1)
		rowChan <- map[string]any{"id": 1}
		rowChan <- map[string]any{"id": 2}
		rowChan <- map[string]any{"id": 3}
		close(rowChan)

		srs := NewStreamingResultSet(columns, rowChan, errChan, 3)
		rows, err := srs.CollectAll()
		if err != nil {
			t.Fatalf("CollectAll: %v", err)
		}
		if len(rows) != 3 {
			t.Errorf("len(rows) = %d, want 3", len(rows))
		}
	})

	t.Run("Next returns error from error channel", func(t *testing.T) {
		rowChan := make(chan map[string]any, 1)
		errChan := make(chan error, 1)
		errChan <- errors.New("test error")
		// Do NOT close rowChan: if both channels are ready, select picks randomly

		srs := NewStreamingResultSet(columns, rowChan, errChan, 0)
		_, err := srs.Next()
		if err == nil || err.Error() != "test error" {
			t.Errorf("expected 'test error', got %v", err)
		}
	})
}

// TestQueryResult_ToJSON tests JSON serialization.
func TestQueryResult_ToJSON(t *testing.T) {
	qr := &QueryResult{
		Columns:  []ColumnDef{{Name: "id", Type: "NUMBER"}},
		Rows:     []map[string]any{{"id": 1}},
		RowCount: 1,
	}
	data, err := qr.ToJSON()
	if err != nil {
		t.Fatalf("ToJSON: %v", err)
	}
	if !strings.Contains(string(data), `"rowCount":1`) {
		t.Errorf("unexpected JSON: %s", string(data))
	}
}

// TestTestConnectionResult_ToJSON tests JSON serialization.
func TestTestConnectionResult_ToJSON(t *testing.T) {
	tcr := &TestConnectionResult{
		Success:       true,
		OracleVersion: "19.0",
		InstanceName:  "orcl",
	}
	data, err := tcr.ToJSON()
	if err != nil {
		t.Fatalf("ToJSON: %v", err)
	}
	if !strings.Contains(string(data), `"success":true`) {
		t.Errorf("unexpected JSON: %s", string(data))
	}
}

// TestOracleErrorCode_AllCodes tests all Oracle error codes.
func TestOracleErrorCode_AllCodes(t *testing.T) {
	tests := []struct {
		code int
		want string
	}{
		{1, "unique constraint violated"},
		{60, "deadlock detected while waiting for resource"},
		{28000, "the account is locked"},
		{28001, "the password has expired"},
		{28002, "the password will expire within N days"},
		{28003, "password verification for the specified password failed"},
		{955, "name is already used by an existing object"},
		{979, "not a GROUP BY expression"},
		{1400, "cannot insert NULL into column"},
		{1722, "invalid number"},
		{2291, "integrity constraint violated - parent key not found"},
		{2292, "integrity constraint violated - child record found"},
		{3114, "not connected to ORACLE"},
		{3135, "connection lost contact"},
		{3136, "inbound connection timed out"},
		{6502, "PL/SQL: numeric or value error"},
		{6512, "PL/SQL: unhandled exception"},
		{4031, "out of shared memory in shared pool"},
		{1555, "snapshot too old (rollback segment too small)"},
		{30006, "resource busy and acquire with NOWAIT specified or timeout expired"},
		{12543, "TNS: destination host unreachable"},
		{12560, "TNS: protocol adapter error"},
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

// TestExecutor_Execute_InvalidConfig tests Execute with invalid config.
func TestExecutor_Execute_InvalidConfig(t *testing.T) {
	executor := NewOracleExecutor(30 * time.Second)
	cfg := ConnectionConfig{} // invalid config
	result := executor.Execute(context.Background(), cfg, "SELECT 1 FROM DUAL", 100)
	if result == nil {
		t.Fatal("Execute returned nil")
	}
	if result.RowCount != 0 {
		t.Errorf("RowCount = %d, want 0", result.RowCount)
	}
	if result.Error == "" || !strings.Contains(result.Error, "invalid connection config") {
		t.Errorf("Error = %q, want invalid connection config", result.Error)
	}
}

// TestTestConnection_InvalidConfig tests TestConnection with invalid config.
func TestTestConnection_InvalidConfig(t *testing.T) {
	executor := NewOracleExecutor(30 * time.Second)
	cfg := ConnectionConfig{} // invalid config
	result := executor.TestConnection(context.Background(), cfg)
	if result.Success {
		t.Error("TestConnection should fail with invalid config")
	}
	if !strings.Contains(result.Error, "invalid connection config") {
		t.Errorf("unexpected error: %s", result.Error)
	}
}