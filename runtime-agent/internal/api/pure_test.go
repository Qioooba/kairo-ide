package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
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