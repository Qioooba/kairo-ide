package protocol

import (
	"encoding/json"
	"testing"
)

func TestEnvelopeResult_IsError(t *testing.T) {
	t.Run("nil error", func(t *testing.T) {
		r := EnvelopeResult{Error: nil}
		if r.IsError() {
			t.Error("IsError should be false when Error is nil")
		}
	})

	t.Run("non-nil error", func(t *testing.T) {
		r := EnvelopeResult{Error: &KairoError{Code: ErrInternal, Message: "test"}}
		if !r.IsError() {
			t.Error("IsError should be true when Error is non-nil")
		}
	})
}

func TestKairoError_JSON(t *testing.T) {
	e := KairoError{
		Code:    ErrInvalidRequest,
		Message: "invalid request",
		Details: "field 'name' is required",
	}
	data, err := json.Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded KairoError
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Code != ErrInvalidRequest {
		t.Errorf("Code = %q, want %q", decoded.Code, ErrInvalidRequest)
	}
	if decoded.Message != "invalid request" {
		t.Errorf("Message = %q", decoded.Message)
	}
}

func TestResponseEnvelope_JSON(t *testing.T) {
	env := ResponseEnvelope{
		RequestID:     "req-1",
		CorrelationID: "corr-1",
		OK:            true,
		Payload:       json.RawMessage(`{"key":"value"}`),
	}
	data, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded ResponseEnvelope
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.RequestID != "req-1" {
		t.Errorf("RequestID = %q", decoded.RequestID)
	}
	if !decoded.OK {
		t.Error("OK should be true")
	}
}

func TestErrorResponse_JSON(t *testing.T) {
	resp := ErrorResponse{
		RequestID:     "req-1",
		CorrelationID: "corr-1",
		OK:            false,
		Error: KairoError{
			Code:    ErrNotFound,
			Message: "not found",
		},
	}
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded ErrorResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.OK {
		t.Error("OK should be false")
	}
	if decoded.Error.Code != ErrNotFound {
		t.Errorf("Error.Code = %q", decoded.Error.Code)
	}
}

func TestRuntimeEndpoints_JSON(t *testing.T) {
	ep := RuntimeEndpoints{
		HTTP:   "localhost:18099",
		Events: "localhost:18099",
	}
	data, err := json.Marshal(ep)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded RuntimeEndpoints
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.HTTP != "localhost:18099" {
		t.Errorf("HTTP = %q", decoded.HTTP)
	}
	if decoded.Events != "localhost:18099" {
		t.Errorf("Events = %q", decoded.Events)
	}
}

func TestBuildRequest_JSON(t *testing.T) {
	req := BuildRequest{
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		Targets:     []string{"compile"},
		Mode:        "offline",
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded BuildRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.WorkspaceID != "ws-1" {
		t.Errorf("WorkspaceID = %q", decoded.WorkspaceID)
	}
	if len(decoded.Targets) != 1 {
		t.Errorf("Targets len = %d, want 1", len(decoded.Targets))
	}
}

func TestHealthResponse_JSON(t *testing.T) {
	resp := HealthResponse{
		Status:  "ok",
		Version: "1.0.0",
	}
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded HealthResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Status != "ok" {
		t.Errorf("Status = %q", decoded.Status)
	}
}

func TestKairoErrorCode_Constants(t *testing.T) {
	// Verify all error codes are non-empty strings
	codes := []KairoErrorCode{
		ErrInternal,
		ErrInvalidRequest,
		ErrUnauthenticated,
		ErrForbidden,
		ErrPathForbidden,
		ErrNotFound,
		ErrConflict,
		ErrRateLimited,
		ErrToolchainMissing,
		ErrRuntimeMissing,
		ErrUnsupported,
		ErrUnsupportedJDKTarget,
		ErrIOError,
	}
	for _, c := range codes {
		if c == "" {
			t.Errorf("error code should not be empty")
		}
	}
}