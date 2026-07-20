package services

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/tomcat6"
)

// TestServerMeta_toResponse_DoesNotLeakSensitiveFields verifies
// that the legacy realServerRunner API responses strip JavaHome,
// WebappDir, CatalinaBase, and the internal Shutdown/AJP ports.
//
// See ADR-0012 (Safe API DTO Boundary). The persisted serverMeta
// (servers.json) keeps these fields for restart, but the HTTP
// response shape must not expose them.
func TestServerMeta_toResponse_DoesNotLeakSensitiveFields(t *testing.T) {
	meta := &serverMeta{
		ID:           "srv_x",
		ProjectID:    "prj_x",
		Type:         "tomcat6",
		State:        "running",
		PID:          4321,
		StartedAt:    time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC),
		JavaHome:     "/secret/java/home",
		WebappDir:    "/secret/webapp/dir",
		CatalinaBase: "/secret/catalina/base",
		ContextPath:  "/app",
		LastError:    "",
		Ports: &tomcat6.Ports{
			HTTP:     18080,
			Shutdown: 18005,
			AJP:      18009,
			Debug:    18001,
		},
	}

	resp := meta.toResponse()
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	jsonStr := string(data)

	sensitiveValues := []string{
		"/secret/java/home",
		"/secret/webapp/dir",
		"/secret/catalina/base",
		"18005", // Shutdown
		"18009", // AJP
	}
	for _, s := range sensitiveValues {
		if strings.Contains(jsonStr, s) {
			t.Errorf("sensitive value %q leaked into JSON: %s", s, jsonStr)
		}
	}

	sensitiveKeys := []string{
		`"javaHome"`,
		`"webappDir"`,
		`"catalinaBase"`,
		`"shutdown"`,
		`"ajp"`,
	}
	for _, k := range sensitiveKeys {
		if strings.Contains(jsonStr, k) {
			t.Errorf("sensitive key %s appeared in JSON: %s", k, jsonStr)
		}
	}
}

// TestServerMeta_toResponse_SafeFieldsPresent verifies the safe
// fields the UI needs are present, including the derived URL.
func TestServerMeta_toResponse_SafeFieldsPresent(t *testing.T) {
	meta := &serverMeta{
		ID:          "srv_x",
		ProjectID:   "prj_x",
		Type:        "tomcat6",
		State:       "running",
		PID:         4321,
		StartedAt:   time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC),
		ContextPath: "/app",
		Ports: &tomcat6.Ports{
			HTTP:  18080,
			Debug: 18001,
		},
	}
	resp := meta.toResponse()
	if resp.ID != "srv_x" {
		t.Errorf("ID = %q", resp.ID)
	}
	if resp.Type != "tomcat6" {
		t.Errorf("Type = %q", resp.Type)
	}
	if resp.State != "running" {
		t.Errorf("State = %q", resp.State)
	}
	if resp.PID != 4321 {
		t.Errorf("PID = %d", resp.PID)
	}
	if resp.Ports == nil {
		t.Fatalf("Ports is nil")
	}
	if resp.Ports.HTTP != 18080 {
		t.Errorf("Ports.HTTP = %d", resp.Ports.HTTP)
	}
	if resp.Ports.Debug != 18001 {
		t.Errorf("Ports.Debug = %d", resp.Ports.Debug)
	}
	if resp.URL != "http://localhost:18080/app" {
		t.Errorf("URL = %q", resp.URL)
	}
}

// TestServerMeta_toResponse_NilMeta verifies that a nil serverMeta
// (deleted server) returns nil rather than panicking.
func TestServerMeta_toResponse_NilMeta(t *testing.T) {
	var meta *serverMeta
	if resp := meta.toResponse(); resp != nil {
		t.Errorf("expected nil response for nil meta, got %+v", resp)
	}
}

// TestServerMeta_toResponse_NilPorts verifies that a serverMeta
// with nil Ports (older record without ports) maps without panic
// and produces an empty URL.
func TestServerMeta_toResponse_NilPorts(t *testing.T) {
	meta := &serverMeta{
		ID:    "srv_x",
		State: "stopped",
	}
	resp := meta.toResponse()
	if resp.Ports != nil {
		t.Errorf("Ports = %+v, want nil", resp.Ports)
	}
	if resp.URL != "" {
		t.Errorf("URL = %q, want empty when Ports is nil", resp.URL)
	}
}
