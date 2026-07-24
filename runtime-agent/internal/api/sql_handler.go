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
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/sql"
)

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
}

// sqlErrorDetail provides structured Oracle error information.
type sqlErrorDetail struct {
	OracleErrorCode string `json:"oracleErrorCode,omitempty"`
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

	// Create a context with timeout for the query execution
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	// Build the connection config from the connection ID
	// In production, this would look up the connection details from
	// persistent storage, including the password.
	cfg := sql.ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		Username: "placeholder",
		Password: "placeholder",
		// Connection details would be loaded from storage
	}

	executor := sql.NewOracleExecutor(30 * time.Second)
	result := executor.Execute(ctx, cfg, req.SQL, maxRows)

	if result == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "query execution returned nil result",
		})
		return
	}

	writeOK(w, env, protocol.ResponseEnvelope{
		RequestID:     env.RequestID,
		CorrelationID: env.CorrelationID,
		OK:            true,
		Payload: &sqlQueryResponse{
			Columns:         result.Columns,
			Rows:            result.Rows,
			RowCount:        result.RowCount,
			TotalRows:       result.TotalRows,
			ExecutionTimeMs: result.ExecutionTimeMs,
			Truncated:       result.Truncated,
		},
	})

	_, _, _, _ = log.FromContext(ctx) // context handling for logging
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

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	executor := sql.NewOracleExecutor(10 * time.Second)
	testResult := executor.TestConnection(ctx, cfg)

	if testResult.Success {
		writeOK(w, env, protocol.ResponseEnvelope{
			RequestID:     env.RequestID,
			CorrelationID: env.CorrelationID,
			OK:            true,
			Payload: &sqlTestConnectionResponse{
				Success:       true,
				OracleVersion: testResult.OracleVersion,
				InstanceName:  testResult.InstanceName,
			},
		})
		return
	}

	writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
		Code:    protocol.ErrInternal,
		Message: testResult.Error,
		Details: &sqlErrorDetail{
			OracleErrorCode: testResult.OracleErrorCode,
		},
	})
}