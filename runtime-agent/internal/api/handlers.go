package api

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/maven"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/repository"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/search"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
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
			Root     string `json:"root"`
			Name     string `json:"name"`
		}
		if err := json.Unmarshal(extractPayload(body), &p); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		rootPath := p.RootPath
		if rootPath == "" {
			rootPath = p.Root
		}
		if rootPath == "" {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "rootPath required"})
			return
		}
		for _, part := range strings.Split(filepath.ToSlash(rootPath), "/") {
			if part == ".." {
				writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrForbidden, Message: "path contains traversal"})
				return
			}
		}
		abs, err := filepath.Abs(rootPath)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		ws, err := s.Services.WorkspaceStore.Open(filepath.Clean(abs), p.Name)
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
	case sub == "" && r.Method == http.MethodGet:
		env, _, _ := readEnvelopeAndBody(r)
		if s.Services.WorkspaceStore == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "WorkspaceStore not configured"})
			return
		}
		ws, err := s.Services.WorkspaceStore.Get(id)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
			return
		}
		writeOK(w, env, ws)
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
		env, body, readErr := readEnvelopeAndBody(r)
		env.WorkspaceID = id
		if readErr != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: readErr.Error()})
			return
		}
		if s.Services.WorkspaceStore == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "WorkspaceStore not configured"})
			return
		}
		ws, err := s.Services.WorkspaceStore.Get(id)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()})
			return
		}
		request, err := decodeStrictProjectScan(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		scanRoot, err := resolveProjectImportRoot(ws.RootPath, request.RootPath)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrPathForbidden, Message: "scan root is outside workspace or crosses a symlink"})
			return
		}
		detected, err := scanWorkspace(scanRoot)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
			return
		}
		writeOK(w, env, map[string]any{"detected": detected})
	case sub == "projects/import":
		s.handleProjectImport(w, r, id)
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
		var project domain.Project
		if err := json.Unmarshal(extractPayload(body), &project); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		if s.Services.ProjectStore == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ProjectStore not configured"})
			return
		}
		// KAIRO-RC-WEB-203: also persist <root>/.kairo/project.yaml.
		// jdtproject.Generate and FileProjectRepo read that file, but
		// the HTTP store alone never wrote it — Java language support
		// silently lost the project model. A yaml failure is a real
		// save failure, so it aborts the PUT before the catalog write.
		yamlRoot := project.RootPath
		if yamlRoot == "" {
			yamlRoot = project.Root
		}
		if yamlRoot != "" {
			if err := repository.SaveProjectConfig(yamlRoot, repository.ProjectToConfig(&project)); err != nil {
				writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "save .kairo/project.yaml: " + err.Error()})
				return
			}
		}
		updated, err := s.Services.ProjectStore.Update(rest, &project)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		writeOK(w, env, updated)
	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or PUT only"})
	}
}

// handleProjectDetect detects a Java web project structure from a
// directory and returns a ProjectDetection with all inferred info.
//
// POST /api/v1/projects/detect
func (s *Server) handleProjectDetect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	var p struct {
		RootPath string `json:"rootPath"`
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
	detected, err := scanWorkspace(abs)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	// Convert to ProjectDetection
	if len(detected) == 0 {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "no project structure detected"})
		return
	}
	d := convertToProjectDetection(detected[0])
	writeOK(w, env, d)
}

func convertToProjectDetection(raw map[string]any) protocol.ProjectDetection {
	pd := protocol.ProjectDetection{
		Confidence: 0.5,
		Warnings:   []string{},
	}
	if rootPath, ok := raw["rootPath"].(string); ok && rootPath != "" {
		// Layout is already populated by scanWorkspace
	}
	if layout, ok := raw["layout"].(map[string]any); ok {
		if src, ok := layout["src"].([]any); ok {
			for _, s := range src {
				if ss, ok := s.(string); ok {
					pd.SourceDirs = append(pd.SourceDirs, ss)
				}
			}
		}
		if wr, ok := layout["webRoot"].(string); ok {
			pd.WebRoot = wr
		}
		if lib, ok := layout["lib"].(string); ok {
			pd.LibDirs = append(pd.LibDirs, lib)
		}
		if bs, ok := layout["buildXml"].(string); ok {
			pd.BuildScript = bs
		}
	}
	if bs, ok := raw["buildSystem"].(string); ok {
		pd.BuildSystem = bs
	}
	if enc, ok := raw["encodingByExtension"].(map[string]any); ok {
		if javaEnc, ok := enc[".java"].(string); ok {
			pd.DefaultEncoding = javaEnc
		}
	}
	if pd.DefaultEncoding == "" {
		pd.DefaultEncoding = "gbk"
	}
	if jdk, ok := raw["detectedJdk"].(map[string]any); ok {
		if v, ok := jdk["version"].(string); ok {
			pd.JDKVersion = v
		}
	}
	if pd.BuildScript == "build.xml" {
		pd.SourceVersion = "1.6"
		pd.TargetVersion = "1.6"
		pd.OutputDir = "build/classes"
	} else {
		pd.SourceVersion = "1.6"
		pd.TargetVersion = "1.6"
		pd.OutputDir = "bin"
	}
	if conf, ok := raw["confidence"].(float64); ok {
		pd.Confidence = conf
	}
	if warns, ok := raw["warnings"].([]any); ok {
		for _, w := range warns {
			if ws, ok := w.(string); ok {
				pd.Warnings = append(pd.Warnings, ws)
			}
		}
	}
	return pd
}

// handleProjectImportNew imports a project with the simplified
// confirmation format.
//
// POST /api/v1/projects/import
func (s *Server) handleProjectImportNew(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, err := readEnvelopeAndBody(r)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}

	var req protocol.ProjectImportConfirmRequest
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}

	if req.WorkspaceID == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "workspaceId required"})
		return
	}
	if req.Name == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "name required"})
		return
	}
	if req.RootPath == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "rootPath required"})
		return
	}

	// Validate workspace exists
	if s.Services.WorkspaceStore == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "WorkspaceStore not configured"})
		return
	}
	ws, err := s.Services.WorkspaceStore.Get(req.WorkspaceID)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "workspace not found"})
		return
	}

	// Resolve project root
	projectRoot, err := resolveProjectImportRoot(ws.RootPath, req.RootPath)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrPathForbidden, Message: "project root is outside workspace"})
		return
	}

	// Build a domain.Project from the simplified request
	buildTool := domain.BuildToolID(req.BuildTool)
	if buildTool == "" {
		buildTool = domain.BuildToolAnt
	}

	project := &domain.Project{
		ID:            domain.ProjectID(sanitizeProjectID(req.Name)),
		WorkspaceID:   domain.WorkspaceID(req.WorkspaceID),
		Name:          req.Name,
		RootPath:      projectRoot,
		Root:          projectRoot,
		SourceRoots:   req.SourceDirs,
		WebappDir:     req.WebRoot,
		OutputDir:     req.OutputDir,
		SourceLevel:   req.SourceVersion,
		TargetLevel:   req.TargetVersion,
		Encoding:      req.DefaultEncoding,
		BuildTool:     buildTool,
		BuildFile:     req.BuildScript,
		ContextPath:   req.ContextPath,
		LibraryDirs:   req.LibDirs,
		ResourceRoots: []string{},
		CreatedAt:     domain.UTCNow(),
		UpdatedAt:     domain.UTCNow(),
	}

	if project.ContextPath == "" {
		project.ContextPath = "/"
	}

	// Persist to .kairo/project.json
	if err := SaveProjectJSON(projectRoot, project); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: "save project.json: " + err.Error()})
		return
	}

	// Also persist to .kairo/project.yaml for compatibility
	if err := repository.SaveProjectConfig(projectRoot, repository.ProjectToConfig(project)); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: "save project.yaml: " + err.Error()})
		return
	}

	// Add to project catalog
	creator, ok := s.Services.ProjectStore.(projectCreator)
	if !ok {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "project store does not support create"})
		return
	}
	saved, err := creator.Create(string(project.ID), project)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrConflict, Message: "project already exists: " + err.Error()})
		return
	}

	// Mark as recent
	s.addRecentProject(string(project.ID), project.Name, projectRoot)

	writeOK(w, env, saved)
}

// handleProjectRecent returns the list of recently opened projects.
//
// GET /api/v1/projects/recent
func (s *Server) handleProjectRecent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)
	recent := s.getRecentProjects()
	writeOK(w, env, recent)
}

func sanitizeProjectID(name string) string {
	// Generate a stable ID from the project name
	id := strings.ToLower(name)
	id = regexp.MustCompile(`[^a-z0-9_.-]+`).ReplaceAllString(id, "-")
	id = strings.Trim(id, "-.")
	if id == "" {
		id = "project"
	}
	return "project-" + id
}

// ----- Recent Projects -----

type recentProjectEntry struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	RootPath     string `json:"rootPath"`
	LastOpenedAt string `json:"lastOpenedAt"`
}

func (s *Server) addRecentProject(id, name, rootPath string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)
	entry := recentProjectEntry{
		ID:           id,
		Name:         name,
		RootPath:     rootPath,
		LastOpenedAt: now,
	}
	// Check if already exists
	for i, e := range s.recentProjects {
		if e.ID == id {
			// Move to front
			s.recentProjects = append(s.recentProjects[:i], s.recentProjects[i+1:]...)
			break
		}
	}
	s.recentProjects = append([]recentProjectEntry{entry}, s.recentProjects...)
	// Keep at most 10
	if len(s.recentProjects) > 10 {
		s.recentProjects = s.recentProjects[:10]
	}
}

func (s *Server) getRecentProjects() []recentProjectEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]recentProjectEntry, len(s.recentProjects))
	copy(out, s.recentProjects)
	return out
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
		env, body, readErr := readEnvelopeAndBody(r)
		if readErr != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: readErr.Error()})
			return
		}
		var req BuildRequest
		if err := decodeStrictBuildRequest(extractPayload(body), &req); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		if req.ProjectID == "" {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "projectId required"})
			return
		}
		// Validate that the projectId actually exists. Without this
		// guard the build engine happily accepted any string and
		// returned a queued-then-success build with 0 files compiled
		// — the user got a green checkmark for a build that did
		// nothing. Surfacing 404 here is the truthful behavior
		// (N-BUILD-001).
		// KAIRO-RC-WEB-238: also HYDRATE the request from the stored
		// project — the UI sends only {projectId[, clean]}, and
		// without the project's root/levels/encoding/outputDir the
		// engine compiled 0 files into agent-data with defaults
		// (the "sham build").
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
		if err := hydrateBuildRequest(&req, p); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		req.TraceID = env.CorrelationID
		if req.TraceID == "" {
			_, correlationID, _, _ := log.FromContext(r.Context())
			req.TraceID = correlationID
		}
		if req.TraceID == "" {
			req.TraceID = env.RequestID
		}
		if req.TraceID == "" {
			requestID, _, _, _ := log.FromContext(r.Context())
			req.TraceID = requestID
		}
		if s.Services.BuildEngine == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "BuildEngine not configured"})
			return
		}
		res, err := s.Services.BuildEngine.Start(req)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrCompileFailed, Message: err.Error()})
			return
		}
		writeOK(w, env, res)
	default:
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or POST only"})
	}
}

func decodeStrictBuildRequest(raw []byte, dst *BuildRequest) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func (s *Server) handleBuildByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/builds/")
	env, _, _ := readEnvelopeAndBody(r)
	if s.Services.BuildEngine == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "BuildEngine not configured"})
		return
	}
	var res *BuildResult
	var err error
	switch r.Method {
	case http.MethodGet:
		res, err = s.Services.BuildEngine.Get(rest)
	case http.MethodDelete:
		res, err = s.Services.BuildEngine.Cancel(r.Context(), rest)
	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or DELETE only"})
		return
	}
	if err != nil {
		code := protocol.ErrInternal
		switch {
		case errors.Is(err, ErrBuildNotFound):
			code = protocol.ErrNotFound
		case errors.Is(err, ErrBuildCancelTimeout), errors.Is(err, context.DeadlineExceeded):
			code = protocol.ErrTimeout
		case errors.Is(err, context.Canceled):
			code = protocol.ErrCancelled
		}
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: code, Message: err.Error()})
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
		var req DeployRequest
		if err := json.Unmarshal(extractPayload(body), &req); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		// KAIRO-RC-WEB-239: the frontend sends {projectId, buildId,
		// scope} — resolve source (the project's webapp dir) and
		// target (the runner's Catalina webapps) instead of failing
		// with "source is required".
		if req.Source == "" && req.ProjectID != "" && s.Services.ProjectStore != nil {
			p, err := s.Services.ProjectStore.Get(req.ProjectID)
			if err != nil {
				writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "project not found: " + req.ProjectID})
				return
			}
			req.Source = filepath.Join(p.RootPath, p.WebappDir)
			if req.Intent == "publish-static-changes" {
				req.What, req.Mode, req.Trigger = "static", "merge", "manual"
				if resolver, ok := s.Services.ServerRunner.(interface{ DeploymentTarget(string) (string, error) }); ok {
					req.Target, err = resolver.DeploymentTarget(req.ProjectID)
					if err != nil { writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrConflict, Message: err.Error()}); return }
				}
			}
			if req.Target == "" && s.Services.ServerRunner != nil && s.Services.ServerRunner.CatalinaHome() != "" {
				ctx := strings.TrimPrefix(p.ContextPath, "/")
				if ctx == "" {
					ctx = sanitizeContextName(p.Name)
				}
				req.Target = filepath.Join(s.Services.ServerRunner.CatalinaHome(), "webapps", ctx)
			}
		}
		res, err := s.Services.Deployer.Publish(req)
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

// hydrateBuildRequest fills build-request fields the UI does not
// send from the stored project (KAIRO-RC-WEB-238).
func hydrateBuildRequest(req *BuildRequest, p domain.Project) error {
	root := p.RootPath
	if root == "" {
		root = p.Root
	}
	if root == "" {
		return fmt.Errorf("project root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve project root: %w", err)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("canonicalize project root: %w", err)
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		if err != nil {
			return fmt.Errorf("stat project root: %w", err)
		}
		return fmt.Errorf("project root is not a directory")
	}

	policy := pathpolicy.NewDefaultPathPolicy()
	if p.OutputDir == "" {
		return fmt.Errorf("project outputDir is required")
	}
	outputDir, err := policy.ResolveWithin(root, filepath.ToSlash(p.OutputDir))
	if err != nil {
		return fmt.Errorf("invalid project outputDir: %w", err)
	}
	if filepath.Clean(outputDir) == filepath.Clean(root) {
		return fmt.Errorf("project outputDir must not be the project root")
	}

	intent := req.Intent
	if intent == "" {
		intent = "full"
	}
	if intent != "full" && intent != "selected-files" {
		return fmt.Errorf("intent must be full or selected-files")
	}
	var files []string
	if intent == "selected-files" {
		if len(req.SelectedFiles) == 0 {
			return fmt.Errorf("selectedFiles is required for selected-files intent")
		}
		if len(req.SelectedFiles) > 10000 {
			return fmt.Errorf("selectedFiles exceeds 10000 entries")
		}
		seen := make(map[string]struct{}, len(req.SelectedFiles))
		for _, selected := range req.SelectedFiles {
			resolved, err := policy.ResolveWithin(root, selected)
			if err != nil {
				return fmt.Errorf("invalid selected file %q: %w", selected, err)
			}
			info, err := os.Stat(resolved)
			if err != nil {
				return fmt.Errorf("stat selected file %q: %w", selected, err)
			}
			if !info.Mode().IsRegular() || !strings.EqualFold(filepath.Ext(resolved), ".java") {
				return fmt.Errorf("selected file %q is not a regular .java file", selected)
			}
			if _, duplicate := seen[resolved]; duplicate {
				continue
			}
			seen[resolved] = struct{}{}
			files = append(files, resolved)
		}
	}

	var classpath []string
	classpathDirs := []string{"lib"}
	if p.WebappDir != "" {
		classpathDirs = append(classpathDirs, filepath.ToSlash(filepath.Join(p.WebappDir, "WEB-INF", "lib")))
	}
	for _, relativeDir := range classpathDirs {
		dir, err := policy.ResolveWithin(root, relativeDir)
		if err != nil {
			return fmt.Errorf("invalid classpath directory %q: %w", relativeDir, err)
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return fmt.Errorf("read classpath directory %q: %w", relativeDir, err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".jar") {
				continue
			}
			jar, err := policy.ResolveWithin(root, filepath.ToSlash(filepath.Join(relativeDir, entry.Name())))
			if err != nil {
				return fmt.Errorf("invalid classpath entry %q: %w", entry.Name(), err)
			}
			classpath = append(classpath, jar)
		}
	}

	req.Intent = intent
	req.ProjectRoot = root
	req.OutputDir = outputDir
	req.Files = files
	req.Toolchain = p.ToolchainID
	req.SourceLevel = p.SourceLevel
	req.TargetLevel = p.TargetLevel
	req.Encoding = p.Encoding
	req.Classpath = classpath
	return nil
}

// sanitizeContextName turns a project name into a Tomcat webapps
// directory name (lowercase, spaces to '-', alnum and -_. only).
func sanitizeContextName(name string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.':
			b.WriteRune(r)
			prevDash = false
		case r == ' ' || r == '/':
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "app"
	}
	return out
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
		var req StartServerRequest
		if err := json.Unmarshal(extractPayload(body), &req); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
		// KAIRO-RC-WEB-240: the frontend sends only {projectId, debug};
		// resolve webappDir/contextPath from the stored project instead
		// of failing with "webappDir is required" (a 500 the UI used to
		// swallow silently).
		if req.WebappDir == "" && req.ProjectID != "" && s.Services.ProjectStore != nil {
			p, err := s.Services.ProjectStore.Get(req.ProjectID)
			if err != nil {
				writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "project not found: " + req.ProjectID})
				return
			}
			req.WebappDir = filepath.Join(p.RootPath, p.WebappDir)
			if req.ContextPath == "" {
				req.ContextPath = p.ContextPath
			}
		}
		srv, err := s.Services.ServerRunner.Start(req)
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
			var p struct {
				Force bool `json:"force"`
			}
			_ = json.Unmarshal(extractPayload(body), &p)
			srv, err := s.Services.ServerRunner.Stop(id, p.Force)
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
	case "restart":
		if r.Method != http.MethodPost {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
			return
		}
		srv, err := s.Services.ServerRunner.Restart(id)
		if err != nil {
			code := protocol.ErrProcessSpawnFailed
			if strings.HasPrefix(err.Error(), "server not found") {
				code = protocol.ErrNotFound
			}
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: code, Message: err.Error()})
			return
		}
		writeOK(w, env, srv)
	case "logs":
		s.handleServerLogs(w, r, id, env)
	case "recover":
		if r.Method != http.MethodPost {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
			return
		}
		srv, err := s.Services.ServerRunner.Recover(id)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrProcessSpawnFailed, Message: err.Error()})
			return
		}
		writeOK(w, env, srv)
	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "unknown subpath"})
	}
}

func (s *Server) handleServerLogs(w http.ResponseWriter, r *http.Request, id string, env protocol.RequestEnvelope) {
	if s.Services.ServerRunner == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "ServerRunner not configured"})
		return
	}
	// The payload stays [{line, ts, stream?}] per the endpoint contract; the
	// server's state/pid ride along as headers so the Logs view can
	// show liveness without a second request.
	if srv, err := s.Services.ServerRunner.Get(id); err == nil && srv != nil {
		w.Header().Set("X-Kairo-Server-State", srv.State)
		w.Header().Set("X-Kairo-Server-Pid", strconv.Itoa(srv.PID))
	}
	tail := 0
	if v := r.URL.Query().Get("tail"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			tail = n
		}
	}
	lines, err := s.Services.ServerRunner.Logs(id, tail)
	if err != nil {
		code := protocol.ErrIOError
		if strings.HasPrefix(err.Error(), "server not found") {
			code = protocol.ErrNotFound
		}
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: code, Message: err.Error()})
		return
	}
	if len(lines) == 0 {
		// No log file (or no output) yet — an empty result, not
		// an error.
		w.Header().Set("X-Kairo-Log-Note", "no log output yet")
	}
	writeOK(w, env, lines)
}

// ----- Recovery -----

func (s *Server) handleRecoverableServers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	if s.Services.ServerRunner == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "ServerRunner not configured"})
		return
	}
	servers := s.Services.ServerRunner.Recoverable()
	writeOK(w, protocol.RequestEnvelope{}, servers)
}

// ----- Search -----

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	var searchReq struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal(extractPayload(body), &searchReq); err == nil && searchReq.Query == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "query required"})
		return
	}
	if s.Services.Searcher == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "Searcher not configured"})
		return
	}
	res, err := s.Services.Searcher.Search(r.Context(), extractPayload(body))
	if err != nil {
		code := protocol.ErrIOError
		retryable := false
		if errors.Is(err, context.Canceled) {
			code = protocol.ErrCancelled
		} else if errors.Is(err, context.DeadlineExceeded) {
			code = protocol.ErrTimeout
			retryable = true
		}
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: code, Message: err.Error(), Retryable: retryable})
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

// handleEvents upgrades the request to a WebSocket and
// authenticates the client via the Sec-WebSocket-Protocol
// subprotocol token (see WebSocketSubprotocol). The browser
// API cannot set custom headers on a WebSocket upgrade, so
// the contract (per docs/hotfix-windows-test-readiness.md
// 搂1.2) is:
//
//	client: new WebSocket(url, ["kairo-secret-v1", secret])
//	server: Sec-WebSocket-Protocol response header echoes the secret
//	         back so the browser finishes the handshake.
//
// If the secret is not configured on the agent, auth is
// skipped (dev mode). If the secret IS configured and the
// request does not include a matching subprotocol, we
// return 401 and never call the upgrader.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if s.Services.EventBus == nil {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInternal, Message: "EventBus not configured"})
		return
	}
	if s.secret != "" {
		offered := parseSubprotocols(r.Header.Get("Sec-WebSocket-Protocol"))
		// Find the kairo-secret-v1 entry; the token next to
		// it is the secret. We accept both
		//   "kairo-secret-v1, <secret>"
		// and a single combined "kairo-secret-v1=<secret>" form.
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
		if presented == "" {
			writeError(w, "", "", protocol.KairoError{
				Code:    protocol.ErrUnauthenticated,
				Message: "missing or invalid WebSocket subprotocol",
			})
			return
		}
		// Constant-time compare is overkill for a local
		// desktop secret but matches the middleware's
		// expectation that the secret never leaks via
		// timing. We do it here too.
		if subtle.ConstantTimeCompare([]byte(presented), []byte(s.secret)) != 1 {
			writeError(w, "", "", protocol.KairoError{
				Code:    protocol.ErrUnauthenticated,
				Message: "missing or invalid WebSocket subprotocol",
			})
			return
		}
		// Echo the secret back as the selected subprotocol
		// so the browser completes the upgrade.
		w.Header().Set("Sec-WebSocket-Protocol", presented)
	}
	s.Services.EventBus.Serve(w, r)
}

// parseSubprotocols splits the Sec-WebSocket-Protocol header
// into its tokens, trimming whitespace. Per RFC 6455 the
// header is a comma-separated list.
func parseSubprotocols(h string) []string {
	if h == "" {
		return nil
	}
	parts := strings.Split(h, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

// ----- Endpoints -----

// handleEndpoints returns the dynamic host:port that the
// runtime client should use to connect to the agent. Per
// docs/hotfix-windows-test-readiness.md 搂2, the agent
// chooses its port at startup (CLI --port or default 18080),
// and may have retried after a port collision. The frontend
// used to hardcode 18099 — it now calls this endpoint first
// and uses the returned values for every WS / EventStream
// URL.
//
// Response shape:
//
//	{ "http": "127.0.0.1:18080", "events": "127.0.0.1:18080" }
//
// `http` is the base URL for /api/v1/* calls; `events` is the
// host:port for /api/v1/events (WS). They are the same today
// but kept separate so future work can split them (e.g.
// attach the WS port to a Unix domain socket) without
// breaking the wire.
func (s *Server) handleEndpoints(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	s.mu.Lock()
	addr := s.bindAddr
	port := s.port
	s.mu.Unlock()
	if port == 0 {
		// We haven't called ListenAndServe yet; fall back
		// to the address the router already knows about.
		if s.httpServer != nil && s.httpServer.Addr != "" {
			host, p, _ := splitHostPort(s.httpServer.Addr)
			addr = host
			if n, err := strconv.Atoi(p); err == nil {
				port = n
			}
		}
	}
	hostport := net.JoinHostPort(addr, strconv.Itoa(port))
	writeOK(w, protocol.RequestEnvelope{}, protocol.RuntimeEndpoints{
		HTTP:   hostport,
		Events: hostport,
	})
}

// ----- Runtime Restart -----

// handleRuntimeRestart responds 200 with `{status: "restarting"}`
// and then performs the actual restart asynchronously. Per
// docs/hotfix-windows-test-readiness.md 搂3:
//
//  1. Reply 200 immediately so the caller knows the agent
//     accepted the request.
//  2. Call the registered shutdown hook (typically
//     container.Shutdown) with a 3s timeout.
//  3. Shutdown the HTTP server (so the new process can bind
//     the port).
//  4. os.Executable() + os.Args[1:] spawn a new process.
//  5. Current process exits 0.
//
// The handler is intentionally synchronous up to writing the
// 200 (so the caller gets a real signal that the agent
// committed to the restart) but the respawn runs in a
// goroutine. The goroutine will call os.Exit, so the
// listener never sees a "second" 200.
func (s *Server) handleRuntimeRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "POST only",
		})
		return
	}
	// No body to parse — the contract says "no body". Tolerate
	// an empty envelope anyway in case the client sends one.
	writeOK(w, protocol.RequestEnvelope{}, map[string]string{"status": "restarting"})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	if s.logger != nil {
		s.logger.Info("runtime restart requested", log.Fields{
			"path":   r.URL.Path,
			"remote": r.RemoteAddr,
		})
	}
	// Run the actual restart off the request goroutine so
	// we can flush the 200 first.
	go s.doRestart()
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
	case http.MethodDelete:
		// DELETE is not part of the JDTLS contract. The
		// JDT LS process lifecycle is owned by the Theia
		// backend (see docs/adr/0014-jdt-ls-lifecycle.md),
		// and the agent only manages the distribution +
		// launch descriptor. Refuse with 400 so the
		// frontend can show an explicit "not supported"
		// rather than silently getting a 200 with status.
		writeError(w, "", "", protocol.KairoError{
			Code:    protocol.ErrInvalidRequest,
			Message: "DELETE not supported on /api/v1/jdtls; use POST to install or GET to inspect",
		})
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

	// Resolve the toolchain only when the project pins one.
	// Projects without a ToolchainID must NOT be blocked: the JDT
	// LS manager launches with its own JRE (KAIRO_JRE17_HOME or
	// --jre17), and the import wizard never sets ToolchainID, so
	// requiring one made JDT LS unreachable for every imported
	// project (KAIRO-RC-WEB-258, flow-03 live evidence: HTTP 400
	// "project has no toolchain configured").
	var toolchain *domain.Toolchain
	if project.ToolchainID != "" {
		if s.Services.ToolchainRegistry == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code: protocol.ErrInternal, Message: "ToolchainRegistry not configured",
			})
			return
		}
		t, err := s.Services.ToolchainRepo.Get(r.Context(), project.ToolchainID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
				Code: protocol.ErrToolchainMissing, Message: fmt.Sprintf("toolchain not found: %s", err.Error()),
			})
			return
		}
		toolchain = t
	}

	// Resolve the project working directory: prefer the project's
	// own root (from the repository), then the workspace root.
	projectRoot := project.RootPath
	if projectRoot == "" {
		projectRoot = project.Root
	}
	if projectRoot == "" && s.Services.WorkspaceStore != nil {
		ws, err := s.Services.WorkspaceStore.Get(workspaceID)
		if err == nil {
			projectRoot = ws.RootPath
		}
	}
	if projectRoot == "" {
		projectRoot = projectID // last-resort fallback
	}

	// Give JDT LS a real Eclipse project model to import. Without
	// one it treats every file as standalone, and its fake
	// compilation-unit creation collides ("Resource
	// '/jdt.ls-java-project/src/com' already exists") — completion
	// and definition then fail inside the LS (KAIRO-RC-WEB-251,
	// captured from the child's own log). The model is written
	// INTO the project root: Eclipse resolves .classpath src
	// entries against the project location and rejects absolute
	// ones, so an external model dir can never work.
	workingDir := projectRoot
	if s.Services.JDTProjectGenerator != nil {
		genPayload, _ := json.Marshal(map[string]any{
			"workspaceId":     workspaceID,
			"projectId":       projectID,
			"rootPath":        projectRoot,
			"intoProjectRoot": true,
		})
		if _, gerr := s.Services.JDTProjectGenerator.Generate(genPayload); gerr != nil {
			if s.logger != nil {
				s.logger.Warn("jdt project model generation failed; falling back to standalone mode", log.Fields{"err": gerr.Error()})
			}
		}
	}

	// Build the launch descriptor.
	desc, err := s.Services.JDTLS.GetLaunchDescriptor(r.Context(), workspaceID, projectID, workingDir)
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

// ----- Maven -----

// handleMavenDetect detects a Maven project from pom.xml.
//
// POST /api/v1/maven/detect
func (s *Server) handleMavenDetect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	var p struct {
		RootPath string `json:"rootPath"`
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
	result, err := maven.Detect(abs)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, result)
}

// handleMavenDependencies returns the dependency tree for a Maven project.
//
// GET /api/v1/maven/dependencies?rootPath=...&offline=true
func (s *Server) handleMavenDependencies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET only"})
		return
	}
	env, _, _ := readEnvelopeAndBody(r)
	rootPath := r.URL.Query().Get("rootPath")
	if rootPath == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "rootPath query parameter required"})
		return
	}
	abs, err := filepath.Abs(rootPath)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	offline := r.URL.Query().Get("offline") == "true"
	result, err := maven.GetDependencies(abs, offline)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()})
		return
	}
	writeOK(w, env, result)
}

// handleMavenRun runs a Maven lifecycle task.
//
// POST /api/v1/maven/run
func (s *Server) handleMavenRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	env, body, _ := readEnvelopeAndBody(r)
	var req maven.RunRequest
	if err := json.Unmarshal(extractPayload(body), &req); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if req.RootPath == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "rootPath required"})
		return
	}
	if req.Task == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "task required"})
		return
	}
	abs, err := filepath.Abs(req.RootPath)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	req.RootPath = abs
	result, err := maven.RunTask(req)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrProcessSpawnFailed, Message: err.Error()})
		return
	}
	writeOK(w, env, result)
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
