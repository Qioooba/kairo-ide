package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/repository"
)

type fixedRootRunConfigurationStore struct {
	root string
	repo *repository.RunConfigurationRepository
}

type launchConfigurationStore struct{ configuration domain.TomcatRunConfiguration }

func (s *launchConfigurationStore) Load(context.Context, string) (domain.RunConfigurationDocument, error) {
	return domain.RunConfigurationDocument{}, nil
}
func (s *launchConfigurationStore) Replace(context.Context, string, domain.RunConfigurationDocument) (domain.RunConfigurationDocument, error) {
	panic("unexpected")
}
func (s *launchConfigurationStore) Get(_ context.Context, _ string, id string) (domain.TomcatRunConfiguration, error) {
	if id != s.configuration.ID {
		return domain.TomcatRunConfiguration{}, domain.ErrRunConfigurationNotFound
	}
	return s.configuration, nil
}
func (s *launchConfigurationStore) Create(context.Context, string, domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	panic("unexpected")
}
func (s *launchConfigurationStore) Update(context.Context, string, string, domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	panic("unexpected")
}
func (s *launchConfigurationStore) Delete(context.Context, string, string) (domain.RunConfigurationDocument, error) {
	panic("unexpected")
}

type launchWorkspaceStore struct{ record WorkspaceRecord }

func (s *launchWorkspaceStore) List() []WorkspaceRecord                      { return []WorkspaceRecord{s.record} }
func (s *launchWorkspaceStore) Open(string, string) (WorkspaceRecord, error) { panic("unexpected") }
func (s *launchWorkspaceStore) Get(id string) (WorkspaceRecord, error) {
	if id != s.record.ID {
		return WorkspaceRecord{}, errors.New("not found")
	}
	return s.record, nil
}
func (s *launchWorkspaceStore) Close(string) error { panic("unexpected") }

type launchProjectRepo struct{ project domain.Project }

func (r *launchProjectRepo) Get(_ context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.Project, error) {
	if r.project.WorkspaceID != workspaceID || r.project.ID != projectID {
		return nil, errors.New("not found")
	}
	copy := r.project
	return &copy, nil
}

type launchToolchainRepo struct{ toolchain domain.Toolchain }

func (r *launchToolchainRepo) Get(_ context.Context, id string) (*domain.Toolchain, error) {
	if id != r.toolchain.ID {
		return nil, errors.New("not found")
	}
	copy := r.toolchain
	return &copy, nil
}

func (store *fixedRootRunConfigurationStore) Load(ctx context.Context, _ string) (domain.RunConfigurationDocument, error) {
	return store.repo.Load(ctx, store.root)
}
func (store *fixedRootRunConfigurationStore) Replace(ctx context.Context, _ string, document domain.RunConfigurationDocument) (domain.RunConfigurationDocument, error) {
	return store.repo.Replace(ctx, store.root, document)
}
func (store *fixedRootRunConfigurationStore) Get(ctx context.Context, _, configurationID string) (domain.TomcatRunConfiguration, error) {
	return store.repo.Get(ctx, store.root, configurationID)
}
func (store *fixedRootRunConfigurationStore) Create(ctx context.Context, _ string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	return store.repo.Create(ctx, store.root, configuration)
}
func (store *fixedRootRunConfigurationStore) Update(ctx context.Context, _, configurationID string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	return store.repo.Update(ctx, store.root, configurationID, configuration)
}
func (store *fixedRootRunConfigurationStore) Delete(ctx context.Context, _, configurationID string) (domain.RunConfigurationDocument, error) {
	return store.repo.Delete(ctx, store.root, configurationID)
}

func apiRunConfiguration(id string) domain.TomcatRunConfiguration {
	return domain.TomcatRunConfiguration{
		ID: id, Name: "Configuration " + id, Type: "tomcat6", ProjectID: "legacy-sample",
		Mode: "run", JDKRef: "jdk6-local", Build: domain.RunConfigurationBuild{Type: "ant", Target: "war"},
		Server: domain.RunConfigurationServer{ID: "tomcat6-local", HTTPPort: 18080, DebugPort: 8000, ContextPath: "/legacy"},
		Deploy: domain.RunConfigurationDeploy{Mode: "exploded", Artifact: "dist/legacy"},
		Env:    map[string]string{}, VMOptions: []string{}, BeforeLaunchTasks: []string{"build", "deploy"},
	}
}

func runConfigurationRequest(t *testing.T, handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestRunConfigurationEndpointsCRUDAndDoNotExecuteCustomCommand(t *testing.T) {
	root := t.TempDir()
	store := &fixedRootRunConfigurationStore{root: root, repo: repository.NewRunConfigurationRepository(nil)}
	server := NewServer(&Services{RunConfigurationStore: store}, log.New("run-config-test"), nil, "test", "")
	handler := server.Handler()
	collection := "/api/v1/workspaces/ws_test/run-configurations"
	item := collection + "/custom"

	if response := runConfigurationRequest(t, handler, http.MethodGet, collection, nil); response.Code != http.StatusNotFound {
		t.Fatalf("missing GET status=%d body=%s", response.Code, response.Body.String())
	}
	marker := filepath.Join(root, "must-not-exist")
	configuration := apiRunConfiguration("custom")
	configuration.Build = domain.RunConfigurationBuild{Type: "custom", Command: "touch " + marker}
	if response := runConfigurationRequest(t, handler, http.MethodPost, collection, configuration); response.Code != http.StatusOK {
		t.Fatalf("POST status=%d body=%s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("custom command was executed: %v", err)
	}
	if response := runConfigurationRequest(t, handler, http.MethodGet, item, nil); response.Code != http.StatusOK {
		t.Fatalf("GET item status=%d body=%s", response.Code, response.Body.String())
	}
	configuration.Name = "Updated custom"
	if response := runConfigurationRequest(t, handler, http.MethodPut, item, configuration); response.Code != http.StatusOK {
		t.Fatalf("PUT item status=%d body=%s", response.Code, response.Body.String())
	}
	if response := runConfigurationRequest(t, handler, http.MethodDelete, item, nil); response.Code != http.StatusOK {
		t.Fatalf("DELETE status=%d body=%s", response.Code, response.Body.String())
	}
	document, err := store.Load(context.Background(), "ignored")
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Configurations) != 0 || document.SelectedConfigurationID != nil {
		t.Fatalf("delete last selection semantics: %#v", document)
	}
}

func TestRunConfigurationEndpointsRejectUnknownAndCorruptState(t *testing.T) {
	root := t.TempDir()
	store := &fixedRootRunConfigurationStore{root: root, repo: repository.NewRunConfigurationRepository(nil)}
	server := NewServer(&Services{RunConfigurationStore: store}, log.New("run-config-test"), nil, "test", "")
	handler := server.Handler()
	collection := "/api/v1/workspaces/ws_test/run-configurations"
	configuration := apiRunConfiguration("strict")
	data, err := json.Marshal(configuration)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		t.Fatal(err)
	}
	object["unexpected"] = true
	if response := runConfigurationRequest(t, handler, http.MethodPost, collection, object); response.Code != http.StatusBadRequest {
		t.Fatalf("unknown POST status=%d body=%s", response.Code, response.Body.String())
	}
	path := filepath.Join(root, filepath.FromSlash(repository.RunConfigurationsRelativePath))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"broken":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if response := runConfigurationRequest(t, handler, http.MethodGet, collection, nil); response.Code != http.StatusConflict {
		t.Fatalf("corrupt GET status=%d body=%s", response.Code, response.Body.String())
	}
}

type fakeBuildEngine struct {
	results map[string]*BuildResult
}

func (e *fakeBuildEngine) Start(req BuildRequest) (*BuildResult, error) {
	result := &BuildResult{ID: "build_1", State: "success", ProjectID: req.ProjectID}
	e.results[result.ID] = result
	return result, nil
}
func (e *fakeBuildEngine) Get(id string) (*BuildResult, error) {
	r, ok := e.results[id]
	if !ok {
		return nil, errors.New("not found")
	}
	return r, nil
}
func (e *fakeBuildEngine) List() []*BuildResult {
	var out []*BuildResult
	for _, r := range e.results {
		out = append(out, r)
	}
	return out
}
func (e *fakeBuildEngine) Cancel(ctx context.Context, id string) (*BuildResult, error) {
	r, ok := e.results[id]
	if !ok {
		return nil, errors.New("not found")
	}
	r.State = "cancelled"
	return r, nil
}

type fakeOrchestrator struct {
	runner *fakeServerRunner
}

func (o *fakeOrchestrator) Execute(ctx context.Context, config LaunchOrchestratorConfig) (*ServerResponse, error) {
	cfg := config.Configuration
	debug := cfg.Mode == "debug"
	debugPort := 0
	if debug {
		debugPort = cfg.Server.DebugPort
	}
	return o.runner.Start(StartServerRequest{
		ProjectID:    cfg.ProjectID,
		Debug:        debug,
		JavaHome:     config.JavaHome,
		WebappDir:    config.ArtifactPath,
		ContextPath:  cfg.Server.ContextPath,
		HTTPPort:     cfg.Server.HTTPPort,
		DebugPort:    debugPort,
		DebugSuspend: debug && cfg.Suspend,
		JVMOptions:   cfg.VMOptions,
		Env:          config.Env,
	})
}

func launchTestServices(t *testing.T, configuration domain.TomcatRunConfiguration) (*Services, *fakeServerRunner, string) {
	t.Helper()
	workspaceRoot := t.TempDir()
	projectRoot := filepath.Join(workspaceRoot, "project")
	artifact := filepath.Join(projectRoot, "dist", "legacy")
	javaHome := filepath.Join(workspaceRoot, "jdk6")
	for _, dir := range []string{artifact, javaHome} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	artifact, err := filepath.EvalSymlinks(artifact)
	if err != nil {
		t.Fatal(err)
	}
	runner := &fakeServerRunner{}
	buildEngine := &fakeBuildEngine{results: make(map[string]*BuildResult)}
	deployer := &fakeDeployer{}
	dataDir := t.TempDir()
	return &Services{
		RunConfigurationStore: &launchConfigurationStore{configuration: configuration},
		WorkspaceStore:        &launchWorkspaceStore{record: WorkspaceRecord{ID: "ws_test", RootPath: workspaceRoot}},
		ProjectRepo:           &launchProjectRepo{project: domain.Project{ID: domain.ProjectID(configuration.ProjectID), WorkspaceID: "ws_test", RootPath: projectRoot}},
		ToolchainRepo:         &launchToolchainRepo{toolchain: domain.Toolchain{ID: configuration.JDKRef, JavaHome: javaHome}},
		ServerRunner:          runner,
		BuildEngine:           buildEngine,
		Deployer:              deployer,
		DataDir:               dataDir,
		Orchestrator:          &fakeOrchestrator{runner: runner},
	}, runner, artifact
}

func executableRunConfiguration(mode string) domain.TomcatRunConfiguration {
	configuration := apiRunConfiguration("launch")
	configuration.ProjectID = "project-1"
	configuration.Mode = mode
	configuration.Suspend = mode == "debug"
	configuration.BeforeLaunchTasks = []string{}
	configuration.Deploy = domain.RunConfigurationDeploy{Mode: "exploded", Artifact: "dist/legacy"}
	configuration.Env = map[string]string{"MODE": "test", "API_TOKEN": "${env:KAIRO_TEST_LAUNCH_TOKEN}"}
	configuration.VMOptions = []string{"-Xmx256m"}
	return configuration
}

func TestRunConfigurationLaunchRehydratesTrustedDebugPlan(t *testing.T) {
	configuration := executableRunConfiguration("debug")
	services, runner, artifact := launchTestServices(t, configuration)
	t.Setenv("KAIRO_TEST_LAUNCH_TOKEN", "must-not-leak")
	server := NewServer(services, log.New("launch-test"), nil, "test", "")
	path := "/api/v1/workspaces/ws_test/run-configurations/launch/launch"
	response := runConfigurationRequest(t, server.Handler(), http.MethodPost, path, map[string]any{"mode": "debug"})
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if runner.lastReq.ProjectID != configuration.ProjectID || runner.lastReq.WebappDir != artifact || runner.lastReq.JavaHome == "" {
		t.Fatalf("trusted launch mapping incomplete: %#v", runner.lastReq)
	}
	if !runner.lastReq.Debug || runner.lastReq.DebugPort != 8000 || !runner.lastReq.DebugSuspend || runner.lastReq.HTTPPort != 18080 {
		t.Fatalf("debug mapping incorrect: %#v", runner.lastReq)
	}
	if len(runner.lastReq.Env) != 2 || !containsString(runner.lastReq.Env, "API_TOKEN=must-not-leak") {
		t.Fatalf("environment not resolved into trusted plan: %#v", runner.lastReq.Env)
	}
	if strings.Contains(response.Body.String(), "must-not-leak") || strings.Contains(response.Body.String(), runner.lastReq.JavaHome) {
		t.Fatalf("response leaked trusted launch values: %s", response.Body.String())
	}
}

func TestRunConfigurationLaunchFailsClosedForUnsupportedOrUntrustedInput(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*domain.TomcatRunConfiguration)
		body   any
		status int
	}{
		{name: "mode mismatch", body: map[string]any{"mode": "debug"}, status: http.StatusConflict},
		{name: "unknown request field", body: map[string]any{"mode": "run", "env": map[string]string{"TOKEN": "bad"}}, status: http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configuration := executableRunConfiguration("run")
			if test.mutate != nil {
				test.mutate(&configuration)
			}
			services, runner, _ := launchTestServices(t, configuration)
			t.Setenv("KAIRO_TEST_LAUNCH_TOKEN", "secret")
			server := NewServer(services, log.New("launch-test"), nil, "test", "")
			response := runConfigurationRequest(t, server.Handler(), http.MethodPost, "/api/v1/workspaces/ws_test/run-configurations/launch/launch", test.body)
			if response.Code != test.status {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.status, response.Body.String())
			}
			if runner.lastReq.ProjectID != "" {
				t.Fatalf("runner started for rejected request: %#v", runner.lastReq)
			}
		})
	}
}

func TestRunConfigurationLaunchMissingEnvironmentReferenceDoesNotLeak(t *testing.T) {
	configuration := executableRunConfiguration("run")
	services, runner, _ := launchTestServices(t, configuration)
	server := NewServer(services, log.New("launch-test"), nil, "test", "")
	response := runConfigurationRequest(t, server.Handler(), http.MethodPost, "/api/v1/workspaces/ws_test/run-configurations/launch/launch", map[string]any{"mode": "run"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if runner.lastReq.ProjectID != "" {
		t.Fatal("runner must not start with an unresolved environment reference")
	}
	if strings.Contains(response.Body.String(), "API_TOKEN") {
		t.Fatalf("response disclosed configuration env key/value: %s", response.Body.String())
	}
}

func TestDecodeRunConfigurationLaunchRequestRejectsTrailingJSON(t *testing.T) {
	if _, err := decodeRunConfigurationLaunchRequest(json.RawMessage(`{"mode":"run"} {"mode":"debug"}`)); err == nil {
		t.Fatal("top-level trailing JSON must be rejected")
	}
}

func TestResolveRunConfigurationEnvironmentRejectsMalformedReference(t *testing.T) {
	if _, err := resolveRunConfigurationEnvironment(map[string]string{"VALUE": "${env:BAD-NAME}"}); err == nil {
		t.Fatal("malformed environment reference must fail closed")
	}
}

func TestRunConfigurationLaunchRejectsProjectAndArtifactEscape(t *testing.T) {
	configuration := executableRunConfiguration("run")
	t.Run("project outside workspace", func(t *testing.T) {
		services, runner, _ := launchTestServices(t, configuration)
		services.ProjectRepo.(*launchProjectRepo).project.RootPath = t.TempDir()
		t.Setenv("KAIRO_TEST_LAUNCH_TOKEN", "secret")
		server := NewServer(services, log.New("launch-test"), nil, "test", "")
		response := runConfigurationRequest(t, server.Handler(), http.MethodPost, "/api/v1/workspaces/ws_test/run-configurations/launch/launch", map[string]any{"mode": "run"})
		if response.Code != http.StatusForbidden || runner.lastReq.ProjectID != "" {
			t.Fatalf("escape status=%d request=%#v body=%s", response.Code, runner.lastReq, response.Body.String())
		}
	})
	t.Run("artifact symlink outside project", func(t *testing.T) {
		services, runner, artifact := launchTestServices(t, configuration)
		if err := os.RemoveAll(artifact); err != nil {
			t.Fatal(err)
		}
		outside := t.TempDir()
		if err := os.Symlink(outside, artifact); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		t.Setenv("KAIRO_TEST_LAUNCH_TOKEN", "secret")
		server := NewServer(services, log.New("launch-test"), nil, "test", "")
		response := runConfigurationRequest(t, server.Handler(), http.MethodPost, "/api/v1/workspaces/ws_test/run-configurations/launch/launch", map[string]any{"mode": "run"})
		if response.Code != http.StatusForbidden || runner.lastReq.ProjectID != "" {
			t.Fatalf("symlink status=%d request=%#v body=%s", response.Code, runner.lastReq, response.Body.String())
		}
	})
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
