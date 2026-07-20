package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
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

func (f *fakeJDTLS) GetLaunchDescriptor(ctx context.Context, workspaceID string, projectID string) (json.RawMessage, error) {
	return json.Marshal(map[string]interface{}{
		"command":    "/path/to/java",
		"args":       []string{"-jar", "launcher.jar"},
		"workingDir": "/path/to/project",
		"env":        []string{"PATH=/usr/bin"},
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

func TestJDTLS_DeleteMethodNotSupported(t *testing.T) {
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
