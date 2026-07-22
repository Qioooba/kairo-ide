package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// seedServerMeta persists a serverMeta record into the runner's
// dataDir so a freshly constructed runner loads it from disk.
func seedServerMeta(t *testing.T, dataDir string, m *serverMeta) {
	t.Helper()
	data, err := json.Marshal([]*serverMeta{m})
	if err != nil {
		t.Fatalf("marshal meta: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "servers.json"), data, 0o600); err != nil {
		t.Fatalf("write servers.json: %v", err)
	}
}

// TestServerLogs_TailsKairoStdoutLog verifies that Logs returns the
// tail of <catalinaBase>/logs/kairo-stdout.log for a server that is
// not currently running (the file is the source of truth).
func TestServerLogs_TailsKairoStdoutLog(t *testing.T) {
	dataDir := t.TempDir()
	base := filepath.Join(dataDir, "runtime", "srv_1")
	if err := os.MkdirAll(filepath.Join(base, "logs"), 0o755); err != nil {
		t.Fatal(err)
	}
	var sb strings.Builder
	for i := 1; i <= 600; i++ {
		sb.WriteString("line-" + strconv.Itoa(i) + "\n")
	}
	if err := os.WriteFile(filepath.Join(base, "logs", "kairo-stdout.log"), []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	seedServerMeta(t, dataDir, &serverMeta{ID: "srv_1", State: "stopped", CatalinaBase: base})

	r := newRealServerRunner(dataDir, "", "", nil)

	// Default tail: last 500 lines.
	entries, err := r.Logs("srv_1", 0)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	if len(entries) != 500 {
		t.Fatalf("default tail returned %d entries, want 500", len(entries))
	}
	if entries[0].Line != "line-101" || entries[len(entries)-1].Line != "line-600" {
		t.Fatalf("unexpected tail window: first=%q last=%q", entries[0].Line, entries[len(entries)-1].Line)
	}
	if entries[0].TS == "" {
		t.Errorf("entries must carry a timestamp")
	}

	// Explicit tail wins.
	entries, err = r.Logs("srv_1", 10)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	if len(entries) != 10 || entries[0].Line != "line-591" {
		t.Fatalf("tail=10 returned %d entries, first=%q", len(entries), entries[0].Line)
	}
}

// TestServerLogs_NoLogFileYet verifies that a missing log file
// yields an empty slice, not an error (the server may not have
// produced output yet).
func TestServerLogs_NoLogFileYet(t *testing.T) {
	dataDir := t.TempDir()
	base := filepath.Join(dataDir, "runtime", "srv_1")
	seedServerMeta(t, dataDir, &serverMeta{ID: "srv_1", State: "running", CatalinaBase: base})

	r := newRealServerRunner(dataDir, "", "", nil)
	entries, err := r.Logs("srv_1", 0)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected empty entries, got %d", len(entries))
	}

	// Unknown server is still an error.
	if _, err := r.Logs("srv_nope", 0); err == nil {
		t.Fatalf("expected error for unknown server")
	}
}

// TestServerRestart_NotFound verifies the error surface without a
// real Tomcat: unknown IDs and records without restart metadata
// must fail before any process work happens.
func TestServerRestart_NotFound(t *testing.T) {
	dataDir := t.TempDir()
	r := newRealServerRunner(dataDir, "", "", nil)
	if _, err := r.Restart("srv_nope"); err == nil {
		t.Fatalf("expected error for unknown server")
	} else if !strings.HasPrefix(err.Error(), "server not found") {
		t.Fatalf("unexpected error: %v", err)
	}

	seedServerMeta(t, dataDir, &serverMeta{ID: "srv_1", State: "stopped"})
	r2 := newRealServerRunner(dataDir, "", "", nil)
	if _, err := r2.Restart("srv_1"); err == nil {
		t.Fatalf("expected error for missing restart metadata")
	}
}
