package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/app"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

func TestSplitHostPort(t *testing.T) {
	tests := []struct {
		name     string
		addr     string
		wantHost string
		wantPort string
	}{
		{"valid", "localhost:8080", "localhost", "8080"},
		{"ip", "127.0.0.1:3000", "127.0.0.1", "3000"},
		{"ipv6", "[::1]:8080", "[::1]", "8080"},
		{"no port", "localhost", "localhost", ""},
		{"empty", "", "", ""},
		{"multiple colons", "a:b:c", "a:b", "c"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			host, port, err := splitHostPort(tc.addr)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if host != tc.wantHost {
				t.Errorf("host = %q, want %q", host, tc.wantHost)
			}
			if port != tc.wantPort {
				t.Errorf("port = %q, want %q", port, tc.wantPort)
			}
		})
	}
}

func TestRequireMethod(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		allowed []string
		wantErr bool
	}{
		{"allowed", http.MethodPost, []string{http.MethodPost, http.MethodPut}, false},
		{"not allowed", http.MethodGet, []string{http.MethodPost, http.MethodPut}, true},
		{"single", http.MethodDelete, []string{http.MethodDelete}, false},
		{"empty allowed", http.MethodGet, []string{}, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "/", nil)
			err := requireMethod(r, tc.allowed...)
			if tc.wantErr && err == nil {
				t.Error("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestIsClientError(t *testing.T) {
	tests := []struct {
		code protocol.KairoErrorCode
		want bool
	}{
		{protocol.ErrInvalidRequest, true},
		{protocol.ErrUnauthenticated, true},
		{protocol.ErrNotFound, true},
		{protocol.ErrForbidden, true},
		{protocol.ErrInternal, false},
		{protocol.ErrConflict, true},
		{protocol.KairoErrorCode("unknown"), false},
	}

	for _, tc := range tests {
		t.Run(string(tc.code), func(t *testing.T) {
			if got := isClientError(tc.code); got != tc.want {
				t.Errorf("isClientError(%q) = %v, want %v", tc.code, got, tc.want)
			}
		})
	}
}

func TestNewRequestID(t *testing.T) {
	id1 := newRequestID()
	id2 := newRequestID()
	if id1 == "" {
		t.Error("request ID should not be empty")
	}
	if id1 == id2 {
		t.Error("consecutive request IDs should be unique")
	}
	if len(id1) < 8 {
		t.Errorf("request ID too short: %d", len(id1))
	}
}

func TestRandomID(t *testing.T) {
	id1 := randomID(16)
	id2 := randomID(16)
	if id1 == "" {
		t.Error("random ID should not be empty")
	}
	if id1 == id2 {
		t.Error("consecutive random IDs should be unique")
	}
	if len(id1) != 16 {
		t.Errorf("randomID(16) len = %d, want 16", len(id1))
	}
	if len(randomID(0)) != 0 {
		t.Error("randomID(0) should return empty string")
	}
}

func TestRunConfigurationError(t *testing.T) {
	err := runConfigurationError(errors.New("test error"))
	if err.Code == "" {
		t.Error("error should have a code")
	}
	if err.Message == "" {
		t.Error("error should have a message")
	}
	if err.Code != protocol.ErrIOError {
		t.Errorf("unexpected error code: %q, want %q", err.Code, protocol.ErrIOError)
	}
}

func TestDecodeJSON(t *testing.T) {
	type testPayload struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}

	t.Run("valid", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(`{"name":"test","age":30}`)))
		got, err := decodeJSON[testPayload](r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Name != "test" || got.Age != 30 {
			t.Errorf("got %+v", got)
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(`not json`)))
		_, err := decodeJSON[testPayload](r)
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("empty body", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		_, err := decodeJSON[testPayload](r)
		if err == nil {
			t.Fatal("expected error for empty body")
		}
	})
}

func TestWriteErrorObj(t *testing.T) {
	w := httptest.NewRecorder()
	writeErrorObj(w, http.StatusBadRequest, "TEST_ERR", "test error message")

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["code"] != "TEST_ERR" {
		t.Errorf("code = %q, want TEST_ERR", body["code"])
	}
	if body["message"] != "test error message" {
		t.Errorf("message = %q, want 'test error message'", body["message"])
	}
}

func TestDecodeEnvelope(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		body := `{"requestId":"req-1","workspaceId":"ws-1","projectId":"proj-1"}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		r.Header.Set("Content-Type", "application/json")
		var env protocol.RequestEnvelope
		if err := decodeEnvelope(r, &env); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "req-1" || env.WorkspaceID != "ws-1" {
			t.Errorf("env = %+v", env)
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(`not json`)))
		r.Header.Set("Content-Type", "application/json")
		var env protocol.RequestEnvelope
		if err := decodeEnvelope(r, &env); err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("empty body", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.Header.Set("Content-Type", "application/json")
		var env protocol.RequestEnvelope
		if err := decodeEnvelope(r, &env); err == nil {
			t.Fatal("expected error for empty body")
		}
	})
}

func TestDecodeBodyBytes(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(`{"key":"value"}`)))
		got, err := decodeBodyBytes(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if string(got) != `{"key":"value"}` {
			t.Errorf("got %q", string(got))
		}
	})

	t.Run("nil body", func(t *testing.T) {
		r := &http.Request{Method: http.MethodPost}
		_, err := decodeBodyBytes(r)
		if err == nil {
			t.Fatal("expected error for nil body")
		}
	})
}

func TestExtractPayloadBytes(t *testing.T) {
	t.Run("with payload key", func(t *testing.T) {
		body := []byte(`{"payload":{"name":"test"},"requestId":"1"}`)
		got := extractPayloadBytes(body)
		var m map[string]json.RawMessage
		if err := json.Unmarshal(got, &m); err != nil {
			t.Fatal(err)
		}
		if _, ok := m["name"]; !ok {
			t.Error("expected 'name' key in extracted payload")
		}
	})

	t.Run("without payload key", func(t *testing.T) {
		body := []byte(`{"name":"test"}`)
		got := extractPayloadBytes(body)
		if string(got) != string(body) {
			t.Errorf("expected original body, got %q", string(got))
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		body := []byte(`not json`)
		got := extractPayloadBytes(body)
		if string(got) != string(body) {
			t.Errorf("expected original body for invalid JSON")
		}
	})
}

func TestWriteJSONMeta(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSONMeta(w, http.StatusOK)
	// writeJSONMeta is a no-op, so it should not panic or write anything
}

func TestDecodeEnvelope_GET(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/workspaces", nil)
	r.Header.Set("X-Kairo-Request-Id", "req-123")
	r.Header.Set("X-Kairo-Correlation-Id", "corr-456")
	r.Header.Set("X-Kairo-Workspace-Id", "ws-789")

	var env protocol.RequestEnvelope
	if err := decodeEnvelope(r, &env); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if env.RequestID != "req-123" {
		t.Errorf("RequestID = %q, want req-123", env.RequestID)
	}
	if env.CorrelationID != "corr-456" {
		t.Errorf("CorrelationID = %q, want corr-456", env.CorrelationID)
	}
	if env.WorkspaceID != "ws-789" {
		t.Errorf("WorkspaceID = %q, want ws-789", env.WorkspaceID)
	}
}

func TestDecodeEnvelope_GET_NoHeaders(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/workspaces", nil)

	var env protocol.RequestEnvelope
	if err := decodeEnvelope(r, &env); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should generate a request ID
	if env.RequestID == "" {
		t.Error("RequestID should not be empty")
	}
}

func TestWriteError_VariousCodes(t *testing.T) {
	tests := []struct {
		code       protocol.KairoErrorCode
		wantStatus int
	}{
		{protocol.ErrInternal, 500},
		{protocol.ErrInvalidRequest, 400},
		{protocol.ErrUnauthenticated, 401},
		{protocol.ErrForbidden, 403},
		{protocol.ErrPathForbidden, 403},
		{protocol.ErrNotFound, 404},
		{protocol.ErrConflict, 409},
		{protocol.ErrRateLimited, 429},
		{protocol.ErrToolchainMissing, 400},
		{protocol.ErrUnsupported, 400},
		{protocol.KairoErrorCode(""), 500}, // empty code defaults to 500
	}

	for _, tc := range tests {
		t.Run(string(tc.code), func(t *testing.T) {
			w := httptest.NewRecorder()
			writeError(w, "req-1", "corr-1", protocol.KairoError{
				Code:    tc.code,
				Message: "test error",
			})
			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}

			var resp protocol.ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if resp.OK {
				t.Error("OK should be false")
			}
			if resp.Error.Code == "" {
				t.Error("error code should not be empty")
			}
		})
	}
}

func TestWriteErrorObj_MultipleErrors(t *testing.T) {
	// Test with different error types
	w := httptest.NewRecorder()
	writeErrorObj(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestDecodeJSON_InvalidContentType(t *testing.T) {
	type testPayload struct {
		Name string `json:"name"`
	}
	r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(`{"name":"test"}`)))
	r.Header.Set("Content-Type", "text/plain")
	// decodeJSON doesn't check content type, it should still work
	got, err := decodeJSON[testPayload](r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Name != "test" {
		t.Errorf("Name = %q, want test", got.Name)
	}
}

func TestDecodeJSON_LargeBody(t *testing.T) {
	type testPayload struct {
		Data string `json:"data"`
	}
	// Create a large but valid payload
	largeData := make([]byte, 10000)
	for i := range largeData {
		largeData[i] = 'a'
	}
	payload := `{"data":"` + string(largeData) + `"}`
	r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(payload)))
	got, err := decodeJSON[testPayload](r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got.Data) != 10000 {
		t.Errorf("Data len = %d, want 10000", len(got.Data))
	}
}

func TestSplitHostPort_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		addr     string
		wantHost string
		wantPort string
	}{
		{"with port space", "localhost :8080", "localhost ", "8080"},
		{"colon only", ":", "", ""},
		{"empty string", "", "", ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			host, port, err := splitHostPort(tc.addr)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if host != tc.wantHost {
				t.Errorf("host = %q, want %q", host, tc.wantHost)
			}
			if port != tc.wantPort {
				t.Errorf("port = %q, want %q", port, tc.wantPort)
			}
		})
	}
}

func TestSanitizeProjectID(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"simple", "MyProject", "project-myproject"},
		{"with spaces", "My Project", "project-my-project"},
		{"with special chars", "Hello@World!", "project-hello-world"},
		{"chinese chars", "中文项目", "project-project"},
		{"empty", "", "project-project"},
		{"already lower", "myproject", "project-myproject"},
		{"with dots", "com.example.app", "project-com.example.app"},
		{"with underscores", "my_project", "project-my_project"},
		{"with hyphens", "my-project", "project-my-project"},
		{"leading hyphens", "---name---", "project-name"},
		{"only special", "!@#$%", "project-project"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeProjectID(tc.input)
			if got != tc.want {
				t.Errorf("sanitizeProjectID(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestSanitizeContextName(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"simple", "MyApp", "myapp"},
		{"with spaces", "My Application", "my-application"},
		{"with slash", "app/v1", "app-v1"},
		{"mixed case", "HelloWorld", "helloworld"},
		{"chinese chars", "我的应用", "app"},
		{"empty", "", "app"},
		{"leading spaces", "  hello", "hello"},
		{"trailing dashes", "hello---", "hello"},
		{"only special", "!@#$%", "app"},
		{"with numbers", "app123", "app123"},
		{"with dots", "my.app", "my.app"},
		{"with underscores", "my_app", "my_app"},
		{"multiple spaces", "a  b  c", "a-b-c"},
		{"space slash combo", "hello / world", "hello-world"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeContextName(tc.input)
			if got != tc.want {
				t.Errorf("sanitizeContextName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestExtractPayload(t *testing.T) {
	tests := []struct {
		name string
		body []byte
	}{
		{"empty body", []byte{}},
		{"nil body", nil},
		{"bare object", []byte(`{"name":"test"}`)},
		{"with payload key", []byte(`{"payload":{"name":"test"},"requestId":"1"}`)},
		{"empty payload", []byte(`{"payload":{},"requestId":"1"}`)},
		{"null payload", []byte(`{"payload":null}`)},
		{"invalid json", []byte(`not json`)},
		{"nested payload", []byte(`{"payload":{"deep":{"nested":"value"}}}`)},
		{"array payload", []byte(`{"payload":[1,2,3]}`)},
		{"string payload", []byte(`{"payload":"string-value"}`)},
		{"empty string payload", []byte(`{"payload":""}`)},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractPayload(tc.body)
			// For empty body, should return nil
			if len(tc.body) == 0 && got != nil {
				t.Errorf("extractPayload(empty) = %q, want nil", string(got))
			}
		})
	}
}

func TestParseSubprotocols(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   []string
	}{
		{"empty", "", nil},
		{"single", "kairo-secret-v1", []string{"kairo-secret-v1"}},
		{"comma separated", "kairo-secret-v1, mysecret", []string{"kairo-secret-v1", "mysecret"}},
		{"with spaces", "kairo-secret-v1 , mysecret", []string{"kairo-secret-v1", "mysecret"}},
		{"with trailing comma", "kairo-secret-v1,", []string{"kairo-secret-v1"}},
		{"with leading comma", ",kairo-secret-v1", []string{"kairo-secret-v1"}},
		{"multiple tokens", "a, b, c", []string{"a", "b", "c"}},
		{"empty tokens", "a,,b", []string{"a", "b"}},
		{"only commas", ",,", nil},
		{"equals form", "kairo-secret-v1=mysecret", []string{"kairo-secret-v1=mysecret"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parseSubprotocols(tc.header)
			if len(got) != len(tc.want) {
				t.Fatalf("parseSubprotocols(%q) len = %d, want %d; got=%v", tc.header, len(got), len(tc.want), got)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("parseSubprotocols(%q)[%d] = %q, want %q", tc.header, i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestDefaultEncodingByExt(t *testing.T) {
	got := defaultEncodingByExt()
	if len(got) == 0 {
		t.Fatal("defaultEncodingByExt() returned empty map")
	}
	// Verify keys exist
	expected := map[string]string{
		".java":       "utf-8",
		".jsp":        "gbk",
		".xml":        "utf-8",
		".properties": "iso-8859-1",
		".html":       "utf-8",
		".css":        "utf-8",
		".js":         "utf-8",
		".tag":        "utf-8",
		".tld":        "utf-8",
	}
	for k, v := range expected {
		if got[k] != v {
			t.Errorf("defaultEncodingByExt()[%q] = %q, want %q", k, got[k], v)
		}
	}
}

func TestConvertToProjectDetection(t *testing.T) {
	tests := []struct {
		name string
		raw  map[string]any
	}{
		{
			name: "full input",
			raw: map[string]any{
				"rootPath":    "/path/to/project",
				"buildSystem": "ant",
				"layout": map[string]any{
					"src":     []interface{}{"src/main/java", "src/test/java"},
					"webRoot": "WebRoot",
					"lib":     "lib",
				},
				"encodingByExtension": map[string]interface{}{".java": "gbk"},
				"detectedJdk":         map[string]any{"version": "1.8.0"},
				"confidence":          float64(0.9),
				"warnings":            []interface{}{"no web.xml found"},
			},
		},
		{
			name: "minimal input",
			raw:  map[string]any{},
		},
		{
			name: "ant build script",
			raw: map[string]any{
				"layout": map[string]any{
					"buildXml": "build.xml",
				},
			},
		},
		{
			name: "non-ant build script",
			raw: map[string]any{
				"layout": map[string]any{
					"buildXml": "pom.xml",
				},
			},
		},
		{
			name: "no encoding",
			raw:  map[string]any{},
		},
		{
			name: "with warnings array",
			raw: map[string]any{
				"warnings": []interface{}{"warn1", "warn2"},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pd := convertToProjectDetection(tc.raw)
			// Verify it doesn't panic and returns a valid struct
			if pd.DefaultEncoding == "" {
				t.Error("DefaultEncoding should not be empty")
			}
			// non-ant build script should have outputDir "bin"
			if raw, ok := tc.raw["layout"].(map[string]any); ok {
				if bs, ok := raw["buildXml"].(string); ok && bs != "build.xml" {
					if pd.OutputDir != "bin" {
						t.Errorf("OutputDir = %q, want bin", pd.OutputDir)
					}
				}
			}
		})
	}
}

func TestDecodeStrictBuildRequest_EdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{"valid minimal", `{"projectId":"proj-1"}`, false},
		{"valid with clean", `{"projectId":"proj-1","clean":true}`, false},
		{"empty", ``, true},
		{"invalid json", `not json`, true},
		{"multiple JSON values", `{"projectId":"proj-1"} {"extra":"value"}`, true},
		{"trailing garbage", `{"projectId":"proj-1"}garbage`, true},
		{"unknown field", `{"projectId":"proj-1","unknownField":"value"}`, true},
		{"null", `null`, false},
		{"empty object", `{}`, false},
		{"array", `[]`, true},
		{"string", `"hello"`, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var req BuildRequest
			err := decodeStrictBuildRequest([]byte(tc.body), &req)
			if tc.wantErr && err == nil {
				t.Errorf("decodeStrictBuildRequest(%q) expected error, got nil", tc.body)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("decodeStrictBuildRequest(%q) unexpected error: %v", tc.body, err)
			}
		})
	}
}

func TestReadEnvelopeAndBody_EdgeCases(t *testing.T) {
	t.Run("GET request reads headers", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("X-Kairo-Request-Id", "req-1")
		r.Header.Set("X-Kairo-Correlation-Id", "corr-1")
		r.Header.Set("X-Kairo-Workspace-Id", "ws-1")
		env, body, err := readEnvelopeAndBody(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "req-1" {
			t.Errorf("RequestID = %q, want req-1", env.RequestID)
		}
		if env.CorrelationID != "corr-1" {
			t.Errorf("CorrelationID = %q, want corr-1", env.CorrelationID)
		}
		if body != nil {
			t.Errorf("body should be nil for GET, got %q", string(body))
		}
	})

	t.Run("DELETE request reads headers", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodDelete, "/", nil)
		r.Header.Set("X-Kairo-Request-Id", "req-del")
		env, body, err := readEnvelopeAndBody(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "req-del" {
			t.Errorf("RequestID = %q, want req-del", env.RequestID)
		}
		if body != nil {
			t.Errorf("body should be nil for DELETE, got %q", string(body))
		}
	})

	t.Run("POST with envelope", func(t *testing.T) {
		body := `{"requestId":"req-1","workspaceId":"ws-1","payload":{"name":"test"}}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		env, _, err := readEnvelopeAndBody(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "req-1" {
			t.Errorf("RequestID = %q, want req-1", env.RequestID)
		}
	})

	t.Run("POST with bare payload", func(t *testing.T) {
		body := `{"name":"test"}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		env, _, err := readEnvelopeAndBody(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Bare payload should be tolerated (no error)
		if env.RequestID != "" {
			t.Logf("RequestID from bare payload: %q", env.RequestID)
		}
	})

	t.Run("POST with envelope but header fallback", func(t *testing.T) {
		body := `{"workspaceId":"ws-1"}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		r.Header.Set("X-Kairo-Request-Id", "header-req-1")
		env, _, err := readEnvelopeAndBody(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "header-req-1" {
			t.Errorf("RequestID = %q, want header-req-1", env.RequestID)
		}
	})

	t.Run("POST empty body", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		env, _, err := readEnvelopeAndBody(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "" {
			t.Logf("RequestID from empty body: %q", env.RequestID)
		}
	})
}

func TestWriteJSON(t *testing.T) {
	t.Run("writes JSON with status", func(t *testing.T) {
		w := httptest.NewRecorder()
		writeJSON(w, http.StatusOK, map[string]string{"hello": "world"})
		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", w.Code)
		}
		ct := w.Header().Get("Content-Type")
		if ct != "application/json; charset=utf-8" {
			t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
		}
		var body map[string]string
		if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if body["hello"] != "world" {
			t.Errorf("body = %v", body)
		}
	})

	t.Run("writes nil", func(t *testing.T) {
		w := httptest.NewRecorder()
		writeJSON(w, http.StatusNoContent, nil)
		if w.Code != http.StatusNoContent {
			t.Errorf("status = %d, want 204", w.Code)
		}
	})
}

func TestWriteOK(t *testing.T) {
	t.Run("wraps payload in envelope", func(t *testing.T) {
		w := httptest.NewRecorder()
		env := protocol.RequestEnvelope{
			RequestID:     "req-1",
			CorrelationID: "corr-1",
		}
		writeOK(w, env, map[string]string{"key": "value"})
		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", w.Code)
		}
		var resp protocol.ResponseEnvelope
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if !resp.OK {
			t.Error("OK should be true")
		}
		if resp.RequestID != "req-1" {
			t.Errorf("RequestID = %q, want req-1", resp.RequestID)
		}
	})

	t.Run("empty envelope", func(t *testing.T) {
		w := httptest.NewRecorder()
		writeOK(w, protocol.RequestEnvelope{}, "string payload")
		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", w.Code)
		}
	})
}

func TestLogError_NilLogger(t *testing.T) {
	// logError with nil logger should not panic
	s := &Server{logger: nil}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	s.logError(r, "test message", nil)
	s.logError(r, "test message", log.Fields{"key": "value"})
}

func TestPayloadOf(t *testing.T) {
	t.Run("extracts payload from envelope", func(t *testing.T) {
		body := `{"requestId":"req-1","payload":{"name":"test"}}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		got := payloadOf(r)
		var m map[string]json.RawMessage
		if err := json.Unmarshal(got, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if _, ok := m["name"]; !ok {
			t.Error("expected 'name' key")
		}
	})

	t.Run("bare payload", func(t *testing.T) {
		body := `{"name":"test"}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		got := payloadOf(r)
		if string(got) != body {
			t.Errorf("payloadOf = %q, want %q", string(got), body)
		}
	})

	t.Run("empty body", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		got := payloadOf(r)
		if got != nil {
			t.Errorf("payloadOf = %q, want nil", string(got))
		}
	})
}

func TestRecentProjects(t *testing.T) {
	s := &Server{}

	// Add projects
	s.addRecentProject("proj-1", "Project One", "/path/one")
	s.addRecentProject("proj-2", "Project Two", "/path/two")

	// Get projects
	list := s.getRecentProjects()
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}

	// Most recent should be first
	if list[0].ID != "proj-2" {
		t.Errorf("list[0].ID = %q, want proj-2", list[0].ID)
	}
	if list[0].Name != "Project Two" {
		t.Errorf("list[0].Name = %q, want Project Two", list[0].Name)
	}

	// Re-add existing project should move it to front
	s.addRecentProject("proj-1", "Project One", "/path/one")
	list = s.getRecentProjects()
	if list[0].ID != "proj-1" {
		t.Errorf("after re-add, list[0].ID = %q, want proj-1", list[0].ID)
	}

	// Test max 10
	for i := 0; i < 15; i++ {
		s.addRecentProject(fmt.Sprintf("proj-%d", i+10), fmt.Sprintf("Project %d", i+10), fmt.Sprintf("/path/%d", i+10))
	}
	list = s.getRecentProjects()
	if len(list) > 10 {
		t.Errorf("len = %d, want <= 10", len(list))
	}
	if list[0].ID == "proj-1" {
		t.Error("proj-1 should have been evicted after adding 15 more")
	}
}

func TestToBuildResponse(t *testing.T) {
	now := time.Now().UTC()
	finished := now.Add(5 * time.Second)
	run := domain.BuildRun{
		ID:         "build-1",
		ProjectID:  "proj-1",
		State:      domain.BuildStateSucceeded,
		QueuedAt:   now,
		FinishedAt: &finished,
		Summary:    "Build completed successfully",
		Diagnostics: []domain.BuildDiagnostic{
			{File: "src/Main.java", Line: 10, Column: 5, Severity: "warning", Message: "unused variable"},
		},
	}

	resp := ToBuildResponse(run)
	if resp.ID != "build-1" {
		t.Errorf("ID = %q, want build-1", resp.ID)
	}
	if resp.State != "succeeded" {
		t.Errorf("State = %q, want succeeded", resp.State)
	}
	if resp.EndTime == "" {
		t.Error("EndTime should not be empty")
	}
	if len(resp.Diagnostics) != 1 {
		t.Fatalf("len(Diagnostics) = %d, want 1", len(resp.Diagnostics))
	}
	if resp.Diagnostics[0].File != "src/Main.java" {
		t.Errorf("Diagnostics[0].File = %q, want src/Main.java", resp.Diagnostics[0].File)
	}

	// Test nil FinishedAt
	run2 := domain.BuildRun{
		ID:        "build-2",
		ProjectID: "proj-2",
		State:     domain.BuildStateRunning,
		QueuedAt:  now,
	}
	resp2 := ToBuildResponse(run2)
	if resp2.EndTime != "" {
		t.Errorf("EndTime = %q, want empty", resp2.EndTime)
	}
}

func TestToBuildResponseList(t *testing.T) {
	now := time.Now().UTC()
	runs := []domain.BuildRun{
		{ID: "build-1", ProjectID: "proj-1", State: domain.BuildStateSucceeded, QueuedAt: now},
		{ID: "build-2", ProjectID: "proj-2", State: domain.BuildStateFailed, QueuedAt: now},
	}
	list := ToBuildResponseList(runs)
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
	if list[0].ID != "build-1" {
		t.Errorf("list[0].ID = %q, want build-1", list[0].ID)
	}
	if list[1].ID != "build-2" {
		t.Errorf("list[1].ID = %q, want build-2", list[1].ID)
	}

	// Empty list
	empty := ToBuildResponseList(nil)
	if len(empty) != 0 {
		t.Errorf("len(empty) = %d, want 0", len(empty))
	}
}

func TestToDeploymentResponse(t *testing.T) {
	t.Run("nil result", func(t *testing.T) {
		resp := ToDeploymentResponse(nil)
		if resp.ID != "" {
			t.Errorf("ID = %q, want empty", resp.ID)
		}
	})

	t.Run("valid result", func(t *testing.T) {
		result := &app.DeployResult{
			ID:        "dep-1",
			ProjectID: "proj-1",
			BuildID:   "build-1",
			State:     "success",
			Succeeded: 10,
			Modified:  5,
			Deleted:   2,
			Bytes:     1024,
			Error:     "",
		}
		resp := ToDeploymentResponse(result)
		if resp.ID != "dep-1" {
			t.Errorf("ID = %q, want dep-1", resp.ID)
		}
		if resp.Added != 10 {
			t.Errorf("Added = %d, want 10", resp.Added)
		}
		if resp.Modified != 5 {
			t.Errorf("Modified = %d, want 5", resp.Modified)
		}
		if resp.Deleted != 2 {
			t.Errorf("Deleted = %d, want 2", resp.Deleted)
		}
		if resp.Bytes != 1024 {
			t.Errorf("Bytes = %d, want 1024", resp.Bytes)
		}
		if resp.State != "success" {
			t.Errorf("State = %q, want success", resp.State)
		}
	})

	t.Run("error result", func(t *testing.T) {
		result := &app.DeployResult{
			ID:    "dep-2",
			State: "failed",
			Error: "deployment failed",
		}
		resp := ToDeploymentResponse(result)
		if resp.Error != "deployment failed" {
			t.Errorf("Error = %q, want 'deployment failed'", resp.Error)
		}
	})
}

func TestFindJdkOnPath(t *testing.T) {
	// Save and restore JAVA_HOME
	orig := os.Getenv("JAVA_HOME")
	defer os.Setenv("JAVA_HOME", orig)

	t.Run("no JAVA_HOME set", func(t *testing.T) {
		os.Setenv("JAVA_HOME", "")
		got := findJdkOnPath()
		if got != nil {
			t.Errorf("expected nil when JAVA_HOME is empty, got %v", got)
		}
	})

	t.Run("JAVA_HOME set to non-existent path", func(t *testing.T) {
		os.Setenv("JAVA_HOME", "/nonexistent/jdk/path")
		got := findJdkOnPath()
		if got != nil {
			t.Errorf("expected nil when JAVA_HOME points to non-existent path, got %v", got)
		}
	})
}

func TestScanWorkspace_Empty(t *testing.T) {
	_, err := scanWorkspace("")
	if err == nil {
		t.Fatal("expected error for empty root")
	}
}

func TestScanWorkspace_NonExistent(t *testing.T) {
	_, err := scanWorkspace("/nonexistent/path")
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}

func TestScanWorkspace_NotDirectory(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "file.txt")
	os.WriteFile(f, []byte("test"), 0o644)
	_, err := scanWorkspace(f)
	if err == nil {
		t.Fatal("expected error for non-directory")
	}
}

func TestScanWorkspace_Valid(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.MkdirAll(filepath.Join(dir, "WebRoot"), 0o755)
	detected, err := scanWorkspace(dir)
	if err != nil {
		t.Fatalf("scanWorkspace: %v", err)
	}
	if len(detected) != 1 {
		t.Fatalf("expected 1 detected project, got %d", len(detected))
	}
	if detected[0]["rootPath"] != dir {
		t.Errorf("rootPath = %v, want %s", detected[0]["rootPath"], dir)
	}
}

func TestDetectLayout(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.MkdirAll(filepath.Join(dir, "WebRoot"), 0o755)
	os.MkdirAll(filepath.Join(dir, "lib"), 0o755)

	layout := detectLayout(dir)
	if layout["webRoot"] != "WebRoot" {
		t.Errorf("webRoot = %v, want WebRoot", layout["webRoot"])
	}
	if layout["lib"] != "lib" {
		t.Errorf("lib = %v, want lib", layout["lib"])
	}
}

func TestDetectLayout_WebContent(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "WebContent"), 0o755)
	layout := detectLayout(dir)
	if layout["webRoot"] != "WebContent" {
		t.Errorf("webRoot = %v, want WebContent", layout["webRoot"])
	}
}

func TestDetectLayout_WithBuildXml(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "build.xml"), []byte("<project/>"), 0o644)
	layout := detectLayout(dir)
	if layout["buildXml"] != "build.xml" {
		t.Errorf("buildXml = %v, want build.xml", layout["buildXml"])
	}
}

func TestDetectBuildSystem(t *testing.T) {
	tests := []struct {
		name   string
		file   string
		expect string
	}{
		{"ant", "build.xml", "ant"},
		{"maven", "pom.xml", "maven"},
		{"gradle", "build.gradle", "gradle"},
		{"none", "", "none"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if tc.file != "" {
				os.WriteFile(filepath.Join(dir, tc.file), []byte("test"), 0o644)
			}
			got := detectBuildSystem(dir)
			if got != tc.expect {
				t.Errorf("detectBuildSystem = %q, want %q", got, tc.expect)
			}
		})
	}
}

func TestReadWebXML_NotFound(t *testing.T) {
	dir := t.TempDir()
	result := readWebXML(dir)
	if result != nil {
		t.Error("expected nil when no web.xml found")
	}
}

func TestReadWebXML_Valid(t *testing.T) {
	dir := t.TempDir()
	webInf := filepath.Join(dir, "WEB-INF")
	os.MkdirAll(webInf, 0o755)
	webxml := `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
  <servlet>
    <servlet-name>MainServlet</servlet-name>
    <servlet-class>com.example.MainServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>MainServlet</servlet-name>
    <url-pattern>/main</url-pattern>
  </servlet-mapping>
  <context-param>
    <param-name>config</param-name>
    <param-value>value1</param-value>
  </context-param>
</web-app>`
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte(webxml), 0o644)

	result := readWebXML(dir)
	if result == nil {
		t.Fatal("expected web.xml result")
	}
	if result["servletCount"] != 1 {
		t.Errorf("servletCount = %v, want 1", result["servletCount"])
	}
}

func TestReadWebXML_InvalidXml(t *testing.T) {
	dir := t.TempDir()
	webInf := filepath.Join(dir, "WEB-INF")
	os.MkdirAll(webInf, 0o755)
	os.WriteFile(filepath.Join(webInf, "web.xml"), []byte("not xml"), 0o644)
	result := readWebXML(dir)
	if result != nil {
		t.Error("expected nil for invalid web.xml")
	}
}

func TestFindJdkOnPath_NoJavaHome(t *testing.T) {
	// Test without JAVA_HOME set
	oldHome := os.Getenv("JAVA_HOME")
	os.Unsetenv("JAVA_HOME")
	defer os.Setenv("JAVA_HOME", oldHome)

	result := findJdkOnPath()
	if result != nil {
		t.Error("expected nil when JAVA_HOME is not set")
	}
}

func TestProjectJSONPath(t *testing.T) {
	got := projectJSONPath("/my/project")
	want := filepath.Join("/my/project", ".kairo", "project.json")
	if got != want {
		t.Errorf("projectJSONPath = %q, want %q", got, want)
	}
}

func TestSaveAndLoadProjectJSON(t *testing.T) {
	dir := t.TempDir()
	project := &domain.Project{
		ID:          "my-project",
		Name:        "My Project",
		RootPath:    dir,
		SourceRoots: []string{"src"},
		WebappDir:   "WebRoot",
		OutputDir:   "build/classes",
		SourceLevel: "1.8",
		TargetLevel: "1.8",
		Encoding:    "utf-8",
		BuildTool:   domain.BuildToolAnt,
		BuildFile:   "build.xml",
		ContextPath: "/myapp",
	}

	if err := SaveProjectJSON(dir, project); err != nil {
		t.Fatalf("SaveProjectJSON: %v", err)
	}

	data, err := LoadProjectJSON(dir)
	if err != nil {
		t.Fatalf("LoadProjectJSON: %v", err)
	}
	if data.ID != "my-project" {
		t.Errorf("ID = %q, want my-project", data.ID)
	}
	if data.Name != "My Project" {
		t.Errorf("Name = %q, want My Project", data.Name)
	}
	if data.SchemaVersion != 1 {
		t.Errorf("SchemaVersion = %d, want 1", data.SchemaVersion)
	}
}

func TestLoadProjectJSON_NotFound(t *testing.T) {
	dir := t.TempDir()
	_, err := LoadProjectJSON(dir)
	if err == nil {
		t.Fatal("expected error for missing project.json")
	}
}

func TestLoadProjectJSON_InvalidJson(t *testing.T) {
	dir := t.TempDir()
	kairoDir := filepath.Join(dir, ".kairo")
	os.MkdirAll(kairoDir, 0o755)
	os.WriteFile(filepath.Join(kairoDir, "project.json"), []byte("not json"), 0o644)
	_, err := LoadProjectJSON(dir)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestDecodeStrictProjectScan(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		req, err := decodeStrictProjectScan([]byte{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if req.RootPath != "" {
			t.Errorf("RootPath = %q, want empty", req.RootPath)
		}
	})

	t.Run("valid", func(t *testing.T) {
		req, err := decodeStrictProjectScan([]byte(`{"rootPath":"/path/to/project","deep":true}`))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if req.RootPath != "/path/to/project" {
			t.Errorf("RootPath = %q", req.RootPath)
		}
		if !req.Deep {
			t.Error("Deep should be true")
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		_, err := decodeStrictProjectScan([]byte("not json"))
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("unknown fields", func(t *testing.T) {
		_, err := decodeStrictProjectScan([]byte(`{"rootPath":"/p","unknown":"field"}`))
		if err == nil {
			t.Fatal("expected error for unknown fields")
		}
	})

	t.Run("multiple values", func(t *testing.T) {
		_, err := decodeStrictProjectScan([]byte(`{"rootPath":"/p"}{}`))
		if err == nil {
			t.Fatal("expected error for multiple JSON values")
		}
	})
}

func TestDecodeStrictProjectImport(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		var project domain.Project
		err := decodeStrictProjectImport([]byte(`{"id":"test","name":"Test"}`), &project)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if project.ID != "test" {
			t.Errorf("ID = %q", project.ID)
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		var project domain.Project
		err := decodeStrictProjectImport([]byte("not json"), &project)
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("unknown fields", func(t *testing.T) {
		var project domain.Project
		err := decodeStrictProjectImport([]byte(`{"id":"test","unknown":"field"}`), &project)
		if err == nil {
			t.Fatal("expected error for unknown fields")
		}
	})

	t.Run("multiple values", func(t *testing.T) {
		var project domain.Project
		err := decodeStrictProjectImport([]byte(`{"id":"test"}{}`), &project)
		if err == nil {
			t.Fatal("expected error for multiple JSON values")
		}
	})
}

func TestResolveProjectImportRoot(t *testing.T) {
	t.Run("requested empty", func(t *testing.T) {
		dir := t.TempDir()
		root, err := resolveProjectImportRoot(dir, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if root != dir {
			t.Errorf("root = %q, want %q", root, dir)
		}
	})

	t.Run("outside workspace", func(t *testing.T) {
		dir := t.TempDir()
		_, err := resolveProjectImportRoot(dir, "/outside/path")
		if err == nil {
			t.Fatal("expected error for path outside workspace")
		}
	})

	t.Run("relative path", func(t *testing.T) {
		dir := t.TempDir()
		subDir := filepath.Join(dir, "subdir")
		os.MkdirAll(subDir, 0o755)
		root, err := resolveProjectImportRoot(dir, "subdir")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if root != subDir {
			t.Errorf("root = %q, want %q", root, subDir)
		}
	})
}

func TestSameProjectRoot(t *testing.T) {
	t.Run("same", func(t *testing.T) {
		dir := t.TempDir()
		if !sameProjectRoot(dir, dir) {
			t.Error("same root should return true")
		}
	})

	t.Run("different", func(t *testing.T) {
		dir1 := t.TempDir()
		dir2 := t.TempDir()
		if sameProjectRoot(dir1, dir2) {
			t.Error("different roots should return false")
		}
	})
}

func TestValidateImportedProject(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.MkdirAll(filepath.Join(dir, "WebRoot"), 0o755)
	os.MkdirAll(filepath.Join(dir, "build", "classes"), 0o755)

	t.Run("valid", func(t *testing.T) {
		project := &domain.Project{
			ID:          "test-project",
			WorkspaceID: "ws-1",
			Name:        "Test Project",
			BuildTool:   domain.BuildToolAnt,
			SourceLevel: "1.8",
			TargetLevel: "1.8",
			Encoding:    "utf-8",
			ContextPath: "/test",
			SourceRoots: []string{"src"},
			WebappDir:   "WebRoot",
			OutputDir:   "build/classes",
			BuildFile:   "build.xml",
		}
		os.WriteFile(filepath.Join(dir, "build.xml"), []byte("<project/>"), 0o644)
		err := validateImportedProject(project, "ws-1", dir)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("nil project", func(t *testing.T) {
		err := validateImportedProject(nil, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for nil project")
		}
	})

	t.Run("invalid id", func(t *testing.T) {
		project := &domain.Project{ID: "!invalid"}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for invalid project ID")
		}
	})

	t.Run("workspace mismatch", func(t *testing.T) {
		project := &domain.Project{ID: "test", WorkspaceID: "ws-2"}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for workspace mismatch")
		}
	})

	t.Run("empty name", func(t *testing.T) {
		project := &domain.Project{ID: "test", WorkspaceID: "ws-1", Name: ""}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for empty name")
		}
	})

	t.Run("whitespace name", func(t *testing.T) {
		project := &domain.Project{ID: "test", WorkspaceID: "ws-1", Name: "  hello"}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for untrimmed name")
		}
	})

	t.Run("unsupported build tool", func(t *testing.T) {
		project := &domain.Project{
			ID:          "test",
			WorkspaceID: "ws-1",
			Name:        "Test",
			BuildTool:   "gradle",
			SourceLevel: "1.8",
			TargetLevel: "1.8",
		}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for unsupported build tool")
		}
	})

	t.Run("invalid source level", func(t *testing.T) {
		project := &domain.Project{
			ID:          "test",
			WorkspaceID: "ws-1",
			Name:        "Test",
			BuildTool:   domain.BuildToolAnt,
			SourceLevel: "99",
			TargetLevel: "1.8",
		}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for invalid source level")
		}
	})

	t.Run("unsupported encoding", func(t *testing.T) {
		project := &domain.Project{
			ID:          "test",
			WorkspaceID: "ws-1",
			Name:        "Test",
			BuildTool:   domain.BuildToolAnt,
			SourceLevel: "1.8",
			TargetLevel: "1.8",
			Encoding:    "unsupported-encoding",
			ContextPath: "/",
			SourceRoots: []string{"src"},
			WebappDir:   "WebRoot",
			OutputDir:   "build/classes",
		}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for unsupported encoding")
		}
	})

	t.Run("missing source roots", func(t *testing.T) {
		project := &domain.Project{
			ID:          "test",
			WorkspaceID: "ws-1",
			Name:        "Test",
			BuildTool:   domain.BuildToolAnt,
			SourceLevel: "1.8",
			TargetLevel: "1.8",
			Encoding:    "utf-8",
			ContextPath: "/",
			SourceRoots: []string{},
			WebappDir:   "WebRoot",
			OutputDir:   "build/classes",
		}
		err := validateImportedProject(project, "ws-1", dir)
		if err == nil {
			t.Fatal("expected error for missing source roots")
		}
	})
}

func TestRequireMethod_EdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		allowed []string
		wantErr bool
	}{
		{"single allowed match", http.MethodGet, []string{http.MethodGet}, false},
		{"single allowed no match", http.MethodPost, []string{http.MethodGet}, true},
		{"multiple allowed first match", http.MethodGet, []string{http.MethodGet, http.MethodPost, http.MethodPut}, false},
		{"multiple allowed last match", http.MethodPut, []string{http.MethodGet, http.MethodPost, http.MethodPut}, false},
		{"multiple allowed no match", http.MethodDelete, []string{http.MethodGet, http.MethodPost}, true},
		{"empty allowed", http.MethodGet, nil, true},
		{"nil allowed", http.MethodGet, nil, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "/", nil)
			err := requireMethod(r, tc.allowed...)
			if tc.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// ---- Port diagnostics tests ----

func TestParseSSOutput(t *testing.T) {
	tests := []struct {
		name   string
		output string
		port   int
		wantPID int
		wantName string
	}{
		{
			name: "valid java process",
			output: `LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:(("java",pid=12345,fd=42))`,
			port:   8080,
			wantPID: 12345,
			wantName: "java",
		},
		{
			name: "no matching port",
			output: `LISTEN  0  128  0.0.0.0:9090  0.0.0.0:*  users:(("java",pid=12345,fd=42))`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "empty output",
			output: "",
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "no users field",
			output: `LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "users field without pid",
			output: `LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:(("java"))`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "invalid pid",
			output: `LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:(("java",pid=abc,fd=42))`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "zero pid",
			output: `LISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:(("java",pid=0,fd=42))`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "multiple lines first match",
			output: "LISTEN  0  128  :::8080  :::*  users:((\"node\",pid=99,fd=3))\nLISTEN  0  128  0.0.0.0:8080  0.0.0.0:*  users:((\"java\",pid=42,fd=7))",
			port:   8080,
			wantPID: 99,
			wantName: "node",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pid, name := parseSSOutput(tc.output, tc.port)
			if pid != tc.wantPID {
				t.Errorf("pid = %d, want %d", pid, tc.wantPID)
			}
			if name != tc.wantName {
				t.Errorf("name = %q, want %q", name, tc.wantName)
			}
		})
	}
}

func TestParseNetstatOutput(t *testing.T) {
	tests := []struct {
		name   string
		output string
		port   int
		wantPID int
		wantName string
	}{
		{
			name: "valid java process",
			output: `tcp  0  0  0.0.0.0:8080  0.0.0.0:*  LISTEN  12345/java`,
			port:   8080,
			wantPID: 12345,
			wantName: "java",
		},
		{
			name: "no matching port",
			output: `tcp  0  0  0.0.0.0:9090  0.0.0.0:*  LISTEN  12345/java`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "empty output",
			output: "",
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "no LISTEN",
			output: `tcp  0  0  0.0.0.0:8080  0.0.0.0:*  ESTABLISHED  12345/java`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "short line",
			output: `tcp  0  0  0.0.0.0:8080`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "no process name",
			output: `tcp  0  0  0.0.0.0:8080  0.0.0.0:*  LISTEN  12345`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "invalid pid",
			output: `tcp  0  0  0.0.0.0:8080  0.0.0.0:*  LISTEN  abc/java`,
			port:   8080,
			wantPID: 0,
			wantName: "",
		},
		{
			name: "multiple / in last field",
			output: `tcp  0  0  0.0.0.0:8080  0.0.0.0:*  LISTEN  12345/java/extra`,
			port:   8080,
			wantPID: 12345,
			wantName: "java/extra",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pid, name := parseNetstatOutput(tc.output, tc.port)
			if pid != tc.wantPID {
				t.Errorf("pid = %d, want %d", pid, tc.wantPID)
			}
			if name != tc.wantName {
				t.Errorf("name = %q, want %q", name, tc.wantName)
			}
		})
	}
}

func TestDiagnosePort(t *testing.T) {
	tests := []struct {
		name       string
		port       int
		wantOccupied bool
	}{
		{"zero port", 0, false},
		{"negative port", -1, false},
		{"port above max", 65536, false},
		{"valid port (not occupied)", 54321, false},
		{"port 65535", 65535, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := diagnosePort(tc.port)
			if result.Port != tc.port {
				t.Errorf("Port = %d, want %d", result.Port, tc.port)
			}
			if result.Occupied != tc.wantOccupied {
				t.Errorf("Occupied = %v, want %v", result.Occupied, tc.wantOccupied)
			}
			// Invalid ports should have a suggestion
			if tc.port <= 0 || tc.port > 65535 {
				if result.Suggestion == "" {
					t.Error("expected suggestion for invalid port")
				}
			}
		})
	}
}

func TestHandlePortDiagnostics(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		queryPort  string
		wantStatus int
	}{
		{"valid port", http.MethodGet, "8080", http.StatusOK},
		{"no port", http.MethodGet, "", http.StatusBadRequest},
		{"invalid port string", http.MethodGet, "abc", http.StatusBadRequest},
		{"zero port", http.MethodGet, "0", http.StatusBadRequest},
		{"port above max", http.MethodGet, "65536", http.StatusBadRequest},
		{"negative port", http.MethodGet, "-1", http.StatusBadRequest},
		{"non-GET method", http.MethodPost, "8080", http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			logger := log.New("test").WithLevel(log.LevelWarn)
			auditLog, err := audit.New(t.TempDir() + "/audit.log")
			if err != nil {
				t.Fatalf("audit.New: %v", err)
			}
			t.Cleanup(func() { _ = auditLog.Close() })
			srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "")

			url := "/api/v1/diagnostics/port"
			if tc.queryPort != "" {
				url += "?port=" + tc.queryPort
			}
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, url, nil)
			srv.Handler().ServeHTTP(rr, req)

			if rr.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d, body=%s", rr.Code, tc.wantStatus, rr.Body.String())
			}
		})
	}
}

func TestDecodeEnvelopePayload(t *testing.T) {
	type testPayload struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}

	t.Run("GET request returns error", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err == nil {
			t.Fatal("expected error for GET request")
		}
		if !strings.Contains(err.Error(), "no body") {
			t.Errorf("error = %q, want 'no body'", err.Error())
		}
	})

	t.Run("DELETE request returns error", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodDelete, "/", nil)
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err == nil {
			t.Fatal("expected error for DELETE request")
		}
	})

	t.Run("POST with valid envelope payload", func(t *testing.T) {
		body := `{"requestId":"req-1","workspaceId":"ws-1","payload":{"name":"test","age":30}}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "req-1" {
			t.Errorf("RequestID = %q, want req-1", env.RequestID)
		}
		if env.WorkspaceID != "ws-1" {
			t.Errorf("WorkspaceID = %q, want ws-1", env.WorkspaceID)
		}
		if dst.Name != "test" || dst.Age != 30 {
			t.Errorf("payload = %+v", dst)
		}
	})

	t.Run("POST with bare payload (no envelope)", func(t *testing.T) {
		body := `{"name":"test","age":30}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Bare payload is treated as the entire payload
		if dst.Name != "test" || dst.Age != 30 {
			t.Errorf("payload = %+v", dst)
		}
	})

	t.Run("POST with invalid JSON", func(t *testing.T) {
		body := `not json`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err == nil {
			t.Fatal("expected error for invalid JSON")
		}
	})

	t.Run("POST with header fallback for request ID", func(t *testing.T) {
		body := `{"payload":{"name":"test","age":30}}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		r.Header.Set("X-Kairo-Request-Id", "header-req-1")
		r.Header.Set("X-Kairo-Correlation-Id", "header-corr-1")
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if env.RequestID != "header-req-1" {
			t.Errorf("RequestID = %q, want header-req-1", env.RequestID)
		}
		if env.CorrelationID != "header-corr-1" {
			t.Errorf("CorrelationID = %q, want header-corr-1", env.CorrelationID)
		}
	})

	t.Run("POST with mismatched payload type", func(t *testing.T) {
		body := `{"payload":{"name":123}}` // name should be string, got number
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err == nil {
			t.Fatal("expected error for type mismatch")
		}
	})

	t.Run("POST empty body", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err == nil {
			t.Fatal("expected error for empty body")
		}
	})

	t.Run("GET with headers populates envelope", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("X-Kairo-Request-Id", "req-get")
		r.Header.Set("X-Kairo-Correlation-Id", "corr-get")
		r.Header.Set("X-Kairo-Workspace-Id", "ws-get")
		var env protocol.RequestEnvelope
		var dst testPayload
		err := decodeEnvelopePayload(r, &env, &dst)
		if err == nil {
			t.Fatal("expected error for GET")
		}
		// Even on error, the envelope should be populated from headers
		if env.RequestID != "req-get" {
			t.Errorf("RequestID = %q, want req-get", env.RequestID)
		}
		if env.WorkspaceID != "ws-get" {
			t.Errorf("WorkspaceID = %q, want ws-get", env.WorkspaceID)
		}
	})
}