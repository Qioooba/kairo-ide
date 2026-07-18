package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/encoding"
	"github.com/kairo-ide/runtime-agent/internal/log"
	"github.com/kairo-ide/runtime-agent/internal/search"
	"github.com/kairo-ide/runtime-agent/internal/security"
)

// ----- Workspaces -----

func (s *Server) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if s.Services.WorkspaceStore == nil {
			writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "WorkspaceStore not configured"})
			return
		}
		writeOK(w, protocol.RequestEnvelope{}, s.Services.WorkspaceStore.List())
	case http.MethodPost:
		env, body, err := readEnvelopeAndBody(r)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		var p struct {
			RootPath string `json:"rootPath"`
			Name     string `json:"name"`
		}
		if err := json.Unmarshal(extractPayload(body), &p); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		if p.RootPath == "" {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "rootPath required"})
			return
		}
		abs, err := filepath.Abs(p.RootPath)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		ws, err := s.Services.WorkspaceStore.Open(abs, p.Name)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrForbidden, Message: err.Error()})
			return
		}
		writeOK(w, env, ws)
	default:
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or POST only"})
	}
}

func (s *Server) handleWorkspacesSub(w http.ResponseWriter, r *http.Request) {
	// /api/v1/workspaces/{id}[/scan]
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/workspaces/")
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "workspace id required"})
		return
	}
	id := parts[0]
	sub := ""
	if len(parts) == 2 {
		sub = parts[1]
	}
	switch {
	case sub == "" && r.Method == http.MethodDelete:
		env, _, _ := readEnvelopeAndBody(r)
		if s.Services.WorkspaceStore == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "WorkspaceStore not configured"})
			return
		}
		if err := s.Services.WorkspaceStore.Close(id); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
			return
		}
		writeOK(w, env, map[string]bool{"ok": true})
	case sub == "scan" && r.Method == http.MethodPost:
		env, _, _ := readEnvelopeAndBody(r)
		env.WorkspaceID = id
		if s.Services.WorkspaceStore == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "WorkspaceStore not configured"})
			return
		}
		ws, err := s.Services.WorkspaceStore.Get(id)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
			return
		}
		detected, err := scanWorkspace(ws.RootPath)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
			return
		}
		writeOK(w, env, map[string]any{"detected": detected})
	default:
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrNotFound, Message: "unknown subpath"})
	}
}

// ----- Projects -----

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)
	if s.Services.ProjectStore == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ProjectStore not configured"})
		return
	}
	writeOK(w, env, s.Services.ProjectStore.List())
}

func (s *Server) handleProjectByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/projects/")
	if rest == "" {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "id required"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	switch r.Method {
	case http.MethodGet:
		if s.Services.ProjectStore == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ProjectStore not configured"})
			return
		}
		p, err := s.Services.ProjectStore.Get(rest)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
			return
		}
		writeOK(w, env, p)
	case http.MethodPut:
		var p struct {
			Config any `json:"config"`
		}
		if err := json.Unmarshal(extractPayload(body), &p); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		if s.Services.ProjectStore == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ProjectStore not configured"})
			return
		}
		updated, err := s.Services.ProjectStore.Update(rest, p.Config)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		writeOK(w, env, updated)
	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or PUT only"})
	}
}

// ----- Toolchains -----

func (s *Server) handleToolchains(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)
	if s.Services.ToolchainRegistry == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ToolchainRegistry not configured"})
		return
	}
	writeOK(w, env, s.Services.ToolchainRegistry.List())
}

func (s *Server) handleToolchainImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	var p struct {
		Path  string `json:"path"`
		Label string `json:"label"`
	}
	if err := json.Unmarshal(extractPayload(body), &p); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if s.Services.ToolchainRegistry == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ToolchainRegistry not configured"})
		return
	}
	t, err := s.Services.ToolchainRegistry.Import(p.Path, p.Label)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrToolchainMissing, Message: err.Error()})
		return
	}
	writeOK(w, env, t)
}

// ----- Builds -----

func (s *Server) handleBuilds(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		env, _, _ := readEnvelopeAndBody(r)
		if s.Services.BuildEngine == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "BuildEngine not configured"})
			return
		}
		writeOK(w, env, s.Services.BuildEngine.List())
	case http.MethodPost:
		env, body, _ := readEnvelopeAndBody(r)
		if s.Services.BuildEngine == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "BuildEngine not configured"})
			return
		}
		res, err := s.Services.BuildEngine.Start(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrCompileFailed, Message: err.Error()})
			return
		}
		writeOK(w, env, res)
	default:
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or POST only"})
	}
}

func (s *Server) handleBuildByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/builds/")
	env, _, _ := readEnvelopeAndBody(r)
	if s.Services.BuildEngine == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "BuildEngine not configured"})
		return
	}
	res, err := s.Services.BuildEngine.Get(rest)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
		return
	}
	writeOK(w, env, res)
}

// ----- Deployments -----

func (s *Server) handleDeployments(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		env, _, _ := readEnvelopeAndBody(r)
		if s.Services.Deployer == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Deployer not configured"})
			return
		}
		writeOK(w, env, s.Services.Deployer.List())
	case http.MethodPost:
		env, body, _ := readEnvelopeAndBody(r)
		if s.Services.Deployer == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Deployer not configured"})
			return
		}
		res, err := s.Services.Deployer.Publish(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrDeployFailed, Message: err.Error()})
			return
		}
		writeOK(w, env, res)
	default:
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or POST only"})
	}
}

func (s *Server) handleDeploymentByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/deployments/")
	env, _, _ := readEnvelopeAndBody(r)
	if s.Services.Deployer == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Deployer not configured"})
		return
	}
	res, err := s.Services.Deployer.Get(rest)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
		return
	}
	writeOK(w, env, res)
}

// ----- Servers -----

func (s *Server) handleServers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		env, _, _ := readEnvelopeAndBody(r)
		if s.Services.ServerRunner == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ServerRunner not configured"})
			return
		}
		writeOK(w, env, s.Services.ServerRunner.List())
	case http.MethodPost:
		env, body, _ := readEnvelopeAndBody(r)
		if s.Services.ServerRunner == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ServerRunner not configured"})
			return
		}
		srv, err := s.Services.ServerRunner.Start(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrProcessSpawnFailed, Message: err.Error()})
			return
		}
		writeOK(w, env, srv)
	default:
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or POST only"})
	}
}

func (s *Server) handleServerSub(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/servers/")
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "id required"})
		return
	}
	id := parts[0]
	sub := ""
	if len(parts) == 2 {
		sub = parts[1]
	}
	env, body, _ := readEnvelopeAndBody(r)
	if s.Services.ServerRunner == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ServerRunner not configured"})
		return
	}
	switch sub {
	case "":
		switch r.Method {
		case http.MethodGet:
			srv, err := s.Services.ServerRunner.Get(id)
			if err != nil {
				writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
				return
			}
			writeOK(w, env, srv)
		case http.MethodDelete:
			srv, err := s.Services.ServerRunner.Stop(id, extractPayload(body))
			if err != nil {
				writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrProcessSpawnFailed, Message: err.Error()})
				return
			}
			writeOK(w, env, srv)
		default:
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or DELETE only"})
		}
	case "debug":
		if r.Method != http.MethodPost {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
			return
		}
		srv, err := s.Services.ServerRunner.Debug(id)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrDebugAttachFailed, Message: err.Error()})
			return
		}
		writeOK(w, env, srv)
	case "logs":
		s.handleServerLogs(w, r, id, env)
	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "unknown subpath"})
	}
}

func (s *Server) handleServerLogs(w http.ResponseWriter, r *http.Request, id string, env protocol.RequestEnvelope) {
	if s.Services.ServerRunner == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ServerRunner not configured"})
		return
	}
	follow := r.URL.Query().Get("follow") == "true"
	lines, err := s.Services.ServerRunner.Logs(id, follow)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, lines)
}

// ----- Search -----

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	if s.Services.Searcher == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Searcher not configured"})
		return
	}
	res, err := s.Services.Searcher.Search(extractPayload(body))
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, res)
}

// ----- Encoding -----

func (s *Server) handleEncodingDetect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	if s.Services.Encoder == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Encoder not configured"})
		return
	}
	res, err := s.Services.Encoder.Detect(extractPayload(body))
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, res)
}

func (s *Server) handleEncodingRecode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	if s.Services.Encoder == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Encoder not configured"})
		return
	}
	res, err := s.Services.Encoder.Recode(extractPayload(body))
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, res)
}

func (s *Server) handleEncodingValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	if s.Services.Encoder == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Encoder not configured"})
		return
	}
	res, err := s.Services.Encoder.Validate(extractPayload(body))
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, res)
}

// ----- Auth -----

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	if s.Services.Auth == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Auth not configured"})
		return
	}
	res, err := s.Services.Auth.Login(extractPayload(body), w)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrUnauthenticated, Message: err.Error()})
		return
	}
	writeOK(w, env, res)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)
	if s.Services.Auth != nil {
		_ = s.Services.Auth.Logout(r, w)
	}
	writeOK(w, env, map[string]bool{"ok": true})
}

// ----- Audit -----

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)
	if s.audit == nil {
		writeOK(w, env, []any{})
		return
	}
	rdr, err := s.audit.OpenReader()
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	events, err := rdr.Read(0)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, events)
}

// ----- WebSocket -----

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if s.Services.EventBus == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "EventBus not configured"})
		return
	}
	s.Services.EventBus.Serve(w, r)
}

// ----- JDT Language Server -----
//
// /api/v1/jdtls
//   GET     — current distribution status (state, version, JRE, etc.)
//   POST    — prepare (ensure JDT LS distribution is installed)
//
// As of Phase 4, the Theia backend owns the JDT LS process
// lifecycle and LSP communication. The Go Agent provides the
// launch descriptor and manages the distribution.

func (s *Server) handleJDTLS(w http.ResponseWriter, r *http.Request) {
	if s.Services.JDTLS == nil {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "JDTLS not configured on this agent",
		})
		return
	}
	switch r.Method {
	case http.MethodGet:
		env, _, _ := readEnvelopeAndBody(r)
		st, err := s.Services.JDTLS.Status()
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code: protocol.ErrInternal, Message: err.Error(),
			})
			return
		}
		writeOK(w, env, st)
	case http.MethodPost:
		env, _, _ := readEnvelopeAndBody(r)
		rep, err := s.Services.JDTLS.Prepare(r.Context())
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code: protocol.ErrInternal, Message: err.Error(),
			})
			return
		}
		writeOK(w, env, rep)
	default:
		writeError(w, "", "", protocol.KairoError{
			Code: protocol.ErrInvalidRequest, Message: "GET or POST only",
		})
	}
}

// handleJDTLSLaunchDescriptor returns the launch descriptor
// for JDT LS. The Theia backend calls this to know how to spawn
// the JDT LS process.
//
// GET /api/v1/workspaces/{ws}/java/launch-descriptor?projectId={project}
func (s *Server) handleJDTLSLaunchDescriptor(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	if s.Services.JDTLS == nil {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "JDTLS not configured on this agent",
		})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)
	// Extract workspace ID from the path: /api/v1/workspaces/{ws}/java/launch-descriptor
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/workspaces/")
	parts := strings.SplitN(rest, "/", 3)
	if len(parts) < 3 || parts[1] != "java" || parts[2] != "launch-descriptor" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrInvalidRequest, Message: "invalid path",
		})
		return
	}
	workspaceID := parts[0]
	projectID := r.URL.Query().Get("projectId")
	if projectID == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrInvalidRequest, Message: "projectId query parameter required",
		})
		return
	}

	// Resolve project from repository.
	project, err := s.Services.ProjectRepo.Get(r.Context(), domain.WorkspaceID(workspaceID), domain.ProjectID(projectID))
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrNotFound, Message: fmt.Sprintf("project not found: %s", err.Error()),
		})
		return
	}

	// Resolve toolchain.
	if project.ToolchainID == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrToolchainMissing, Message: "project has no toolchain configured",
		})
		return
	}
	if s.Services.ToolchainRegistry == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrInternal, Message: "ToolchainRegistry not configured",
		})
		return
	}
	toolchain, err := s.Services.ToolchainRepo.Get(r.Context(), project.ToolchainID)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrToolchainMissing, Message: fmt.Sprintf("toolchain not found: %s", err.Error()),
		})
		return
	}

	// Resolve workspace root for the project working directory.
	var projectRoot string
	if s.Services.WorkspaceStore != nil {
		ws, err := s.Services.WorkspaceStore.Get(workspaceID)
		if err == nil {
			projectRoot = ws.RootPath
		}
	}
	if projectRoot == "" {
		projectRoot = projectID // fallback
	}

	// Build the launch descriptor.
	desc, err := s.Services.JDTLS.GetLaunchDescriptor(r.Context(), workspaceID, projectID)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrInternal, Message: fmt.Sprintf("build launch descriptor: %s", err.Error()),
		})
		return
	}
	_ = project
	_ = toolchain
	writeOK(w, env, desc)
}

// handleJDTLSPrepare downloads and verifies the JDT LS
// distribution for a workspace.
//
// POST /api/v1/workspaces/{ws}/java/prepare
func (s *Server) handleJDTLSPrepare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	if s.Services.JDTLS == nil {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "JDTLS not configured on this agent",
		})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)

	// Check if already prepared.
	rep, err := s.Services.JDTLS.Prepare(r.Context())
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: fmt.Sprintf("prepare failed: %s", err.Error()),
		})
		return
	}
	writeOK(w, env, rep)
}

// payloadOf extracts the JSON payload from a request that
// has an envelope. We tolerate both { "requestId":..., "payload": {...}}
// and a bare payload.
func payloadOf(r *http.Request) json.RawMessage {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 16*1024*1024))
	return extractPayload(body)
}

// readEnvelopeAndBody reads the request body once, decodes the
// envelope, and returns both. Use this from any handler that
// needs to read the payload.
func readEnvelopeAndBody(r *http.Request) (protocol.RequestEnvelope, []byte, error) {
	env := protocol.RequestEnvelope{}
	if r.Method == http.MethodGet || r.Method == http.MethodDelete {
		env.RequestID = r.Header.Get("X-Kairo-Request-Id")
		env.CorrelationID = r.Header.Get("X-Kairo-Correlation-Id")
		env.WorkspaceID = r.Header.Get("X-Kairo-Workspace-Id")
		return env, nil, nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024*1024))
	if err != nil {
		return env, body, err
	}
	if err := json.Unmarshal(body, &env); err != nil {
		// Tolerate bare payloads (no envelope).
		return env, body, nil
	}
	if env.RequestID == "" {
		env.RequestID = r.Header.Get("X-Kairo-Request-Id")
	}
	if env.CorrelationID == "" {
		env.CorrelationID = r.Header.Get("X-Kairo-Correlation-Id")
	}
	return env, body, nil
}

// extractPayload finds the `payload` field in a body, falling
// back to the body itself.
func extractPayload(body []byte) json.RawMessage {
	if len(body) == 0 {
		return nil
	}
	var env struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(body, &env); err == nil && len(env.Payload) > 0 {
		return env.Payload
	}
	return body
}

// keep helpers used.
var (
	_ = log.Fields{}
	_ = security.WorkspaceRoots{}
	_ = encoding.UTF8
	_ = search.DefaultExcludes
)

// handleWorkspacesJava dispatches workspace-level Java endpoints.
// It routes /api/v1/workspaces/{ws}/java/launch-descriptor to the
// launch descriptor handler.
func (s *Server) handleWorkspacesJava(w http.ResponseWriter, r *http.Request) {
	ws := r.PathValue("ws")
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/workspaces/"+ws+"/java/")
	switch {
	case rest == "launch-descriptor":
		s.handleJDTLSLaunchDescriptor(w, r)
	case rest == "prepare":
		s.handleJDTLSPrepare(w, r)
	default:
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrNotFound, Message: "unknown java subpath: " + rest})
	}
}

// handleJDTProject dispatches /api/v1/jdtls/project. POST
// generates a JDT LS project model under the runtime data
// dir for a legacy project. GET returns the current status
// (the workspace the model is bound to and the resolved
// classpath).
func (s *Server) handleJDTProject(w http.ResponseWriter, r *http.Request) {
	if s.Services.JDTProjectGenerator == nil {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInternal,
			Message: "JDTProjectGenerator not configured on this agent",
		})
		return
	}
	switch r.Method {
	case http.MethodGet:
		env, _, _ := readEnvelopeAndBody(r)
		wsID := r.URL.Query().Get("workspaceId")
		st, err := s.Services.JDTProjectGenerator.Status(wsID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code: protocol.ErrInternal, Message: err.Error(),
			})
			return
		}
		writeOK(w, env, st)
	case http.MethodPost:
		env, body, _ := readEnvelopeAndBody(r)
		res, err := s.Services.JDTProjectGenerator.Generate(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code: protocol.ErrInvalidRequest, Message: err.Error(),
			})
			return
		}
		writeOK(w, env, res)
	default:
		writeError(w, "", "", protocol.KairoError{
			Code: protocol.ErrInvalidRequest, Message: "GET or POST only",
		})
	}
}
