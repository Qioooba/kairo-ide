package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/app"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// --- HTTP Handler benchmarks ---

func BenchmarkServer_HealthEndpoint(b *testing.B) {
	srv := newBenchServer()
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp, err := http.Get(ts.URL + "/api/v1/health")
		if err != nil {
			b.Fatal(err)
		}
		resp.Body.Close()
	}
}

func BenchmarkServer_EndpointsEndpoint(b *testing.B) {
	srv := newBenchServer()
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp, err := http.Get(ts.URL + "/api/v1/endpoints")
		if err != nil {
			b.Fatal(err)
		}
		resp.Body.Close()
	}
}

func BenchmarkServer_MiddlewareChain(b *testing.B) {
	srv := newBenchServer()
	handler := srv.Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}

func BenchmarkWriteJSON(b *testing.B) {
	w := &headerOnlyRecorder{}
	payload := protocol.ResponseEnvelope{
		RequestID:     "req-123",
		CorrelationID: "corr-456",
		OK:            true,
		Payload:       map[string]string{"status": "ok"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		writeJSON(w, http.StatusOK, payload)
	}
}

func BenchmarkWriteOK(b *testing.B) {
	w := &headerOnlyRecorder{}
	env := protocol.RequestEnvelope{
		RequestID:     "req-123",
		CorrelationID: "corr-456",
	}
	payload := map[string]string{"status": "ok"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		writeOK(w, env, payload)
	}
}

func BenchmarkWriteError(b *testing.B) {
	w := &headerOnlyRecorder{}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		writeError(w, "req-1", "corr-1", protocol.KairoError{
			Code:    protocol.ErrNotFound,
			Message: "resource not found",
		})
	}
}

func BenchmarkDecodeEnvelope_POST(b *testing.B) {
	body := bytes.NewReader([]byte(`{"requestId":"req-1","correlationId":"corr-1","payload":{"key":"value"}}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/test", body)
	req.Header.Set("Content-Type", "application/json")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		body.Reset([]byte(`{"requestId":"req-1","correlationId":"corr-1","payload":{"key":"value"}}`))
		var dst protocol.RequestEnvelope
		_ = decodeEnvelope(req, &dst)
	}
}

func BenchmarkExtractPayload(b *testing.B) {
	body := []byte(`{"requestId":"req-1","payload":{"key":"value","nested":{"deep":true}}}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		extractPayload(body)
	}
}

func BenchmarkExtractPayload_BarePayload(b *testing.B) {
	body := []byte(`{"key":"value","nested":{"deep":true}}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		extractPayload(body)
	}
}

func BenchmarkReadEnvelopeAndBody(b *testing.B) {
	body := []byte(`{"requestId":"req-1","correlationId":"corr-1","payload":{"key":"value"}}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/test", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		readEnvelopeAndBody(req)
	}
}

func BenchmarkRandomID(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		randomID(12)
	}
}

func BenchmarkNewRequestID(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		newRequestID()
	}
}

func BenchmarkSplitHostPort(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		splitHostPort("127.0.0.1:18080")
	}
}

func BenchmarkParseSubprotocols(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		parseSubprotocols("kairo-secret-v1, my-secret-token")
	}
}

func BenchmarkSanitizeContextName(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sanitizeContextName("My Web Application")
	}
}

func BenchmarkSanitizeProjectID(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sanitizeProjectID("My Web Application")
	}
}

func BenchmarkToServerUseCaseResponse(b *testing.B) {
	rec := newTestServerRecord()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ToServerUseCaseResponse(rec)
	}
}

func BenchmarkToServerUseCaseResponseList(b *testing.B) {
	records := []*domain.ServerRecord{
		ptr(newTestServerRecord()),
		ptr(newTestServerRecord()),
		ptr(newTestServerRecord()),
		ptr(newTestServerRecord()),
		ptr(newTestServerRecord()),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ToServerUseCaseResponseList(records)
	}
}

func BenchmarkToBuildResponse(b *testing.B) {
	run := newTestBuildRun()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ToBuildResponse(run)
	}
}

func BenchmarkToBuildResponseList(b *testing.B) {
	runs := []domain.BuildRun{
		newTestBuildRun(),
		newTestBuildRun(),
		newTestBuildRun(),
		newTestBuildRun(),
		newTestBuildRun(),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ToBuildResponseList(runs)
	}
}

func BenchmarkToDeploymentResponse(b *testing.B) {
	result := &app.DeployResult{
		ID:        "dep-1",
		ProjectID: "proj-1",
		BuildID:   "build-1",
		State:     "completed",
		Succeeded: 42,
		Modified:  5,
		Deleted:   0,
		Bytes:     102400,
		Error:     "",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ToDeploymentResponse(result)
	}
}

// --- JSON Serialization benchmarks ---

func BenchmarkJSONMarshal_ResponseEnvelope(b *testing.B) {
	env := protocol.ResponseEnvelope{
		RequestID:     "req-1",
		CorrelationID: "corr-1",
		OK:            true,
		Payload:       map[string]any{"status": "ok", "data": []int{1, 2, 3}},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(env)
	}
}

func BenchmarkJSONUnmarshal_RequestEnvelope(b *testing.B) {
	data := []byte(`{"requestId":"req-1","correlationId":"corr-1","workspaceId":"ws-1","payload":{"key":"value"}}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var env protocol.RequestEnvelope
		json.Unmarshal(data, &env)
	}
}

func BenchmarkCORS_Middleware(b *testing.B) {
	srv := newBenchServer()
	handler := srv.corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
		req.Header.Set("Origin", "http://localhost:3000")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}

func BenchmarkCORS_Middleware_OPTIONS(b *testing.B) {
	srv := newBenchServer()
	handler := srv.corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/test", nil)
		req.Header.Set("Origin", "http://localhost:3000")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}
}

// --- helpers for benchmarks ---

func newBenchServer() *Server {
	return NewServer(
		&Services{},
		log.New("bench"),
		nil, // audit
		"1.0.0",
		"", // no secret
	)
}

// headerOnlyRecorder is a minimal http.ResponseWriter that only records headers.
type headerOnlyRecorder struct {
	headers   http.Header
	statusCode int
}

func (r *headerOnlyRecorder) Header() http.Header {
	if r.headers == nil {
		r.headers = http.Header{}
	}
	return r.headers
}

func (r *headerOnlyRecorder) Write(b []byte) (int, error) { return len(b), nil }
func (r *headerOnlyRecorder) WriteHeader(code int)         { r.statusCode = code }

func newTestServerRecord() domain.ServerRecord {
	now := time.Now()
	rt := domain.RuntimePlan{
		WorkspaceID:    "ws-1",
		ProjectID:      "proj-1",
		ServerID:       "srv-1",
		RuntimeID:      "tomcat6",
		HTTPPort:       18080,
		ShutdownPort:   8005,
		DebugPort:      5005,
		ContextPath:    "/myapp",
		CatalinaBase:   "/tmp/catalina",
		DeploymentRoot: "/tmp/deploy",
		Generation:     1,
	}
	return domain.ServerRecord{
		ID:            "srv-1",
		WorkspaceID:   "ws-1",
		ProjectID:     "proj-1",
		DesiredState:  domain.DesiredServerStateRunning,
		ObservedState: domain.ServerStateRunning,
		Generation:    1,
		PID:           12345,
		RuntimePlan:   rt,
		StartedAt:     &now,
		UpdatedAt:     now,
	}
}

func newTestBuildRun() domain.BuildRun {
	now := time.Now()
	return domain.BuildRun{
		ID:          "build-1",
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		State:       domain.BuildStateSucceeded,
		QueuedAt:    now,
		StartedAt:   &now,
		FinishedAt:  &now,
		Summary:     "Build completed successfully",
		Diagnostics: []domain.BuildDiagnostic{
			{File: "src/Main.java", Line: 10, Column: 5, Severity: "warning", Message: "unused variable"},
		},
	}
}

func ptr[T any](v T) *T { return &v }