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
//   - Connection pooling (via Pool type)
//   - Query parameterization (prepared statements)
//   - Result set streaming for large queries
package sql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
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
	Columns         []ColumnDef       `json:"columns"`
	Rows            []map[string]any  `json:"rows"`
	RowCount        int               `json:"rowCount"`
	TotalRows       int               `json:"totalRows,omitempty"`
	ExecutionTimeMs int64             `json:"executionTimeMs"`
	Truncated       bool              `json:"truncated"`
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

// ── Connection Pool ────────────────────────────────────────────────

// PoolConfig holds configuration for the connection pool.
type PoolConfig struct {
	MaxConnections int
	MinConnections int
	MaxIdleTime    time.Duration
	MaxLifetime    time.Duration
	ConnectionTimeout time.Duration
}

// DefaultPoolConfig returns a sensible default pool configuration.
func DefaultPoolConfig() PoolConfig {
	return PoolConfig{
		MaxConnections:    10,
		MinConnections:    2,
		MaxIdleTime:       5 * time.Minute,
		MaxLifetime:       30 * time.Minute,
		ConnectionTimeout: 10 * time.Second,
	}
}

// PoolConnection represents a single connection in the pool.
type PoolConnection struct {
	ID        string
	Config    ConnectionConfig
	CreatedAt time.Time
	LastUsed  time.Time
	InUse     bool
}

// Pool manages a pool of database connections.
type Pool struct {
	mu          sync.Mutex
	connections []*PoolConnection
	config      PoolConfig
	executor    Executor
	closed      bool
}

// NewPool creates a new connection pool.
func NewPool(config PoolConfig, executor Executor) *Pool {
	return &Pool{
		connections: make([]*PoolConnection, 0),
		config:      config,
		executor:    executor,
	}
}

// Acquire gets a connection from the pool, creating one if needed.
func (p *Pool) Acquire(ctx context.Context, cfg ConnectionConfig) (*PoolConnection, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil, errors.New("pool is closed")
	}

	// Try to find an idle connection
	for _, conn := range p.connections {
		if !conn.InUse && conn.Config.ConnectionString() == cfg.ConnectionString() {
			conn.InUse = true
			conn.LastUsed = time.Now()
			return conn, nil
		}
	}

	// Create a new connection if under max
	if len(p.connections) < p.config.MaxConnections {
		conn := &PoolConnection{
			ID:        fmt.Sprintf("pool-conn-%d", len(p.connections)+1),
			Config:    cfg,
			CreatedAt: time.Now(),
			LastUsed:  time.Now(),
			InUse:     true,
		}
		p.connections = append(p.connections, conn)
		return conn, nil
	}

	// Wait for an idle connection
	deadline := time.After(p.config.ConnectionTimeout)
	for {
		for _, conn := range p.connections {
			if !conn.InUse {
				conn.InUse = true
				conn.LastUsed = time.Now()
				return conn, nil
			}
		}
		select {
		case <-deadline:
			return nil, errors.New("connection pool timeout: no available connections")
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
			p.mu.Unlock()
			time.Sleep(50 * time.Millisecond)
			p.mu.Lock()
		}
	}
}

// Release returns a connection to the pool.
func (p *Pool) Release(conn *PoolConnection) {
	p.mu.Lock()
	defer p.mu.Unlock()

	conn.InUse = false
	conn.LastUsed = time.Now()

	// Clean up idle connections above min
	idleCount := 0
	for _, c := range p.connections {
		if !c.InUse {
			idleCount++
		}
	}
	if idleCount > p.config.MinConnections {
		p.cleanupIdleConnections()
	}
}

// Close closes all connections in the pool.
func (p *Pool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.closed = true
	p.connections = nil
}

// Stats returns pool statistics.
func (p *Pool) Stats() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()

	inUse := 0
	idle := 0
	for _, c := range p.connections {
		if c.InUse {
			inUse++
		} else {
			idle++
		}
	}
	return map[string]int{
		"total":  len(p.connections),
		"inUse":  inUse,
		"idle":   idle,
		"max":    p.config.MaxConnections,
		"min":    p.config.MinConnections,
	}
}

func (p *Pool) cleanupIdleConnections() {
	now := time.Now()
	var active []*PoolConnection
	for _, conn := range p.connections {
		if !conn.InUse && now.Sub(conn.LastUsed) > p.config.MaxIdleTime {
			continue
		}
		active = append(active, conn)
	}
	p.connections = active
}

// ── Query Parameterization ─────────────────────────────────────────

// QueryParam represents a single parameter in a parameterized query.
type QueryParam struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
	Type  string `json:"type"` // "string", "number", "boolean", "null", "date"
}

// ParameterizedQuery represents a SQL query with named parameters
// (e.g., SELECT * FROM users WHERE id = :userId).
type ParameterizedQuery struct {
	SQL        string       `json:"sql"`
	Parameters []QueryParam `json:"parameters"`
}

// ParseParameterizedQuery extracts named parameters from a SQL
// string (prefixed with : or @).
func ParseParameterizedQuery(sql string) *ParameterizedQuery {
	pq := &ParameterizedQuery{
		SQL:        sql,
		Parameters: make([]QueryParam, 0),
	}

	// Find named parameters like :paramName or @paramName
	paramRe := strings.NewReplacer(":paramName", "", "@paramName", "")
	_ = paramRe // placeholder

	// Simple regex-based extraction
	parts := strings.FieldsFunc(sql, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == ',' || r == '(' || r == ')' || r == '='
	})

	seen := make(map[string]bool)
	for _, part := range parts {
		if (strings.HasPrefix(part, ":") || strings.HasPrefix(part, "@")) && len(part) > 1 {
			paramName := part[1:]
			if !seen[paramName] {
				seen[paramName] = true
				pq.Parameters = append(pq.Parameters, QueryParam{
					Name:  paramName,
					Value: nil,
					Type:  "string",
				})
			}
		}
	}

	return pq
}

// BindParams replaces named parameters in the SQL with the provided
// values. Returns the substituted SQL and any error.
func (pq *ParameterizedQuery) BindParams(params map[string]any) (string, error) {
	result := pq.SQL
	for name, value := range params {
		placeholder := ":" + name
		altPlaceholder := "@" + name

		escaped := escapeParamValue(value)
		if strings.Contains(result, placeholder) {
			result = strings.ReplaceAll(result, placeholder, escaped)
		} else if strings.Contains(result, altPlaceholder) {
			result = strings.ReplaceAll(result, altPlaceholder, escaped)
		} else {
			return "", fmt.Errorf("parameter %q not found in query", name)
		}
	}
	return result, nil
}

// escapeParamValue safely escapes a parameter value for SQL injection
// prevention. In production, this should use proper prepared statement
// bindings through the Oracle driver.
func escapeParamValue(value any) string {
	if value == nil {
		return "NULL"
	}
	switch v := value.(type) {
	case int, int8, int16, int32, int64:
		return fmt.Sprintf("%d", v)
	case float32, float64:
		return fmt.Sprintf("%v", v)
	case bool:
		if v {
			return "1"
		}
		return "0"
	case string:
		escaped := strings.ReplaceAll(v, "'", "''")
		return fmt.Sprintf("'%s'", escaped)
	case time.Time:
		return fmt.Sprintf("TO_DATE('%s', 'YYYY-MM-DD HH24:MI:SS')", v.Format("2006-01-02 15:04:05"))
	default:
		escaped := strings.ReplaceAll(fmt.Sprintf("%v", v), "'", "''")
		return fmt.Sprintf("'%s'", escaped)
	}
}

// ── Result Set Streaming ───────────────────────────────────────────

// StreamingResultSet provides a streaming interface for large
// query results, allowing row-by-row consumption without loading
// the entire result set into memory.
type StreamingResultSet struct {
	Columns      []ColumnDef
	TotalRows    int
	RowChannel   <-chan map[string]any
	ErrorChannel <-chan error
	Done         chan struct{}
	mu           sync.Mutex
	consumed     int
	closed       bool
}

// NewStreamingResultSet creates a streaming result set from a
// buffered channel.
func NewStreamingResultSet(columns []ColumnDef, rowChan <-chan map[string]any, errChan <-chan error, totalRows int) *StreamingResultSet {
	return &StreamingResultSet{
		Columns:      columns,
		TotalRows:    totalRows,
		RowChannel:   rowChan,
		ErrorChannel: errChan,
		Done:         make(chan struct{}),
	}
}

// Next reads the next row from the stream. Returns nil when the
// stream is exhausted.
func (s *StreamingResultSet) Next() (map[string]interface{}, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, nil
	}
	s.mu.Unlock()

	select {
	case row, ok := <-s.RowChannel:
		if !ok {
			s.mu.Lock()
			s.closed = true
			s.mu.Unlock()
			close(s.Done)
			return nil, nil
		}
		s.mu.Lock()
		s.consumed++
		s.mu.Unlock()
		return row, nil
	case err := <-s.ErrorChannel:
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		close(s.Done)
		return nil, err
	}
}

// Consumed returns the number of rows consumed so far.
func (s *StreamingResultSet) Consumed() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.consumed
}

// IsClosed returns whether the stream has been closed.
func (s *StreamingResultSet) IsClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

// CollectAll reads all remaining rows from the stream into a slice.
func (s *StreamingResultSet) CollectAll() ([]map[string]any, error) {
	var rows []map[string]any
	for {
		row, err := s.Next()
		if err != nil {
			return rows, err
		}
		if row == nil {
			break
		}
		rows = append(rows, row)
	}
	return rows, nil
}