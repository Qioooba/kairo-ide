package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// TestToServerResponse_DoesNotLeakSensitiveFields verifies that
// local filesystem paths, environment variables, JVM options, and
// process identity material from domain.ServerRecord are NEVER
// serialized into the API JSON output.
//
// This is a security boundary test — see ADR-0012 (Safe API DTO
// Boundary). If this test fails, a sensitive field is leaking
// through the HTTP API.
func TestToServerResponse_DoesNotLeakSensitiveFields(t *testing.T) {
	startedAt := time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
	rec := domain.ServerRecord{
		ID:            "srv_abc",
		WorkspaceID:   "ws_x",
		ProjectID:     "prj_x",
		DesiredState:  domain.DesiredServerStateRunning,
		ObservedState: domain.ServerStateRunning,
		Generation:    3,
		PID:           12345,
		ProcessIdentity: &domain.ProcessIdentity{
			PID:          12345,
			Executable:   "/secret/path/to/java",
			StartTime:    startedAt,
			CatalinaBase: "/secret/catalina/base",
			MarkerToken:  "SECRET_MARKER_TOKEN_DO_NOT_LEAK",
		},
		RuntimePlan: domain.RuntimePlan{
			RuntimeID:      "tomcat6",
			JavaHome:       "/secret/java/home",
			CatalinaHome:   "/secret/catalina/home",
			CatalinaBase:   "/secret/catalina/base",
			WebappDir:      "/secret/webapp/dir",
			DeploymentRoot: "/secret/deploy/root",
			ContextPath:    "/app",
			HTTPPort:       18080,
			ShutdownPort:   18005,
			DebugPort:      18001,
			JVMOptions:     []string{"-Dsecret=leak"},
			Env:            []string{"SECRET_ENV=leak"},
		},
		LastError: "",
		StartedAt: &startedAt,
		UpdatedAt: startedAt,
	}

	resp := ToServerUseCaseResponse(rec)
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	jsonStr := string(data)

	// Sensitive VALUES that MUST NOT appear in the JSON output.
	sensitiveValues := []string{
		"/secret/path/to/java",
		"/secret/java/home",
		"/secret/catalina/home",
		"/secret/catalina/base",
		"/secret/webapp/dir",
		"/secret/deploy/root",
		"SECRET_MARKER_TOKEN_DO_NOT_LEAK",
		"-Dsecret=leak",
		"SECRET_ENV=leak",
		"18005", // ShutdownPort — internal, must not be exposed
	}
	for _, s := range sensitiveValues {
		if strings.Contains(jsonStr, s) {
			t.Errorf("sensitive value %q leaked into JSON: %s", s, jsonStr)
		}
	}

	// Sensitive JSON KEYS that MUST NOT appear in the output. These
	// would indicate that a whole subobject (ProcessIdentity,
	// RuntimePlan) is being serialized rather than mapped through
	// the safe DTO.
	sensitiveKeys := []string{
		`"javaHome"`,
		`"catalinaHome"`,
		`"catalinaBase"`,
		`"webappDir"`,
		`"deploymentRoot"`,
		`"jvmOptions"`,
		`"env"`,
		`"shutdownPort"`,
		`"processIdentity"`,
		`"executable"`,
		`"markerToken"`,
		`"startTime"`, // ProcessIdentity.StartTime, not ServerRecord.StartedAt
		`"runtimePlan"`,
	}
	for _, k := range sensitiveKeys {
		if strings.Contains(jsonStr, k) {
			t.Errorf("sensitive key %s appeared in JSON: %s", k, jsonStr)
		}
	}
}

// TestToServerResponse_SafeFieldsPresent verifies that the
// non-sensitive fields the UI needs are present and correctly
// mapped.
func TestToServerResponse_SafeFieldsPresent(t *testing.T) {
	startedAt := time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
	stoppedAt := time.Date(2026, 7, 19, 11, 0, 0, 0, time.UTC)
	rec := domain.ServerRecord{
		ID:            "srv_abc",
		WorkspaceID:   "ws_x",
		ProjectID:     "prj_x",
		DesiredState:  domain.DesiredServerStateRunning,
		ObservedState: domain.ServerStateRunning,
		Generation:    3,
		PID:           12345,
		RuntimePlan: domain.RuntimePlan{
			RuntimeID:   "tomcat6",
			ContextPath: "/app",
			HTTPPort:    18080,
			DebugPort:   18001,
		},
		LastError: "boom",
		StartedAt: &startedAt,
		StoppedAt: &stoppedAt,
		UpdatedAt: startedAt,
	}

	resp := ToServerUseCaseResponse(rec)

	if resp.ID != "srv_abc" {
		t.Errorf("ID = %q, want srv_abc", resp.ID)
	}
	if resp.WorkspaceID != "ws_x" {
		t.Errorf("WorkspaceID = %q, want ws_x", resp.WorkspaceID)
	}
	if resp.ProjectID != "prj_x" {
		t.Errorf("ProjectID = %q, want prj_x", resp.ProjectID)
	}
	if resp.RuntimeID != "tomcat6" {
		t.Errorf("RuntimeID = %q, want tomcat6", resp.RuntimeID)
	}
	if resp.DesiredState != "running" {
		t.Errorf("DesiredState = %q, want running", resp.DesiredState)
	}
	if resp.ObservedState != "running" {
		t.Errorf("ObservedState = %q, want running", resp.ObservedState)
	}
	if resp.Generation != 3 {
		t.Errorf("Generation = %d, want 3", resp.Generation)
	}
	if resp.PID != 12345 {
		t.Errorf("PID = %d, want 12345", resp.PID)
	}
	if resp.HTTPPort != 18080 {
		t.Errorf("HTTPPort = %d, want 18080", resp.HTTPPort)
	}
	if resp.DebugPort != 18001 {
		t.Errorf("DebugPort = %d, want 18001", resp.DebugPort)
	}
	if resp.ContextPath != "/app" {
		t.Errorf("ContextPath = %q, want /app", resp.ContextPath)
	}
	if resp.LastError != "boom" {
		t.Errorf("LastError = %q, want boom", resp.LastError)
	}
	if resp.URL != "http://localhost:18080/app" {
		t.Errorf("URL = %q, want http://localhost:18080/app", resp.URL)
	}
	if resp.StartedAt == nil {
		t.Errorf("StartedAt is nil")
	} else if *resp.StartedAt != startedAt.UTC().Format(time.RFC3339Nano) {
		t.Errorf("StartedAt = %q, want %q", *resp.StartedAt, startedAt.UTC().Format(time.RFC3339Nano))
	}
	if resp.StoppedAt == nil {
		t.Errorf("StoppedAt is nil")
	}
}

// TestToServerResponse_NoPortsNoURL verifies that when HTTPPort is
// 0 (e.g. server is stopped), the URL field is empty and ports
// don't appear with zero values.
func TestToServerResponse_NoPortsNoURL(t *testing.T) {
	rec := domain.ServerRecord{
		ID:            "srv_x",
		WorkspaceID:   "ws_x",
		ProjectID:     "prj_x",
		DesiredState:  domain.DesiredServerStateStopped,
		ObservedState: domain.ServerStateStopped,
	}
	resp := ToServerUseCaseResponse(rec)
	if resp.URL != "" {
		t.Errorf("URL = %q, want empty when HTTPPort=0", resp.URL)
	}
	if resp.HTTPPort != 0 {
		t.Errorf("HTTPPort = %d, want 0", resp.HTTPPort)
	}
	if resp.DebugPort != 0 {
		t.Errorf("DebugPort = %d, want 0", resp.DebugPort)
	}
}

// TestToServerResponseList_NilEntriesSkipped verifies that nil
// entries in the input slice do not produce nil JSON entries.
func TestToServerResponseList_NilEntriesSkipped(t *testing.T) {
	rec1 := &domain.ServerRecord{ID: "srv_1"}
	rec2 := &domain.ServerRecord{ID: "srv_2"}
	records := []*domain.ServerRecord{rec1, nil, rec2}
	list := ToServerUseCaseResponseList(records)
	if len(list) != 2 {
		t.Fatalf("len(list) = %d, want 2", len(list))
	}
	if list[0].ID != "srv_1" || list[1].ID != "srv_2" {
		t.Errorf("list IDs = %q, %q; want srv_1, srv_2", list[0].ID, list[1].ID)
	}
}

// TestToServerResponse_NilProcessIdentity verifies that a record
// with no ProcessIdentity (stopped/never-started server) maps
// without panic and produces valid JSON.
func TestToServerResponse_NilProcessIdentity(t *testing.T) {
	rec := domain.ServerRecord{
		ID:            "srv_x",
		ObservedState: domain.ServerStateStopped,
		DesiredState:  domain.DesiredServerStateStopped,
	}
	resp := ToServerUseCaseResponse(rec)
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(data), `"id":"srv_x"`) {
		t.Errorf("expected id in JSON: %s", string(data))
	}
}
