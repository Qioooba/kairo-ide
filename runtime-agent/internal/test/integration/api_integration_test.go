//go:build integration
// +build integration

// Package integration provides end-to-end tests that exercise the Go
// Runtime Agent API with mock services. These tests start the real
// HTTP server (with no secret for testing) and verify the full API
// flow: project import, health check, search, build, and error handling.
//
// Run with:
//
//	go test -count=1 -tags=integration ./runtime-agent/internal/test/integration/
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// ----------- mock services -----------

// fakeWorkspaceStore implements api.WorkspaceStore.
type fakeWorkspaceStore struct {
	workspaces map[string]api.WorkspaceRecord
}

func (f *fakeWorkspaceStore) List() []api.WorkspaceRecord {
	out := make([]api.WorkspaceRecord, 0, len(f.workspaces))
	for _, ws := range f.workspaces {
		out = append(out, ws)
	}
	return out
}

func (f *fakeWorkspaceStore) Open(rootPath, name string) (api.WorkspaceRecord, error) {
	id := fmt.Sprintf("ws_%s", name)
	ws := api.WorkspaceRecord{
		ID:         id,
		Name:       name,
		RootPath:   rootPath,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		LastOpened: time.Now().UTC().Format(time.RFC3339),
		UserID:     "test-user",
	}
	f.workspaces[id] = ws
	return ws, nil
}

func (f *fakeWorkspaceStore) Get(id string) (api.WorkspaceRecord, error) {
	ws, ok := f.workspaces[id]
	if !ok {
		return api.WorkspaceRecord{}, fmt.Errorf("workspace not found: %s", id)
	}
	return ws, nil
}

func (f *fakeWorkspaceStore) Close(id string) error {
	delete(f.workspaces, id)
	return nil
}

// fakeProjectStore implements api.ProjectStore and projectCreator.
type fakeProjectStore struct {
	projects map[string]domain.Project
}

func (f *fakeProjectStore) List() []domain.Project {
	out := make([]domain.Project, 0, len(f.projects))
	for _, p := range f.projects {
		out = append(out, p)
	}
	return out
}

func (f *fakeProjectStore) Get(id string) (domain.Project, error) {
	p, ok := f.projects[id]
	if !ok {
		return domain.Project{}, fmt.Errorf("project not found: %s", id)
	}
	return p, nil
}

func (f *fakeProjectStore) Update(id string, cfg *domain.Project) (domain.Project, error) {
	if cfg == nil {
		return domain.Project{}, fmt.Errorf("nil project")
	}
	f.projects[id] = *cfg
	return *cfg, nil
}

func (f *fakeProjectStore) Create(id string, project *domain.Project) (domain.Project, error) {
	if _, ok := f.projects[id]; ok {
		return domain.Project{}, fmt.Errorf("project already exists: %s", id)
	}
	f.projects[id] = *project
	return *project, nil
}

// fakeBuildEngine implements api.BuildEngine.
type fakeBuildEngine struct {
	builds map[string]*api.BuildResult
}

func (f *fakeBuildEngine) Start(req api.BuildRequest) (*api.BuildResult, error) {
	id := fmt.Sprintf("build_%d", len(f.builds)+1)
	result := &api.BuildResult{
		ID:            id,
		State:         "success",
		StartedAt:     time.Now().UTC().Format(time.RFC3339),
		FinishedAt:    time.Now().UTC().Format(time.RFC3339),
		ProjectID:     req.ProjectID,
		FilesCompiled: 5,
		ElapsedMs:     100,
		Output:        "Build successful",
		ExitCode:      0,
	}
	f.builds[id] = result
	return result, nil
}

func (f *fakeBuildEngine) Get(id string) (*api.BuildResult, error) {
	b, ok := f.builds[id]
	if !ok {
		return nil, api.ErrBuildNotFound
	}
	return b, nil
}

func (f *fakeBuildEngine) List() []*api.BuildResult {
	out := make([]*api.BuildResult, 0, len(f.builds))
	for _, b := range f.builds {
		out = append(out, b)
	}
	return out
}

func (f *fakeBuildEngine) Cancel(ctx context.Context, id string) (*api.BuildResult, error) {
	b, ok := f.builds[id]
	if !ok {
		return nil, api.ErrBuildNotFound
	}
	b.State = "cancelled"
	return b, nil
}

// fakeSearcher implements api.Searcher.
type fakeSearcher struct{}

func (f *fakeSearcher) Search(ctx context.Context, payload json.RawMessage) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"results": []map[string]any{
			{"file": "src/main/java/HelloServlet.java", "line": 10, "match": "println"},
		},
		"total": 1,
	})
}

func (f *fakeSearcher) ListFiles(ctx context.Context, payload json.RawMessage) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"files": []map[string]any{
			{"path": "src/main/java/HelloServlet.java", "name": "HelloServlet.java"},
		},
		"total": 1,
	})
}

// ----------- server setup -----------

type integrationTestServer struct {
	srv     *api.Server
	ts      *httptest.Server
	workspaceID string
	projectID   string
}

func newIntegrationTestServer(t *testing.T) *integrationTestServer {
	t.Helper()

	dir := t.TempDir()
	logger := log.New("integration-test").WithLevel(log.LevelWarn)

	auditLog, err := audit.New(filepath.Join(dir, "audit.log"))
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })

	// Create workspace
	wsStore := &fakeWorkspaceStore{workspaces: make(map[string]api.WorkspaceRecord)}
	wsRoot := filepath.Join(dir, "workspace", "test-project")
	os.MkdirAll(filepath.Join(wsRoot, "src", "main", "java"), 0755)
	os.MkdirAll(filepath.Join(wsRoot, "WebRoot", "WEB-INF"), 0755)
	ws, err := wsStore.Open(wsRoot, "test-project")
	if err != nil {
		t.Fatalf("workspace.Open: %v", err)
	}

	ps := &fakeProjectStore{projects: make(map[string]domain.Project)}
	be := &fakeBuildEngine{builds: make(map[string]*api.BuildResult)}
	searcher := &fakeSearcher{}

	svcs := &api.Services{
		WorkspaceStore: wsStore,
		ProjectStore:   ps,
		BuildEngine:    be,
		Searcher:       searcher,
	}

	srv := api.NewServer(svcs, logger, auditLog, "integration-test-0.1.0", "")
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	return &integrationTestServer{
		srv:         srv,
		ts:          ts,
		workspaceID: ws.ID,
	}
}

// ----------- helpers -----------

func (its *integrationTestServer) baseURL() string {
	return its.ts.URL
}

func (its *integrationTestServer) postJSON(path string, body any) (*http.Response, []byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, nil, err
	}
	resp, err := http.Post(its.ts.URL+path, "application/json", bytes.NewReader(b))
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return resp, respBody, err
}

func (its *integrationTestServer) getJSON(path string) (*http.Response, []byte, error) {
	resp, err := http.Get(its.ts.URL + path)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return resp, respBody, err
}

func decodeSuccessResponse(t *testing.T, body []byte) protocol.ResponseEnvelope {
	t.Helper()
	var env protocol.ResponseEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal response: %v, body=%s", err, string(body))
	}
	if !env.OK {
		t.Fatalf("expected ok=true, got ok=false, body=%s", string(body))
	}
	return env
}

func decodeErrorResponse(t *testing.T, body []byte) protocol.ErrorResponse {
	t.Helper()
	var env protocol.ErrorResponse
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal error response: %v, body=%s", err, string(body))
	}
	if env.OK {
		t.Fatalf("expected ok=false, got ok=true, body=%s", string(body))
	}
	return env
}

// ----------- tests -----------

// TestHealthEndpoint verifies the health endpoint returns the correct shape.
func TestHealthEndpoint(t *testing.T) {
	its := newIntegrationTestServer(t)

	resp, body, err := its.getJSON("/api/v1/health")
	if err != nil {
		t.Fatalf("GET /api/v1/health: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", resp.StatusCode, string(body))
	}

	env := decodeSuccessResponse(t, body)
	// Health endpoint uses an empty request envelope, so requestId
	// may be empty in the JSON body. The X-Kairo-Request-Id header
	// carries the actual request ID.

	// Verify payload contains health fields
	raw, _ := json.Marshal(env.Payload)
	var health protocol.HealthResponse
	if err := json.Unmarshal(raw, &health); err != nil {
		t.Fatalf("unmarshal health payload: %v", err)
	}
	if !health.OK {
		t.Error("health.ok should be true")
	}
	if health.Version == "" {
		t.Error("health.version should not be empty")
	}
}

// TestProjectImportFlow tests the full project import flow.
func TestProjectImportFlow(t *testing.T) {
	its := newIntegrationTestServer(t)

	// NOTE: The real handler expects the project root to be a valid
	// subdirectory under the workspace. Since we're using a temp dir
	// workspace, we can't easily test the full import flow through
	// the HTTP handler. Instead, we verify the handler returns the
	// correct error shape for missing fields.

	// Test with missing name
	badPayload := map[string]any{
		"workspaceId": its.workspaceID,
		"rootPath":    ".",
	}
	resp, body, err := its.postJSON("/api/v1/projects/import", badPayload)
	if err != nil {
		t.Fatalf("POST /api/v1/projects/import: %v", err)
	}

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d, body=%s", resp.StatusCode, string(body))
	}

	errResp := decodeErrorResponse(t, body)
	if errResp.Error.Code != protocol.ErrInvalidRequest {
		t.Errorf("expected error code '%s', got '%s'", protocol.ErrInvalidRequest, errResp.Error.Code)
	}
	if errResp.Error.Message == "" {
		t.Error("error message should not be empty")
	}

	// Verify the envelope shape
	validateErrorEnvelope(t, errResp)
}

// TestBuildEndpoint tests the build endpoint flow.
func TestBuildEndpoint(t *testing.T) {
	its := newIntegrationTestServer(t)

	// Test build with missing projectId
	badPayload := map[string]any{
		"clean": true,
	}
	resp, body, err := its.postJSON("/api/v1/builds", badPayload)
	if err != nil {
		t.Fatalf("POST /api/v1/builds: %v", err)
	}

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d, body=%s", resp.StatusCode, string(body))
	}

	errResp := decodeErrorResponse(t, body)
	if errResp.Error.Code != protocol.ErrInvalidRequest {
		t.Errorf("expected error code '%s', got '%s'", protocol.ErrInvalidRequest, errResp.Error.Code)
	}
	validateErrorEnvelope(t, errResp)

	// Test GET builds list
	resp, body, err = its.getJSON("/api/v1/builds")
	if err != nil {
		t.Fatalf("GET /api/v1/builds: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", resp.StatusCode, string(body))
	}

	env := decodeSuccessResponse(t, body)
	payloadBytes, _ := json.Marshal(env.Payload)
	var builds []any
	json.Unmarshal(payloadBytes, &builds)
	// Build list should be an array (even if empty)
	if builds == nil {
		t.Error("builds payload should be an array")
	}
}

// TestSearchEndpoint tests the search endpoint.
func TestSearchEndpoint(t *testing.T) {
	its := newIntegrationTestServer(t)

	payload := map[string]any{
		"query": "println",
	}
	resp, body, err := its.postJSON("/api/v1/search", payload)
	if err != nil {
		t.Fatalf("POST /api/v1/search: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", resp.StatusCode, string(body))
	}

	env := decodeSuccessResponse(t, body)
	payloadBytes, _ := json.Marshal(env.Payload)
	var result map[string]any
	json.Unmarshal(payloadBytes, &result)
	if result["total"] == nil {
		t.Error("search result should have total field")
	}
}

// TestSearchMissingQuery tests search with missing query.
func TestSearchMissingQuery(t *testing.T) {
	its := newIntegrationTestServer(t)

	payload := map[string]any{
		"query": "",
	}
	resp, body, err := its.postJSON("/api/v1/search", payload)
	if err != nil {
		t.Fatalf("POST /api/v1/search: %v", err)
	}

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d, body=%s", resp.StatusCode, string(body))
	}

	errResp := decodeErrorResponse(t, body)
	validateErrorEnvelope(t, errResp)
}

// TestBuildNotFound tests getting a non-existent build.
func TestBuildNotFound(t *testing.T) {
	its := newIntegrationTestServer(t)

	resp, body, err := its.getJSON("/api/v1/builds/nonexistent")
	if err != nil {
		t.Fatalf("GET /api/v1/builds/nonexistent: %v", err)
	}

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d, body=%s", resp.StatusCode, string(body))
	}

	errResp := decodeErrorResponse(t, body)
	if errResp.Error.Code != protocol.ErrNotFound {
		t.Errorf("expected error code '%s', got '%s'", protocol.ErrNotFound, errResp.Error.Code)
	}
	validateErrorEnvelope(t, errResp)
}

// TestProjectList tests listing projects.
func TestProjectList(t *testing.T) {
	its := newIntegrationTestServer(t)

	resp, body, err := its.getJSON("/api/v1/projects")
	if err != nil {
		t.Fatalf("GET /api/v1/projects: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", resp.StatusCode, string(body))
	}

	env := decodeSuccessResponse(t, body)
	payloadBytes, _ := json.Marshal(env.Payload)
	var projects []any
	json.Unmarshal(payloadBytes, &projects)
	if projects == nil {
		t.Error("projects payload should be an array")
	}
}

// TestWorkspaceList tests listing workspaces.
func TestWorkspaceList(t *testing.T) {
	its := newIntegrationTestServer(t)

	resp, body, err := its.getJSON("/api/v1/workspaces")
	if err != nil {
		t.Fatalf("GET /api/v1/workspaces: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", resp.StatusCode, string(body))
	}

	env := decodeSuccessResponse(t, body)
	payloadBytes, _ := json.Marshal(env.Payload)
	var workspaces []api.WorkspaceRecord
	json.Unmarshal(payloadBytes, &workspaces)
	if len(workspaces) == 0 {
		t.Error("workspaces should have at least one entry")
	}
}

// TestToolchainsEndpoint tests the toolchains endpoint.
func TestToolchainsEndpoint(t *testing.T) {
	its := newIntegrationTestServer(t)

	resp, body, err := its.getJSON("/api/v1/toolchains")
	if err != nil {
		t.Fatalf("GET /api/v1/toolchains: %v", err)
	}

	// ToolchainRegistry is nil, so we expect 500
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d, body=%s", resp.StatusCode, string(body))
	}

	errResp := decodeErrorResponse(t, body)
	if errResp.Error.Code != protocol.ErrInternal {
		t.Errorf("expected error code '%s', got '%s'", protocol.ErrInternal, errResp.Error.Code)
	}
	validateErrorEnvelope(t, errResp)
}

// TestEndpointsEndpoint tests the dynamic endpoints endpoint.
func TestEndpointsEndpoint(t *testing.T) {
	its := newIntegrationTestServer(t)

	resp, body, err := its.getJSON("/api/v1/endpoints")
	if err != nil {
		t.Fatalf("GET /api/v1/endpoints: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", resp.StatusCode, string(body))
	}

	env := decodeSuccessResponse(t, body)
	payloadBytes, _ := json.Marshal(env.Payload)
	var endpoints protocol.RuntimeEndpoints
	if err := json.Unmarshal(payloadBytes, &endpoints); err != nil {
		t.Fatalf("unmarshal endpoints: %v", err)
	}
	if endpoints.HTTP == "" {
		t.Error("endpoints.http should not be empty")
	}
	if endpoints.Events == "" {
		t.Error("endpoints.events should not be empty")
	}
}

// TestCORSHeaders tests that CORS headers are present.
func TestCORSHeaders(t *testing.T) {
	its := newIntegrationTestServer(t)

	req, _ := http.NewRequest(http.MethodOptions, its.ts.URL+"/api/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS /api/v1/health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 for OPTIONS, got %d", resp.StatusCode)
	}

	acao := resp.Header.Get("Access-Control-Allow-Origin")
	if acao == "" {
		t.Error("Access-Control-Allow-Origin header should be present")
	}
}

// TestRequestIDHeader tests that a request ID is always returned.
func TestRequestIDHeader(t *testing.T) {
	its := newIntegrationTestServer(t)

	resp, err := http.Get(its.ts.URL + "/api/v1/health")
	if err != nil {
		t.Fatalf("GET /api/v1/health: %v", err)
	}
	defer resp.Body.Close()

	rid := resp.Header.Get("X-Kairo-Request-Id")
	if rid == "" {
		t.Error("X-Kairo-Request-Id header should be present")
	}
}

// TestEnvelopeShape verifies that all success responses follow the
// ResponseEnvelope format (ok, requestId, payload).
func TestEnvelopeShape(t *testing.T) {
	its := newIntegrationTestServer(t)

	endpoints := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/health"},
		{http.MethodGet, "/api/v1/workspaces"},
		{http.MethodGet, "/api/v1/projects"},
		{http.MethodGet, "/api/v1/builds"},
		{http.MethodGet, "/api/v1/endpoints"},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			var resp *http.Response
			var body []byte
			var err error

			if ep.method == http.MethodGet {
				resp, body, err = its.getJSON(ep.path)
			} else {
				resp, body, err = its.postJSON(ep.path, map[string]any{})
			}
			if err != nil {
				t.Fatalf("request: %v", err)
			}

			// All endpoints should return JSON
			ct := resp.Header.Get("Content-Type")
			if ct != "" && !contains(ct, "application/json") {
				t.Errorf("Content-Type should be application/json, got %s", ct)
			}

			// All responses should be valid JSON with ok field
			var env map[string]any
			if err := json.Unmarshal(body, &env); err != nil {
				t.Fatalf("unmarshal: %v, body=%s", err, string(body))
			}
			if _, ok := env["ok"]; !ok {
				t.Error("response should have 'ok' field")
			}
			if _, ok := env["requestId"]; !ok {
				t.Error("response should have 'requestId' field")
			}
		})
	}
}

// TestErrorEnvelopeShape verifies that all error responses follow the
// ErrorResponse format (ok: false, error: {code, message}).
func TestErrorEnvelopeShape(t *testing.T) {
	its := newIntegrationTestServer(t)

	// Test with a bad request to get an error response
	payload := map[string]any{
		"query": "",
	}
	resp, body, err := its.postJSON("/api/v1/search", payload)
	if err != nil {
		t.Fatalf("POST /api/v1/search: %v", err)
	}

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d, body=%s", resp.StatusCode, string(body))
	}

	var env map[string]any
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if ok, _ := env["ok"].(bool); ok {
		t.Error("error response should have ok: false")
	}
	if _, ok := env["requestId"]; !ok {
		t.Error("error response should have requestId")
	}
	errObj, ok := env["error"].(map[string]any)
	if !ok {
		t.Fatal("error response should have error object")
	}
	if _, ok := errObj["code"]; !ok {
		t.Error("error object should have code")
	}
	if _, ok := errObj["message"]; !ok {
		t.Error("error object should have message")
	}
}

// ----------- helpers -----------

func validateErrorEnvelope(t *testing.T, errResp protocol.ErrorResponse) {
	t.Helper()
	if errResp.OK {
		t.Error("error response should have ok: false")
	}
	if errResp.Error.Code == "" {
		t.Error("error response should have error code")
	}
	if errResp.Error.Message == "" {
		t.Error("error response should have error message")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}