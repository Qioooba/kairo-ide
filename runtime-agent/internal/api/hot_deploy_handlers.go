package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/debug"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
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
		Intent:        "full",
		SelectedFiles: req.Files,
	}
	if len(req.Files) > 0 {
		buildReq.Intent = "selected-files"
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

// handleJvmCompile handles POST /api/v1/jvm/compile.
// Thin wrapper around incremental compile for a single source file
// (HotSwap / probe callers). Resolves projectId from the file path
// when omitted.
func (s *Server) handleJvmCompile(w http.ResponseWriter, r *http.Request) {
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
		File      string `json:"file"`
		ProjectID string `json:"projectId"`
	}
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if req.File == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "file required"})
		return
	}

	if s.Services.ProjectStore == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ProjectStore not configured"})
		return
	}

	var p domain.Project
	var err error
	if req.ProjectID != "" {
		p, err = s.Services.ProjectStore.Get(req.ProjectID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrNotFound,
				Message: fmt.Sprintf("project not found: %s", req.ProjectID),
			})
			return
		}
	} else {
		p, err = findProjectContainingFile(s.Services.ProjectStore, req.File)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrNotFound,
				Message: err.Error(),
			})
			return
		}
		req.ProjectID = string(p.ID)
	}

	buildReq := BuildRequest{
		ProjectID:     req.ProjectID,
		Clean:         false,
		Intent:        "selected-files",
		SelectedFiles: []string{req.File},
	}
	if err := hydrateBuildRequest(&buildReq, p); err != nil {
		writeOK(w, env, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
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
		writeOK(w, env, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	classPath := res.OutputDir
	if classPath == "" {
		classPath = p.OutputDir
	}
	failed := strings.EqualFold(res.State, "failed") || strings.EqualFold(res.State, "failure")
	if failed || res.Error != "" {
		errMsg := res.Error
		if errMsg == "" {
			errMsg = fmt.Sprintf("compilation %s", res.State)
		}
		writeOK(w, env, map[string]interface{}{
			"success":   false,
			"classPath": classPath,
			"error":     errMsg,
		})
		return
	}

	writeOK(w, env, map[string]interface{}{
		"success":   true,
		"classPath": classPath,
	})
}

// handleJvmRedefine handles POST /api/v1/jvm/redefine (BD-P1-4).
// Attempts live JDWP VirtualMachine.RedefineClasses when an exclusive
// JDWP port is available (request jdwpPort/jdwpHost, else first running
// server with a debug port). There is no in-agent DAP session registry
// to share redefine with an already-attached debugger — when DAP owns
// the port, callers must use the frontend DebugSession.sendCustomRequest
// path (JavaHotSwapService) instead of a second JDWP attach. This handler
// never reports success on attach failure: it returns ErrUnsupported/501.
func (s *Server) handleJvmRedefine(w http.ResponseWriter, r *http.Request) {
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
		SourcePath string `json:"sourcePath"`
		ClassPath  string `json:"classPath"`
		ClassName  string `json:"className"`
		JdwpHost   string `json:"jdwpHost"`
		JdwpPort   int    `json:"jdwpPort"`
	}
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if req.SourcePath == "" && req.ClassName == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "sourcePath or className required"})
		return
	}
	if req.ClassPath == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "classPath required (compiled output directory)"})
		return
	}

	host := req.JdwpHost
	port := req.JdwpPort
	if port <= 0 {
		host, port = s.resolveJDWPEndpoint()
	}
	if port <= 0 {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrUnsupported,
			Message: "no JDWP debug port available for class redefine; start the server in debug mode or pass jdwpPort",
			Details: map[string]string{
				"sourcePath": req.SourcePath,
				"classPath":  req.ClassPath,
				"hint":       "HotSwap requires an exclusive JDWP listener; if a debugger is already attached, use the debugger HotSwap instead",
			},
		})
		return
	}

	result, err := debug.RedefineClassLive(debug.LiveRedefineRequest{
		Host:       host,
		Port:       port,
		ClassPath:  req.ClassPath,
		SourcePath: req.SourcePath,
		ClassName:  req.ClassName,
	}, nil)
	if err != nil {
		msg := err.Error()
		code := protocol.ErrInternal
		lower := strings.ToLower(msg)
		if strings.Contains(lower, "dial") || strings.Contains(lower, "handshake") {
			code = protocol.ErrUnsupported
			msg = "cannot attach JDWP for redefine (port busy or no listener): " + err.Error()
		} else if strings.Contains(lower, "not loaded") || strings.Contains(lower, "invalid class") {
			code = protocol.ErrInvalidRequest
		}
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    code,
			Message: msg,
			Details: map[string]string{
				"sourcePath": req.SourcePath,
				"classPath":  req.ClassPath,
				"jdwpPort":   fmt.Sprintf("%d", port),
			},
		})
		return
	}

	writeOK(w, env, map[string]interface{}{
		"success":   true,
		"className": result.ClassName,
		"refTypeId": result.RefTypeID,
		"byteCount": result.ByteCount,
		"jdwpHost":  result.JDWPHost,
		"jdwpPort":  result.JDWPPort,
	})
}

// resolveJDWPEndpoint picks a debug port from running servers.
func (s *Server) resolveJDWPEndpoint() (host string, port int) {
	if s.Services == nil || s.Services.ServerRunner == nil {
		return "", 0
	}
	for _, srv := range s.Services.ServerRunner.List() {
		if srv == nil || srv.Ports == nil || srv.Ports.Debug <= 0 {
			continue
		}
		state := strings.ToLower(srv.State)
		if state == "running" || state == "starting" || state == "debugging" {
			return "127.0.0.1", srv.Ports.Debug
		}
	}
	return "", 0
}

// handleJDTLSDistribution handles GET /api/v1/jdtls/distribution.
func (s *Server) handleJDTLSDistribution(w http.ResponseWriter, r *http.Request) {
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
	st, err := s.Services.JDTLS.DistributionStatus()
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrInternal, Message: err.Error(),
		})
		return
	}
	writeOK(w, env, st)
}

// findProjectContainingFile picks the project whose root is the
// longest path prefix of file (most specific match).
func findProjectContainingFile(store ProjectStore, file string) (domain.Project, error) {
	abs, err := filepath.Abs(file)
	if err != nil {
		return domain.Project{}, fmt.Errorf("resolve file path: %w", err)
	}
	abs = filepath.Clean(abs)

	var best domain.Project
	bestLen := -1
	for _, p := range store.List() {
		root := p.RootPath
		if root == "" {
			root = p.Root
		}
		if root == "" {
			continue
		}
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		rootAbs = filepath.Clean(rootAbs)
		rel, err := filepath.Rel(rootAbs, abs)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if len(rootAbs) > bestLen {
			best = p
			bestLen = len(rootAbs)
		}
	}
	if bestLen < 0 {
		return domain.Project{}, fmt.Errorf("no project contains file: %s", file)
	}
	return best, nil
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
