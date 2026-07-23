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
	"sort"
	"strings"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

var runConfigurationEnvironmentReference = regexp.MustCompile(`^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$`)

func runConfigurationError(err error) protocol.KairoError {
	switch {
	case errors.Is(err, domain.ErrRunConfigurationsMissing), errors.Is(err, domain.ErrRunConfigurationNotFound):
		return protocol.KairoError{Code: protocol.ErrNotFound, Message: err.Error()}
	case errors.Is(err, domain.ErrInvalidRunConfiguration):
		return protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()}
	case errors.Is(err, domain.ErrRunConfigurationsCorrupt), errors.Is(err, domain.ErrRunConfigurationConflict):
		return protocol.KairoError{Code: protocol.ErrConflict, Message: err.Error()}
	case errors.Is(err, pathpolicy.ErrOutsideRoot), errors.Is(err, pathpolicy.ErrSymlinkEscape),
		errors.Is(err, pathpolicy.ErrPathTraversal), errors.Is(err, pathpolicy.ErrAbsolutePath):
		return protocol.KairoError{Code: protocol.ErrPathForbidden, Message: err.Error()}
	default:
		return protocol.KairoError{Code: protocol.ErrIOError, Message: err.Error()}
	}
}

func (s *Server) requireRunConfigurationStore(env protocol.RequestEnvelope, w http.ResponseWriter) RunConfigurationStore {
	if s.Services == nil || s.Services.RunConfigurationStore == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{
			Code: protocol.ErrInternal, Message: "RunConfigurationStore not configured",
		})
		return nil
	}
	return s.Services.RunConfigurationStore
}

func (s *Server) handleRunConfigurations(w http.ResponseWriter, r *http.Request) {
	env, body, err := readEnvelopeAndBody(r)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	workspaceID := r.PathValue("ws")
	env.WorkspaceID = workspaceID
	store := s.requireRunConfigurationStore(env, w)
	if store == nil {
		return
	}

	switch r.Method {
	case http.MethodGet:
		document, err := store.Load(r.Context(), workspaceID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		writeOK(w, env, document)
	case http.MethodPut:
		document, err := domain.DecodeRunConfigurationDocument(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		saved, err := store.Replace(r.Context(), workspaceID, document)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		writeOK(w, env, saved)
	case http.MethodPost:
		configuration, err := domain.DecodeTomcatRunConfiguration(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		saved, err := store.Create(r.Context(), workspaceID, configuration)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		writeOK(w, env, saved)
	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET, POST or PUT only"})
	}
}

func (s *Server) handleRunConfigurationByID(w http.ResponseWriter, r *http.Request) {
	env, body, err := readEnvelopeAndBody(r)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	workspaceID := r.PathValue("ws")
	configurationID := r.PathValue("configuration")
	env.WorkspaceID = workspaceID
	store := s.requireRunConfigurationStore(env, w)
	if store == nil {
		return
	}

	switch r.Method {
	case http.MethodGet:
		configuration, err := store.Get(r.Context(), workspaceID, configurationID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		writeOK(w, env, configuration)
	case http.MethodPut:
		configuration, err := domain.DecodeTomcatRunConfiguration(extractPayload(body))
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		saved, err := store.Update(r.Context(), workspaceID, configurationID, configuration)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		writeOK(w, env, saved)
	case http.MethodDelete:
		saved, err := store.Delete(r.Context(), workspaceID, configurationID)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
			return
		}
		writeOK(w, env, saved)
	default:
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET, PUT or DELETE only"})
	}
}

func decodeRunConfigurationLaunchRequest(raw json.RawMessage) (protocol.RunConfigurationLaunchRequest, error) {
	var request protocol.RunConfigurationLaunchRequest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, fmt.Errorf("invalid launch request: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return request, errors.New("invalid launch request: trailing JSON")
	}
	if request.Mode != "run" && request.Mode != "debug" {
		return request, errors.New("launch mode must be run or debug")
	}
	return request, nil
}

func resolveRunConfigurationProjectRoot(workspaceRoot string, project *domain.Project) (string, error) {
	if project == nil {
		return "", errors.New("project is nil")
	}
	workspaceRoot, err := filepath.Abs(workspaceRoot)
	if err != nil {
		return "", fmt.Errorf("resolve workspace root: %w", err)
	}
	if real, err := filepath.EvalSymlinks(workspaceRoot); err == nil {
		workspaceRoot = real
	}
	root := project.RootPath
	if root == "" {
		root = project.Root
	}
	if root == "" {
		return "", errors.New("project root is empty")
	}
	if !filepath.IsAbs(root) {
		return pathpolicy.NewDefaultPathPolicy().ResolveWithin(workspaceRoot, filepath.ToSlash(root))
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("canonicalize project root: %w", err)
	}
	relative, err := filepath.Rel(workspaceRoot, root)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return "", pathpolicy.ErrOutsideRoot
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("project root is not an accessible directory")
	}
	return root, nil
}

func resolveRunConfigurationEnvironment(values map[string]string) ([]string, error) {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	resolved := make([]string, 0, len(names))
	for _, name := range names {
		value := values[name]
		if match := runConfigurationEnvironmentReference.FindStringSubmatch(value); match != nil {
			var ok bool
			value, ok = os.LookupEnv(match[1])
			if !ok {
				return nil, fmt.Errorf("environment reference %s is not set", match[1])
			}
		} else if strings.HasPrefix(value, "${env:") {
			return nil, fmt.Errorf("environment reference for %s is invalid", name)
		}
		resolved = append(resolved, name+"="+value)
	}
	return resolved, nil
}

func (s *Server) handleRunConfigurationLaunch(w http.ResponseWriter, r *http.Request) {
	env, body, err := readEnvelopeAndBody(r)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "POST only"})
		return
	}
	request, err := decodeRunConfigurationLaunchRequest(extractPayload(body))
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if s.Services == nil || s.Services.RunConfigurationStore == nil || s.Services.WorkspaceStore == nil ||
		s.Services.ProjectRepo == nil || s.Services.ToolchainRepo == nil || s.Services.ServerRunner == nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "run configuration launcher is not configured"})
		return
	}
	workspaceID := r.PathValue("ws")
	configurationID := r.PathValue("configuration")
	env.WorkspaceID = workspaceID
	configuration, err := s.Services.RunConfigurationStore.Get(r.Context(), workspaceID, configurationID)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
		return
	}
	if err := configuration.Validate(); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, runConfigurationError(err))
		return
	}
	if request.Mode != configuration.Mode {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrConflict, Message: "requested mode does not match persisted configuration"})
		return
	}
	workspace, err := s.Services.WorkspaceStore.Get(workspaceID)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "workspace not found"})
		return
	}
	project, err := s.Services.ProjectRepo.Get(r.Context(), domain.WorkspaceID(workspaceID), domain.ProjectID(configuration.ProjectID))
	if err != nil || project.WorkspaceID != domain.WorkspaceID(workspaceID) || string(project.ID) != configuration.ProjectID {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "configuration project does not belong to workspace"})
		return
	}
	projectRoot, err := resolveRunConfigurationProjectRoot(workspace.RootPath, project)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrPathForbidden, Message: "project root is outside workspace"})
		return
	}
	artifact, err := pathpolicy.NewDefaultPathPolicy().ResolveWithin(projectRoot, configuration.Deploy.Artifact)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrPathForbidden, Message: "artifact path is outside project"})
		return
	}
	if info, err := os.Stat(artifact); err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "artifact is not available"})
		return
	} else if configuration.Deploy.Mode == "exploded" && !info.IsDir() {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "exploded artifact directory is not available"})
		return
	} else if configuration.Deploy.Mode == "war" && !info.Mode().IsRegular() {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrNotFound, Message: "WAR artifact file is not available"})
		return
	}
	toolchain, err := s.Services.ToolchainRepo.Get(r.Context(), configuration.JDKRef)
	if err != nil || toolchain == nil || toolchain.JavaHome == "" {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrToolchainMissing, Message: "configured JDK toolchain is not registered"})
		return
	}
	if info, err := os.Stat(toolchain.JavaHome); err != nil || !info.IsDir() {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrToolchainMissing, Message: "configured JDK home is unavailable"})
		return
	}
	resolvedEnvironment, err := resolveRunConfigurationEnvironment(configuration.Env)
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
		return
	}
	if len(configuration.BeforeLaunchTasks) != 0 {
		if s.Services.Orchestrator == nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrInternal, Message: "orchestration services are not configured"})
			return
		}
		launchConfig := LaunchOrchestratorConfig{
			Configuration: configuration,
			WorkspaceRoot: workspace.RootPath,
			ProjectRoot:   projectRoot,
			ArtifactPath:  artifact,
			JavaHome:      toolchain.JavaHome,
			Env:           resolvedEnvironment,
		}
		server, err := s.Services.Orchestrator.Execute(r.Context(), launchConfig)
		if err != nil {
			writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrProcessSpawnFailed, Message: "run configuration orchestration failed: " + err.Error()})
			return
		}
		writeOK(w, env, server)
		return
	}
	debug := configuration.Mode == "debug"
	debugPort := 0
	if debug {
		debugPort = configuration.Server.DebugPort
	}
	server, err := s.Services.ServerRunner.Start(StartServerRequest{
		ProjectID: configuration.ProjectID, Debug: debug, JavaHome: toolchain.JavaHome,
		WebappDir: artifact, ContextPath: configuration.Server.ContextPath,
		HTTPPort: configuration.Server.HTTPPort, DebugPort: debugPort,
		DebugSuspend: debug && configuration.Suspend, JVMOptions: append([]string(nil), configuration.VMOptions...),
		Env: resolvedEnvironment,
	})
	if err != nil {
		writeError(w, env.RequestID, env.CorrelationID, protocol.KairoError{Code: protocol.ErrProcessSpawnFailed, Message: "run configuration launch failed"})
		return
	}
	writeOK(w, env, server)
}
