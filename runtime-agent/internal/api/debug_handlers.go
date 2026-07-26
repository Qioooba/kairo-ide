package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

type jdkDownloadResponse struct {
	Status  string `json:"status"`
	JDKPath string `json:"jdkPath,omitempty"`
	Message string `json:"message,omitempty"`
}

type jdkProgressData struct {
	Percent int    `json:"percent"`
	Message string `json:"message"`
}

func (s *Server) publishJDKProgress(workspaceID string, percent int, message string) {
	if s.Services == nil || s.Services.EventBus == nil {
		return
	}
	adapter, ok := s.Services.EventBus.(*events.EventBusAdapter)
	if !ok || adapter == nil || adapter.Hub == nil {
		return
	}
	data, _ := json.Marshal(jdkProgressData{Percent: percent, Message: message})
	adapter.Hub.Publish(events.Event{
		Type:        "jdk.download.progress",
		WorkspaceID: workspaceID,
		Message:     message,
		Data:        data,
	})
}

// handleDebugAdapterStatus handles GET /api/v1/debug/adapter/status
func (s *Server) handleDebugAdapterStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "method not allowed"})
		return
	}

	if s.Services.JDKManager == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "JDKManager not configured"})
		return
	}

	status := s.Services.JDKManager.GetFullStatus()
	writeOK(w, protocol.RequestEnvelope{}, status)
}

// handleJDKDownload handles POST /api/v1/debug/jdk/download
func (s *Server) handleJDKDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "method not allowed"})
		return
	}

	if s.Services.JDKManager == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "JDKManager not configured"})
		return
	}

	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	workspaceID := env.WorkspaceID
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Kairo-Workspace-Id")
	}

	if !s.Services.JDKManager.NeedsDownload() {
		detected := s.Services.JDKManager.Detect()
		resp := jdkDownloadResponse{
			Status:  "already_available",
			JDKPath: detected.JDK.Path,
		}
		writeOK(w, env, resp)
		return
	}

	s.publishJDKProgress(workspaceID, 0, "Starting JDK 17 download...")

	progressFn := func(percent int, message string) {
		if s.logger != nil {
			s.logger.Info("jdk download progress", log.Fields{
				"percent": percent,
				"message": message,
			})
		}
		s.publishJDKProgress(workspaceID, percent, message)
	}

	jdk, err := s.Services.JDKManager.EnsureJDK17(r.Context(), progressFn)
	if err != nil {
		s.publishJDKProgress(workspaceID, 0, "Download failed: "+err.Error())
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "JDK download failed: " + err.Error(),
		})
		return
	}

	jdkPath := filepath.Join(s.Services.JDKManager.BundledDir, "jdk17")
	resp := jdkDownloadResponse{
		Status:  "complete",
		JDKPath: jdkPath,
		Message: "JDK 17 installed successfully",
	}
	if jdk != nil {
		resp.JDKPath = jdk.Home
	}

	s.publishJDKProgress(workspaceID, 100, "JDK 17 installation complete")
	writeOK(w, env, resp)
}
