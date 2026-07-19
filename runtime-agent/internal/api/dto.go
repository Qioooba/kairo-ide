package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// All DTOs are strongly typed. No json.RawMessage at the HTTP boundary.

// CreateWorkspaceRequest is the request body for POST /api/v1/workspaces.
type CreateWorkspaceRequest struct {
	Name string `json:"name"`
	Root string `json:"root"`
}

// WorkspaceResponse is the response for workspace endpoints.
type WorkspaceResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Root       string `json:"root"`
	LastOpened string `json:"lastOpened"`
}

// StartBuildRequest is the request body for POST /api/v1/builds.
type StartBuildRequest struct {
	ProjectID string `json:"projectId"`
	Clean     bool   `json:"clean,omitempty"`
	Intent    string `json:"intent,omitempty"`
}

// BuildResponse is the response for build endpoints.
type BuildResponse struct {
	ID          string               `json:"id"`
	ProjectID   string               `json:"projectId"`
	State       string               `json:"state"`
	StartTime   string               `json:"startTime"`
	EndTime     string               `json:"endTime,omitempty"`
	Summary     string               `json:"summary,omitempty"`
	Diagnostics []BuildDiagnosticDTO `json:"diagnostics,omitempty"`
}

// BuildDiagnosticDTO is a single compiler diagnostic in the response.
type BuildDiagnosticDTO struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// StartDeploymentRequest is the request body for POST /api/v1/deployments.
type StartDeploymentRequest struct {
	ProjectID string `json:"projectId"`
	BuildID   string `json:"buildId"`
	Scope     string `json:"scope,omitempty"`
}

// DeploymentResponse is the response for deployment endpoints.
type DeploymentResponse struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	BuildID   string `json:"buildId"`
	State     string `json:"state"`
	Added     int    `json:"added"`
	Modified  int    `json:"modified"`
	Deleted   int    `json:"deleted"`
}

// StartServerRequest is the request body for POST /api/v1/servers.
type StartServerRequest struct {
	ProjectID string `json:"projectId"`
}

// ServerResponse is the SAFE API response for server endpoints.
//
// It is a deliberately-typed DTO that strips internal/sensitive
// fields from domain.ServerRecord. Domain objects (ServerRecord,
// RuntimePlan, ProcessIdentity) MUST NOT be serialized directly
// to API responses — they contain local filesystem paths
// (JavaHome, CatalinaHome, CatalinaBase, WebappDir,
// DeploymentRoot), environment variables, JVM options, and
// process identity material (Executable, StartTime, MarkerToken)
// that must never leave the agent process.
//
// See ADR-0012 (Safe API DTO Boundary) for the rationale and the
// full list of excluded fields.
//
// Adding a new sensitive field to ServerRecord / RuntimePlan /
// ProcessIdentity will NOT automatically appear in the API
// response — it must be explicitly added to ToServerResponse,
// which is the single choke point for API output.
type ServerResponse struct {
	ID            string  `json:"id"`
	WorkspaceID   string  `json:"workspaceId"`
	ProjectID     string  `json:"projectId"`
	RuntimeID     string  `json:"runtimeId"`
	DesiredState  string  `json:"desiredState"`
	ObservedState string  `json:"observedState"`
	Generation    uint64  `json:"generation"`
	PID           int     `json:"pid,omitempty"`
	HTTPPort      int     `json:"httpPort,omitempty"`
	DebugPort     int     `json:"debugPort,omitempty"`
	ContextPath   string  `json:"contextPath,omitempty"`
	LastError     string  `json:"lastError,omitempty"`
	StartedAt     *string `json:"startedAt,omitempty"`
	StoppedAt     *string `json:"stoppedAt,omitempty"`
	UpdatedAt     string  `json:"updatedAt"`
	// URL is the user-facing HTTP URL, derived from HTTPPort and
	// ContextPath. It contains no sensitive information.
	URL string `json:"url,omitempty"`
}

// ToServerResponse maps a domain.ServerRecord to a safe
// ServerResponse DTO.
//
// It NEVER copies:
//   - ProcessIdentity (Executable path, StartTime, CatalinaBase,
//     MarkerToken) — process identity material
//   - RuntimePlan.JavaHome, CatalinaHome, CatalinaBase, WebappDir,
//     DeploymentRoot — local filesystem paths
//   - RuntimePlan.JVMOptions, Env — may carry secrets
//   - RuntimePlan.ShutdownPort — internal port
//
// Sensitive fields are absent from the DTO by construction; there
// is no "leak by accident" path. Adding a new field to
// ServerRecord/RuntimePlan/ProcessIdentity does NOT automatically
// surface in the API response.
func ToServerResponse(rec domain.ServerRecord) ServerResponse {
	resp := ServerResponse{
		ID:            string(rec.ID),
		WorkspaceID:   string(rec.WorkspaceID),
		ProjectID:     string(rec.ProjectID),
		RuntimeID:     rec.RuntimePlan.RuntimeID,
		DesiredState:  string(rec.DesiredState),
		ObservedState: string(rec.ObservedState),
		Generation:    rec.Generation,
		PID:           rec.PID,
		HTTPPort:      rec.RuntimePlan.HTTPPort,
		DebugPort:     rec.RuntimePlan.DebugPort,
		ContextPath:   rec.RuntimePlan.ContextPath,
		LastError:     rec.LastError,
		UpdatedAt:     rec.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if rec.StartedAt != nil {
		s := rec.StartedAt.UTC().Format(time.RFC3339Nano)
		resp.StartedAt = &s
	}
	if rec.StoppedAt != nil {
		s := rec.StoppedAt.UTC().Format(time.RFC3339Nano)
		resp.StoppedAt = &s
	}
	if rec.RuntimePlan.HTTPPort > 0 {
		resp.URL = fmt.Sprintf("http://localhost:%d%s",
			rec.RuntimePlan.HTTPPort, rec.RuntimePlan.ContextPath)
	}
	return resp
}

// ToServerResponseList maps a slice of domain.ServerRecord to a
// slice of safe ServerResponse DTOs. Nil entries are skipped.
func ToServerResponseList(records []*domain.ServerRecord) []ServerResponse {
	out := make([]ServerResponse, 0, len(records))
	for _, rec := range records {
		if rec == nil {
			continue
		}
		out = append(out, ToServerResponse(*rec))
	}
	return out
}

// ErrorResponse is a typed error response.
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// decodeJSON decodes the request body into a typed struct.
func decodeJSON[T any](r *http.Request) (T, error) {
	var v T
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		return v, fmt.Errorf("decode json: %w", err)
	}
	return v, nil
}

// writeErrorObj writes a typed error response as JSON.
func writeErrorObj(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, ErrorResponse{
		Code:    code,
		Message: message,
	})
}
