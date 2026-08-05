package api

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
)

// handleCustomBuild handles POST /api/v1/build/custom
func (s *Server) handleCustomBuild(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}

	env, body, readErr := readEnvelopeAndBody(r)
	if readErr != nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: readErr.Error()})
		return
	}

	var cfg build.CustomBuildConfig
	if err := json.Unmarshal(extractPayload(body), &cfg); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}

	if cfg.BuildID == "" {
		cfg.BuildID = "build-" + randomID(8)
	}
	if cfg.ProjectRoot == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "projectRoot is required"})
		return
	}
	if cfg.Command == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "command is required"})
		return
	}

	absRoot, absErr := filepath.Abs(cfg.ProjectRoot)
	if absErr != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: absErr.Error()})
		return
	}
	absRoot, ok := s.authorizeAbsPath(w, env, absRoot)
	if !ok {
		return
	}
	cfg.ProjectRoot = absRoot
	if cfg.WorkingDir != "" {
		absWD, wdErr := filepath.Abs(cfg.WorkingDir)
		if wdErr != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: wdErr.Error()})
			return
		}
		absWD, ok = s.authorizeAbsPath(w, env, absWD)
		if !ok {
			return
		}
		cfg.WorkingDir = absWD
	}

	// Detached from the HTTP request lifetime — defer-cancel would SIGKILL the
	// child as soon as writeOK returns (BD-P0-5). Cancel() still kills via process group.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	_ = cancel // timer retained until timeout; Cancel() does not need this handle

	if s.Services.CustomBuild == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "CustomBuild not configured"})
		return
	}

	if err := s.Services.CustomBuild.Start(ctx, cfg); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: err.Error()})
		return
	}

	writeOK(w, env, map[string]interface{}{
		"buildId": cfg.BuildID,
		"status":  "running",
	})
}

// handleCustomBuildSub handles sub-resources under /api/v1/build/custom/
func (s *Server) handleCustomBuildSub(w http.ResponseWriter, r *http.Request) {
	// /api/v1/build/custom/{buildId}/cancel
	// /api/v1/build/custom/{buildId} (GET status)
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/build/custom/")
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "buildId required"})
		return
	}
	buildID := parts[0]

	if len(parts) == 2 && parts[1] == "cancel" {
		s.handleCustomBuildCancel(w, r, buildID)
		return
	}

	if len(parts) == 1 || (len(parts) == 2 && parts[1] == "") {
		s.handleCustomBuildStatus(w, r, buildID)
		return
	}

	writeError(w, "", "", protocol.KairoError{Code: protocol.ErrNotFound, Message: "unknown sub-resource"})
}

// handleCustomBuildStatus handles GET /api/v1/build/custom/{buildId}
func (s *Server) handleCustomBuildStatus(w http.ResponseWriter, r *http.Request, buildID string) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	if s.Services.CustomBuild == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "CustomBuild not configured"})
		return
	}
	status, exitCode, known := s.Services.CustomBuild.Status(buildID)
	payload := map[string]interface{}{
		"buildId": buildID,
		"status":  status,
	}
	if known {
		payload["exitCode"] = exitCode
	}
	writeOK(w, protocol.RequestEnvelope{}, payload)
}

// handleCustomBuildCancel handles POST /api/v1/build/custom/{buildId}/cancel
func (s *Server) handleCustomBuildCancel(w http.ResponseWriter, r *http.Request, buildID string) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}

	if s.Services.CustomBuild == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "CustomBuild not configured"})
		return
	}

	if err := s.Services.CustomBuild.Cancel(buildID); err != nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
		return
	}

	writeOK(w, protocol.RequestEnvelope{}, map[string]interface{}{
		"buildId": buildID,
		"status":  "cancelled",
	})
}
