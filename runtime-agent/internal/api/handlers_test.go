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

	"github.com/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/kairo-ide/runtime-agent/internal/audit"
	"github.com/kairo-ide/runtime-agent/internal/log"
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
