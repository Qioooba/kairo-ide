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
	for i := 1; i <= 6000; i++ {
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
	if entries[0].Line != "line-5501" || entries[len(entries)-1].Line != "line-6000" {
		t.Fatalf("unexpected tail window: first=%q last=%q", entries[0].Line, entries[len(entries)-1].Line)
	}
	if entries[0].TS == "" {
		t.Errorf("entries must carry a timestamp")
	}
	if entries[0].Source != "kairo-stdout.log" || entries[0].Ordinal >= entries[len(entries)-1].Ordinal {
		t.Fatalf("entries need stable source/ordinal identity: first=%#v last=%#v", entries[0], entries[len(entries)-1])
	}
	stableTimestamp := entries[0].TS
	repeated, err := r.Logs("srv_1", 0)
	if err != nil || repeated[0].TS != stableTimestamp || repeated[0].Ordinal != entries[0].Ordinal {
		t.Fatalf("unchanged polls must retain identity: first=%#v repeated=%#v err=%v", entries[0], repeated[0], err)
	}

	// Explicit tail wins.
	entries, err = r.Logs("srv_1", 10)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	if len(entries) != 10 || entries[0].Line != "line-5991" {
		t.Fatalf("tail=10 returned %d entries, first=%q", len(entries), entries[0].Line)
	}

	entries, err = r.Logs("srv_1", 999999)
	if err != nil || len(entries) != maxLogTail || entries[0].Line != "line-1001" {
		t.Fatalf("hard tail cap returned %d entries, first=%q, err=%v", len(entries), entries[0].Line, err)
	}
}

func TestServerLogs_BoundedLargeFileTailAndSkipsSymlinks(t *testing.T) {
	dataDir := t.TempDir()
	base := filepath.Join(dataDir, "runtime", "srv_1")
	logDir := filepath.Join(base, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatal(err)
	}
	large := strings.Repeat("discarded-prefix-data\n", 150000) + "[stdout] wanted-one\n[stderr] wanted-two\n"
	if err := os.WriteFile(filepath.Join(logDir, "kairo-stdout.log"), []byte(large), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(dataDir, "outside-secret.log")
	if err := os.WriteFile(outside, []byte("must-not-leak\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(logDir, "linked.log")); err != nil {
		t.Skipf("symlink unavailable on this platform: %v", err)
	}
	seedServerMeta(t, dataDir, &serverMeta{ID: "srv_1", State: "running", CatalinaBase: base})

	r := newRealServerRunner(dataDir, "", "", nil)
	entries, err := r.Logs("srv_1", 10)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	joined := make([]string, 0, len(entries))
	for _, entry := range entries {
		joined = append(joined, entry.Line)
	}
	output := strings.Join(joined, "\n")
	if strings.Contains(output, "must-not-leak") {
		t.Fatal("symlink target escaped the logs directory")
	}
	if !strings.Contains(output, "wanted-one\nwanted-two") {
		t.Fatalf("large-file tail missing final lines: %q", output)
	}
	if len(entries) < 2 || entries[len(entries)-2].Stream != "stdout" || entries[len(entries)-1].Stream != "stderr" {
		t.Fatalf("persisted stream markers were not retained: %#v", entries)
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
