package api

import (
	"encoding/json"
	"fmt"
	"net/http"
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
	ID          string              `json:"id"`
	ProjectID   string              `json:"projectId"`
	State       string              `json:"state"`
	StartTime   string              `json:"startTime"`
	EndTime     string              `json:"endTime,omitempty"`
	Summary     string              `json:"summary,omitempty"`
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

// ServerResponse is the response for server endpoints.
type ServerResponse struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	State     string `json:"state"`
	HTTPPort  int    `json:"httpPort"`
	PID       int    `json:"pid"`
	StartTime string `json:"startTime"`
	URL       string `json:"url,omitempty"`
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