package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// fakeJDTLS is an in-memory JDTLS service used by the
// /api/v1/jdtls handler tests. It mimics the
// start->initialize->ready / stop / crash contract without
// spawning a real JVM.
type fakeJDTLS struct {
	mu       sync.Mutex
	state    string // stopped|starting|running|stopping|crashed
	pid      int
	jre      string
	jar      string
	version  string
	lastErr  string
	initOK   bool
	startErr error
	stopErr  error
}

func (f *fakeJDTLS) Status() (json.RawMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return json.Marshal(jdtlsTestStatus{
		State:     f.state,
		Pid:       f.pid,
		Version:   f.version,
		JRE:       f.jre,
		Jar:       f.jar,
		LastError: f.lastErr,
	})
}

func (f *fakeJDTLS) Prepare(ctx context.Context) (json.RawMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.state = "stopped"
	f.version = "1.43.0"
	return json.Marshal(jdtlsTestStatus{
		State:   f.state,
		Version: f.version,
		JRE:     f.jre,
	})
}

func (f *fakeJDTLS) GetLaunchDescriptor(ctx context.Context, workspaceID string, projectID string, workingDir string) (json.RawMessage, error) {
	dir := workingDir
	if dir == "" {
		dir = "/path/to/project"
	}
	return json.Marshal(map[string]interface{}{
		"command":      "/path/to/java",
		"args":         []string{"-jar", "launcher.jar"},
		"workingDir":   dir,
		"envAllowlist": []string{"PATH=/usr/bin", "JAVA_HOME=/path/to/jre"},
	})
}

type jdtlsTestStatus struct {
	State       string `json:"state"`
	Pid         int    `json:"pid,omitempty"`
	Version     string `json:"version,omitempty"`
	StartedAt   string `json:"startedAt,omitempty"`
	StoppedAt   string `json:"stoppedAt,omitempty"`
	JRE         string `json:"jre,omitempty"`
	Jar         string `json:"jar,omitempty"`
	SourceLevel string `json:"sourceLevel,omitempty"`
	LastError   string `json:"lastError,omitempty"`
}

func newTestServer(t *testing.T, j *fakeJDTLS) *Server {
	t.Helper()
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	svcs := &Services{JDTLS: j}
	return NewServer(svcs, logger, auditLog, "test-0.1.0", "")
}

func decodeOK(t *testing.T, body []byte) (protocol.ResponseEnvelope, map[string]any) {
	t.Helper()
	var env protocol.ResponseEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, string(body))
	}
	if !env.OK {
		t.Fatalf("expected ok=true, got %+v", env)
	}
	raw, _ := json.Marshal(env.Payload)
	var p map[string]any
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("payload unmarshal: %v raw=%s", err, string(raw))
	}
	return env, p
}

func decodeErr(t *testing.T, body []byte) (protocol.ErrorResponse, protocol.KairoError) {
	t.Helper()
	var env protocol.ErrorResponse
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, string(body))
	}
	if env.OK {
		t.Fatalf("expected ok=false, got %+v", env)
	}
	return env, env.Error
}

func TestJDTLS_GetReturnsStoppedWhenNeverStarted(t *testing.T) {
	j := &fakeJDTLS{state: "stopped", jre: "C:/jre17", version: "1.43.0"}
	srv := newTestServer(t, j)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if p["state"] != "stopped" {
		t.Errorf("state = %v, want stopped", p["state"])
	}
	if p["jre"] != "C:/jre17" {
		t.Errorf("jre = %v, want C:/jre17", p["jre"])
	}
}

func TestJDTLS_PostPrepareInstallsDistribution(t *testing.T) {
	j := &fakeJDTLS{state: "stopped", jre: "C:/jre17", version: "1.43.0"}
	srv := newTestServer(t, j)

	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("prepare status = %d body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if p["state"] != "stopped" {
		t.Errorf("state = %v, want stopped", p["state"])
	}
	if p["version"] != "1.43.0" {
		t.Errorf("version = %v, want 1.43.0", p["version"])
	}
}

func TestJDTLS_DeleteReturnsError(t *testing.T) {
	j := &fakeJDTLS{state: "stopped", jre: "C:/jre17", version: "1.43.0"}
	srv := newTestServer(t, j)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestJDTLS_UnsupportedMethod(t *testing.T) {
	j := &fakeJDTLS{state: "stopped"}
	srv := newTestServer(t, j)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestJDTLS_NotConfiguredReturnsError(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
}

func mustEnvelope(t *testing.T, payload map[string]any) []byte {
	t.Helper()
	// The wire shape is {"requestId":"...", "payload":{...}};
	// the Go RequestEnvelope struct has no Payload field, so we
	// hand-build the JSON to mirror what the UI sends.
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	body := []byte(`{"requestId":"test-req-1","workspaceId":"ws_test","payload":`)
	body = append(body, raw...)
	body = append(body, '}')
	return body
}

// Sanity: round-trip the request through the full middleware
// (request id, recovery) to make sure the handler does not blow
// up under the same chain that real traffic uses.
func TestJDTLS_FullMiddlewareRoundTrip(t *testing.T) {
	j := &fakeJDTLS{state: "running", jre: "C:/jre17", version: "1.42.0", pid: 99}
	srv := newTestServer(t, j)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/jdtls", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d body=%s", res.StatusCode, string(body))
	}
	if !strings.Contains(string(body), `"state":"running"`) {
		t.Errorf("body missing state=running: %s", string(body))
	}
}

// TestEndpoints_NoSecret_ReturnsDynamicHostPort covers
// docs/hotfix-windows-test-readiness.md 搂2. The endpoint is
// reachable without the secret (per the middleware exemption
// list) so the runtime client can discover host:port during
// boot. The actual values come from the Server's bind/port,
// which we set by hand here.
func TestEndpoints_NoSecret_ReturnsDynamicHostPort(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")
	srv.bindAddr = "127.0.0.1"
	srv.port = 18099

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/endpoints", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if got, _ := p["http"].(string); got != "127.0.0.1:18099" {
		t.Errorf("http = %q, want 127.0.0.1:18099", got)
	}
	if got, _ := p["events"].(string); got != "127.0.0.1:18099" {
		t.Errorf("events = %q, want 127.0.0.1:18099", got)
	}
}

// TestEndpoints_RejectsNonGET covers the contract that the
// endpoint is GET-only.
func TestEndpoints_RejectsNonGET(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/endpoints", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestRuntimeRestart_Sends200AndKicksOffAsync covers
// docs/hotfix-windows-test-readiness.md 搂3. The handler
// MUST reply 200 with `{status: restarting}` before doing
// any work, so the caller gets a real acknowledgement. The
// actual respawn is hard to assert in a unit test (it calls
// os.Exit), so we install a fake shutdown hook that records
// the call and skip the exec step by leaving Executable
// empty.
func TestRuntimeRestart_Sends200AndKicksOffAsync(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "test-secret")

	shutdownCalled := make(chan struct{}, 1)
	srv.SetRestartConfig(RestartConfig{
		Args:            []string{"--config", "test"},
		ShutdownTimeout: 100 * time.Millisecond,
		NoExec:          true, // unit test: don't actually replace the test process
		OnShutdown: func(ctx context.Context) error {
			select {
			case shutdownCalled <- struct{}{}:
			default:
			}
			return nil
		},
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runtime/restart", nil)
	req.Header.Set("X-Kairo-Secret", "test-secret")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if got, _ := p["status"].(string); got != "restarting" {
		t.Errorf("status = %q, want restarting", got)
	}

	// The async shutdown hook should fire within a short
	// window. We don't assert Executable=.../os.Exit because
	// that would actually exit the test process.
	select {
	case <-shutdownCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("OnShutdown was not called within 2s")
	}
}

// TestRuntimeRestart_RequiresAuth covers that
// /api/v1/runtime/restart is gated by X-Kairo-Secret like
// every other non-exempt route.
func TestRuntimeRestart_RequiresAuth(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "topsecret")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runtime/restart", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", rr.Code, rr.Body.String())
	}
}

// TestRuntimeRestart_RejectsNonPOST covers the contract that
// the endpoint is POST-only.
func TestRuntimeRestart_RejectsNonPOST(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "topsecret")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/runtime/restart", nil)
	req.Header.Set("X-Kairo-Secret", "topsecret")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestEvents_RejectsMissingSubprotocol covers
// docs/hotfix-windows-test-readiness.md 搂1.2: WS auth uses
// the Sec-WebSocket-Protocol header. When the agent has a
// secret configured, a request without the matching
// subprotocol must return 401 (not upgrade).
func TestEvents_RejectsMissingSubprotocol(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	// fakeEventBus records calls to Serve so we can assert
	// the handler short-circuits before the upgrade.
	bus := &fakeEventBus{}
	srv := NewServer(&Services{EventBus: bus}, logger, auditLog, "test-0.1.0", "topsecret")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", rr.Code, rr.Body.String())
	}
	if bus.called {
		t.Fatal("EventBus.Serve must not be called when subprotocol is missing")
	}
}

// TestEvents_RejectsMismatchedSecret covers that a subprotocol
// present with the wrong secret is still 401.
func TestEvents_RejectsMismatchedSecret(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	bus := &fakeEventBus{}
	srv := NewServer(&Services{EventBus: bus}, logger, auditLog, "test-0.1.0", "topsecret")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	req.Header.Set("Sec-WebSocket-Protocol", WebSocketSubprotocol+", wrongsecret")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", rr.Code, rr.Body.String())
	}
	if bus.called {
		t.Fatal("EventBus.Serve must not be called when subprotocol secret is wrong")
	}
}

// TestEvents_AcceptsValidSubprotocol covers that the right
// secret is accepted and EventBus.Serve is invoked.
func TestEvents_AcceptsValidSubprotocol(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	bus := &fakeEventBus{}
	srv := NewServer(&Services{EventBus: bus}, logger, auditLog, "test-0.1.0", "topsecret")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	req.Header.Set("Sec-WebSocket-Protocol", WebSocketSubprotocol+", topsecret")
	srv.Handler().ServeHTTP(rr, req)
	if !bus.called {
		t.Fatalf("EventBus.Serve was not called for valid subprotocol; status=%d body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Sec-WebSocket-Protocol"); got != "topsecret" {
		t.Errorf("Sec-WebSocket-Protocol echo = %q, want topsecret", got)
	}
}

// TestSecretHeader_RequiredForProtectedRoutes sanity-checks
// that X-Kairo-Secret is the only auth header, and that
// /api/v1/health + /api/v1/endpoints are exempt (per
// docs/hotfix-windows-test-readiness.md 搂1.1 / 搂2).
func TestSecretHeader_RequiredForProtectedRoutes(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "topsecret")

	// Protected route: 401 without the secret.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("audit without secret: status = %d, want 401, body=%s", rr.Code, rr.Body.String())
	}

	// health + endpoints: 200 without the secret.
	for _, p := range []string{"/api/v1/health", "/api/v1/endpoints"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, p, nil)
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("%s without secret: status = %d, want 200, body=%s", p, rr.Code, rr.Body.String())
		}
	}

	// Authorization: Bearer must NOT bypass the secret.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	req.Header.Set("Authorization", "Bearer topsecret")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("audit with Authorization Bearer (no X-Kairo-Secret): status = %d, want 401, body=%s",
			rr.Code, rr.Body.String())
	}

	// X-Kairo-Secret with the right value: 200.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	req.Header.Set("X-Kairo-Secret", "topsecret")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("audit with correct X-Kairo-Secret: status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// fakeEventBus is a stub EventBus that records whether Serve
// was called. Used by the WebSocket subprotocol tests.
type fakeEventBus struct {
	called bool
}

func (f *fakeEventBus) Serve(w http.ResponseWriter, r *http.Request) {
	f.called = true
	// In a real call we would call upgrader.Upgrade here. We
	// deliberately do NOT, so the tests stay single-threaded
	// and the recorder does not have to model a real upgrade.
	w.WriteHeader(http.StatusSwitchingProtocols)
}

// fakeProjectStore is a minimal in-memory ProjectStore for
// handler tests.
type fakeProjectStore struct {
	saved domain.Project
}

func (f *fakeProjectStore) List() []domain.Project { return []domain.Project{f.saved} }
func (f *fakeProjectStore) Get(id string) (domain.Project, error) {
	if f.saved.ID != domain.ProjectID(id) {
		return domain.Project{}, fmt.Errorf("project not found: %s", id)
	}
	return f.saved, nil
}
func (f *fakeProjectStore) Update(id string, cfg *domain.Project) (domain.Project, error) {
	f.saved = *cfg
	return *cfg, nil
}
func (f *fakeProjectStore) Delete(id string) error {
	f.saved = domain.Project{}
	return nil
}

// KAIRO-RC-WEB-203: PUT /api/v1/projects/{id} must persist
// <root>/.kairo/project.yaml — jdtproject.Generate reads it.
func TestProjectPut_WritesKairoProjectYAML(t *testing.T) {
	root := t.TempDir()
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	store := &fakeProjectStore{}
	srv := NewServer(&Services{ProjectStore: store}, logger, auditLog, "test-0.1.0", "")

	body := `{"id":"proj-1","workspaceId":"ws-1","name":"Legacy 中文项目","rootPath":"` + filepath.ToSlash(root) + `","sourceRoots":["src"],"webappDir":"WebRoot","outputDir":"build/classes","sourceLevel":"1.8","targetLevel":"1.8","encoding":"gbk","buildTool":"ant"}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/projects/proj-1", strings.NewReader(body))
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if store.saved.Name != "Legacy 中文项目" {
		t.Fatalf("catalog stored name = %q, want %q", store.saved.Name, "Legacy 中文项目")
	}
	yamlPath := filepath.Join(root, ".kairo", "project.yaml")
	data, err := os.ReadFile(yamlPath)
	if err != nil {
		t.Fatalf("expected %s to exist: %v", yamlPath, err)
	}
	if !strings.Contains(string(data), "Legacy 中文项目") || !strings.Contains(string(data), "gbk") {
		t.Fatalf("project.yaml missing name/encoding:\n%s", string(data))
	}
}

// fakeServerRunner records the Start request it was given.
type fakeServerRunner struct {
	lastReq    StartServerRequest
	restartID  string
	restartErr error
	logs       []ServerLogEntry
	logsErr    error
	lastTail   int
}

func (f *fakeServerRunner) Start(req StartServerRequest) (*ServerResponse, error) {
	f.lastReq = req
	return &ServerResponse{ID: "srv_1", ProjectID: req.ProjectID, State: "starting", ContextPath: req.ContextPath, Ports: &ServerPorts{HTTP: req.HTTPPort, Debug: req.DebugPort}}, nil
}
func (f *fakeServerRunner) CatalinaHome() string                   { return "/tmp/catalina" }
func (f *fakeServerRunner) Get(id string) (*ServerResponse, error) { return nil, nil }
func (f *fakeServerRunner) List() []*ServerResponse                { return nil }
func (f *fakeServerRunner) Stop(id string, force bool) (*ServerResponse, error) {
	return nil, nil
}
func (f *fakeServerRunner) Restart(id string) (*ServerResponse, error) {
	f.restartID = id
	if f.restartErr != nil {
		return nil, f.restartErr
	}
	return &ServerResponse{ID: id, State: "running"}, nil
}
func (f *fakeServerRunner) Debug(id string) (*ServerResponse, error) { return nil, nil }
func (f *fakeServerRunner) Logs(id string, tail int) ([]ServerLogEntry, error) {
	f.lastTail = tail
	return f.logs, f.logsErr
}
func (f *fakeServerRunner) Recoverable() []*ServerResponse { return nil }
func (f *fakeServerRunner) Recover(id string) (*ServerResponse, error) {
	return &ServerResponse{ID: id, State: "running"}, nil
}

// KAIRO-RC-WEB-240: POST /api/v1/servers with only {projectId} must
// resolve webappDir/contextPath from the stored project.
func TestServerStart_ResolvesWebappDirFromProject(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	store := &fakeProjectStore{saved: domain.Project{
		ID:        "proj-1",
		Name:      "legacy",
		RootPath:  "/tmp/legacy-sample",
		WebappDir: "WebRoot",
	}}
	runner := &fakeServerRunner{}
	srv := NewServer(&Services{ProjectStore: store, ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers", strings.NewReader(`{"projectId":"proj-1"}`))
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if filepath.ToSlash(runner.lastReq.WebappDir) != "/tmp/legacy-sample/WebRoot" {
		t.Fatalf("WebappDir = %q, want /tmp/legacy-sample/WebRoot", runner.lastReq.WebappDir)
	}
}

func TestServerStart_PropagatesExplicitDebugMode(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(filepath.Join(t.TempDir(), "audit.log"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	store := &fakeProjectStore{saved: domain.Project{
		ID: "proj-1", RootPath: "/tmp/legacy-sample", WebappDir: "WebRoot",
	}}
	runner := &fakeServerRunner{}
	srv := NewServer(&Services{ProjectStore: store, ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers", strings.NewReader(`{"projectId":"proj-1","debug":true}`))
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if !runner.lastReq.Debug {
		t.Fatal("debug=true was not propagated to ServerRunner")
	}
}

// POST /api/v1/servers/{id}/restart must route to ServerRunner.Restart
// (previously the sub-path fell through to "unknown subpath" → 404).
func TestServerRestart_RoutesToRunner(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	runner := &fakeServerRunner{}
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/srv_1/restart", strings.NewReader(`{}`))
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if runner.restartID != "srv_1" {
		t.Fatalf("restart id = %q, want srv_1", runner.restartID)
	}

	// GET on the restart sub-path is method-not-allowed.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/servers/srv_1/restart", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code == http.StatusOK {
		t.Fatalf("GET restart should not succeed, body=%s", rr.Body.String())
	}

	// Unknown server → 404 not_found.
	runner.restartErr = errors.New("server not found: srv_x")
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v1/servers/srv_x/restart", strings.NewReader(`{}`))
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

// GET /api/v1/servers/{id}/logs must return the [{line, ts, stream?}]
// contract shape and pass ?tail=N through to the runner.
func TestServerLogs_ReturnsEntriesAndTail(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	runner := &fakeServerRunner{
		logs: []ServerLogEntry{{Line: "INFO: Server startup in 1234 ms", TS: "2026-01-01T00:00:00Z"}},
	}
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/srv_1/logs?tail=50", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if runner.lastTail != 50 {
		t.Fatalf("tail = %d, want 50", runner.lastTail)
	}
	var env struct {
		OK      bool            `json:"ok"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	var entries []ServerLogEntry
	if err := json.Unmarshal(env.Payload, &entries); err != nil {
		t.Fatalf("payload is not a log entry array: %v", err)
	}
	if len(entries) != 1 || entries[0].Line == "" || entries[0].TS == "" {
		t.Fatalf("unexpected entries: %#v", entries)
	}

	// Unknown server → 404 not_found.
	runner.logsErr = errors.New("server not found: srv_x")
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/servers/srv_x/logs", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

// fakeDeployer records the Publish request.
type fakeDeployer struct {
	lastReq DeployRequest
}

func (f *fakeDeployer) Publish(req DeployRequest) (*DeployResult, error) {
	f.lastReq = req
	return &DeployResult{ID: "dep_1", State: "success"}, nil
}
func (f *fakeDeployer) Get(id string) (*DeployResult, error) { return nil, nil }
func (f *fakeDeployer) List() []*DeployResult                { return nil }

// KAIRO-RC-WEB-239: POST /api/v1/deployments {projectId, buildId}
// must resolve source (project webapp) and target (catalina webapps).
func TestDeployment_ResolvesSourceAndTargetFromProject(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	store := &fakeProjectStore{saved: domain.Project{
		ID:          "proj-1",
		Name:        "Legacy Sample",
		RootPath:    "/tmp/legacy-sample",
		WebappDir:   "WebRoot",
		SourceRoots: []string{"src"},
	}}
	runner := &fakeServerRunner{}
	deployer := &fakeDeployer{}
	srv := NewServer(&Services{ProjectStore: store, ServerRunner: runner, Deployer: deployer}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/deployments", strings.NewReader(`{"projectId":"proj-1","buildId":"b1","scope":"all"}`))
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if filepath.ToSlash(deployer.lastReq.Source) != "/tmp/legacy-sample/WebRoot" {
		t.Fatalf("Source = %q, want /tmp/legacy-sample/WebRoot", deployer.lastReq.Source)
	}
	if filepath.ToSlash(deployer.lastReq.Target) != "/tmp/catalina/webapps/legacy-sample" {
		t.Fatalf("Target = %q, want /tmp/catalina/webapps/legacy-sample", deployer.lastReq.Target)
	}
}

// KAIRO-RC-WEB-238: POST /api/v1/builds {projectId} must hydrate
// root/levels/encoding/outputDir/classpath from the project.
func TestBuildStart_HydratesFromProject(t *testing.T) {
	root := t.TempDir()
	proj := domain.Project{
		ID:          "proj-1",
		Name:        "legacy",
		RootPath:    root,
		WebappDir:   "WebRoot",
		OutputDir:   "build/classes",
		SourceLevel: "1.8",
		TargetLevel: "1.8",
		Encoding:    "gbk",
	}
	req := BuildRequest{ProjectID: "proj-1"}
	if err := hydrateBuildRequest(&req, proj); err != nil {
		t.Fatal(err)
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if req.ProjectRoot != realRoot {
		t.Fatalf("ProjectRoot = %q", req.ProjectRoot)
	}
	if req.SourceLevel != "1.8" || req.TargetLevel != "1.8" {
		t.Fatalf("levels = %q/%q", req.SourceLevel, req.TargetLevel)
	}
	if req.Encoding != "gbk" {
		t.Fatalf("Encoding = %q", req.Encoding)
	}
	if req.OutputDir != filepath.Join(realRoot, "build", "classes") {
		t.Fatalf("OutputDir = %q", req.OutputDir)
	}
}

type cancelBuildEngineStub struct {
	cancelCalls int
	result      *BuildResult
}

func (s *cancelBuildEngineStub) Start(BuildRequest) (*BuildResult, error) { return s.result, nil }
func (s *cancelBuildEngineStub) Get(string) (*BuildResult, error)         { return s.result, nil }
func (s *cancelBuildEngineStub) List() []*BuildResult                     { return []*BuildResult{s.result} }
func (s *cancelBuildEngineStub) Cancel(ctx context.Context, _ string) (*BuildResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.cancelCalls++
	return s.result, nil
}

func TestBuildDeleteInvokesCancellation(t *testing.T) {
	engine := &cancelBuildEngineStub{result: &BuildResult{ID: "build-1", State: "cancelled"}}
	srv := newTestServer(t, nil)
	srv.Services.BuildEngine = engine
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/builds/build-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if engine.cancelCalls != 1 {
		t.Fatalf("Cancel calls = %d, want 1", engine.cancelCalls)
	}
}

func TestBuildRequestRejectsCallerSuppliedExecutionPaths(t *testing.T) {
	var req BuildRequest
	malicious := `{"projectId":"proj-1","projectRoot":"/outside","outputDir":"/outside/out","files":["/outside/Evil.java"],"classpath":["/outside/evil.jar"],"toolchainId":"attacker"}`
	if err := decodeStrictBuildRequest([]byte(malicious), &req); err == nil {
		t.Fatal("trusted execution fields must be rejected as unknown")
	}
}

func TestBuildPostRejectsCallerSuppliedExecutionPaths(t *testing.T) {
	srv := newTestServer(t, nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/builds", strings.NewReader(`{"projectId":"proj-1","projectRoot":"/outside"}`))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "unknown field") {
		t.Fatalf("response does not explain strict rejection: %s", rr.Body.String())
	}
}

func TestBuildSelectedFileTraversalIsRejected(t *testing.T) {
	root := t.TempDir()
	req := BuildRequest{ProjectID: "proj-1", Intent: "selected-files", SelectedFiles: []string{"../Escape.java"}}
	project := domain.Project{ID: "proj-1", RootPath: root, OutputDir: "build/classes"}
	if err := hydrateBuildRequest(&req, project); err == nil {
		t.Fatal("selected file traversal must be rejected")
	}
}

type contextSearchStub struct {
	seen error
}

func (s *contextSearchStub) Search(ctx context.Context, _ json.RawMessage) (json.RawMessage, error) {
	s.seen = ctx.Err()
	return nil, ctx.Err()
}

// fakeWorkspaceStore is a minimal in-memory WorkspaceStore for handler tests.
type fakeWorkspaceStore struct {
	workspaces []WorkspaceRecord
}

func (f *fakeWorkspaceStore) List() []WorkspaceRecord                { return f.workspaces }
func (f *fakeWorkspaceStore) Get(id string) (WorkspaceRecord, error) {
	for _, ws := range f.workspaces {
		if ws.ID == id {
			return ws, nil
		}
	}
	return WorkspaceRecord{}, fmt.Errorf("workspace not found: %s", id)
}
func (f *fakeWorkspaceStore) Open(rootPath, name string) (WorkspaceRecord, error) {
	ws := WorkspaceRecord{
		ID:       "ws_" + name,
		Name:     name,
		RootPath: rootPath,
	}
	f.workspaces = append(f.workspaces, ws)
	return ws, nil
}
func (f *fakeWorkspaceStore) Close(id string) error {
	for i, ws := range f.workspaces {
		if ws.ID == id {
			f.workspaces = append(f.workspaces[:i], f.workspaces[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("workspace not found: %s", id)
}

// fakeToolchainRegistry is a minimal in-memory ToolchainRegistry for handler tests.
type fakeToolchainRegistry struct {
	toolchains []json.RawMessage
}

func (f *fakeToolchainRegistry) List() []json.RawMessage { return f.toolchains }
func (f *fakeToolchainRegistry) Import(path, label string) (json.RawMessage, error) {
	raw, _ := json.Marshal(map[string]string{"id": "tc_test", "name": label, "path": path})
	return raw, nil
}

// fakeEncoder is a minimal Encoder for handler tests.
type fakeEncoder struct{}

func (f *fakeEncoder) Detect(payload json.RawMessage) (json.RawMessage, error) {
	return json.Marshal(map[string]any{"encoding": "utf-8", "confidence": 0.95})
}
func (f *fakeEncoder) Recode(payload json.RawMessage) (json.RawMessage, error) {
	return json.Marshal(map[string]any{"encoding": "utf-8", "content": "re-encoded"})
}
func (f *fakeEncoder) Validate(payload json.RawMessage) (json.RawMessage, error) {
	return json.Marshal(map[string]bool{"valid": true})
}

// fakeAuth is a minimal Authenticator for handler tests.
type fakeAuth struct {
	loginErr error
}

func (f *fakeAuth) Login(payload json.RawMessage, w http.ResponseWriter) (json.RawMessage, error) {
	if f.loginErr != nil {
		return nil, f.loginErr
	}
	return json.Marshal(map[string]any{"token": "test-token", "user": "admin"})
}
func (f *fakeAuth) Logout(r *http.Request, w http.ResponseWriter) error { return nil }

// TestHealth_RejectsNonGET tests that the health endpoint rejects non-GET methods.
func TestHealth_RejectsNonGET(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/health", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHealth_OK tests the health endpoint returns correct data.
func TestHealth_OK(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")
	srv.bindAddr = "127.0.0.1"
	srv.port = 8080

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if got, _ := p["version"].(string); got != "test-0.1.0" {
		t.Errorf("version = %q, want test-0.1.0", got)
	}
	if _, ok := p["platform"]; !ok {
		t.Error("health response missing platform field")
	}
}

// TestProjects_List tests GET /api/v1/projects.
func TestProjects_List(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	store := &fakeProjectStore{saved: domain.Project{ID: "proj-1", Name: "test"}}
	srv := NewServer(&Services{ProjectStore: store}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestProjects_RejectsNonGET tests that the projects endpoint rejects non-GET methods.
func TestProjects_RejectsNonGET(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestProjects_NoStore tests that the projects endpoint returns an error when ProjectStore is nil.
func TestProjects_NoStore(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestProjectByID_Get tests GET /api/v1/projects/{id}.
func TestProjectByID_Get(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	store := &fakeProjectStore{saved: domain.Project{ID: "proj-1", Name: "test"}}
	srv := NewServer(&Services{ProjectStore: store}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/proj-1", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestProjectByID_GetNotFound tests GET /api/v1/projects/{id} with a missing ID.
func TestProjectByID_GetNotFound(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	store := &fakeProjectStore{}
	srv := NewServer(&Services{ProjectStore: store}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/nonexistent", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

// TestProjectByID_EmptyID tests GET /api/v1/projects/ with no ID.
func TestProjectByID_EmptyID(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestToolchains_List tests GET /api/v1/toolchains.
func TestToolchains_List(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	reg := &fakeToolchainRegistry{toolchains: []json.RawMessage{json.RawMessage(`{"id":"tc1","name":"JDK 8"}`)}}
	srv := NewServer(&Services{ToolchainRegistry: reg}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/toolchains", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestToolchains_RejectsNonGET tests that the toolchains endpoint rejects non-GET methods.
func TestToolchains_RejectsNonGET(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/toolchains", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestToolchains_NoRegistry tests that the toolchains endpoint returns an error when ToolchainRegistry is nil.
func TestToolchains_NoRegistry(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/toolchains", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestToolchainImport tests POST /api/v1/toolchains/import.
func TestToolchainImport(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	reg := &fakeToolchainRegistry{}
	srv := NewServer(&Services{ToolchainRegistry: reg}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"path": "/opt/jdk", "label": "JDK 17"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/toolchains/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestToolchainImport_RejectsNonPOST tests that the toolchain import endpoint rejects non-POST methods.
func TestToolchainImport_RejectsNonPOST(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/toolchains/import", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestAudit_List tests GET /api/v1/audit.
func TestAudit_List(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestAudit_RejectsNonGET tests that the audit endpoint rejects non-GET methods.
func TestAudit_RejectsNonGET(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/audit", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestAudit_NilAuditLog tests that the audit endpoint returns empty list when audit log is nil.
func TestAudit_NilAuditLog(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	srv := NewServer(&Services{}, logger, nil, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestLogin_Success tests POST /api/v1/auth/login.
func TestLogin_Success(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	auth := &fakeAuth{}
	srv := NewServer(&Services{Auth: auth}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"username": "admin", "password": "secret"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestLogin_RejectsNonPOST tests that the login endpoint rejects non-POST methods.
func TestLogin_RejectsNonPOST(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestLogin_NoAuth tests that the login endpoint returns error when Auth is nil.
func TestLogin_NoAuth(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"username": "admin"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestLogout_Success tests POST /api/v1/auth/logout.
func TestLogout_Success(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	auth := &fakeAuth{}
	srv := NewServer(&Services{Auth: auth}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestLogout_RejectsNonPOST tests that the logout endpoint rejects non-POST methods.
func TestLogout_RejectsNonPOST(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestEncodingDetect tests POST /api/v1/encoding/detect.
func TestEncodingDetect(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	enc := &fakeEncoder{}
	srv := NewServer(&Services{Encoder: enc}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"sample": "hello"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestEncodingRecode tests POST /api/v1/encoding/recode.
func TestEncodingRecode(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	enc := &fakeEncoder{}
	srv := NewServer(&Services{Encoder: enc}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"content": "test", "from": "gbk", "to": "utf-8"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/recode", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestEncodingValidate tests POST /api/v1/encoding/validate.
func TestEncodingValidate(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	enc := &fakeEncoder{}
	srv := NewServer(&Services{Encoder: enc}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"content": "test", "encoding": "utf-8"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/validate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestEncodingDetect_NoEncoder tests that the encoding detect endpoint returns error when Encoder is nil.
func TestEncodingDetect_NoEncoder(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"sample": "hello"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestRecoverableServers tests GET /api/v1/servers/recoverable.
func TestRecoverableServers(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	runner := &fakeServerRunner{}
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/recoverable", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestRecoverableServers_RejectsNonGET tests that the recoverable servers endpoint rejects non-GET methods.
func TestRecoverableServers_RejectsNonGET(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/recoverable", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestRecoverableServers_NoRunner tests that the recoverable servers endpoint returns error when ServerRunner is nil.
func TestRecoverableServers_NoRunner(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/recoverable", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestProjectRecent tests GET /api/v1/projects/recent.
func TestProjectRecent(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")
	srv.addRecentProject("proj-1", "Test Project", "/tmp/test")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/recent", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestProjectRecent_RejectsNonGET tests that the project recent endpoint rejects non-GET methods.
func TestProjectRecent_RejectsNonGET(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/recent", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestDeploymentByID tests GET /api/v1/deployments/{id}.
func TestDeploymentByID(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	deployer := &fakeDeployer{}
	srv := NewServer(&Services{Deployer: deployer}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/deployments/dep-1", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestDeploymentByID_NoDeployer tests that the deployment by ID endpoint returns error when Deployer is nil.
func TestDeploymentByID_NoDeployer(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/deployments/dep-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWorkspaces_List tests GET /api/v1/workspaces.
func TestWorkspaces_List(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{workspaces: []WorkspaceRecord{{ID: "ws_1", Name: "test", RootPath: "/tmp/test"}}}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWorkspaces_NoStore tests that the workspaces endpoint returns error when WorkspaceStore is nil.
func TestWorkspaces_NoStore(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWorkspacesSub_Get tests GET /api/v1/workspaces/{id}.
func TestWorkspacesSub_Get(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{workspaces: []WorkspaceRecord{{ID: "ws_1", Name: "test", RootPath: "/tmp/test"}}}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws_1", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWorkspacesSub_GetNotFound tests GET /api/v1/workspaces/{id} with a missing ID.
func TestWorkspacesSub_GetNotFound(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/nonexistent", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWorkspacesSub_Delete tests DELETE /api/v1/workspaces/{id}.
func TestWorkspacesSub_Delete(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{workspaces: []WorkspaceRecord{{ID: "ws_1", Name: "test", RootPath: "/tmp/test"}}}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/workspaces/ws_1", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWorkspacesSub_EmptyID tests that the workspaces sub endpoint returns error for empty ID.
func TestWorkspacesSub_EmptyID(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWorkspacesSub_UnknownSubpath tests that workspace sub endpoint returns error for unknown subpath.
func TestWorkspacesSub_UnknownSubpath(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws_1/unknown", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleBuilds_NoStore tests that the builds endpoint returns error when ProjectStore is nil.
func TestHandleBuilds_NoStore(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"projectId": "proj-1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/builds", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleBuilds_RejectsWrongMethod tests that the builds endpoint rejects non-GET/POST methods.
func TestHandleBuilds_RejectsWrongMethod(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/builds", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleServers_NoRunner tests that the servers endpoint returns error when ServerRunner is nil.
func TestHandleServers_NoRunner(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleServers_RejectsWrongMethod tests that the servers endpoint rejects non-GET/POST methods.
func TestHandleServers_RejectsWrongMethod(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/servers", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleDeployments_NoDeployer tests that POST /api/v1/deployments returns error when Deployer is nil.
func TestHandleDeployments_NoDeployer(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"projectId": "proj-1", "buildId": "b1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/deployments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleDeployments_RejectsWrongMethod tests that the deployments endpoint rejects non-GET/POST methods.
func TestHandleDeployments_RejectsWrongMethod(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/deployments", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleWorkspaces_RejectsWrongMethod tests that the workspaces endpoint rejects non-GET/POST methods.
func TestHandleWorkspaces_RejectsWrongMethod(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleProjectByID_RejectsWrongMethod tests that the project by ID endpoint rejects non-GET/PUT methods.
func TestHandleProjectByID_RejectsWrongMethod(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/proj-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleServerSub_NoRunner tests that the server sub endpoint returns error when ServerRunner is nil.
func TestHandleServerSub_NoRunner(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/srv_1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

// TestHandleServerSub_EmptyID tests that the server sub endpoint returns error for empty ID.
func TestHandleServerSub_EmptyID(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

// TestCORS_OptionsRequest tests that CORS preflight OPTIONS requests return 204.
func TestCORS_OptionsRequest(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Error("CORS origin header not set")
	}
}

// TestCORS_NoOrigin tests that CORS headers are not set when no Origin header is present.
func TestCORS_NoOrigin(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/health", nil)
	srv.Handler().ServeHTTP(rr, req)

	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("CORS origin header should not be set without Origin")
	}
}

// TestParseSubprotocols_EdgeCases tests edge cases of parseSubprotocols.
func TestParseSubprotocols_EdgeCases(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		expect []string
	}{
		{"empty", "", nil},
		{"single", "sub1", []string{"sub1"}},
		{"multiple", "sub1, sub2", []string{"sub1", "sub2"}},
		{"with spaces", " sub1 , sub2 ", []string{"sub1", "sub2"}},
		{"combined form", "kairo-secret-v1=secret123", []string{"kairo-secret-v1=secret123"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseSubprotocols(tt.input)
			if len(got) != len(tt.expect) {
				t.Fatalf("len = %d, want %d; got=%v", len(got), len(tt.expect), got)
			}
			for i, v := range tt.expect {
				if got[i] != v {
					t.Errorf("got[%d] = %q, want %q", i, got[i], v)
				}
			}
		})
	}
}

// TestSetRateLimit tests the SetRateLimit method.
func TestSetRateLimit(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	// Disable rate limiting
	srv.SetRateLimit(0)
	if srv.rateLimiter != nil {
		t.Error("rateLimiter should be nil after SetRateLimit(0)")
	}

	// Enable rate limiting
	srv.SetRateLimit(60)
	if srv.rateLimiter == nil {
		t.Error("rateLimiter should not be nil after SetRateLimit(60)")
	}

	// Change rate limit
	srv.SetRateLimit(120)
	if srv.rateLimiter == nil {
		t.Error("rateLimiter should not be nil after SetRateLimit(120)")
	}
}

// TestSetRateLimit_Negative tests that negative rate limit disables it.
func TestSetRateLimit_Negative(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	srv.SetRateLimit(-1)
	if srv.rateLimiter != nil {
		t.Error("rateLimiter should be nil after SetRateLimit(-1)")
	}
}

func TestSearchHandler_MapsCancellationAndDeadline(t *testing.T) {
	tests := []struct {
		name string
		ctx  func() (context.Context, context.CancelFunc)
		code protocol.KairoErrorCode
	}{
		{
			name: "cancelled",
			ctx: func() (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx, func() {}
			},
			code: protocol.ErrCancelled,
		},
		{
			name: "deadline",
			ctx: func() (context.Context, context.CancelFunc) {
				return context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
			},
			code: protocol.ErrTimeout,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stub := &contextSearchStub{}
			logger := log.New("test").WithLevel(log.LevelWarn)
			auditLog, err := audit.New(filepath.Join(t.TempDir(), "audit.log"))
			if err != nil {
				t.Fatal(err)
			}
			defer auditLog.Close()
			srv := NewServer(&Services{Searcher: stub}, logger, auditLog, "test-0.1.0", "")

			ctx, cancel := tt.ctx()
			defer cancel()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/search", strings.NewReader(`{"query":"hello"}`)).WithContext(ctx)
			rr := httptest.NewRecorder()
			srv.Handler().ServeHTTP(rr, req)

			if !errors.Is(stub.seen, ctx.Err()) {
				t.Fatalf("search context error=%v, request context error=%v", stub.seen, ctx.Err())
			}
			var response protocol.ErrorResponse
			if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v body=%s", err, rr.Body.String())
			}
			if response.Error.Code != tt.code {
				t.Fatalf("error code=%q, want %q; body=%s", response.Error.Code, tt.code, rr.Body.String())
			}
		})
	}
}

func TestMavenDetect_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/detect", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestMavenDetect_NoRootPath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenDetect_ValidPom(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test</artifactId>
  <version>1.0</version>
</project>`), 0o644)

	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"rootPath": dir})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenDependencies_NonGet(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/dependencies", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestMavenDependencies_NoRootPath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/dependencies", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenDependencies_Valid(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test</artifactId>
  <version>1.0</version>
</project>`), 0o644)

	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/dependencies?rootPath="+dir, nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenRun_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/run", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestMavenRun_NoRootPath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"task": "compile"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenRun_NoTask(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	dir := t.TempDir()
	body := mustEnvelope(t, map[string]any{"rootPath": dir})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestProjectDetect_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/detect", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestProjectDetect_NoRootPath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestProjectDetect_ValidDir(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)

	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"rootPath": dir})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestProjectImportNew_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/import", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestProjectImportNew_NoWorkspace(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestProjectImportNew_NoName(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"workspaceId": "ws-1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestProjectImportNew_NoRootPath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"workspaceId": "ws-1", "name": "Test"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestWorkspacesJava_UnknownSubpath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/unknown", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

func TestJDTProject_NotConfigured(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls/project", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestJDTLSLaunchDescriptor_NotConfigured(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/launch-descriptor?projectId=proj-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestJDTLSLaunchDescriptor_NonGet(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/java/launch-descriptor", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestJDTLSPrepare_NotConfigured(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/java/prepare", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestJDTLSPrepare_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/prepare", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLExecute_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sql/execute", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLExecute_NoConnectionID(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"sql": "SELECT 1 FROM DUAL"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLExecute_NoSQL(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"connectionId": "conn-1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLExecute_MaxRowsExceeded(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"connectionId": "conn-1", "sql": "SELECT 1 FROM DUAL", "maxRows": 200000})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLTestConnection_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sql/test-connection", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLTestConnection_NoConnectionParams(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/test-connection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLTestConnection_InvalidJSON(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/test-connection", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSQLExecute_InvalidJSON(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sql/execute", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenRun_InvalidJSON(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestMavenDetect_InvalidJSON(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/detect", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestEncodingRecode_NoEncoder(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"content": "test"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/recode", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestEncodingValidate_NoEncoder(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"content": "test", "encoding": "utf-8"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/validate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestEncodingDetect_NonPost(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/encoding/detect", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestEncodingRecode_NonPost(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/encoding/recode", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestEncodingValidate_NonPost(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/encoding/validate", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTProject_NoGenerator(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"projectId": "proj-1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtls/project", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTProject_NonPost(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls/project", nil)
	srv.Handler().ServeHTTP(rr, req)
	// Returns 500 because JDTProjectGenerator is not configured on the test server
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTProject_NoProjectId(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtls/project", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// Returns 500 because JDTProjectGenerator is not configured on the test server
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLSPrepare_NoProjectId(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/java/prepare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// Prepare succeeds even without projectId - it installs the distribution
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLSLaunchDescriptor_NoProjectId(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/launch-descriptor", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleBuilds_Get(t *testing.T) {
	engine := &cancelBuildEngineStub{result: &BuildResult{ID: "build-1", State: "succeeded"}}
	srv := newTestServer(t, nil)
	srv.Services.BuildEngine = engine

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/builds", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleBuildByID_Get(t *testing.T) {
	engine := &cancelBuildEngineStub{result: &BuildResult{ID: "build-1", State: "succeeded"}}
	srv := newTestServer(t, nil)
	srv.Services.BuildEngine = engine

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/builds/build-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleBuildByID_NoEngine(t *testing.T) {
	srv := newTestServer(t, nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/builds/build-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleBuilds_GetNoEngine(t *testing.T) {
	srv := newTestServer(t, nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/builds", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleDeployments_Get(t *testing.T) {
	deployer := &fakeDeployer{}
	srv := newTestServer(t, nil)
	srv.Services.Deployer = deployer

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/deployments", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleDeployments_GetNoDeployer(t *testing.T) {
	srv := newTestServer(t, nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/deployments", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspaces_Post(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	dir := t.TempDir()
	body := mustEnvelope(t, map[string]any{"rootPath": dir, "name": "TestWS"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspaces_PostNoRootPath(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"name": "TestWS"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspaces_PostPathTraversal(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"rootPath": "/tmp/../etc", "name": "TestWS"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspaces_PostInvalidJSON(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectByID_PutInvalidJSON(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/projects/proj-1", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectByID_Delete(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/projects/proj-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleSearch_RejectsNonPost(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleSearch_NoSearcher(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"query": "hello"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/search", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleSearch_NoQuery(t *testing.T) {
	stub := &contextSearchStub{}
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{Searcher: stub}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/search", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleLogin_InvalidJSON(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	auth := &fakeAuth{}
	srv := NewServer(&Services{Auth: auth}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// fakeAuth succeeds with any input, the handler returns 200
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleLogout_NoAuth(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	srv.Handler().ServeHTTP(rr, req)
	// Logout succeeds even without Auth configured
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleLogin_LoginError(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	auth := &fakeAuth{loginErr: errors.New("invalid credentials")}
	srv := NewServer(&Services{Auth: auth}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"username": "admin", "password": "wrong"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleToolchainImport_NoRegistry(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"path": "/opt/jdk"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/toolchains/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleToolchainImport_InvalidJSON(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	reg := &fakeToolchainRegistry{}
	srv := NewServer(&Services{ToolchainRegistry: reg}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/toolchains/import", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectDetect_InvalidJSON(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/detect", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectImportNew_InvalidJSON(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectImportNew_NoProjectStore(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"workspaceId": "ws-1", "name": "Test", "rootPath": "/tmp/test"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectImportNew_NoWorkspaceStore(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	srv.Services.ProjectStore = &fakeProjectStore{}
	body := mustEnvelope(t, map[string]any{"workspaceId": "ws-1", "name": "Test", "rootPath": "/tmp/test"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspacesJava_LaunchDescriptor(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/launch-descriptor?projectId=p1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (no ProjectRepo), body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspacesJava_Prepare(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"projectId": "p1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/java/prepare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspacesJava_UnknownSubpath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/unknown", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleWorkspacesSub_Scan(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	ws := &fakeWorkspaceStore{workspaces: []WorkspaceRecord{{ID: "ws_1", Name: "test", RootPath: t.TempDir()}}}
	srv := NewServer(&Services{WorkspaceStore: ws}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"rootPath": t.TempDir()})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws_1/scan", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// Scan root may be outside workspace, returns 403
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleServerSub_Recover(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	runner := &fakeServerRunner{}
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/srv_1/recover", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleServerSub_Debug(t *testing.T) {
	runner := &fakeServerRunner{}
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/srv_1/debug", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleServerSub_Stop(t *testing.T) {
	runner := &fakeServerRunner{}
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/srv_1/stop", nil)
	srv.Handler().ServeHTTP(rr, req)
	// /api/v1/servers/srv_1/stop routes to handleServerSub which returns "unknown subpath"
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleServerSub_UnknownSubpath(t *testing.T) {
	runner := &fakeServerRunner{}
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers/srv_1/unknown", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleMavenDependencies_NoDependencies(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test</artifactId>
  <version>1.0</version>
</project>`), 0o644)

	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/dependencies?rootPath="+dir, nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleMavenDependencies_InvalidPOM(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(`not xml`), 0o644)

	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/maven/dependencies?rootPath="+dir, nil)
	srv.Handler().ServeHTTP(rr, req)
	// Invalid POM returns 500 (EOF/parse error)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleMavenDetect_NoPom(t *testing.T) {
	dir := t.TempDir()
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"rootPath": dir})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleMavenRun_WithArgs(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test</artifactId>
  <version>1.0</version>
</project>`), 0o644)

	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"rootPath": dir, "task": "compile", "args": "-DskipTests"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleMavenRun_NoPom(t *testing.T) {
	dir := t.TempDir()
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"rootPath": dir, "task": "compile"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/maven/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

type fakeProjectRepo struct {
	proj *domain.Project
	err  error
}

func (f *fakeProjectRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.Project, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.proj, nil
}

type fakeToolchainRepo struct {
	tc  *domain.Toolchain
	err error
}

func (f *fakeToolchainRepo) Get(ctx context.Context, id string) (*domain.Toolchain, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.tc, nil
}

func TestHandleJDTLSLaunchDescriptor_WithProjectRepo(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	proj := &domain.Project{ID: "p1", RootPath: "/tmp/proj", SourceLevel: "1.8", TargetLevel: "1.8", Encoding: "utf-8"}
	srv.Services.ProjectRepo = &fakeProjectRepo{proj: proj}
	srv.Services.ToolchainRepo = &fakeToolchainRepo{tc: &domain.Toolchain{ID: "tc1", JavaHome: "/opt/jdk"}}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/launch-descriptor?projectId=p1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLSLaunchDescriptor_ProjectNotFound(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	srv.Services.ProjectRepo = &fakeProjectRepo{err: errors.New("not found")}
	srv.Services.ToolchainRepo = &fakeToolchainRepo{tc: &domain.Toolchain{ID: "tc1", JavaHome: "/opt/jdk"}}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/launch-descriptor?projectId=nonexistent", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLSLaunchDescriptor_NoToolchainRepo(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	proj := &domain.Project{ID: "p1", RootPath: "/tmp/proj", SourceLevel: "1.8", TargetLevel: "1.8", Encoding: "utf-8"}
	srv.Services.ProjectRepo = &fakeProjectRepo{proj: proj}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/java/launch-descriptor?projectId=p1", nil)
	srv.Handler().ServeHTTP(rr, req)
	// Project has no ToolchainID, so ToolchainRepo is not needed — returns 200
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLS_Delete(t *testing.T) {
	j := &fakeJDTLS{state: "running", jre: "C:/jre17", version: "1.43.0", pid: 99}
	srv := newTestServer(t, j)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	// DELETE is not supported on /api/v1/jdtls
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleEncodingDetect_InvalidJSON(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	enc := &fakeEncoder{}
	srv := NewServer(&Services{Encoder: enc}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/detect", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// fakeEncoder always succeeds, handler returns 200
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleEncodingRecode_InvalidJSON(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	enc := &fakeEncoder{}
	srv := NewServer(&Services{Encoder: enc}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/recode", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// fakeEncoder always succeeds, handler returns 200
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleEncodingValidate_InvalidJSON(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	enc := &fakeEncoder{}
	srv := NewServer(&Services{Encoder: enc}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/encoding/validate", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// fakeEncoder always succeeds, handler returns 200
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleServers_Get(t *testing.T) {
	runner := &fakeServerRunner{}
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{ServerRunner: runner}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleDeploymentByID_NonGet(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	deployer := &fakeDeployer{}
	srv := NewServer(&Services{Deployer: deployer}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/deployments/dep-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	// Handler doesn't reject non-GET methods for this route
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleDeploymentByID_NotFound(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")
	// No Deployer configured → internal error
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/deployments/dep-1", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleAudit_NilBody(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	srv := NewServer(&Services{}, logger, nil, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectDetect_NonExistentPath(t *testing.T) {
	srv := newTestServer(t, &fakeJDTLS{state: "stopped"})
	body := mustEnvelope(t, map[string]any{"rootPath": "/nonexistent/path"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/detect", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// Non-existent path returns 500 (IO error)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleProjectRecent_NoProjects(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/recent", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (empty list), body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLS_Get(t *testing.T) {
	j := &fakeJDTLS{state: "running", jre: "C:/jre17", version: "1.43.0", pid: 99}
	srv := newTestServer(t, j)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if p["state"] != "running" {
		t.Errorf("state = %v, want running", p["state"])
	}
	if p["version"] != "1.43.0" {
		t.Errorf("version = %v, want 1.43.0", p["version"])
	}
}

func TestHandleJDTLS_Get_Crashed(t *testing.T) {
	j := &fakeJDTLS{state: "crashed", jre: "C:/jre17", version: "1.43.0", lastErr: "OOM"}
	srv := newTestServer(t, j)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	_, p := decodeOK(t, rr.Body.Bytes())
	if p["state"] != "crashed" {
		t.Errorf("state = %v, want crashed", p["state"])
	}
	if p["lastError"] != "OOM" {
		t.Errorf("lastError = %v, want OOM", p["lastError"])
	}
}

func TestHandleJDTLS_Post_Start(t *testing.T) {
	j := &fakeJDTLS{state: "stopped", jre: "C:/jre17", version: "1.43.0"}
	srv := newTestServer(t, j)

	body := mustEnvelope(t, map[string]any{"projectId": "proj-1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLS_Post_InvalidJSON(t *testing.T) {
	j := &fakeJDTLS{state: "stopped", jre: "C:/jre17", version: "1.43.0"}
	srv := newTestServer(t, j)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtls", bytes.NewReader([]byte(`not json`)))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	// POST handler doesn't parse JSON, it calls Prepare directly — returns 200
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLS_NotConfigured_Get(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLS_NotConfigured_Post(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	body := mustEnvelope(t, map[string]any{"projectId": "proj-1"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jdtls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleJDTLS_NotConfigured_Delete(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/jdtls", nil)
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
}
