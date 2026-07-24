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
	req := StartBuildRequest{
		ProjectID:     "proj-1",
		Clean:         true,
		Intent:        "full",
		SelectedFiles: []string{"compile"},
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded StartBuildRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ProjectID != "proj-1" {
		t.Errorf("ProjectID = %q", decoded.ProjectID)
	}
	if !decoded.Clean {
		t.Errorf("Clean should be true")
	}
}

func TestHealthResponse_JSON(t *testing.T) {
	resp := HealthResponse{
		OK:      true,
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
	if !decoded.OK {
		t.Errorf("OK should be true")
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

// ---------------------------------------------------------------------------
//  KairoError with Retryable field
// ---------------------------------------------------------------------------

func TestKairoError_WithRetryable(t *testing.T) {
	e := KairoError{
		Code:      ErrInternal,
		Message:   "internal error",
		Retryable: true,
		Details:   map[string]any{"trace": "stack-123"},
	}
	data, err := json.Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded KairoError
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Code != ErrInternal {
		t.Errorf("Code = %q, want %q", decoded.Code, ErrInternal)
	}
	if decoded.Message != "internal error" {
		t.Errorf("Message = %q", decoded.Message)
	}
	if !decoded.Retryable {
		t.Error("Retryable should be true")
	}
}

// ---------------------------------------------------------------------------
//  ErrorResponse with Details field
// ---------------------------------------------------------------------------

func TestErrorResponse_WithDetails(t *testing.T) {
	resp := ErrorResponse{
		RequestID:     "req-2",
		CorrelationID: "corr-2",
		OK:            false,
		Error: KairoError{
			Code:    ErrInvalidRequest,
			Message: "validation failed",
			Details: []map[string]string{
				{"field": "name", "error": "required"},
				{"field": "port", "error": "out of range"},
			},
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
	if decoded.Error.Code != ErrInvalidRequest {
		t.Errorf("Error.Code = %q", decoded.Error.Code)
	}
	if decoded.Error.Details == nil {
		t.Error("Error.Details should not be nil")
	}
}

// ---------------------------------------------------------------------------
//  EnvelopeResult helper methods
// ---------------------------------------------------------------------------

func TestEnvelopeResult_Helpers(t *testing.T) {
	t.Run("IsError true", func(t *testing.T) {
		r := EnvelopeResult{Error: &KairoError{Code: ErrNotFound, Message: "gone"}}
		if !r.IsError() {
			t.Error("IsError should be true")
		}
	})

	t.Run("IsError false", func(t *testing.T) {
		r := EnvelopeResult{Error: nil}
		if r.IsError() {
			t.Error("IsError should be false")
		}
	})

	t.Run("fields set correctly", func(t *testing.T) {
		r := EnvelopeResult{
			RequestID:     "req-3",
			CorrelationID: "corr-3",
			Payload:       map[string]string{"key": "val"},
			Error:         nil,
		}
		if r.RequestID != "req-3" {
			t.Errorf("RequestID = %q", r.RequestID)
		}
		if r.CorrelationID != "corr-3" {
			t.Errorf("CorrelationID = %q", r.CorrelationID)
		}
		if r.Payload == nil {
			t.Error("Payload should not be nil")
		}
	})
}

// ---------------------------------------------------------------------------
//  Encoding constants
// ---------------------------------------------------------------------------

func TestEncodingConstants(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{"EncodingUTF8", EncodingUTF8},
		{"EncodingUTF8BOM", EncodingUTF8BOM},
		{"EncodingUTF16LE", EncodingUTF16LE},
		{"EncodingUTF16BE", EncodingUTF16BE},
		{"EncodingGBK", EncodingGBK},
		{"EncodingGB18030", EncodingGB18030},
		{"EncodingISO88591", EncodingISO88591},
		{"EncodingUSASCII", EncodingUSASCII},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.value == "" {
				t.Errorf("%s should not be empty", tt.name)
			}
		})
	}
}

// ---------------------------------------------------------------------------
//  RequestEnvelope JSON round-trip
// ---------------------------------------------------------------------------

func TestRequestEnvelope_JSON(t *testing.T) {
	tests := []struct {
		name string
		env  RequestEnvelope
	}{
		{
			name: "full",
			env: RequestEnvelope{
				WorkspaceID:   "ws-1",
				ProjectID:     "proj-1",
				RequestID:     "req-1",
				CorrelationID: "corr-1",
			},
		},
		{
			name: "minimal",
			env: RequestEnvelope{
				WorkspaceID: "ws-2",
				RequestID:   "req-2",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.env)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded RequestEnvelope
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if decoded.WorkspaceID != tt.env.WorkspaceID {
				t.Errorf("WorkspaceID = %q, want %q", decoded.WorkspaceID, tt.env.WorkspaceID)
			}
			if decoded.RequestID != tt.env.RequestID {
				t.Errorf("RequestID = %q, want %q", decoded.RequestID, tt.env.RequestID)
			}
			if decoded.ProjectID != tt.env.ProjectID {
				t.Errorf("ProjectID = %q, want %q", decoded.ProjectID, tt.env.ProjectID)
			}
			if decoded.CorrelationID != tt.env.CorrelationID {
				t.Errorf("CorrelationID = %q, want %q", decoded.CorrelationID, tt.env.CorrelationID)
			}
		})
	}
}

// ---------------------------------------------------------------------------
//  RunConfigurationLaunchRequest JSON round-trip
// ---------------------------------------------------------------------------

func TestRunConfigurationLaunchRequest_JSON(t *testing.T) {
	req := RunConfigurationLaunchRequest{
		Mode: "debug",
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded RunConfigurationLaunchRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Mode != "debug" {
		t.Errorf("Mode = %q, want %q", decoded.Mode, "debug")
	}
}

// ---------------------------------------------------------------------------
//  StartBuildRequest JSON round-trip
// ---------------------------------------------------------------------------

func TestStartBuildRequest_JSON(t *testing.T) {
	tests := []struct {
		name string
		req  StartBuildRequest
	}{
		{
			name: "full",
			req: StartBuildRequest{
				ProjectID:     "proj-1",
				Clean:         true,
				Intent:        "full",
				SelectedFiles: []string{"src/Main.java", "src/Util.java"},
			},
		},
		{
			name: "minimal",
			req: StartBuildRequest{
				ProjectID: "proj-2",
			},
		},
		{
			name: "selected-files intent",
			req: StartBuildRequest{
				ProjectID:     "proj-3",
				Intent:        "selected-files",
				SelectedFiles: []string{"src/Hello.java"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.req)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded StartBuildRequest
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if decoded.ProjectID != tt.req.ProjectID {
				t.Errorf("ProjectID = %q, want %q", decoded.ProjectID, tt.req.ProjectID)
			}
			if decoded.Clean != tt.req.Clean {
				t.Errorf("Clean = %v, want %v", decoded.Clean, tt.req.Clean)
			}
			if decoded.Intent != tt.req.Intent {
				t.Errorf("Intent = %q, want %q", decoded.Intent, tt.req.Intent)
			}
			if len(decoded.SelectedFiles) != len(tt.req.SelectedFiles) {
				t.Errorf("SelectedFiles len = %d, want %d", len(decoded.SelectedFiles), len(tt.req.SelectedFiles))
			}
		})
	}
}

// ---------------------------------------------------------------------------
//  StartDeploymentRequest JSON round-trip
// ---------------------------------------------------------------------------

func TestStartDeploymentRequest_JSON(t *testing.T) {
	req := StartDeploymentRequest{
		ProjectID: "proj-1",
		BuildID:   "build-123",
		Scope:     "all",
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded StartDeploymentRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ProjectID != "proj-1" {
		t.Errorf("ProjectID = %q", decoded.ProjectID)
	}
	if decoded.BuildID != "build-123" {
		t.Errorf("BuildID = %q", decoded.BuildID)
	}
	if decoded.Scope != "all" {
		t.Errorf("Scope = %q", decoded.Scope)
	}
}

// ---------------------------------------------------------------------------
//  StartServerRequest JSON round-trip
// ---------------------------------------------------------------------------

func TestStartServerRequest_JSON(t *testing.T) {
	tests := []struct {
		name string
		req  StartServerRequest
	}{
		{
			name: "with debug",
			req: StartServerRequest{
				ProjectID: "proj-1",
				Debug:     true,
			},
		},
		{
			name: "without debug",
			req: StartServerRequest{
				ProjectID: "proj-2",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.req)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded StartServerRequest
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if decoded.ProjectID != tt.req.ProjectID {
				t.Errorf("ProjectID = %q, want %q", decoded.ProjectID, tt.req.ProjectID)
			}
			if decoded.Debug != tt.req.Debug {
				t.Errorf("Debug = %v, want %v", decoded.Debug, tt.req.Debug)
			}
		})
	}
}

// ---------------------------------------------------------------------------
//  BuildResult + BuildDiagnostic + BuildSummary JSON round-trip
// ---------------------------------------------------------------------------

func TestBuildDiagnostic_JSON(t *testing.T) {
	d := BuildDiagnostic{
		File:      "src/Main.java",
		Line:      42,
		Column:    10,
		EndLine:   42,
		EndColumn: 15,
		Severity:  "error",
		Code:      "E001",
		Message:   "cannot find symbol",
	}
	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded BuildDiagnostic
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.File != "src/Main.java" {
		t.Errorf("File = %q", decoded.File)
	}
	if decoded.Line != 42 {
		t.Errorf("Line = %d", decoded.Line)
	}
	if decoded.Column != 10 {
		t.Errorf("Column = %d", decoded.Column)
	}
	if decoded.Severity != "error" {
		t.Errorf("Severity = %q", decoded.Severity)
	}
	if decoded.Message != "cannot find symbol" {
		t.Errorf("Message = %q", decoded.Message)
	}
}

func TestBuildSummary_JSON(t *testing.T) {
	s := BuildSummary{
		Errors:        3,
		Warnings:      7,
		FilesCompiled: 42,
	}
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded BuildSummary
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Errors != 3 {
		t.Errorf("Errors = %d", decoded.Errors)
	}
	if decoded.Warnings != 7 {
		t.Errorf("Warnings = %d", decoded.Warnings)
	}
	if decoded.FilesCompiled != 42 {
		t.Errorf("FilesCompiled = %d", decoded.FilesCompiled)
	}
}

func TestBuildResult_JSON(t *testing.T) {
	r := BuildResult{
		ID:         "build-1",
		State:      "success",
		StartedAt:  "2025-01-15T10:30:00Z",
		FinishedAt: "2025-01-15T10:31:00Z",
		Diagnostics: []BuildDiagnostic{
			{File: "src/Main.java", Line: 10, Column: 5, Severity: "warning", Message: "unused import"},
		},
		Output: "Build completed successfully",
		Summary: BuildSummary{
			Errors:        0,
			Warnings:      1,
			FilesCompiled: 15,
		},
	}
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded BuildResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ID != "build-1" {
		t.Errorf("ID = %q", decoded.ID)
	}
	if decoded.State != "success" {
		t.Errorf("State = %q", decoded.State)
	}
	if len(decoded.Diagnostics) != 1 {
		t.Errorf("Diagnostics len = %d, want 1", len(decoded.Diagnostics))
	}
	if decoded.Summary.Errors != 0 {
		t.Errorf("Summary.Errors = %d", decoded.Summary.Errors)
	}
}

// ---------------------------------------------------------------------------
//  DeploymentResult JSON round-trip
// ---------------------------------------------------------------------------

func TestDeploymentResult_JSON(t *testing.T) {
	tests := []struct {
		name string
		r    DeploymentResult
	}{
		{
			name: "success",
			r: DeploymentResult{
				ID:            "deploy-1",
				State:         "success",
				StartedAt:     "2025-01-15T10:31:00Z",
				FinishedAt:    "2025-01-15T10:31:05Z",
				FilesTouched:  12,
				Bytes:         2048000,
				Trigger:       "manual",
				HotReloadMode: "classHotSwap",
			},
		},
		{
			name: "failure",
			r: DeploymentResult{
				ID:            "deploy-2",
				State:         "failure",
				StartedAt:     "2025-01-15T10:31:00Z",
				FilesTouched:  0,
				Trigger:       "auto",
				HotReloadMode: "staticSync",
				Error:         "target unreachable",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.r)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded DeploymentResult
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if decoded.ID != tt.r.ID {
				t.Errorf("ID = %q", decoded.ID)
			}
			if decoded.State != tt.r.State {
				t.Errorf("State = %q", decoded.State)
			}
			if decoded.Trigger != tt.r.Trigger {
				t.Errorf("Trigger = %q", decoded.Trigger)
			}
			if decoded.Error != tt.r.Error {
				t.Errorf("Error = %q", decoded.Error)
			}
		})
	}
}

// ---------------------------------------------------------------------------
//  ServerInstance + ServerPorts + ServerMemory JSON round-trip
// ---------------------------------------------------------------------------

func TestServerPorts_JSON(t *testing.T) {
	p := ServerPorts{
		HTTP:     8080,
		Shutdown: 8005,
		AJP:      8009,
		JMX:      1099,
		Debug:    5005,
	}
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ServerPorts
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.HTTP != 8080 {
		t.Errorf("HTTP = %d", decoded.HTTP)
	}
	if decoded.Shutdown != 8005 {
		t.Errorf("Shutdown = %d", decoded.Shutdown)
	}
	if decoded.AJP != 8009 {
		t.Errorf("AJP = %d", decoded.AJP)
	}
	if decoded.Debug != 5005 {
		t.Errorf("Debug = %d", decoded.Debug)
	}
}

func TestServerMemory_JSON(t *testing.T) {
	m := ServerMemory{
		HeapUsedMb: 256.5,
		HeapMaxMb:  1024.0,
	}
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ServerMemory
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.HeapUsedMb != 256.5 {
		t.Errorf("HeapUsedMb = %f", decoded.HeapUsedMb)
	}
	if decoded.HeapMaxMb != 1024.0 {
		t.Errorf("HeapMaxMb = %f", decoded.HeapMaxMb)
	}
}

func TestServerInstance_JSON(t *testing.T) {
	tests := []struct {
		name string
		s    ServerInstance
	}{
		{
			name: "running",
			s: ServerInstance{
				ID:        "server-1",
				ProjectID: "proj-1",
				Type:      "tomcat",
				State:     "running",
				PID:       12345,
				Ports: ServerPorts{
					HTTP:     8080,
					Shutdown: 8005,
				},
				StartedAt:    "2025-01-15T10:30:00Z",
				CatalinaBase: "/opt/tomcat",
				Memory: &ServerMemory{
					HeapUsedMb: 512.0,
					HeapMaxMb:  1024.0,
				},
			},
		},
		{
			name: "stopped",
			s: ServerInstance{
				ID:           "server-2",
				ProjectID:    "proj-2",
				Type:         "tomcat",
				State:        "stopped",
				Ports:        ServerPorts{},
				CatalinaBase: "/opt/tomcat2",
				LastError:    "crashed unexpectedly",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.s)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded ServerInstance
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if decoded.ID != tt.s.ID {
				t.Errorf("ID = %q", decoded.ID)
			}
			if decoded.State != tt.s.State {
				t.Errorf("State = %q", decoded.State)
			}
			if decoded.CatalinaBase != tt.s.CatalinaBase {
				t.Errorf("CatalinaBase = %q", decoded.CatalinaBase)
			}
			if tt.s.Memory != nil && decoded.Memory == nil {
				t.Error("Memory should not be nil")
			}
			if tt.s.Memory == nil && decoded.Memory != nil {
				t.Error("Memory should be nil")
			}
		})
	}
}

// ---------------------------------------------------------------------------
//  Workspace JSON round-trip
// ---------------------------------------------------------------------------

func TestWorkspace_JSON(t *testing.T) {
	w := Workspace{
		ID:           "ws-1",
		Name:         "My Workspace",
		RootPath:     "/home/user/workspace",
		CreatedAt:    "2025-01-01T00:00:00Z",
		LastOpenedAt: "2025-01-15T10:00:00Z",
		UserID:       "user-1",
	}
	data, err := json.Marshal(w)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded Workspace
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ID != "ws-1" {
		t.Errorf("ID = %q", decoded.ID)
	}
	if decoded.Name != "My Workspace" {
		t.Errorf("Name = %q", decoded.Name)
	}
	if decoded.RootPath != "/home/user/workspace" {
		t.Errorf("RootPath = %q", decoded.RootPath)
	}
	if decoded.CreatedAt != "2025-01-01T00:00:00Z" {
		t.Errorf("CreatedAt = %q", decoded.CreatedAt)
	}
	if decoded.LastOpenedAt != "2025-01-15T10:00:00Z" {
		t.Errorf("LastOpenedAt = %q", decoded.LastOpenedAt)
	}
	if decoded.UserID != "user-1" {
		t.Errorf("UserID = %q", decoded.UserID)
	}
}

// ---------------------------------------------------------------------------
//  ProjectConfig + nested types JSON round-trip
// ---------------------------------------------------------------------------

func TestSourceLayout_JSON(t *testing.T) {
	sl := SourceLayout{
		Src:       []string{"src/main/java", "src/main/resources"},
		WebRoot:   "web",
		Config:    []string{"config"},
		Lib:       "lib",
		TestSrc:   []string{"src/test/java"},
		Resources: []string{"src/main/resources"},
		BuildXML:  "build.xml",
	}
	data, err := json.Marshal(sl)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded SourceLayout
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded.Src) != 2 {
		t.Errorf("Src len = %d, want 2", len(decoded.Src))
	}
	if decoded.WebRoot != "web" {
		t.Errorf("WebRoot = %q", decoded.WebRoot)
	}
	if decoded.Lib != "lib" {
		t.Errorf("Lib = %q", decoded.Lib)
	}
	if decoded.BuildXML != "build.xml" {
		t.Errorf("BuildXML = %q", decoded.BuildXML)
	}
}

func TestEncodingConfig_JSON(t *testing.T) {
	ec := EncodingConfig{
		Default: "utf-8",
		Aliases: map[string]string{
			"utf8": "utf-8",
		},
		PerExtension: map[string]string{
			".java": "utf-8",
			".xml":  "utf-8",
		},
	}
	data, err := json.Marshal(ec)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded EncodingConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Default != "utf-8" {
		t.Errorf("Default = %q", decoded.Default)
	}
	if len(decoded.Aliases) != 1 {
		t.Errorf("Aliases len = %d, want 1", len(decoded.Aliases))
	}
	if len(decoded.PerExtension) != 2 {
		t.Errorf("PerExtension len = %d, want 2", len(decoded.PerExtension))
	}
}

func TestToolchainRef_JSON(t *testing.T) {
	tr := ToolchainRef{
		ToolchainID: "tc-1",
		Fingerprint: "abc123",
		Label:       "JDK 11",
	}
	data, err := json.Marshal(tr)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ToolchainRef
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ToolchainID != "tc-1" {
		t.Errorf("ToolchainID = %q", decoded.ToolchainID)
	}
	if decoded.Fingerprint != "abc123" {
		t.Errorf("Fingerprint = %q", decoded.Fingerprint)
	}
	if decoded.Label != "JDK 11" {
		t.Errorf("Label = %q", decoded.Label)
	}
}

func TestCompilerConfig_JSON(t *testing.T) {
	cc := CompilerConfig{
		ToolchainRef: ToolchainRef{
			ToolchainID: "tc-1",
			Fingerprint: "abc123",
		},
		SourceLevel: "11",
		TargetLevel: "11",
		Args:        []string{"-Xlint:all"},
		EmulatedV6:  false,
	}
	data, err := json.Marshal(cc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded CompilerConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ToolchainID != "tc-1" {
		t.Errorf("ToolchainID = %q", decoded.ToolchainID)
	}
	if decoded.SourceLevel != "11" {
		t.Errorf("SourceLevel = %q", decoded.SourceLevel)
	}
	if decoded.TargetLevel != "11" {
		t.Errorf("TargetLevel = %q", decoded.TargetLevel)
	}
	if len(decoded.Args) != 1 {
		t.Errorf("Args len = %d, want 1", len(decoded.Args))
	}
}

func TestJavaConfig_JSON(t *testing.T) {
	jc := JavaConfig{
		LanguageServer: ToolchainRef{
			ToolchainID: "tc-ls",
			Fingerprint: "fp-ls",
		},
		Compiler: CompilerConfig{
			ToolchainRef: ToolchainRef{
				ToolchainID: "tc-compiler",
				Fingerprint: "fp-compiler",
			},
			SourceLevel: "11",
			TargetLevel: "11",
		},
		Runtime: ToolchainRef{
			ToolchainID: "tc-runtime",
			Fingerprint: "fp-runtime",
		},
	}
	data, err := json.Marshal(jc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded JavaConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.LanguageServer.ToolchainID != "tc-ls" {
		t.Errorf("LanguageServer.ToolchainID = %q", decoded.LanguageServer.ToolchainID)
	}
	if decoded.Compiler.SourceLevel != "11" {
		t.Errorf("Compiler.SourceLevel = %q", decoded.Compiler.SourceLevel)
	}
	if decoded.Runtime.ToolchainID != "tc-runtime" {
		t.Errorf("Runtime.ToolchainID = %q", decoded.Runtime.ToolchainID)
	}
}

func TestJVMConfig_JSON(t *testing.T) {
	jvm := JVMConfig{
		MaxHeapMb: 1024,
		PermGenMb: 256,
		ExtraArgs: []string{"-XX:+UseG1GC", "-Dfile.encoding=UTF-8"},
	}
	data, err := json.Marshal(jvm)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded JVMConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.MaxHeapMb != 1024 {
		t.Errorf("MaxHeapMb = %d", decoded.MaxHeapMb)
	}
	if decoded.PermGenMb != 256 {
		t.Errorf("PermGenMb = %d", decoded.PermGenMb)
	}
	if len(decoded.ExtraArgs) != 2 {
		t.Errorf("ExtraArgs len = %d, want 2", len(decoded.ExtraArgs))
	}
}

func TestServerRuntimeSettings_JSON(t *testing.T) {
	srs := ServerRuntimeSettings{
		HTTPPort:     8080,
		ShutdownPort: 8005,
		AJPPort:      8009,
		JMXPort:      1099,
		DebugPort:    5005,
		ContextPath:  "/myapp",
		Env: map[string]string{
			"JAVA_HOME": "/opt/jdk11",
			"CATALINA_HOME": "/opt/tomcat",
		},
		JVM: &JVMConfig{
			MaxHeapMb: 1024,
			PermGenMb: 256,
		},
	}
	data, err := json.Marshal(srs)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ServerRuntimeSettings
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.HTTPPort != 8080 {
		t.Errorf("HTTPPort = %d", decoded.HTTPPort)
	}
	if decoded.ContextPath != "/myapp" {
		t.Errorf("ContextPath = %q", decoded.ContextPath)
	}
	if len(decoded.Env) != 2 {
		t.Errorf("Env len = %d, want 2", len(decoded.Env))
	}
	if decoded.JVM == nil {
		t.Error("JVM should not be nil")
	}
}

func TestServerRuntimeConfig_JSON(t *testing.T) {
	src := ServerRuntimeConfig{
		Type: "tomcat",
		Config: ServerRuntimeSettings{
			HTTPPort:    8080,
			ContextPath: "/myapp",
		},
	}
	data, err := json.Marshal(src)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ServerRuntimeConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Type != "tomcat" {
		t.Errorf("Type = %q", decoded.Type)
	}
	if decoded.Config.HTTPPort != 8080 {
		t.Errorf("Config.HTTPPort = %d", decoded.Config.HTTPPort)
	}
}

func TestBuildConfig_JSON(t *testing.T) {
	bc := BuildConfig{
		Mode:          "ant",
		AntFile:       "build.xml",
		CustomCommand: "",
		Excludes:      []string{"**/test/**", "**/generated/**"},
	}
	data, err := json.Marshal(bc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded BuildConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Mode != "ant" {
		t.Errorf("Mode = %q", decoded.Mode)
	}
	if decoded.AntFile != "build.xml" {
		t.Errorf("AntFile = %q", decoded.AntFile)
	}
	if len(decoded.Excludes) != 2 {
		t.Errorf("Excludes len = %d, want 2", len(decoded.Excludes))
	}
}

func TestDeployConfig_JSON(t *testing.T) {
	dc := DeployConfig{
		Mode:        "copy",
		Target:      "/opt/tomcat/webapps/myapp",
		ClassesPath: "build/classes",
		LibPath:     "lib",
	}
	data, err := json.Marshal(dc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded DeployConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Mode != "copy" {
		t.Errorf("Mode = %q", decoded.Mode)
	}
	if decoded.Target != "/opt/tomcat/webapps/myapp" {
		t.Errorf("Target = %q", decoded.Target)
	}
	if decoded.ClassesPath != "build/classes" {
		t.Errorf("ClassesPath = %q", decoded.ClassesPath)
	}
}

func TestHotReloadConfig_JSON(t *testing.T) {
	hrc := HotReloadConfig{
		Mode:             "classHotSwap",
		DebounceMs:       300,
		FallbackToReload: true,
	}
	data, err := json.Marshal(hrc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded HotReloadConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Mode != "classHotSwap" {
		t.Errorf("Mode = %q", decoded.Mode)
	}
	if decoded.DebounceMs != 300 {
		t.Errorf("DebounceMs = %d", decoded.DebounceMs)
	}
	if !decoded.FallbackToReload {
		t.Error("FallbackToReload should be true")
	}
}

func TestProjectConfig_JSON(t *testing.T) {
	pc := ProjectConfig{
		SchemaVersion: 1,
		ID:            "proj-1",
		Name:          "MyProject",
		RootPath:      "/home/user/project",
		SourceLayout: SourceLayout{
			Src:     []string{"src/main/java"},
			WebRoot: "web",
			Config:  []string{"config"},
			Lib:     "lib",
		},
		Encoding: EncodingConfig{
			Default: "utf-8",
		},
		Java: JavaConfig{
			LanguageServer: ToolchainRef{ToolchainID: "tc-ls", Fingerprint: "fp-ls"},
			Compiler: CompilerConfig{
				ToolchainRef: ToolchainRef{ToolchainID: "tc-c", Fingerprint: "fp-c"},
				SourceLevel:  "11",
				TargetLevel:  "11",
			},
			Runtime: ToolchainRef{ToolchainID: "tc-r", Fingerprint: "fp-r"},
		},
		ServerRuntime: ServerRuntimeConfig{
			Type: "tomcat",
			Config: ServerRuntimeSettings{
				HTTPPort: 8080,
			},
		},
		Build: BuildConfig{
			Mode:    "ant",
			AntFile: "build.xml",
		},
		Deploy: DeployConfig{
			Mode:   "copy",
			Target: "/opt/tomcat/webapps/myapp",
		},
		HotReload: HotReloadConfig{
			Mode: "classHotSwap",
		},
	}
	data, err := json.Marshal(pc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ProjectConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.SchemaVersion != 1 {
		t.Errorf("SchemaVersion = %d", decoded.SchemaVersion)
	}
	if decoded.ID != "proj-1" {
		t.Errorf("ID = %q", decoded.ID)
	}
	if decoded.Name != "MyProject" {
		t.Errorf("Name = %q", decoded.Name)
	}
	if decoded.SourceLayout.WebRoot != "web" {
		t.Errorf("SourceLayout.WebRoot = %q", decoded.SourceLayout.WebRoot)
	}
	if decoded.Encoding.Default != "utf-8" {
		t.Errorf("Encoding.Default = %q", decoded.Encoding.Default)
	}
	if decoded.Build.Mode != "ant" {
		t.Errorf("Build.Mode = %q", decoded.Build.Mode)
	}
}

// ---------------------------------------------------------------------------
//  Toolchain JSON round-trip
// ---------------------------------------------------------------------------

func TestToolchain_JSON(t *testing.T) {
	tc := Toolchain{
		ID:           "tc-1",
		Kind:         "jdk",
		Home:         "/opt/jdk11",
		Vendor:       "OpenJDK",
		Version:      "11.0.20",
		SourceLevels: []string{"11", "8"},
		Fingerprint:  "abc123def456",
		ImportedAt:   "2025-01-15T10:00:00Z",
	}
	data, err := json.Marshal(tc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded Toolchain
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ID != "tc-1" {
		t.Errorf("ID = %q", decoded.ID)
	}
	if decoded.Kind != "jdk" {
		t.Errorf("Kind = %q", decoded.Kind)
	}
	if decoded.Home != "/opt/jdk11" {
		t.Errorf("Home = %q", decoded.Home)
	}
	if decoded.Vendor != "OpenJDK" {
		t.Errorf("Vendor = %q", decoded.Vendor)
	}
	if decoded.Version != "11.0.20" {
		t.Errorf("Version = %q", decoded.Version)
	}
	if len(decoded.SourceLevels) != 2 {
		t.Errorf("SourceLevels len = %d, want 2", len(decoded.SourceLevels))
	}
	if decoded.Fingerprint != "abc123def456" {
		t.Errorf("Fingerprint = %q", decoded.Fingerprint)
	}
	if decoded.ImportedAt != "2025-01-15T10:00:00Z" {
		t.Errorf("ImportedAt = %q", decoded.ImportedAt)
	}
}

// ---------------------------------------------------------------------------
//  DetectedProjectLayout + nested types JSON round-trip
// ---------------------------------------------------------------------------

func TestDetectedJDK_JSON(t *testing.T) {
	dj := DetectedJDK{
		Home:    "/opt/jdk11",
		Version: "11.0.20",
	}
	data, err := json.Marshal(dj)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded DetectedJDK
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Home != "/opt/jdk11" {
		t.Errorf("Home = %q", decoded.Home)
	}
	if decoded.Version != "11.0.20" {
		t.Errorf("Version = %q", decoded.Version)
	}
}

func TestDetectedServer_JSON(t *testing.T) {
	ds := DetectedServer{
		Name:    "Apache Tomcat",
		Version: "9.0.80",
		Home:    "/opt/tomcat",
	}
	data, err := json.Marshal(ds)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded DetectedServer
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Name != "Apache Tomcat" {
		t.Errorf("Name = %q", decoded.Name)
	}
	if decoded.Version != "9.0.80" {
		t.Errorf("Version = %q", decoded.Version)
	}
	if decoded.Home != "/opt/tomcat" {
		t.Errorf("Home = %q", decoded.Home)
	}
}

func TestWebXMLSummary_JSON(t *testing.T) {
	ws := WebXMLSummary{
		ServletCount: 3,
		URLPatterns:  []string{"/api/*", "/ws/*"},
		ContextParams: map[string]string{
			"appName":    "MyApp",
			"debug":      "true",
		},
	}
	data, err := json.Marshal(ws)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded WebXMLSummary
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ServletCount != 3 {
		t.Errorf("ServletCount = %d", decoded.ServletCount)
	}
	if len(decoded.URLPatterns) != 2 {
		t.Errorf("URLPatterns len = %d, want 2", len(decoded.URLPatterns))
	}
	if len(decoded.ContextParams) != 2 {
		t.Errorf("ContextParams len = %d, want 2", len(decoded.ContextParams))
	}
}

func TestDetectedProjectLayout_JSON(t *testing.T) {
	dpl := DetectedProjectLayout{
		RootPath: "/home/user/project",
		Layout: SourceLayout{
			Src:     []string{"src/main/java"},
			WebRoot: "web",
			Config:  []string{"config"},
		},
		DetectedJDK: &DetectedJDK{
			Home:    "/opt/jdk11",
			Version: "11.0.20",
		},
		DetectedServer: &DetectedServer{
			Name:    "Apache Tomcat",
			Version: "9.0.80",
			Home:    "/opt/tomcat",
		},
		WebXML: &WebXMLSummary{
			ServletCount: 2,
			URLPatterns:  []string{"/api/*"},
		},
		BuildSystem: "ant",
		EncodingByExtension: map[string]string{
			".java": "utf-8",
			".xml":  "utf-8",
		},
		Confidence: 0.95,
		Warnings:   []string{"no build script found"},
	}
	data, err := json.Marshal(dpl)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded DetectedProjectLayout
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.RootPath != "/home/user/project" {
		t.Errorf("RootPath = %q", decoded.RootPath)
	}
	if decoded.BuildSystem != "ant" {
		t.Errorf("BuildSystem = %q", decoded.BuildSystem)
	}
	if decoded.Confidence != 0.95 {
		t.Errorf("Confidence = %f", decoded.Confidence)
	}
	if decoded.DetectedJDK == nil {
		t.Error("DetectedJDK should not be nil")
	}
	if decoded.DetectedServer == nil {
		t.Error("DetectedServer should not be nil")
	}
	if decoded.WebXML == nil {
		t.Error("WebXML should not be nil")
	}
	if len(decoded.Warnings) != 1 {
		t.Errorf("Warnings len = %d, want 1", len(decoded.Warnings))
	}
}

// ---------------------------------------------------------------------------
//  ProjectDetection JSON round-trip
// ---------------------------------------------------------------------------

func TestProjectDetection_JSON(t *testing.T) {
	pd := ProjectDetection{
		SourceDirs:      []string{"src/main/java"},
		WebRoot:         "web",
		LibDirs:         []string{"lib"},
		BuildScript:     "build.xml",
		DefaultEncoding: "utf-8",
		JDKVersion:      "11",
		SourceVersion:   "11",
		TargetVersion:   "11",
		OutputDir:       "build/classes",
		BuildSystem:     "ant",
		Confidence:      0.90,
		Warnings:        []string{"no web.xml found"},
	}
	data, err := json.Marshal(pd)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ProjectDetection
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded.SourceDirs) != 1 {
		t.Errorf("SourceDirs len = %d, want 1", len(decoded.SourceDirs))
	}
	if decoded.WebRoot != "web" {
		t.Errorf("WebRoot = %q", decoded.WebRoot)
	}
	if decoded.BuildScript != "build.xml" {
		t.Errorf("BuildScript = %q", decoded.BuildScript)
	}
	if decoded.DefaultEncoding != "utf-8" {
		t.Errorf("DefaultEncoding = %q", decoded.DefaultEncoding)
	}
	if decoded.BuildSystem != "ant" {
		t.Errorf("BuildSystem = %q", decoded.BuildSystem)
	}
	if decoded.Confidence != 0.90 {
		t.Errorf("Confidence = %f", decoded.Confidence)
	}
}

// ---------------------------------------------------------------------------
//  ProjectImportConfirmRequest JSON round-trip
// ---------------------------------------------------------------------------

func TestProjectImportConfirmRequest_JSON(t *testing.T) {
	req := ProjectImportConfirmRequest{
		WorkspaceID:     "ws-1",
		RootPath:        "/home/user/project",
		Name:            "MyProject",
		SourceDirs:      []string{"src/main/java"},
		WebRoot:         "web",
		LibDirs:         []string{"lib"},
		BuildScript:     "build.xml",
		DefaultEncoding: "utf-8",
		JDKVersion:      "11",
		SourceVersion:   "11",
		TargetVersion:   "11",
		OutputDir:       "build/classes",
		BuildTool:       "ant",
		ContextPath:     "/myapp",
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ProjectImportConfirmRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.WorkspaceID != "ws-1" {
		t.Errorf("WorkspaceID = %q", decoded.WorkspaceID)
	}
	if decoded.RootPath != "/home/user/project" {
		t.Errorf("RootPath = %q", decoded.RootPath)
	}
	if decoded.Name != "MyProject" {
		t.Errorf("Name = %q", decoded.Name)
	}
	if decoded.BuildTool != "ant" {
		t.Errorf("BuildTool = %q", decoded.BuildTool)
	}
	if decoded.ContextPath != "/myapp" {
		t.Errorf("ContextPath = %q", decoded.ContextPath)
	}
}

// ---------------------------------------------------------------------------
//  RecentProject JSON round-trip
// ---------------------------------------------------------------------------

func TestRecentProject_JSON(t *testing.T) {
	rp := RecentProject{
		ID:           "proj-1",
		Name:         "MyProject",
		RootPath:     "/home/user/project",
		LastOpenedAt: "2025-01-15T10:00:00Z",
	}
	data, err := json.Marshal(rp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded RecentProject
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.ID != "proj-1" {
		t.Errorf("ID = %q", decoded.ID)
	}
	if decoded.Name != "MyProject" {
		t.Errorf("Name = %q", decoded.Name)
	}
	if decoded.RootPath != "/home/user/project" {
		t.Errorf("RootPath = %q", decoded.RootPath)
	}
	if decoded.LastOpenedAt != "2025-01-15T10:00:00Z" {
		t.Errorf("LastOpenedAt = %q", decoded.LastOpenedAt)
	}
}

// ---------------------------------------------------------------------------
//  SearchStreamEvent JSON round-trip
// ---------------------------------------------------------------------------

func TestSearchStreamEvent_JSON(t *testing.T) {
	tests := []struct {
		name  string
		event SearchStreamEvent
	}{
		{
			name: "with results",
			event: SearchStreamEvent{
				Kind:   "batch",
				TaskID: "task-1",
				Batch: []struct {
					File          string `json:"file"`
					Line          int    `json:"line"`
					Column        int    `json:"column"`
					MatchText     string `json:"matchText"`
					ContextBefore string `json:"contextBefore"`
					ContextAfter  string `json:"contextAfter"`
					Replacement   string `json:"replacement,omitempty"`
				}{
					{
						File:          "src/Main.java",
						Line:          10,
						Column:        5,
						MatchText:     "System.out.println",
						ContextBefore: "void main() {\n",
						ContextAfter:  "\n}",
						Replacement:   "logger.info",
					},
				},
				BatchIndex: 0,
				Total:      1,
				Done:       true,
			},
		},
		{
			name: "error event",
			event: SearchStreamEvent{
				Kind:   "error",
				TaskID: "task-2",
				Error:  "search failed",
				Done:   true,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.event)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded SearchStreamEvent
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if decoded.Kind != tt.event.Kind {
				t.Errorf("Kind = %q, want %q", decoded.Kind, tt.event.Kind)
			}
			if decoded.TaskID != tt.event.TaskID {
				t.Errorf("TaskID = %q, want %q", decoded.TaskID, tt.event.TaskID)
			}
			if decoded.Done != tt.event.Done {
				t.Errorf("Done = %v, want %v", decoded.Done, tt.event.Done)
			}
			if decoded.Error != tt.event.Error {
				t.Errorf("Error = %q, want %q", decoded.Error, tt.event.Error)
			}
		})
	}
}

// ---------------------------------------------------------------------------
//  All KairoErrorCode constants verification
// ---------------------------------------------------------------------------

func TestAllKairoErrorCodes_NonEmpty(t *testing.T) {
	allCodes := []KairoErrorCode{
		ErrUnauthenticated,
		ErrForbidden,
		ErrNotFound,
		ErrConflict,
		ErrRateLimited,
		ErrInvalidRequest,
		ErrPathForbidden,
		ErrToolchainMissing,
		ErrRuntimeMissing,
		ErrUnsupportedJDKTarget,
		ErrInternal,
		ErrIOError,
		ErrProcessSpawnFailed,
		ErrCompileFailed,
		ErrDeployFailed,
		ErrDebugAttachFailed,
		ErrCancelled,
		ErrTimeout,
		ErrPluginCrashed,
		ErrUnsupported,
	}
	for _, c := range allCodes {
		if c == "" {
			t.Errorf("error code should not be empty")
		}
	}
}