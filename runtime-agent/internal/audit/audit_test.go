package audit

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAudit_AppendAndRead(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	evs := []Event{
		{Action: "file.write", Target: "a.txt", Result: "ok"},
		{Action: "file.read", Target: "a.txt", Result: "ok"},
		{Action: "login.failed", Result: "denied", Fields: map[string]any{"ip": "127.0.0.1"}},
	}
	for _, e := range evs {
		if err := l.Append(e); err != nil {
			t.Fatal(err)
		}
	}
	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Errorf("got %d events, want 3", len(got))
	}
	if got[0].Action != "file.write" || got[0].Result != "ok" {
		t.Errorf("event 0 = %+v", got[0])
	}
	if got[2].Result != "denied" {
		t.Errorf("event 2 = %+v", got[2])
	}
	if got[2].Fields["ip"] != "127.0.0.1" {
		t.Errorf("event 2 fields = %+v", got[2].Fields)
	}
}

// =============================================================================
// Append with nil log
// =============================================================================

func TestAudit_AppendNilLog(t *testing.T) {
	var l *Log
	err := l.Append(Event{Action: "test"})
	if err == nil {
		t.Fatal("expected error for nil log")
	}
}

// =============================================================================
// Append with empty defaults
// =============================================================================

func TestAudit_AppendDefaults(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	// Append with empty Ts, Level, Result
	e := Event{Action: "test"}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}
	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d events, want 1", len(got))
	}
	if got[0].Ts == "" {
		t.Error("expected non-empty Ts")
	}
	if got[0].Level != "info" {
		t.Errorf("expected default Level 'info', got %q", got[0].Level)
	}
	if got[0].Result != "ok" {
		t.Errorf("expected default Result 'ok', got %q", got[0].Result)
	}
}

// =============================================================================
// Close edge cases
// =============================================================================

func TestAudit_CloseNil(t *testing.T) {
	var l *Log
	if err := l.Close(); err != nil {
		t.Errorf("expected nil, got %v", err)
	}
}

func TestAudit_CloseTwice(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	// Second close may return an error on some platforms (file already closed)
	// The audit.Close handles nil l and nil l.f gracefully
	l.Close()
}

// =============================================================================
// Read with limit
// =============================================================================

func TestAudit_ReadLimit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	for i := 0; i < 5; i++ {
		l.Append(Event{Action: "test"})
	}
	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Errorf("got %d events, want 2", len(got))
	}
}

// =============================================================================
// Read from empty log
// =============================================================================

func TestAudit_ReadEmpty(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("got %d events, want 0", len(got))
	}
}

// =============================================================================
// New creates parent dirs
// =============================================================================

func TestAudit_NewCreatesDirs(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "sub", "deep", "logs")
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	if _, err := os.Stat(p); err != nil {
		t.Errorf("audit log file not created: %v", err)
	}
}

// =============================================================================
// Appending with all fields
// =============================================================================

func TestAudit_AppendFullEvent(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	e := Event{
		Ts:            "2024-01-01T00:00:00Z",
		Level:         "warn",
		Component:     "api",
		WorkspaceID:   "ws1",
		ProjectID:     "p1",
		RequestID:     "req1",
		CorrelationID: "corr1",
		UserID:        "user1",
		Action:        "file.write",
		Target:        "config.xml",
		Result:        "ok",
		Fields:        map[string]any{"size": 1024},
	}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}
	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d events, want 1", len(got))
	}
	if got[0].UserID != "user1" {
		t.Errorf("UserID = %q, want user1", got[0].UserID)
	}
	if got[0].Component != "api" {
		t.Errorf("Component = %q, want api", got[0].Component)
	}
	if got[0].Fields["size"] != float64(1024) {
		t.Errorf("Fields[size] = %v", got[0].Fields["size"])
	}
}

// =============================================================================
// Concurrent writes
// =============================================================================

func TestAudit_ConcurrentAppend(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	const goroutines = 10
	const eventsPer = 10
	done := make(chan bool, goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			for j := 0; j < eventsPer; j++ {
				l.Append(Event{Action: "test"})
			}
			done <- true
		}()
	}
	for i := 0; i < goroutines; i++ {
		<-done
	}

	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != goroutines*eventsPer {
		t.Errorf("got %d events, want %d", len(got), goroutines*eventsPer)
	}
}

// =============================================================================
// Event Category
// =============================================================================

func TestEventCategory_Values(t *testing.T) {
	categories := []EventCategory{
		CategoryCreate, CategoryRead, CategoryUpdate, CategoryDelete,
		CategoryAuthentication, CategoryConfiguration, CategoryDeployment,
		CategoryBuild, CategoryDebug, CategorySystem, CategorySecurity, CategoryNetwork,
	}
	for _, cat := range categories {
		if cat == "" {
			t.Error("event category should not be empty")
		}
	}
}

func TestAudit_AppendWithCategory(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	e := Event{
		Category: CategoryAuthentication,
		Action:   "login",
		Result:   "ok",
		UserID:   "admin",
	}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}

	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d events, want 1", len(got))
	}
	if got[0].Category != CategoryAuthentication {
		t.Errorf("Category = %q, want %q", got[0].Category, CategoryAuthentication)
	}
}

// =============================================================================
// Audit Log Signing
// =============================================================================

func TestAudit_Signing(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	key := []byte("test-signing-key-32-bytes-long!")

	l, err := New(p, WithSigningKey(key))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	e := Event{
		Category: CategoryCreate,
		Action:   "file.write",
		Target:   "test.txt",
		Result:   "ok",
		UserID:   "user1",
	}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}

	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d events, want 1", len(got))
	}
	if got[0].Signature == "" {
		t.Error("expected non-empty signature for signed event")
	}
}

func TestAudit_VerifySignature_Valid(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	key := []byte("test-signing-key-32-bytes-long!")

	l, err := New(p, WithSigningKey(key))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	e := Event{
		Category: CategoryCreate,
		Action:   "file.write",
		Target:   "test.txt",
		Result:   "ok",
		UserID:   "user1",
	}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}

	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}

	if !l.VerifySignature(got[0]) {
		t.Error("VerifySignature should return true for valid signature")
	}
}

func TestAudit_VerifySignature_Invalid(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	key := []byte("test-signing-key-32-bytes-long!")

	l, err := New(p, WithSigningKey(key))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	e := Event{
		Category: CategoryCreate,
		Action:   "file.write",
		Target:   "test.txt",
		Result:   "ok",
		UserID:   "user1",
	}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}

	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}

	// Tamper with the event
	got[0].Action = "tampered.action"

	if l.VerifySignature(got[0]) {
		t.Error("VerifySignature should return false for tampered event")
	}
}

func TestAudit_VerifySignature_NoSigning(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p) // No signing key
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	e := Event{Action: "test"}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}

	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}

	// Without signing key, VerifySignature returns true
	if !l.VerifySignature(got[0]) {
		t.Error("VerifySignature should return true when no signing key configured")
	}
}

func TestAudit_VerifySignature_EmptySignature(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	key := []byte("test-signing-key-32-bytes-long!")

	l, err := New(p, WithSigningKey(key))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	// An event with empty signature should fail verification
	e := Event{
		Category: CategoryCreate,
		Action:   "test",
		Signature: "",
	}
	if l.VerifySignature(e) {
		t.Error("VerifySignature should return false for empty signature when signing is configured")
	}
}

func TestAudit_DifferentKeysFail(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	key1 := []byte("test-signing-key-32-bytes-long!")
	key2 := []byte("different-signing-key-32-bytes!!")

	l1, err := New(p, WithSigningKey(key1))
	if err != nil {
		t.Fatal(err)
	}
	defer l1.Close()

	e := Event{
		Category: CategoryCreate,
		Action:   "file.write",
		Result:   "ok",
	}
	if err := l1.Append(e); err != nil {
		t.Fatal(err)
	}

	// Create a new log with different key and verify
	l2, err := New(p, WithSigningKey(key2))
	if err != nil {
		t.Fatal(err)
	}
	defer l2.Close()

	r, err := l2.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}

	if l2.VerifySignature(got[0]) {
		t.Error("VerifySignature should fail with different signing key")
	}
}

// =============================================================================
// CEF Format
// =============================================================================

func TestEvent_ToCEF(t *testing.T) {
	e := Event{
		Ts:        "2024-01-01T00:00:00Z",
		Level:     "warn",
		Category:  CategoryAuthentication,
		Component: "api",
		SourceIP:  "192.168.1.1",
		UserID:    "admin",
		Action:    "login.failed",
		Result:    "denied",
	}
	cef := e.ToCEF()

	if !strings.HasPrefix(cef, "CEF:0|") {
		t.Errorf("CEF should start with 'CEF:0|', got: %s", cef)
	}
	if !strings.Contains(cef, "login.failed") {
		t.Errorf("CEF should contain action name, got: %s", cef)
	}
	if !strings.Contains(cef, "suser=admin") {
		t.Errorf("CEF should contain suser=admin, got: %s", cef)
	}
	if !strings.Contains(cef, "outcome=denied") {
		t.Errorf("CEF should contain outcome=denied, got: %s", cef)
	}
}

func TestEvent_ToCEF_ErrorSeverity(t *testing.T) {
	e := Event{
		Level:  "error",
		Action: "deploy.failed",
	}
	cef := e.ToCEF()
	if !strings.Contains(cef, "|9|") {
		t.Errorf("CEF error severity should be 9, got: %s", cef)
	}
}

func TestEvent_ToCEF_InfoSeverity(t *testing.T) {
	e := Event{
		Level:  "info",
		Action: "file.read",
	}
	cef := e.ToCEF()
	if !strings.Contains(cef, "|1|") {
		t.Errorf("CEF info severity should be 1, got: %s", cef)
	}
}

func TestEvent_WriteCEF(t *testing.T) {
	e := Event{
		Level:  "info",
		Action: "test",
	}
	var buf bytes.Buffer
	if err := e.WriteCEF(&buf); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "CEF:") {
		t.Error("WriteCEF should produce CEF format")
	}
}

func TestEscapeCEFValue(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"simple", "simple"},
		{"key=value", "key\\=value"},
		{"path\\to\\file", "path\\\\to\\\\file"},
		{"a=b\\c", "a\\=b\\\\c"},
	}
	for _, tc := range tests {
		got := escapeCEFValue(tc.input)
		if got != tc.expected {
			t.Errorf("escapeCEFValue(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestMapLevelToCEFSeverity(t *testing.T) {
	tests := []struct {
		level    string
		expected string
	}{
		{"error", "9"},
		{"critical", "9"},
		{"warn", "5"},
		{"info", "1"},
		{"debug", "0"},
		{"", "0"},
	}
	for _, tc := range tests {
		got := mapLevelToCEFSeverity(tc.level)
		if got != tc.expected {
			t.Errorf("mapLevelToCEFSeverity(%q) = %q, want %q", tc.level, got, tc.expected)
		}
	}
}

// =============================================================================
// Log Rotation
// =============================================================================

func TestAudit_Rotation(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	// Small max size to trigger rotation quickly
	l, err := New(p, WithRotation(100, 3))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	// Write enough events to trigger rotation
	for i := 0; i < 20; i++ {
		e := Event{
			Action: "test",
			Fields: map[string]any{"data": "padding data to increase size of each event"},
		}
		if err := l.Append(e); err != nil {
			t.Fatal(err)
		}
	}

	// Check that rotated files exist
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	rotatedCount := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "audit.log.") {
			rotatedCount++
		}
	}
	if rotatedCount == 0 {
		t.Error("expected at least one rotated log file")
	}
}

func TestAudit_NoRotationWhenDisabled(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p) // No rotation configured
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	for i := 0; i < 50; i++ {
		l.Append(Event{Action: "test"})
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "audit.log.") {
			t.Error("should not have rotated files when rotation is disabled")
		}
	}
}

func TestAudit_CleanupBackups(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p, WithRotation(50, 2)) // Max 2 backups
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	// Write many events with padding to trigger multiple rotations
	for i := 0; i < 100; i++ {
		e := Event{
			Action: "test",
			Fields: map[string]any{"data": "padding data to increase size of each event significantly"},
		}
		l.Append(e)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	rotatedCount := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "audit.log.") {
			rotatedCount++
		}
	}
	// With max 2 backups, we should have at most 2 rotated files
	if rotatedCount > 2 {
		t.Errorf("expected at most 2 rotated files, got %d", rotatedCount)
	}
}

func TestAudit_ArchiveTo(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	archiveDir := filepath.Join(dir, "archive")

	l, err := New(p, WithRotation(80, 10))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	// Generate some rotated files
	for i := 0; i < 50; i++ {
		e := Event{
			Action: "test",
			Fields: map[string]any{"data": "padding data to increase size of each event significantly"},
		}
		l.Append(e)
	}

	// Archive
	if err := l.ArchiveTo(archiveDir); err != nil {
		t.Fatal(err)
	}

	// Verify archive directory has files
	archiveEntries, _ := os.ReadDir(archiveDir)
	if len(archiveEntries) == 0 {
		t.Error("archive directory should have files")
	}
}

// =============================================================================
// Compliance Report
// =============================================================================

func TestAudit_GenerateComplianceReport(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	events := []Event{
		{Category: CategoryCreate, Action: "file.create", Component: "api", Result: "ok", UserID: "user1"},
		{Category: CategoryRead, Action: "file.read", Component: "api", Result: "ok", UserID: "user1"},
		{Category: CategoryUpdate, Action: "file.update", Component: "api", Result: "ok", UserID: "user1"},
		{Category: CategoryDelete, Action: "file.delete", Component: "api", Result: "ok", UserID: "user1"},
		{Category: CategoryAuthentication, Action: "login.failed", Component: "auth", Result: "denied", UserID: "attacker"},
		{Category: CategoryConfiguration, Action: "config.update", Component: "config", Result: "error", UserID: "admin"},
	}

	for _, e := range events {
		l.Append(e)
	}

	report, err := l.GenerateComplianceReport()
	if err != nil {
		t.Fatal(err)
	}

	if report.TotalEvents != 6 {
		t.Errorf("TotalEvents = %d, want 6", report.TotalEvents)
	}
	if report.ByCategory[CategoryCreate] != 1 {
		t.Errorf("CategoryCreate = %d, want 1", report.ByCategory[CategoryCreate])
	}
	if report.ByResult["denied"] != 1 {
		t.Errorf("ByResult[denied] = %d, want 1", report.ByResult["denied"])
	}
	if report.ByResult["error"] != 1 {
		t.Errorf("ByResult[error] = %d, want 1", report.ByResult["error"])
	}
	if len(report.DeniedEvents) != 1 {
		t.Errorf("DeniedEvents = %d, want 1", len(report.DeniedEvents))
	}
	if len(report.ErrorEvents) != 1 {
		t.Errorf("ErrorEvents = %d, want 1", len(report.ErrorEvents))
	}
	if report.PeriodStart == "" || report.PeriodEnd == "" {
		t.Error("PeriodStart and PeriodEnd should not be empty")
	}
}

func TestAudit_GenerateComplianceReport_Empty(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	report, err := l.GenerateComplianceReport()
	if err != nil {
		t.Fatal(err)
	}

	if report.TotalEvents != 0 {
		t.Errorf("TotalEvents = %d, want 0", report.TotalEvents)
	}
	if report.PeriodStart != "" || report.PeriodEnd != "" {
		t.Error("PeriodStart and PeriodEnd should be empty for empty log")
	}
}

func TestAudit_GenerateComplianceReport_IntegrityCheck(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	key := []byte("test-signing-key-32-bytes-long!")

	l, err := New(p, WithSigningKey(key))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	for i := 0; i < 5; i++ {
		l.Append(Event{
			Category: CategoryCreate,
			Action:   "test",
			Result:   "ok",
		})
	}

	report, err := l.GenerateComplianceReport()
	if err != nil {
		t.Fatal(err)
	}

	if report.Integrity.TotalChecked != 5 {
		t.Errorf("Integrity.TotalChecked = %d, want 5", report.Integrity.TotalChecked)
	}
	if report.Integrity.Passed != 5 {
		t.Errorf("Integrity.Passed = %d, want 5", report.Integrity.Passed)
	}
	if !report.Integrity.Intact {
		t.Error("Integrity.Intact should be true for signed events")
	}
	if report.Integrity.Failed != 0 {
		t.Errorf("Integrity.Failed = %d, want 0", report.Integrity.Failed)
	}
}

func TestAudit_WriteComplianceReportJSON(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	l.Append(Event{Category: CategoryCreate, Action: "test", Result: "ok"})

	var buf bytes.Buffer
	if err := l.WriteComplianceReportJSON(&buf); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `"totalEvents"`) {
		t.Error("JSON report should contain totalEvents")
	}
	if !strings.Contains(buf.String(), `"byCategory"`) {
		t.Error("JSON report should contain byCategory")
	}
}

// =============================================================================
// Log Options
// =============================================================================

func TestAudit_WithSigningKey(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	key := []byte("test-signing-key-32-bytes-long!")

	l, err := New(p, WithSigningKey(key))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	if len(l.signingKey) == 0 {
		t.Error("signingKey should be set")
	}
}

func TestAudit_WithRotation(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p, WithRotation(1024*1024, 5))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	if l.maxSize != 1024*1024 {
		t.Errorf("maxSize = %d, want 1048576", l.maxSize)
	}
	if l.maxBackups != 5 {
		t.Errorf("maxBackups = %d, want 5", l.maxBackups)
	}
}

func TestAudit_Path(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	if l.Path() != p {
		t.Errorf("Path() = %q, want %q", l.Path(), p)
	}

	var nilLog *Log
	if nilLog.Path() != "" {
		t.Error("Path() on nil Log should return empty string")
	}
}

func TestAudit_Sync(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	if err := l.Sync(); err != nil {
		t.Errorf("Sync() should not error: %v", err)
	}

	var nilLog *Log
	if err := nilLog.Sync(); err != nil {
		t.Errorf("Sync() on nil Log should not error: %v", err)
	}
}

// =============================================================================
// SourceIP field
// =============================================================================

func TestAudit_AppendWithSourceIP(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")

	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	e := Event{
		Category: CategoryNetwork,
		Action:   "ws.connect",
		SourceIP: "10.0.0.1",
		Result:   "ok",
	}
	if err := l.Append(e); err != nil {
		t.Fatal(err)
	}

	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(1)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].SourceIP != "10.0.0.1" {
		t.Errorf("SourceIP = %q, want 10.0.0.1", got[0].SourceIP)
	}
}
