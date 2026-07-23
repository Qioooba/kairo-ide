package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/repository"
)

var importProjectIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

type projectCreator interface {
	Create(id string, project *domain.Project) (domain.Project, error)
}

type projectScanRequest struct {
	RootPath string `json:"rootPath,omitempty"`
	Deep     bool   `json:"deep,omitempty"`
}

func decodeStrictProjectScan(raw []byte) (projectScanRequest, error) {
	var request projectScanRequest
	if len(bytes.TrimSpace(raw)) == 0 {
		return request, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("multiple JSON values are not allowed")
	}
	return request, nil
}

func decodeStrictProjectImport(raw []byte, project *domain.Project) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(project); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values are not allowed")
	}
	return nil
}

func resolveProjectImportRoot(workspaceRoot, requested string) (string, error) {
	workspaceRoot, err := filepath.Abs(workspaceRoot)
	if err != nil {
		return "", err
	}
	workspaceRoot, err = filepath.EvalSymlinks(workspaceRoot)
	if err != nil {
		return "", fmt.Errorf("canonicalize workspace root: %w", err)
	}
	if requested == "" {
		return workspaceRoot, nil
	}
	if !filepath.IsAbs(requested) {
		return pathpolicy.NewDefaultPathPolicy().ResolveWithin(workspaceRoot, filepath.ToSlash(requested))
	}
	requested, err = filepath.EvalSymlinks(requested)
	if err != nil {
		return "", fmt.Errorf("canonicalize project root: %w", err)
	}
	relative, err := filepath.Rel(workspaceRoot, requested)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return "", pathpolicy.ErrOutsideRoot
	}
	info, err := os.Stat(requested)
	if err != nil || !info.IsDir() {
		return "", errors.New("project root is not an accessible directory")
	}
	return requested, nil
}

func validateImportedProject(project *domain.Project, workspaceID, projectRoot string) error {
	if project == nil || !importProjectIDPattern.MatchString(string(project.ID)) {
		return errors.New("project id must be a stable 1-128 character id")
	}
	if project.WorkspaceID != domain.WorkspaceID(workspaceID) {
		return errors.New("project workspace does not match request workspace")
	}
	if project.Name == "" || strings.TrimSpace(project.Name) != project.Name || utf8.RuneCountInString(project.Name) > 100 {
		return errors.New("project name must be non-blank, trimmed, and at most 100 characters")
	}
	if project.BuildTool != domain.BuildToolAnt && project.BuildTool != domain.BuildToolJavac {
		return errors.New("only Ant and direct javac projects are supported")
	}
	levels := map[string]bool{"1.5": true, "1.6": true, "1.7": true, "1.8": true}
	if !levels[project.SourceLevel] || !levels[project.TargetLevel] {
		return errors.New("source and target levels must be between 1.5 and 1.8")
	}
	if project.ContextPath == "" {
		project.ContextPath = "/"
	}
	if !regexp.MustCompile(`^/[A-Za-z0-9._-]*$`).MatchString(project.ContextPath) {
		return errors.New("contextPath must be / followed by letters, digits, dot, underscore or dash")
	}
	allowedEncoding := map[string]bool{"utf-8": true, "utf-8-bom": true, "gbk": true, "gb18030": true, "iso-8859-1": true, "us-ascii": true, "utf-16le": true, "utf-16be": true}
	project.Encoding = strings.ToLower(project.Encoding)
	if !allowedEncoding[project.Encoding] {
		return errors.New("unsupported project encoding")
	}
	policy := pathpolicy.NewDefaultPathPolicy()
	paths := append([]string{}, project.SourceRoots...)
	paths = append(paths, project.ResourceRoots...)
	paths = append(paths, project.WebappDir, project.OutputDir)
	for _, relative := range paths {
		if _, err := policy.ResolveWithinNoFollow(projectRoot, relative); err != nil {
			return fmt.Errorf("unsafe project path: %w", err)
		}
	}
	if len(project.SourceRoots) == 0 || project.WebappDir == "" || project.OutputDir == "" {
		return errors.New("sourceRoots, webappDir and outputDir are required")
	}
	for _, relative := range append(append([]string{}, project.SourceRoots...), project.WebappDir) {
		resolved, err := policy.ResolveWithin(projectRoot, relative)
		if err != nil {
			return fmt.Errorf("resolve detected project path: %w", err)
		}
		if _, err := os.Stat(resolved); err != nil {
			return fmt.Errorf("required project path is missing: %s", relative)
		}
	}
	if project.BuildTool == domain.BuildToolAnt {
		if project.BuildFile == "" {
			project.BuildFile = "build.xml"
		}
		buildFile, err := policy.ResolveWithin(projectRoot, project.BuildFile)
		if err != nil {
			return fmt.Errorf("unsafe Ant build file: %w", err)
		}
		if info, err := os.Stat(buildFile); err != nil || info.IsDir() {
			return errors.New("Ant project requires an existing build.xml")
		}
	}
	project.RootPath = projectRoot
	project.Root = projectRoot
	return nil
}

func (s *Server) handleProjectImport(w http.ResponseWriter, r *http.Request, workspaceID string) {
	env, body, err := readEnvelopeAndBody(r)
	env.WorkspaceID = workspaceID
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	if s.Services == nil || s.Services.WorkspaceStore == nil || s.Services.ProjectStore == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "project import services are not configured"})
		return
	}
	creator, ok := s.Services.ProjectStore.(projectCreator)
	if !ok {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "project store does not support create-only import"})
		return
	}
	var project domain.Project
	if err := decodeStrictProjectImport(extractPayload(body), &project); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	workspace, err := s.Services.WorkspaceStore.Get(workspaceID)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "workspace not found"})
		return
	}
	projectRoot, err := resolveProjectImportRoot(workspace.RootPath, project.RootPath)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrPathForbidden, Message: "project root is outside workspace or crosses a symlink"})
		return
	}
	if err := validateImportedProject(&project, workspaceID, projectRoot); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if project.ToolchainID != "" {
		if s.Services.ToolchainRepo == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrToolchainMissing, Message: "toolchain registry is unavailable"})
			return
		}
		if _, err := s.Services.ToolchainRepo.Get(r.Context(), project.ToolchainID); err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrToolchainMissing, Message: "selected JDK is not registered"})
			return
		}
	}

	// Serialize create-only import with the existing server mutex so duplicate
	// ID/root checks and project.yaml creation cannot race within one agent.
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.Services.ProjectStore.List() {
		if existing.ID == project.ID || sameProjectRoot(existing.RootPath, projectRoot) {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrConflict, Message: "project is already imported"})
			return
		}
	}
	configPath := repository.ProjectConfigPath(projectRoot)
	if _, err := os.Lstat(configPath); err == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrConflict, Message: "existing .kairo/project.yaml was not overwritten"})
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: "cannot inspect existing project configuration"})
		return
	}
	if err := repository.SaveProjectConfig(projectRoot, repository.ProjectToConfig(&project)); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrIOError, Message: "save project configuration failed"})
		return
	}
	saved, err := creator.Create(string(project.ID), &project)
	if err != nil {
		_ = os.Remove(configPath)
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrConflict, Message: "project is already imported"})
		return
	}
	writeOK(w, env, saved)
}

func sameProjectRoot(left, right string) bool {
	left, leftErr := filepath.EvalSymlinks(left)
	right, rightErr := filepath.EvalSymlinks(right)
	return leftErr == nil && rightErr == nil && filepath.Clean(left) == filepath.Clean(right)
}
