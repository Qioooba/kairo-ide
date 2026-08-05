// Package api — SQL handler for Oracle database operations.
//
// Provides POST /api/v1/sql/execute and POST /api/v1/sql/test-connection
// endpoints. These are EXPERIMENTAL and require Oracle Instant Client
// to be installed on the host.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/sql"
)

// sqlConnections registers configs after test-connection so execute
// can resolve connectionId (Instant Client stub still fails honestly).
var sqlConnections = sql.NewConnectionStore()

// sqlExecuteRequest is the request body for POST /api/v1/sql/execute.
type sqlExecuteRequest struct {
	ConnectionID string `json:"connectionId"`
	SQL          string `json:"sql"`
	MaxRows      int    `json:"maxRows,omitempty"`
}

// sqlQueryResponse is the structured response for SQL query execution.
type sqlQueryResponse struct {
	Columns         []sql.ColumnDef          `json:"columns"`
	Rows            []map[string]interface{} `json:"rows"`
	RowCount        int                      `json:"rowCount"`
	TotalRows       int                      `json:"totalRows,omitempty"`
	ExecutionTimeMs int64                    `json:"executionTimeMs"`
	Truncated       bool                     `json:"truncated"`
}

// sqlTestConnectionResponse is the structured response for connection tests.
type sqlTestConnectionResponse struct {
	Success       bool   `json:"success"`
	OracleVersion string `json:"oracleVersion,omitempty"`
	InstanceName  string `json:"instanceName,omitempty"`
	ConnectionID  string `json:"connectionId,omitempty"`
}

// sqlErrorDetail provides structured Oracle error information.
type sqlErrorDetail struct {
	OracleErrorCode string `json:"oracleErrorCode,omitempty"`
	ConnectionID    string `json:"connectionId,omitempty"`
}

// sqlTestConnectionRequest is the request body for POST /api/v1/sql/test-connection.
type sqlTestConnectionRequest struct {
	Host           string `json:"host"`
	Port           int    `json:"port"`
	SID            string `json:"sid,omitempty"`
	ServiceName    string `json:"serviceName,omitempty"`
	UseServiceName bool   `json:"useServiceName"`
	Username       string `json:"username"`
	Password       string `json:"password"`
}

// handleSQLExecute handles POST /api/v1/sql/execute.
func (s *Server) handleSQLExecute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "POST only",
		})
		return
	}

	env, body, err := readEnvelopeAndBody(r)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "invalid request body: " + err.Error(),
		})
		return
	}

	var req sqlExecuteRequest
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "invalid request payload: " + err.Error(),
		})
		return
	}

	if req.ConnectionID == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "connectionId is required",
		})
		return
	}
	if req.SQL == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "sql is required",
		})
		return
	}

	maxRows := req.MaxRows
	if maxRows <= 0 {
		maxRows = 10000
	}
	if maxRows > 100000 {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "maxRows cannot exceed 100000",
		})
		return
	}

	cfg, ok := sqlConnections.Get(req.ConnectionID)
	if !ok {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrNotFound,
			Message: "unknown connectionId; call POST /api/v1/sql/test-connection first to register",
			Details: &sqlErrorDetail{ConnectionID: req.ConnectionID},
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	executor := sql.NewOracleExecutor(30 * time.Second)
	result := executor.Execute(ctx, cfg, req.SQL, maxRows)
	if result == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "SQL execute returned no result",
		})
		return
	}
	if result.Error != "" {
		code := protocol.ErrUnsupported
		if result.Error == sql.ErrOracleInstantClientMissing {
			code = protocol.ErrUnsupported
		}
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    code,
			Message: result.Error,
			Details: &sqlErrorDetail{ConnectionID: req.ConnectionID},
		})
		return
	}

	rows := make([]map[string]interface{}, len(result.Rows))
	for i, row := range result.Rows {
		rows[i] = row
	}
	writeOK(w, env, &sqlQueryResponse{
		Columns:         result.Columns,
		Rows:            rows,
		RowCount:        result.RowCount,
		TotalRows:       result.TotalRows,
		ExecutionTimeMs: result.ExecutionTimeMs,
		Truncated:       result.Truncated,
	})
}

// handleSQLTestConnection handles POST /api/v1/sql/test-connection.
func (s *Server) handleSQLTestConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "POST only",
		})
		return
	}

	env, body, err := readEnvelopeAndBody(r)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "invalid request body: " + err.Error(),
		})
		return
	}

	var req sqlTestConnectionRequest
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "invalid request payload: " + err.Error(),
		})
		return
	}

	cfg := sql.ConnectionConfig{
		Host:           req.Host,
		Port:           req.Port,
		SID:            req.SID,
		ServiceName:    req.ServiceName,
		UseServiceName: req.UseServiceName,
		Username:       req.Username,
		Password:       req.Password,
	}

	if cfg.Port <= 0 {
		cfg.Port = 1521
	}

	if err := cfg.Validate(); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "invalid connection config: " + err.Error(),
		})
		return
	}

	// Register even when Instant Client is missing so later execute
	// can resolve connectionId and return the same driver message.
	connectionID := sqlConnections.Register(cfg)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	executor := sql.NewOracleExecutor(10 * time.Second)
	testResult := executor.TestConnection(ctx, cfg)

	if testResult.Success {
		writeOK(w, env, &sqlTestConnectionResponse{
			Success:       true,
			OracleVersion: testResult.OracleVersion,
			InstanceName:  testResult.InstanceName,
			ConnectionID:  connectionID,
		})
		return
	}

	writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
		Code:    protocol.ErrUnsupported,
		Message: testResult.Error,
		Details: &sqlErrorDetail{
			OracleErrorCode: testResult.OracleErrorCode,
			ConnectionID:    connectionID,
		},
	})
}
