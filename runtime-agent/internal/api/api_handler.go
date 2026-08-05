//go:build unwired

package api

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/app"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// APIHandler is an UNWIRED typed HTTP boundary kept for unit tests only (GO-P3-2).
// Production traffic uses services.Server.routes() + NewMemoryServices — NewAPIHandler
// is never registered in cmd/kairo-runtime. Do not add production routes here without
// deleting the duplicate memory-services path first.
//
// Pattern (when wired): decode -> validate -> use case -> error mapping -> writeEnvelope.
type APIHandler struct {
	workspaceRepo domain.WorkspaceRepository
	projectRepo   domain.ProjectRepository
	toolchainRepo domain.ToolchainRepository
	buildHistory  domain.BuildHistoryRepository
	serverHistory domain.ServerHistoryRepository

	buildUseCase  *app.BuildUseCase
	deployUseCase *app.DeployUseCase
	serverUseCase *app.ServerUseCase

	eventHub *events.EventHub
	sandbox  *security.WorkspaceRoots

	secret string // local auth secret for desktop host mode
}

// NewAPIHandler creates a new APIHandler with all wired dependencies.
func NewAPIHandler(
	workspaceRepo domain.WorkspaceRepository,
	projectRepo domain.ProjectRepository,
	toolchainRepo domain.ToolchainRepository,
	buildHistory domain.BuildHistoryRepository,
	serverHistory domain.ServerHistoryRepository,
	buildUseCase *app.BuildUseCase,
	deployUseCase *app.DeployUseCase,
	serverUseCase *app.ServerUseCase,
	eventHub *events.EventHub,
	sandbox *security.WorkspaceRoots,
	secret string,
) *APIHandler {
	return &APIHandler{
		workspaceRepo: workspaceRepo,
		projectRepo:   projectRepo,
		toolchainRepo: toolchainRepo,
		buildHistory:  buildHistory,
		serverHistory: serverHistory,
		buildUseCase:  buildUseCase,
		deployUseCase: deployUseCase,
		serverUseCase: serverUseCase,
		eventHub:      eventHub,
		sandbox:       sandbox,
		secret:        secret,
	}
}

// HandleHealth handles GET /api/v1/health.
func (h *APIHandler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// HandleHealthReady handles GET /api/v1/health/ready.
func (h *APIHandler) HandleHealthReady(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// HandleWorkspaces handles GET /api/v1/workspaces and POST /api/v1/workspaces.
func (h *APIHandler) HandleWorkspaces(w http.ResponseWriter, r *http.Request) {
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)

	switch r.Method {
	case http.MethodGet:
		workspaces, err := h.workspaceRepo.List(r.Context())
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInternal,
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, workspaces)

	case http.MethodPost:
		var req CreateWorkspaceRequest
		if err := decodeEnvelopePayload(r, &env, &req); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInvalidRequest,
				Message: err.Error(),
			})
			return
		}
		// Accept either root (canonical) or rootPath (test/legacy alias).
		if req.Root == "" && req.RootPath != "" {
			req.Root = req.RootPath
		}
		if req.Name == "" && req.Root != "" {
			req.Name = filepath.Base(req.Root)
		}
		if req.Name == "" || req.Root == "" {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInvalidRequest,
				Message: "name and root are required",
			})
			return
		}

		ws := domain.Workspace{
			ID:   domain.WorkspaceID(fmt.Sprintf("ws_%s", req.Name)),
			Name: req.Name,
			Root: req.Root,
		}
		if err := h.workspaceRepo.Save(r.Context(), ws); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrConflict,
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, ws)

	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "method not allowed",
		})
	}
}

// HandleProjects handles GET /api/v1/projects.
func (h *APIHandler) HandleProjects(w http.ResponseWriter, r *http.Request) {
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)

	if r.Method != http.MethodGet {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "GET only",
		})
		return
	}

	wsID := r.URL.Query().Get("workspaceId")
	if wsID == "" {
		wsID = r.Header.Get("X-Kairo-Workspace-Id")
	}

	projects, err := h.projectRepo.List(r.Context(), domain.WorkspaceID(wsID))
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: err.Error(),
		})
		return
	}
	writeOK(w, env, projects)
}

// HandleBuilds handles GET /api/v1/builds and POST /api/v1/builds.
func (h *APIHandler) HandleBuilds(w http.ResponseWriter, r *http.Request) {
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	switch r.Method {
	case http.MethodGet:
		projectID := domain.ProjectID(r.URL.Query().Get("projectId"))
		runs, err := h.buildUseCase.List(r.Context(), wsID, projectID, 50)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInternal,
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, ToBuildResponseList(runs))

	case http.MethodPost:
		var req StartBuildRequest
		if err := decodeEnvelopePayload(r, &env, &req); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInvalidRequest,
				Message: err.Error(),
			})
			return
		}

		cmd := app.StartBuildCommand{
			WorkspaceID:   wsID,
			ProjectID:     domain.ProjectID(req.ProjectID),
			Clean:         req.Clean,
			Intent:        domain.BuildIntent(req.Intent),
			SelectedFiles: req.SelectedFiles,
		}

		run, err := h.buildUseCase.Start(r.Context(), cmd)
		if err != nil {
			_, msg := domain.MapError(err)
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.KairoErrorCode(msg),
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, ToBuildResponse(run))

	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "method not allowed",
		})
	}
}

// HandleBuildByID handles GET /api/v1/builds/{buildId} and DELETE /api/v1/builds/{buildId}.
func (h *APIHandler) HandleBuildByID(w http.ResponseWriter, r *http.Request) {
	buildID := r.PathValue("buildId")
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	switch r.Method {
	case http.MethodGet:
		run, err := h.buildUseCase.Get(r.Context(), wsID, domain.BuildID(buildID))
		if err != nil {
			status, code := domain.MapError(err)
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.KairoErrorCode(code),
				Message: err.Error(),
			})
			writeJSONMeta(w, status)
			return
		}
		writeOK(w, env, ToBuildResponse(run))

	case http.MethodDelete:
		if err := h.buildUseCase.Cancel(r.Context(), wsID, domain.BuildID(buildID)); err != nil {
			status, code := domain.MapError(err)
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.KairoErrorCode(code),
				Message: err.Error(),
			})
			writeJSONMeta(w, status)
			return
		}
		writeOK(w, env, map[string]string{"status": "cancelled"})

	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "method not allowed",
		})
	}
}

// HandleDeployments handles GET /api/v1/deployments and POST /api/v1/deployments.
func (h *APIHandler) HandleDeployments(w http.ResponseWriter, r *http.Request) {
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	switch r.Method {
	case http.MethodGet:
		projectID := domain.ProjectID(r.URL.Query().Get("projectId"))
		results, err := h.deployUseCase.ListDeployments(r.Context(), wsID, projectID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInternal,
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, results)

	case http.MethodPost:
		var req StartDeploymentRequest
		if err := decodeEnvelopePayload(r, &env, &req); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInvalidRequest,
				Message: err.Error(),
			})
			return
		}

		cmd := app.StartDeployCommand{
			WorkspaceID: wsID,
			ProjectID:   domain.ProjectID(req.ProjectID),
			BuildID:     domain.BuildID(req.BuildID),
			Scope:       app.DeployScope(req.Scope),
		}

		result, err := h.deployUseCase.Deploy(r.Context(), cmd)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrDeployFailed,
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, ToDeploymentResponse(result))

	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "method not allowed",
		})
	}
}

// HandleDeploymentByID handles GET /api/v1/deployments/{deploymentId}.
func (h *APIHandler) HandleDeploymentByID(w http.ResponseWriter, r *http.Request) {
	deploymentID := r.PathValue("deploymentId")
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	if r.Method != http.MethodGet {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "GET only",
		})
		return
	}

	result, err := h.deployUseCase.GetDeployment(r.Context(), wsID, deploymentID)
	if err != nil {
		status, code := domain.MapError(err)
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.KairoErrorCode(code),
			Message: err.Error(),
		})
		writeJSONMeta(w, status)
		return
	}
	writeOK(w, env, ToDeploymentResponse(result))
}

// HandleServers handles GET /api/v1/servers and POST /api/v1/servers.
func (h *APIHandler) HandleServers(w http.ResponseWriter, r *http.Request) {
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	switch r.Method {
	case http.MethodGet:
		records, err := h.serverUseCase.List(r.Context(), wsID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInternal,
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, records)

	case http.MethodPost:
		var req StartServerUseCaseRequest
		if err := decodeEnvelopePayload(r, &env, &req); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInvalidRequest,
				Message: err.Error(),
			})
			return
		}

		cmd := app.StartServerCommand{
			WorkspaceID: wsID,
			ProjectID:   domain.ProjectID(req.ProjectID),
		}

		record, err := h.serverUseCase.Start(r.Context(), cmd)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInternal,
				Message: err.Error(),
			})
			return
		}
		writeOK(w, env, ToServerUseCaseResponse(*record))

	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "method not allowed",
		})
	}
}

// HandleServerByID handles GET /api/v1/servers/{serverId} and DELETE /api/v1/servers/{serverId}.
func (h *APIHandler) HandleServerByID(w http.ResponseWriter, r *http.Request) {
	serverID := r.PathValue("serverId")
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	switch r.Method {
	case http.MethodGet:
		record, err := h.serverUseCase.Get(r.Context(), wsID, domain.ServerID(serverID))
		if err != nil {
			status, code := domain.MapError(err)
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.KairoErrorCode(code),
				Message: err.Error(),
			})
			writeJSONMeta(w, status)
			return
		}
		writeOK(w, env, ToServerUseCaseResponse(*record))

	case http.MethodDelete:
		if err := h.serverUseCase.Delete(r.Context(), wsID, domain.ServerID(serverID)); err != nil {
			status, code := domain.MapError(err)
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.KairoErrorCode(code),
				Message: err.Error(),
			})
			writeJSONMeta(w, status)
			return
		}
		writeOK(w, env, map[string]string{"status": "stopped"})

	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "method not allowed",
		})
	}
}

// HandleServerRestart handles POST /api/v1/servers/{serverId}/restart.
func (h *APIHandler) HandleServerRestart(w http.ResponseWriter, r *http.Request) {
	serverID := r.PathValue("serverId")
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	if r.Method != http.MethodPost {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "POST only",
		})
		return
	}

	cmd := app.RestartServerCommand{
		WorkspaceID: wsID,
		ServerID:    domain.ServerID(serverID),
	}

	record, err := h.serverUseCase.Restart(r.Context(), cmd)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: err.Error(),
		})
		return
	}
	writeOK(w, env, ToServerUseCaseResponse(*record))
}

// HandleServerLogs handles GET /api/v1/servers/{serverId}/logs.
func (h *APIHandler) HandleServerLogs(w http.ResponseWriter, r *http.Request) {
	serverID := r.PathValue("serverId")
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)
	wsID := domain.WorkspaceID(env.WorkspaceID)
	if wsID == "" {
		wsID = domain.WorkspaceID(r.Header.Get("X-Kairo-Workspace-Id"))
	}

	if r.Method != http.MethodGet {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "GET only",
		})
		return
	}

	// Verify server exists
	_, err := h.serverUseCase.Get(r.Context(), wsID, domain.ServerID(serverID))
	if err != nil {
		status, code := domain.MapError(err)
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.KairoErrorCode(code),
			Message: err.Error(),
		})
		writeJSONMeta(w, status)
		return
	}

	// Return empty logs for now — log streaming is implemented via SSE events
	writeOK(w, env, []map[string]string{})
}

// HandleEvents handles GET /api/v1/events (SSE event stream or WebSocket upgrade).
func (h *APIHandler) HandleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "GET only",
		})
		return
	}

	// WebSocket upgrade: authenticate via subprotocol, then delegate to EventHub.
	if strings.ToLower(r.Header.Get("Upgrade")) == "websocket" {
		if h.secret != "" {
			offered := parseSubprotocols(r.Header.Get("Sec-WebSocket-Protocol"))
			var presented string
			for i, p := range offered {
				if p == WebSocketSubprotocol {
					if i+1 < len(offered) {
						presented = offered[i+1]
					}
					break
				}
				if eq := strings.SplitN(p, "=", 2); len(eq) == 2 && eq[0] == WebSocketSubprotocol {
					presented = eq[1]
					break
				}
			}
			if presented == "" || subtle.ConstantTimeCompare([]byte(presented), []byte(h.secret)) != 1 {
				writeError(w, "", "", protocol.KairoError{
					Code:    protocol.ErrUnauthenticated,
					Message: "missing or invalid WebSocket subprotocol",
				})
				return
			}
			// Echo the secret back as the selected subprotocol.
			w.Header().Set("Sec-WebSocket-Protocol", presented)
		}
		h.eventHub.Serve(w, r)
		return
	}

	// SSE fallback (also protected by the HTTP secret middleware).
	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "streaming not supported",
		})
		return
	}

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Kairo-Workspace-Id")
	}

	afterSeq := int64(0)
	if afterStr := r.URL.Query().Get("after"); afterStr != "" {
		fmt.Sscanf(afterStr, "%d", &afterSeq)
	}

	ch, cancel := h.eventHub.Subscribe(workspaceID, "", afterSeq)
	defer cancel()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case evt := <-ch:
			data, _ := json.Marshal(evt)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// HandleToolchains handles GET /api/v1/toolchains.
func (h *APIHandler) HandleToolchains(w http.ResponseWriter, r *http.Request) {
	env := protocol.RequestEnvelope{}
	_ = decodeEnvelope(r, &env)

	if r.Method != http.MethodGet {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "GET only",
		})
		return
	}

	toolchains, err := h.toolchainRepo.List(r.Context())
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: err.Error(),
		})
		return
	}
	writeOK(w, env, toolchains)
}
