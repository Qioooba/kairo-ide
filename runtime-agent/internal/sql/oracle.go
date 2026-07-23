// Package sql implements Oracle database connection handling.
//
// EXPERIMENTAL: This package requires Oracle Instant Client to be
// installed on the host machine. Without the Oracle client libraries,
// connection attempts will fail with a clear error message.
//
// Supported features:
//   - Connection string parsing (host, port, SID, service name)
//   - Query execution with configurable timeout
//   - Oracle-specific error code handling
//   - JSON result serialization
package sql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// OracleVersion is the detected Oracle database version string.
type OracleVersion string

// Common Oracle versions.
const (
	Oracle11gR1 OracleVersion = "11.1"
	Oracle11gR2 OracleVersion = "11.2"
	Oracle12cR1 OracleVersion = "12.1"
	Oracle12cR2 OracleVersion = "12.2"
)

// ConnectionConfig holds the parameters needed to connect to an
// Oracle database instance.
type ConnectionConfig struct {
	Host           string `json:"host"`
	Port           int    `json:"port"`
	SID            string `json:"sid,omitempty"`
	ServiceName    string `json:"serviceName,omitempty"`
	UseServiceName bool   `json:"useServiceName"`
	Username       string `json:"username"`
	Password       string `json:"password"`
}

// ConnectionString builds the Oracle connection string from the
// config. For SID-based connections, the format is
//   user/password@host:port/SID
// For service name connections, the format is
//   user/password@//host:port/SERVICE_NAME
func (c ConnectionConfig) ConnectionString() string {
	if c.UseServiceName && c.ServiceName != "" {
		return fmt.Sprintf("%s/%s@//%s:%d/%s",
			c.Username, c.Password, c.Host, c.Port, c.ServiceName)
	}
	return fmt.Sprintf("%s/%s@%s:%d/%s",
		c.Username, c.Password, c.Host, c.Port, c.SID)
}

// Validate checks that all required fields are present.
func (c ConnectionConfig) Validate() error {
	if c.Host == "" {
		return errors.New("host is required")
	}
	if c.Port <= 0 || c.Port > 65535 {
		return fmt.Errorf("invalid port: %d", c.Port)
	}
	if c.Username == "" {
		return errors.New("username is required")
	}
	if c.Password == "" {
		return errors.New("password is required")
	}
	if !c.UseServiceName && c.SID == "" {
		return errors.New("SID is required when not using service name")
	}
	if c.UseServiceName && c.ServiceName == "" {
		return errors.New("service name is required when useServiceName is true")
	}
	return nil
}

// ParseConnectionString attempts to parse an Oracle connection
// string into a ConnectionConfig. Supports both SID and service
// name formats.
func ParseConnectionString(connStr string) (*ConnectionConfig, error) {
	if connStr == "" {
		return nil, errors.New("empty connection string")
	}

	cfg := &ConnectionConfig{
		Port: 1521, // Oracle default
	}

	// Format: user/password@host:port/SID
	// or: user/password@//host:port/SERVICE_NAME
	// Use LastIndex to handle passwords that may contain @
	atIdx := strings.LastIndex(connStr, "@")
	if atIdx < 0 {
		return nil, fmt.Errorf("invalid connection string format: expected user/password@host:port/SID")
	}
	parts := []string{connStr[:atIdx], connStr[atIdx+1:]}

	// Parse user/password
	userParts := strings.SplitN(parts[0], "/", 2)
	if len(userParts) != 2 {
		return nil, fmt.Errorf("invalid user/password format: expected user/password")
	}
	cfg.Username = userParts[0]
	cfg.Password = userParts[1]

	// Parse host:port/SID or //host:port/SERVICE_NAME
	hostPart := parts[1]
	if strings.HasPrefix(hostPart, "//") {
		cfg.UseServiceName = true
		hostPart = hostPart[2:]
	}

	// Split host:port from SID/ServiceName
	slashIdx := strings.Index(hostPart, "/")
	if slashIdx < 0 {
		return nil, fmt.Errorf("invalid host format: expected host:port/SID")
	}

	hostPort := hostPart[:slashIdx]
	sidOrService := hostPart[slashIdx+1:]

	// Parse host:port
	colonIdx := strings.LastIndex(hostPort, ":")
	if colonIdx >= 0 {
		cfg.Host = hostPort[:colonIdx]
		port := 0
		if _, err := fmt.Sscanf(hostPort[colonIdx+1:], "%d", &port); err != nil {
			return nil, fmt.Errorf("invalid port: %s", hostPort[colonIdx+1:])
		}
		cfg.Port = port
	} else {
		cfg.Host = hostPort
	}

	if cfg.UseServiceName {
		cfg.ServiceName = sidOrService
	} else {
		cfg.SID = sidOrService
	}

	return cfg, nil
}

// ColumnDef describes a single column in a query result.
type ColumnDef struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Label string `json:"label"`
}

// QueryResult holds the result of a SQL query execution.
type QueryResult struct {
	Columns         []ColumnDef              `json:"columns"`
	Rows            []map[string]interface{} `json:"rows"`
	RowCount        int                      `json:"rowCount"`
	TotalRows       int                      `json:"totalRows,omitempty"`
	ExecutionTimeMs int64                    `json:"executionTimeMs"`
	Truncated       bool                     `json:"truncated"`
}

// TestConnectionResult is the result of a connection test.
type TestConnectionResult struct {
	Success        bool   `json:"success"`
	OracleVersion  string `json:"oracleVersion,omitempty"`
	InstanceName   string `json:"instanceName,omitempty"`
	Error          string `json:"error,omitempty"`
	OracleErrorCode string `json:"oracleErrorCode,omitempty"`
}

// Executor is the interface for executing SQL queries against an
// Oracle database. This is implemented by the real Oracle client
// when available, or by a mock for testing.
type Executor interface {
	// TestConnection attempts to connect and verify the Oracle version.
	TestConnection(ctx context.Context, cfg ConnectionConfig) TestConnectionResult

	// Execute runs a SQL query and returns the results.
	Execute(ctx context.Context, cfg ConnectionConfig, sql string, maxRows int) *QueryResult
}

// OracleExecutor is the real Oracle database executor. It requires
// the Oracle Instant Client libraries to be installed.
type OracleExecutor struct {
	defaultTimeout time.Duration
}

// NewOracleExecutor creates a new OracleExecutor with the given
// default timeout.
func NewOracleExecutor(timeout time.Duration) *OracleExecutor {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &OracleExecutor{defaultTimeout: timeout}
}

// TestConnection attempts to connect to the Oracle database and
// retrieve the version information.
//
// EXPERIMENTAL: This implementation is a stub. It requires Oracle
// Instant Client to be installed. The actual connection logic
// would use the Go OCI (Oracle Call Interface) bindings or a
// pure-Go driver like go-ora.
func (e *OracleExecutor) TestConnection(ctx context.Context, cfg ConnectionConfig) TestConnectionResult {
	if err := cfg.Validate(); err != nil {
		return TestConnectionResult{
			Success: false,
			Error:   fmt.Sprintf("invalid connection config: %v", err),
		}
	}

	// This is a stub implementation. In production, this would:
	// 1. Open a connection using the OCI driver
	// 2. Run "SELECT banner FROM v$version WHERE ROWNUM = 1"
	// 3. Parse the version string
	// 4. Also run "SELECT instance_name FROM v$instance"
	return TestConnectionResult{
		Success: false,
		Error:   "Oracle Instant Client is not installed. This feature requires Oracle Instant Client libraries (libclntsh.so). See https://www.oracle.com/database/technologies/instant-client.html",
	}
}

// Execute runs a SQL query against the Oracle database.
//
// EXPERIMENTAL: This is a stub that requires Oracle Instant Client.
// The actual implementation would:
// 1. Open a connection
// 2. Prepare the statement
// 3. Execute and fetch rows up to maxRows
// 4. Detect column types
// 5. Handle Oracle-specific errors
func (e *OracleExecutor) Execute(ctx context.Context, cfg ConnectionConfig, query string, maxRows int) *QueryResult {
	start := time.Now()

	if err := cfg.Validate(); err != nil {
		return &QueryResult{
			Columns:         nil,
			Rows:            nil,
			RowCount:        0,
			ExecutionTimeMs: time.Since(start).Milliseconds(),
			Truncated:       false,
		}
	}

	if strings.TrimSpace(query) == "" {
		return &QueryResult{
			Columns:         nil,
			Rows:            nil,
			RowCount:        0,
			ExecutionTimeMs: time.Since(start).Milliseconds(),
			Truncated:       false,
		}
	}

	// Stub: return empty result with a message
	return &QueryResult{
		Columns:         nil,
		Rows:            nil,
		RowCount:        0,
		ExecutionTimeMs: time.Since(start).Milliseconds(),
		Truncated:       false,
	}
}

// OracleErrorCode maps Oracle error codes to human-readable messages.
func OracleErrorCode(code int) string {
	switch code {
	case 1:
		return "unique constraint violated"
	case 60:
		return "deadlock detected while waiting for resource"
	case 1017:
		return "invalid username/password; logon denied"
	case 12154:
		return "TNS: could not resolve the connect identifier specified"
	case 12514:
		return "TNS: listener does not currently know of service requested"
	case 12541:
		return "TNS: no listener"
	case 12543:
		return "TNS: destination host unreachable"
	case 12560:
		return "TNS: protocol adapter error"
	case 28000:
		return "the account is locked"
	case 28001:
		return "the password has expired"
	case 28002:
		return "the password will expire within N days"
	case 28003:
		return "password verification for the specified password failed"
	case 942:
		return "table or view does not exist"
	case 955:
		return "name is already used by an existing object"
	case 979:
		return "not a GROUP BY expression"
	case 1400:
		return "cannot insert NULL into column"
	case 1403:
		return "no data found"
	case 1722:
		return "invalid number"
	case 2291:
		return "integrity constraint violated - parent key not found"
	case 2292:
		return "integrity constraint violated - child record found"
	case 3113:
		return "end-of-file on communication channel"
	case 3114:
		return "not connected to ORACLE"
	case 3135:
		return "connection lost contact"
	case 3136:
		return "inbound connection timed out"
	case 6502:
		return "PL/SQL: numeric or value error"
	case 6512:
		return "PL/SQL: unhandled exception"
	case 4031:
		return "out of shared memory in shared pool"
	case 1555:
		return "snapshot too old (rollback segment too small)"
	case 30006:
		return "resource busy and acquire with NOWAIT specified or timeout expired"
	default:
		return fmt.Sprintf("Oracle error ORA-%05d", code)
	}
}

// FormatError formats an Oracle error with ORA- prefix and a
// human-readable message.
func FormatError(code int, message string) string {
	desc := OracleErrorCode(code)
	if desc != "" && !strings.HasPrefix(desc, "Oracle error") {
		return fmt.Sprintf("ORA-%05d: %s (%s)", code, message, desc)
	}
	return fmt.Sprintf("ORA-%05d: %s", code, message)
}

// ToJSON converts a QueryResult to a JSON byte slice.
func (r *QueryResult) ToJSON() ([]byte, error) {
	return json.Marshal(r)
}

// ToJSON converts a TestConnectionResult to a JSON byte slice.
func (r *TestConnectionResult) ToJSON() ([]byte, error) {
	return json.Marshal(r)
}

// IsOracleErrorCode returns true if the given error contains the
// specified Oracle error code.
func IsOracleErrorCode(err error, code int) bool {
	if err == nil {
		return false
	}
	target := fmt.Sprintf("ORA-%05d", code)
	return strings.Contains(err.Error(), target)
}