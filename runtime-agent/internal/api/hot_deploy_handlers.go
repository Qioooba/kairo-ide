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
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
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

	var normalizedFiles []string
	for _, f := range req.Files {
		resolved, err := pathpolicy.ResolveURIOrPath(f)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code:    protocol.ErrInvalidRequest,
				Message: fmt.Sprintf("invalid file path or URI %q: %v", f, err),
			})
			return
		}
		normalizedFiles = append(normalizedFiles, resolved)
	}
	req.Files = normalizedFiles

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
		SourceURI string `json:"sourceUri"`
		ProjectID string `json:"projectId"`
	}
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	rawFile := req.File
	if rawFile == "" {
		rawFile = req.SourceURI
	}
	if rawFile == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "file or sourceUri required"})
		return
	}

	nativeFile, err := pathpolicy.ResolveURIOrPath(rawFile)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: fmt.Sprintf("invalid file path or URI: %v", err),
		})
		return
	}
	req.File = nativeFile

	if s.Services.ProjectStore == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ProjectStore not configured"})
		return
	}

	var p domain.Project
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
// handleJvmRedefine handles POST /api/v1/jvm/redefine (BD-P1-4 / PR03 F03).
// It redefines classes on the VM via JDWP using an explicit, unambiguous
// target binding (projectId, serverId, runtimeInstanceId, sessionGeneration).
// Blind fallback to the first running server is strictly prohibited.
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
		SourcePath string                       `json:"sourcePath"`
		SourceURI  string                       `json:"sourceUri"`
		ClassPath  string                       `json:"classPath"`
		ClassName     string                       `json:"className"`
		ExpectedHash  string                       `json:"expectedHash"`
		ClassLoaderID string                       `json:"classLoaderId"`
		JdwpHost      string                       `json:"jdwpHost"`
		JdwpPort   int                          `json:"jdwpPort"`
		ProjectID  string                       `json:"projectId"`
		ServerID   string                       `json:"serverId"`
		Target     *protocol.DebugTargetBinding `json:"target"`
	}
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if req.SourcePath == "" && req.SourceURI != "" {
		req.SourcePath = req.SourceURI
	}
	if req.SourcePath != "" {
		if native, err := pathpolicy.ResolveURIOrPath(req.SourcePath); err == nil {
			req.SourcePath = native
		}
	}
	if req.ClassPath != "" {
		if native, err := pathpolicy.ResolveURIOrPath(req.ClassPath); err == nil {
			req.ClassPath = native
		}
	}
	if req.SourcePath == "" && req.ClassName == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "sourcePath or className required"})
		return
	}
	if req.ClassPath == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "classPath required (compiled output directory)"})
		return
	}

	host := strings.TrimSpace(req.JdwpHost)
	if host == "" {
		host = "127.0.0.1"
	}
	// Restrict JDWP host to loopback only to prevent SSRF
	if host != "127.0.0.1" && host != "localhost" && host != "::1" && host != "[::1]" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: fmt.Sprintf("invalid jdwpHost %q: only loopback connections are permitted", host),
		})
		return
	}

	// Mandatory target endpoint authorization
	resolvedPort, targetErr := s.resolveTargetEndpoint(req.Target, req.ProjectID, req.ServerID, req.SourcePath)
	if targetErr != nil {
		writeError(w, env.RequestID, env.CorrelationID, *targetErr)
		return
	}

	port := req.JdwpPort
	if port <= 0 {
		port = resolvedPort
	} else if port != resolvedPort {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: fmt.Sprintf("jdwpPort %d does not match authorized target port %d", port, resolvedPort),
		})
		return
	}

	classLoaderID := req.ClassLoaderID
	if classLoaderID == "" && req.Target != nil {
		classLoaderID = req.Target.ClassLoaderID
	}

	result, err := debug.RedefineClassLive(debug.LiveRedefineRequest{
		Host:          host,
		Port:          port,
		ClassPath:     req.ClassPath,
		SourcePath:    req.SourcePath,
		ClassName:     req.ClassName,
		ExpectedHash:  req.ExpectedHash,
		ClassLoaderID: classLoaderID,
	}, nil)
	if err != nil {
		msg := err.Error()
		code := protocol.ErrInternal
		lower := strings.ToLower(msg)
		if strings.Contains(lower, "dial") || strings.Contains(lower, "handshake") {
			code = protocol.ErrUnsupported
			msg = "cannot attach JDWP for redefine (port busy or no listener): " + err.Error()
		} else if strings.Contains(lower, "not loaded") || strings.Contains(lower, "invalid class") ||
			strings.Contains(lower, "ambiguous_class_loader") || strings.Contains(lower, "class_loader_") {
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

// resolveTargetEndpoint resolves the unique, authorized debug port for a target (PR03 / F03 / T09-T11).
// It rejects missing, ambiguous, or stale targets and NEVER falls back blindly to the first running server.
func (s *Server) resolveTargetEndpoint(target *protocol.DebugTargetBinding, projectID, serverID, sourcePath string) (int, *protocol.KairoError) {
	if target != nil {
		if projectID == "" {
			projectID = target.ProjectID
		}
		if serverID == "" {
			serverID = target.ServerID
		}
	}
	if projectID == "" && sourcePath != "" && s.Services != nil && s.Services.ProjectStore != nil {
		if p, err := findProjectContainingFile(s.Services.ProjectStore, sourcePath); err == nil && string(p.ID) != "" {
			projectID = string(p.ID)
		}
	}

	if projectID == "" && serverID == "" {
		return 0, &protocol.KairoError{
			Code:    protocol.ErrTargetNotFound,
			Message: "explicit target binding (projectId or serverId) is required for class redefine; blind fallback to first running server is prohibited",
		}
	}

	if s.Services == nil || s.Services.ServerRunner == nil {
		return 0, &protocol.KairoError{
			Code:    protocol.ErrUnsupported,
			Message: "no JDWP debug port available for class redefine; start the server in debug mode",
		}
	}

	allServers := s.Services.ServerRunner.List()

	if serverID != "" {
		for _, srv := range allServers {
			if srv != nil && srv.ID == serverID {
				state := strings.ToLower(srv.State)
				if (state != "running" && state != "starting" && state != "debugging") || srv.Ports == nil || srv.Ports.Debug <= 0 {
					return 0, &protocol.KairoError{
						Code:    protocol.ErrUnsupported,
						Message: fmt.Sprintf("target server %s is not running in debug mode", serverID),
					}
				}
				if target != nil {
					if target.RuntimeInstanceID != "" && srv.RuntimeInstanceID != "" && target.RuntimeInstanceID != srv.RuntimeInstanceID {
						return 0, &protocol.KairoError{
							Code:    protocol.ErrStaleTarget,
							Message: fmt.Sprintf("stale target: runtime instance mismatch (%s != %s)", target.RuntimeInstanceID, srv.RuntimeInstanceID),
						}
					}
					if target.DeploymentGeneration > 0 && srv.Generation > 0 && target.DeploymentGeneration != srv.Generation {
						return 0, &protocol.KairoError{
							Code:    protocol.ErrStaleTarget,
							Message: fmt.Sprintf("stale target: server generation mismatch (%d != %d)", target.DeploymentGeneration, srv.Generation),
						}
					}
				}
				return srv.Ports.Debug, nil
			}
		}
		return 0, &protocol.KairoError{
			Code:    protocol.ErrTargetNotFound,
			Message: fmt.Sprintf("target server %s not found", serverID),
		}
	}

	// serverID is empty, filter by projectID
	var candidates []*ServerResponse
	for _, srv := range allServers {
		if srv != nil && srv.ProjectID == projectID {
			state := strings.ToLower(srv.State)
			if (state == "running" || state == "starting" || state == "debugging") && srv.Ports != nil && srv.Ports.Debug > 0 {
				candidates = append(candidates, srv)
			}
		}
	}

	if len(candidates) == 0 {
		return 0, &protocol.KairoError{
			Code:    protocol.ErrTargetNotFound,
			Message: fmt.Sprintf("no running debug server found for project: %s", projectID),
		}
	}
	if len(candidates) > 1 {
		return 0, &protocol.KairoError{
			Code:    protocol.ErrTargetAmbiguous,
			Message: fmt.Sprintf("multiple running debug servers found for project %s; explicit serverId target binding required", projectID),
		}
	}

	matched := candidates[0]
	if target != nil {
		if target.RuntimeInstanceID != "" && matched.RuntimeInstanceID != "" && target.RuntimeInstanceID != matched.RuntimeInstanceID {
			return 0, &protocol.KairoError{
				Code:    protocol.ErrStaleTarget,
				Message: fmt.Sprintf("stale target: runtime instance mismatch (%s != %s)", target.RuntimeInstanceID, matched.RuntimeInstanceID),
			}
		}
		if target.DeploymentGeneration > 0 && matched.Generation > 0 && target.DeploymentGeneration != matched.Generation {
			return 0, &protocol.KairoError{
				Code:    protocol.ErrStaleTarget,
				Message: fmt.Sprintf("stale target: server generation mismatch (%d != %d)", target.DeploymentGeneration, matched.Generation),
			}
		}
	}

	return matched.Ports.Debug, nil
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
	nativePath, err := pathpolicy.ResolveURIOrPath(file)
	if err != nil {
		return domain.Project{}, fmt.Errorf("resolve file path: %w", err)
	}
	abs := filepath.Clean(nativePath)

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
		rootNative, err := pathpolicy.ResolveURIOrPath(root)
		if err != nil {
			continue
		}
		rootAbs := filepath.Clean(rootNative)
		if !pathpolicy.IsLexicallyUnder(abs, rootAbs) {
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
