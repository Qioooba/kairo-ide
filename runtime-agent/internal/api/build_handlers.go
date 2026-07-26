package api

import (
	"context"
	"encoding/json"
	"net/http"
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

	var cfg build.CustomBuildConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}

	if cfg.BuildID == "" {
		cfg.BuildID = "build-" + randomID(8)
	}
	if cfg.ProjectRoot == "" {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "projectRoot is required"})
		return
	}
	if cfg.Command == "" {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "command is required"})
		return
	}

	// Start build execution
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	if s.Services.CustomBuild == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "CustomBuild not configured"})
		return
	}

	if err := s.Services.CustomBuild.Start(ctx, cfg); err != nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: err.Error()})
		return
	}

	writeOK(w, protocol.RequestEnvelope{}, map[string]interface{}{
		"buildId": cfg.BuildID,
		"status":  "running",
	})
}

// handleCustomBuildSub handles sub-resources under /api/v1/build/custom/
func (s *Server) handleCustomBuildSub(w http.ResponseWriter, r *http.Request) {
	// /api/v1/build/custom/{buildId}/cancel
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

	writeError(w, "", "", protocol.KairoError{Code: protocol.ErrNotFound, Message: "unknown sub-resource"})
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