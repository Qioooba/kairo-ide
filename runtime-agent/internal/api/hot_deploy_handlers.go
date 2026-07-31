package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

// handleCompileIncremental handles POST /api/v1/jvm/compile-incremental.
// It triggers an incremental build with the specified files and syncs
// compiled classes to the running server.
func (s *Server) handleCompileIncremental(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}

	env, body, readErr := readEnvelopeAndBody(r)
	if readErr != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: readErr.Error()})
		return
	}

	var req struct {
		Files     []string `json:"files"`
		ProjectID string   `json:"projectId"`
	}
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}

	if req.ProjectID == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "projectId required"})
		return
	}

	if s.Services.ProjectStore == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ProjectStore not configured"})
		return
	}

	p, err := s.Services.ProjectStore.Get(req.ProjectID)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrNotFound,
			Message: fmt.Sprintf("project not found: %s", req.ProjectID),
		})
		return
	}

	buildReq := BuildRequest{
		ProjectID:     req.ProjectID,
		Clean:         false,
		Intent:        "incremental",
		SelectedFiles: req.Files,
	}
	if err := hydrateBuildRequest(&buildReq, p); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}

	buildReq.TraceID = env.CorrelationID
	if buildReq.TraceID == "" {
		buildReq.TraceID = env.RequestID
	}

	if s.Services.BuildEngine == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "BuildEngine not configured"})
		return
	}

	res, err := s.Services.BuildEngine.Start(buildReq)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrCompileFailed, Message: err.Error()})
		return
	}

	writeOK(w, env, map[string]interface{}{
		"state":         res.State,
		"filesCompiled": res.FilesCompiled,
		"id":            res.ID,
	})
}

// handleServerReload handles POST /api/v1/servers/{serverId}/reload.
// It triggers a Tomcat context reload by touching WEB-INF/web.xml.
func (s *Server) handleServerReload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}

	env, _, readErr := readEnvelopeAndBody(r)
	if readErr != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: readErr.Error()})
		return
	}

	serverID := r.PathValue("serverId")
	if serverID == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "serverId required"})
		return
	}

	if s.Services.ServerRunner == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ServerRunner not configured"})
		return
	}

	if err := s.Services.ServerRunner.ReloadContext(serverID); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: err.Error()})
		return
	}

	writeOK(w, env, map[string]string{"status": "reloaded"})
}