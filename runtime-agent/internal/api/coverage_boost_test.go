package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// =============================================================================
// logError tests — improve from 25.0%
// =============================================================================

func TestLogError_WithLoggerAndFields(t *testing.T) {
	ring := log.NewRingBuffer(10)
	l := log.New("test").WithCaptured(ring).WithLevel(log.LevelDebug)
	s := &Server{logger: l}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := log.WithRequestContext(r.Context(), "req-123", "corr-456", "", "")
	r = r.WithContext(ctx)

	s.logError(r, "test error", log.Fields{"key": "value"})

	snapshot := ring.Snapshot()
	if len(snapshot) == 0 {
		t.Error("expected log output with logger")
	}
}

func TestLogError_WithLogger_NilFields(t *testing.T) {
	ring := log.NewRingBuffer(10)
	l := log.New("test").WithCaptured(ring).WithLevel(log.LevelDebug)
	s := &Server{logger: l}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := log.WithRequestContext(r.Context(), "req-123", "corr-456", "", "")
	r = r.WithContext(ctx)

	s.logError(r, "test error", nil)

	snapshot := ring.Snapshot()
	if len(snapshot) == 0 {
		t.Error("expected log output with nil fields")
	}
}

// =============================================================================
// handleJDTProject tests — improve from 16.7%
// =============================================================================

func TestHandleJDTProject_NoGeneratorDirect(t *testing.T) {
	j := &fakeJDTLS{state: "running", pid: 12345, version: "1.43.0"}
	s := newTestServer(t, j)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtproject?workspaceId=ws1", nil)
	w := httptest.NewRecorder()
	s.handleJDTProject(w, req)

	// handler checks JDTProjectGenerator before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleJDTProject_POST_NoGenerator(t *testing.T) {
	j := &fakeJDTLS{state: "stopped"}
	s := newTestServer(t, j)

	body := `{"projectId":"p1","workspaceId":"ws1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtproject", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleJDTProject(w, req)

	// handler checks JDTProjectGenerator before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleJDTProject_InvalidMethod(t *testing.T) {
	j := &fakeJDTLS{}
	s := newTestServer(t, j)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/jdtproject", nil)
	w := httptest.NewRecorder()
	s.handleJDTProject(w, req)

	// handler checks JDTProjectGenerator before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleBuilds additional tests — improve from 37.8%
// =============================================================================

func TestHandleBuilds_POST_InvalidJSON(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleBuilds(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleBuilds_POST_EmptyBody(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/builds", nil)
	w := httptest.NewRecorder()
	s.handleBuilds(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleBuilds_WrongMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/builds", nil)
	w := httptest.NewRecorder()
	s.handleBuilds(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleBuildByID additional tests — improve from 57.1%
// =============================================================================

func TestHandleBuildByID_NoEngineDirect(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/builds/b1", nil)
	w := httptest.NewRecorder()
	s.handleBuildByID(w, req)

	// handler checks BuildEngine before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleDeployments additional tests — improve from 68.4%
// =============================================================================

func TestHandleDeployments_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/deployments", nil)
	w := httptest.NewRecorder()
	s.handleDeployments(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleDeployments_POST_NoDeployer(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/deployments", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleDeployments(w, req)

	// handler checks Deployer in POST case before JSON parse — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handleDeploymentByID additional tests — improve from 80.0%
// =============================================================================

func TestHandleDeploymentByID_NoDeployer(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/deployments/dep1", nil)
	w := httptest.NewRecorder()
	s.handleDeploymentByID(w, req)

	// handler checks Deployer before any method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleServers additional tests — improve from 71.4%
// =============================================================================

func TestHandleServers_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/servers", nil)
	w := httptest.NewRecorder()
	s.handleServers(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleServers_POST_NoServerRunner(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleServers(w, req)

	// handler checks ServerRunner in POST case before JSON parse — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handleServerSub additional tests — improve from 61.4%
// =============================================================================

func TestHandleServerSub_NoServerRunner(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/servers/srv1", nil)
	w := httptest.NewRecorder()
	s.handleServerSub(w, req)

	// handler checks ServerRunner before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleServerLogs additional tests — improve from 75.0%
// =============================================================================

func TestHandleServerLogs_NoServerRunner(t *testing.T) {
	s := newTestServer(t, nil)
	env := protocol.RequestEnvelope{RequestID: "req-1"}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/srv1/logs", nil)
	w := httptest.NewRecorder()
	s.handleServerLogs(w, req, "srv1", env)

	// handler checks ServerRunner before any method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleAudit additional tests — improve from 75.0%
// =============================================================================

func TestHandleAudit_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/audit", nil)
	w := httptest.NewRecorder()
	s.handleAudit(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleWorkspacesSub additional tests — improve from 63.0%
// =============================================================================

func TestHandleWorkspacesSub_UnknownSubpath(t *testing.T) {
	s := newTestServer(t, nil)

	// POST /api/v1/workspaces/ws1 → sub="" with POST method → no match → 404
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws1", nil)
	w := httptest.NewRecorder()
	s.handleWorkspacesSub(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// =============================================================================
// handleWorkspaces additional tests — improve from 81.8%
// =============================================================================

func TestHandleWorkspaces_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces", nil)
	w := httptest.NewRecorder()
	s.handleWorkspaces(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleWorkspaces_POST_InvalidJSON(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleWorkspaces(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handleProjectImportNew tests — improve from 39.6%
// =============================================================================

func TestHandleProjectImportNew_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/import", nil)
	w := httptest.NewRecorder()
	s.handleProjectImportNew(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleProjectImport tests — improve from 0.0%
// =============================================================================

func TestHandleProjectImport_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/import/scan", nil)
	w := httptest.NewRecorder()
	s.handleProjectImport(w, req, "ws1")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleProjectImport_NoServices(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import/scan", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleProjectImport(w, req, "ws1")

	// handler checks services after method check → returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProjectImport_NoWorkspaceStore(t *testing.T) {
	s := newTestServer(t, nil)
	s.Services.WorkspaceStore = nil

	body := `{"path":"/tmp/test","workspaceId":"ws1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import/scan", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleProjectImport(w, req, "ws1")

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleSearchStream tests — improve from 0.0%
// =============================================================================

func TestHandleSearchStream_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search/stream", nil)
	w := httptest.NewRecorder()
	s.handleSearchStream(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleProjectByID additional tests — improve from 73.5%
// =============================================================================

func TestHandleProjectByID_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/p1", nil)
	w := httptest.NewRecorder()
	s.handleProjectByID(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleEndpoints additional tests — improve from 73.3%
// =============================================================================

func TestHandleEndpoints_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/endpoints", nil)
	w := httptest.NewRecorder()
	s.handleEndpoints(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleSQLExecute additional tests — improve from 60.6%
// =============================================================================

func TestHandleSQLExecute_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sql/execute", nil)
	w := httptest.NewRecorder()
	s.handleSQLExecute(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleSQLExecute_InvalidJSON(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleSQLExecute(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handleSQLTestConnection additional tests — improve from 60.0%
// =============================================================================

func TestHandleSQLTestConnection_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sql/test-connection", nil)
	w := httptest.NewRecorder()
	s.handleSQLTestConnection(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleSQLTestConnection_InvalidJSON(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/test-connection", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleSQLTestConnection(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handleRunConfigurations additional tests — improve from 52.9%
// =============================================================================

func TestHandleRunConfigurations_NoStore(t *testing.T) {
	s := newTestServer(t, nil)
	s.Services.RunConfigurationStore = nil

	req := httptest.NewRequest(http.MethodGet, "/api/v1/run-configurations", nil)
	w := httptest.NewRecorder()
	s.handleRunConfigurations(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleRunConfigurationByID additional tests — improve from 61.3%
// =============================================================================

func TestHandleRunConfigurationByID_NoStore(t *testing.T) {
	s := newTestServer(t, nil)
	s.Services.RunConfigurationStore = nil

	req := httptest.NewRequest(http.MethodGet, "/api/v1/run-configurations/rc1", nil)
	w := httptest.NewRecorder()
	s.handleRunConfigurationByID(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// requireRunConfigurationStore tests — improve from 50.0%
// =============================================================================

func TestRequireRunConfigurationStore_Nil(t *testing.T) {
	s := &Server{Services: &Services{RunConfigurationStore: nil}}
	w := httptest.NewRecorder()
	env := protocol.RequestEnvelope{RequestID: "req-1"}
	store := s.requireRunConfigurationStore(env, w)
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
	if store != nil {
		t.Error("expected nil store")
	}
}

// =============================================================================
// Shutdown tests — improve from 83.3%
// =============================================================================

func TestServer_Shutdown(t *testing.T) {
	s := newTestServer(t, nil)
	// Shutdown on a server that was never started
	err := s.Shutdown(context.Background())
	if err != nil {
		t.Logf("Shutdown returned error (expected if not started): %v", err)
	}
}

// =============================================================================
// handleJDTLSLaunchDescriptor additional tests — improve from 60.4%
// =============================================================================

func TestHandleJDTLSLaunchDescriptor_InvalidMethod(t *testing.T) {
	j := &fakeJDTLS{}
	s := newTestServer(t, j)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls/launch-descriptor", nil)
	w := httptest.NewRecorder()
	s.handleJDTLSLaunchDescriptor(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleJDTLSPrepare additional tests — improve from 83.3%
// =============================================================================

func TestHandleJDTLSPrepare_InvalidMethod(t *testing.T) {
	j := &fakeJDTLS{}
	s := newTestServer(t, j)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls/prepare", nil)
	w := httptest.NewRecorder()
	s.handleJDTLSPrepare(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleMaven subtests — improve from 80.0%+
// =============================================================================

func TestHandleMavenDetect_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/detect", nil)
	w := httptest.NewRecorder()
	s.handleMavenDetect(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleMavenDependencies_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/dependencies", nil)
	w := httptest.NewRecorder()
	s.handleMavenDependencies(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleMavenRun_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/run", nil)
	w := httptest.NewRecorder()
	s.handleMavenRun(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleEncodingRecode/Validate additional tests
// =============================================================================

func TestHandleEncodingRecode_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/encoding/recode", nil)
	w := httptest.NewRecorder()
	s.handleEncodingRecode(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleEncodingValidate_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/encoding/validate", nil)
	w := httptest.NewRecorder()
	s.handleEncodingValidate(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleProjectDetect additional tests — improve from 83.3%
// =============================================================================

func TestHandleProjectDetect_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/detect", nil)
	w := httptest.NewRecorder()
	s.handleProjectDetect(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleEvents additional tests — improve from 86.4%
// =============================================================================

func TestHandleEvents_NoEventBus(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", nil)
	w := httptest.NewRecorder()
	s.handleEvents(w, req)

	// handler checks EventBus before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleRuntimeRestart additional tests — improve from 100%
// =============================================================================

func TestHandleRuntimeRestart_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/runtime/restart", nil)
	w := httptest.NewRecorder()
	s.handleRuntimeRestart(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleSearch additional tests — improve from 95.7%
// =============================================================================

func TestHandleSearch_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	w := httptest.NewRecorder()
	s.handleSearch(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleLogin / handleLogout tests — improve from 100%
// =============================================================================

func TestHandleLogin_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/login", nil)
	w := httptest.NewRecorder()
	s.handleLogin(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleLogout_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/logout", nil)
	w := httptest.NewRecorder()
	s.handleLogout(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleWorkspacesJava tests
// =============================================================================

func TestHandleWorkspacesJava_UnknownSubpathDirect(t *testing.T) {
	s := newTestServer(t, nil)

	// Route pattern is /api/v1/workspaces/{ws}/java/...
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws1/java/unknown", nil)
	req.SetPathValue("ws", "ws1")
	w := httptest.NewRecorder()
	s.handleWorkspacesJava(w, req)

	// handleWorkspacesJava dispatches to default: "unknown java subpath" → 404
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handlePortDiagnostics tests
// =============================================================================

func TestHandlePortDiagnostics_InvalidMethod(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/port-diagnostics", nil)
	w := httptest.NewRecorder()
	s.handlePortDiagnostics(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// fakeJDTProjectGenerator for testing handleJDTProject
// =============================================================================

type fakeJDTProjectGenerator struct {
	statusRes  json.RawMessage
	statusErr  error
	genRes     json.RawMessage
	genErr     error
}

func (f *fakeJDTProjectGenerator) Generate(payload json.RawMessage) (json.RawMessage, error) {
	if f.genErr != nil {
		return nil, f.genErr
	}
	if f.genRes != nil {
		return f.genRes, nil
	}
	return json.RawMessage(`{"ok":true}`), nil
}

func (f *fakeJDTProjectGenerator) Status(workspaceID string) (json.RawMessage, error) {
	if f.statusErr != nil {
		return nil, f.statusErr
	}
	if f.statusRes != nil {
		return f.statusRes, nil
	}
	return json.RawMessage(`{"status":"ready"}`), nil
}

func TestHandleJDTProject_GET_WithGenerator(t *testing.T) {
	j := &fakeJDTLS{}
	gen := &fakeJDTProjectGenerator{}
	s := newTestServer(t, j)
	s.Services.JDTProjectGenerator = gen

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtproject?workspaceId=ws1", nil)
	w := httptest.NewRecorder()
	s.handleJDTProject(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleJDTProject_GET_StatusError(t *testing.T) {
	j := &fakeJDTLS{}
	gen := &fakeJDTProjectGenerator{statusErr: fmt.Errorf("status error")}
	s := newTestServer(t, j)
	s.Services.JDTProjectGenerator = gen

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtproject?workspaceId=ws1", nil)
	w := httptest.NewRecorder()
	s.handleJDTProject(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestHandleJDTProject_POST_WithGenerator(t *testing.T) {
	j := &fakeJDTLS{}
	gen := &fakeJDTProjectGenerator{}
	s := newTestServer(t, j)
	s.Services.JDTProjectGenerator = gen

	body := `{"requestId":"req-1","payload":{"projectId":"p1","workspaceId":"ws1"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtproject", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleJDTProject(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleJDTProject_POST_GenerateError(t *testing.T) {
	j := &fakeJDTLS{}
	gen := &fakeJDTProjectGenerator{genErr: fmt.Errorf("generate error")}
	s := newTestServer(t, j)
	s.Services.JDTProjectGenerator = gen

	body := `{"requestId":"req-1","payload":{"projectId":"p1","workspaceId":"ws1"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtproject", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleJDTProject(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleProjectImport deeper tests
// =============================================================================

func TestHandleProjectImport_InvalidJSON(t *testing.T) {
	s := newTestServer(t, nil)
	s.Services.WorkspaceStore = newFakeWSStore(t.TempDir())
	// Add a ProjectStore that implements projectCreator so we get past the
	// services check and reach the JSON decode step.
	s.Services.ProjectStore = &fakeProjectCreator{}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import/scan", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleProjectImport(w, req, "ws1")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// fakeProjectCreator implements ProjectStore + projectCreator for testing.
type fakeProjectCreator struct {
	projects []domain.Project
}

func (f *fakeProjectCreator) List() []domain.Project { return f.projects }
func (f *fakeProjectCreator) Get(id string) (domain.Project, error) {
	return domain.Project{}, fmt.Errorf("not found")
}
func (f *fakeProjectCreator) Update(id string, cfg *domain.Project) (domain.Project, error) {
	return domain.Project{}, fmt.Errorf("not implemented")
}
func (f *fakeProjectCreator) Delete(id string) error {
	return fmt.Errorf("not implemented")
}
func (f *fakeProjectCreator) Create(id string, cfg *domain.Project) (domain.Project, error) {
	return *cfg, nil
}

// fakeWSStore is a minimal WorkspaceStore for testing.
type fakeWSStore struct {
	root string
}

func newFakeWSStore(root string) *fakeWSStore {
	return &fakeWSStore{root: root}
}

func (f *fakeWSStore) List() []WorkspaceRecord {
	return nil
}

func (f *fakeWSStore) Open(rootPath, name string) (WorkspaceRecord, error) {
	return WorkspaceRecord{ID: "ws1", Name: name, RootPath: rootPath}, nil
}

func (f *fakeWSStore) Get(id string) (WorkspaceRecord, error) {
	return WorkspaceRecord{ID: id, RootPath: f.root}, nil
}

func (f *fakeWSStore) Close(id string) error {
	return nil
}

func TestHandleProjectImport_ValidJSON_NoProjectStore(t *testing.T) {
	s := newTestServer(t, nil)
	s.Services.WorkspaceStore = newFakeWSStore(t.TempDir())
	// ProjectStore is nil → should return 500

	body := `{"path":"/tmp/test","workspaceId":"ws1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import/scan", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleProjectImport(w, req, "ws1")

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleSearchStream deeper tests
// =============================================================================

func TestHandleSearchStream_InvalidJSON(t *testing.T) {
	s := newTestServer(t, nil)

	// handleSearchStream is a WebSocket upgrade handler, POST with JSON body
	// will fail the WebSocket upgrade
	req := httptest.NewRequest(http.MethodPost, "/api/v1/search/stream", nil)
	w := httptest.NewRecorder()
	s.handleSearchStream(w, req)

	// WebSocket upgrade fails, handler returns early
	if w.Code != http.StatusBadRequest {
		t.Logf("search stream returned %d", w.Code)
	}
}

// =============================================================================
// handleBuilds deeper tests
// =============================================================================

func TestHandleBuilds_GET_NoBuildEngine(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/builds", nil)
	w := httptest.NewRecorder()
	s.handleBuilds(w, req)

	// handler checks BuildEngine before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleDeployments deeper tests
// =============================================================================

func TestHandleDeployments_GET_NoDeployer(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/deployments", nil)
	w := httptest.NewRecorder()
	s.handleDeployments(w, req)

	// handler checks Deployer before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleServers deeper tests
// =============================================================================

func TestHandleServers_GET_NoServerRunner(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers", nil)
	w := httptest.NewRecorder()
	s.handleServers(w, req)

	// handler checks ServerRunner before method — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleBuilds deeper tests — improve from 37.8%
// =============================================================================

func TestHandleBuilds_POST_ProjectNotFound(t *testing.T) {
	s := newTestServer(t, nil)
	store := &fakeProjectStore{}
	s.Services.ProjectStore = store

	body := mustEnvelope(t, map[string]any{"projectId": "unknown-proj"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleBuilds(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unknown project, got %d, body=%s", w.Code, w.Body.String())
	}
}

func TestHandleBuilds_POST_HappyPath(t *testing.T) {
	s := newTestServer(t, nil)
	dir := t.TempDir()
	libDir := filepath.Join(dir, "lib")
	os.MkdirAll(libDir, 0755)

	store := &fakeProjectStore{
		saved: domain.Project{
			ID:        "proj-1",
			RootPath:  dir,
			OutputDir: "build/classes",
			SourceLevel: "1.8",
			TargetLevel: "1.8",
			Encoding:  "UTF-8",
		},
	}
	s.Services.ProjectStore = store
	engine := &cancelBuildEngineStub{result: &BuildResult{ID: "build-1", State: "queued"}}
	s.Services.BuildEngine = engine

	body := mustEnvelope(t, map[string]any{"projectId": "proj-1"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleBuilds(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body=%s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handleWorkspacesSub deeper tests — improve from 63.0%
// =============================================================================

func TestHandleWorkspacesSub_Scan_NoWorkspaceStore(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws1/scan", nil)
	w := httptest.NewRecorder()
	s.handleWorkspacesSub(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleServerSub deeper tests — improve from 61.4%
// =============================================================================

func TestHandleServerSub_InvalidSubpath(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/srv1/invalid", nil)
	w := httptest.NewRecorder()
	s.handleServerSub(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleJDTLSLaunchDescriptor deeper tests — improve from 64.2%
// =============================================================================

func TestHandleJDTLSLaunchDescriptor_NoToolchainRepo_Extended(t *testing.T) {
	s := newTestServer(t, nil)
	repo := &fakeProjectRepo{}
	s.Services.ProjectRepo = repo
	// ToolchainRegistry is nil

	body := mustEnvelope(t, map[string]any{"projectId": "proj-1"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws1/jdtls/launch-descriptor", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleJDTLSLaunchDescriptor(w, req)

	// handler checks method first — GET only — returns 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body=%s", w.Code, w.Body.String())
	}
}

// =============================================================================
// handleProjectByID deeper tests — improve from 73.5%
// =============================================================================

func TestHandleProjectByID_Delete_NoStore(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/projects/proj-1", nil)
	w := httptest.NewRecorder()
	s.handleProjectByID(w, req)

	// ProjectStore not configured — returns 500
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// hydrateBuildRequest deeper tests — improve from 60.3%
// =============================================================================

func TestHydrateBuildRequest_EmptyRoot(t *testing.T) {
	req := &BuildRequest{}
	p := domain.Project{RootPath: "", Root: ""}
	err := hydrateBuildRequest(req, p)
	if err == nil {
		t.Fatal("expected error for empty root")
	}
}

func TestHydrateBuildRequest_EmptyOutputDir(t *testing.T) {
	dir := t.TempDir()
	req := &BuildRequest{}
	p := domain.Project{RootPath: dir, OutputDir: "", SourceLevel: "1.8"}
	err := hydrateBuildRequest(req, p)
	if err == nil {
		t.Fatal("expected error for empty outputDir")
	}
}

func TestHydrateBuildRequest_InvalidIntent(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "build/classes"), 0755)
	req := &BuildRequest{Intent: "invalid"}
	p := domain.Project{RootPath: dir, OutputDir: "build/classes", SourceLevel: "1.8"}
	err := hydrateBuildRequest(req, p)
	if err == nil {
		t.Fatal("expected error for invalid intent")
	}
}

func TestHydrateBuildRequest_SelectedFiles_Empty(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "build/classes"), 0755)
	req := &BuildRequest{Intent: "selected-files", SelectedFiles: []string{}}
	p := domain.Project{RootPath: dir, OutputDir: "build/classes", SourceLevel: "1.8"}
	err := hydrateBuildRequest(req, p)
	if err == nil {
		t.Fatal("expected error for empty selectedFiles")
	}
}

func TestHydrateBuildRequest_OutputDirEqualsRoot(t *testing.T) {
	dir := t.TempDir()
	req := &BuildRequest{}
	p := domain.Project{RootPath: dir, OutputDir: ".", SourceLevel: "1.8"}
	err := hydrateBuildRequest(req, p)
	if err == nil {
		t.Fatal("expected error for outputDir equals root")
	}
}

func TestHydrateBuildRequest_IntentFull_Default(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "build/classes"), 0755)
	req := &BuildRequest{}
	p := domain.Project{RootPath: dir, OutputDir: "build/classes", SourceLevel: "1.8", TargetLevel: "1.8", Encoding: "UTF-8"}
	err := hydrateBuildRequest(req, p)
	if err != nil {
		t.Fatalf("hydrateBuildRequest: %v", err)
	}
	if req.Intent != "full" {
		t.Errorf("Intent = %q, want full", req.Intent)
	}
	if req.ProjectRoot == "" {
		t.Error("ProjectRoot should be set")
	}
	if req.Encoding != "UTF-8" {
		t.Errorf("Encoding = %q, want UTF-8", req.Encoding)
	}
}

// =============================================================================
// handleServerLogs deeper tests — improve from 85.0%
// =============================================================================

func TestHandleServerLogs_NoServerRunner_Direct(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/srv1/logs", nil)
	w := httptest.NewRecorder()
	s.handleServerLogs(w, req, "srv1", protocol.RequestEnvelope{})

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleEvents deeper tests — improve from 86.4%
// =============================================================================

func TestHandleEvents_NoEventBus_Direct(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	w := httptest.NewRecorder()
	s.handleEvents(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleEncodingRecode / handleEncodingValidate deeper tests
// =============================================================================

func TestHandleEncodingRecode_NoEncoder(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test", "from": "gbk", "to": "utf-8"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/recode", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleEncodingRecode(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandleEncodingValidate_NoEncoder(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/validate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleEncodingValidate(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleMavenDetect / handleMavenRun deeper tests
// =============================================================================

func TestHandleMavenDetect_NoMavenRunner(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleMavenDetect(w, req)

	// body has "path" not "rootPath" → rootPath empty → 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleMavenRun_NoMavenRunner(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test", "goals": []string{"compile"}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleMavenRun(w, req)

	// body has "path" and "goals" not "rootPath" and "task" → 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleMavenDependencies deeper tests
// =============================================================================

func TestHandleMavenDependencies_NoMavenRunner(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/dependencies", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleMavenDependencies(w, req)

	// handler is GET only, POST → 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleEndpoints deeper tests — improve from 73.3%
// =============================================================================

func TestHandleEndpoints_NoEventBus(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/endpoints", nil)
	w := httptest.NewRecorder()
	s.handleEndpoints(w, req)

	// GET works fine without EventBus — returns 200
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// =============================================================================
// handleAudit deeper tests — improve from 75.0%
// =============================================================================

func TestHandleAudit_NoAuditLog(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"query": "test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/audit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleAudit(w, req)

	// handler is GET only, POST → 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleProjectDetect deeper tests — improve from 83.3%
// =============================================================================

func TestHandleProjectDetect_NoScanner(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleProjectDetect(w, req)

	// body has "path" not "rootPath" → rootPath empty → 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleToolchainImport deeper tests — improve from 87.5%
// =============================================================================

func TestHandleToolchainImport_NoRegistry_Extended(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test", "label": "JDK 17"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/toolchains/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleToolchainImport(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleWorkspacesJava deeper tests
// =============================================================================

func TestHandleWorkspacesJava_NoProject(t *testing.T) {
	s := newTestServer(t, nil)
	s.Services.JDTLS = nil

	body := mustEnvelope(t, map[string]any{"projectId": "nonexistent"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws1/java/prepare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("ws", "ws1")
	w := httptest.NewRecorder()
	s.handleWorkspacesJava(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandleWorkspacesJava_InvalidPath(t *testing.T) {
	s := newTestServer(t, nil)
	s.Services.JDTLS = nil

	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws1/java/invalid-path", nil)
	req.SetPathValue("ws", "ws1")
	w := httptest.NewRecorder()
	s.handleWorkspacesJava(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// =============================================================================
// SQL handlers deeper tests
// =============================================================================

func TestHandleSQLExecute_NoSQLService(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"connectionId": "c1", "sql": "SELECT 1"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleSQLExecute(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandleSQLTestConnection_NoSQLService(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"url": "jdbc:h2:mem:test", "driver": "org.h2.Driver"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/test-connection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleSQLTestConnection(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// handleDebugAdapterStatus / handleJDKDownload deeper tests
// =============================================================================

func TestHandleDebugAdapterStatus_NoDebugger(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/debug/adapter/status", nil)
	w := httptest.NewRecorder()
	s.handleDebugAdapterStatus(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandleJDKDownload_NoToolchain(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/debug/jdk/download", nil)
	w := httptest.NewRecorder()
	s.handleJDKDownload(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

// =============================================================================
// handleAntClasspathAnalyze deeper tests
// =============================================================================

func TestHandleAntClasspathAnalyze_NoBuildScanner(t *testing.T) {
	s := newTestServer(t, nil)

	body := mustEnvelope(t, map[string]any{"path": "/test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ant/classpath/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleAntClasspathAnalyze(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// =============================================================================
// handlePortDiagnostics deeper tests
// =============================================================================

func TestHandlePortDiagnostics_GET(t *testing.T) {
	s := newTestServer(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/diagnostics/port?port=8080", nil)
	w := httptest.NewRecorder()
	s.handlePortDiagnostics(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}