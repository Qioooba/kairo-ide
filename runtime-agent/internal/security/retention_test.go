//go:build unwired

package security

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// ---- NewRetentionManager ----

func TestRetention_NewRetentionManager_WithPolicies(t *testing.T) {
	policies := []RetentionPolicy{
		{Name: "test", ResourceType: "logs", MaxAge: 24 * time.Hour},
	}
	m := NewRetentionManager(policies)
	if m == nil {
		t.Fatal("expected non-nil RetentionManager")
	}
	if len(m.ListPolicies()) != 1 {
		t.Errorf("expected 1 policy, got %d", len(m.ListPolicies()))
	}
}

func TestRetention_NewRetentionManager_NilDefaults(t *testing.T) {
	m := NewRetentionManager(nil)
	if m == nil {
		t.Fatal("expected non-nil RetentionManager")
	}
	policies := m.ListPolicies()
	if len(policies) != 4 {
		t.Errorf("expected 4 predefined policies, got %d", len(policies))
	}
}

// ---- Predefined policies ----

func TestRetention_PredefinedPolicies(t *testing.T) {
	policies := PredefinedRetentionPolicies()
	if len(policies) != 4 {
		t.Errorf("expected 4 predefined policies, got %d", len(policies))
	}
	types := map[string]bool{}
	for _, p := range policies {
		types[p.ResourceType] = true
	}
	for _, rt := range []string{"logs", "artifacts", "backups", "sessions"} {
		if !types[rt] {
			t.Errorf("expected policy for resource type %s", rt)
		}
	}
}

// ---- ShouldRetain ----

func TestRetention_ShouldRetain_WithinLimits(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	if !m.ShouldRetain("logs", 1*time.Hour, 1024) {
		t.Error("should retain logs within limits")
	}
}

func TestRetention_ShouldRetain_ExceedsAge(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	if m.ShouldRetain("logs", 60*24*time.Hour, 1024) {
		t.Error("should NOT retain logs exceeding max age (30 days)")
	}
}

func TestRetention_ShouldRetain_ExceedsSize(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	if m.ShouldRetain("logs", 1*time.Hour, 600*1024*1024) {
		t.Error("should NOT retain logs exceeding max size (500 MB)")
	}
}

func TestRetention_ShouldRetain_UnknownType(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	if !m.ShouldRetain("unknown-type", 1000*time.Hour, 100*1024*1024*1024) {
		t.Error("should retain unknown resource type (conservative default)")
	}
}

func TestRetention_ShouldRetain_NoMaxAgePolicy(t *testing.T) {
	policies := []RetentionPolicy{
		{Name: "nolimit", ResourceType: "data", MaxAge: 0, MaxSize: 0},
	}
	m := NewRetentionManager(policies)
	if !m.ShouldRetain("data", 1000*24*time.Hour, 10*1024*1024*1024) {
		t.Error("should retain when no limits are set")
	}
}

// ---- GetRetentionPolicy ----

func TestRetention_GetRetentionPolicy_Found(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	p := m.GetRetentionPolicy("logs")
	if p == nil {
		t.Fatal("expected policy for logs")
	}
	if p.ResourceType != "logs" {
		t.Errorf("expected resource type 'logs', got %s", p.ResourceType)
	}
}

func TestRetention_GetRetentionPolicy_NotFound(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	p := m.GetRetentionPolicy("nonexistent")
	if p != nil {
		t.Error("expected nil for unknown resource type")
	}
}

// ---- ListPolicies ----

func TestRetention_ListPolicies(t *testing.T) {
	policies := []RetentionPolicy{
		{Name: "a", ResourceType: "type-a"},
		{Name: "b", ResourceType: "type-b"},
	}
	m := NewRetentionManager(policies)
	list := m.ListPolicies()
	if len(list) != 2 {
		t.Errorf("expected 2 policies, got %d", len(list))
	}
	// Verify it's a copy
	list[0].Name = "modified"
	if m.ListPolicies()[0].Name == "modified" {
		t.Error("ListPolicies should return a copy")
	}
}

// ---- ApplyRetention ----

func TestRetention_ApplyRetention_DeletesExpiredLogs(t *testing.T) {
	dir := t.TempDir()

	// Create a log file
	logPath := filepath.Join(dir, "test.log")
	if err := os.WriteFile(logPath, []byte("log content"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Set modification time to 60 days ago
	oldTime := time.Now().Add(-60 * 24 * time.Hour)
	if err := os.Chtimes(logPath, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	policies := []RetentionPolicy{
		{
			Name:             "logs",
			MaxAge:           30 * 24 * time.Hour,
			ResourceType:     "logs",
			AutoCleanup:      true,
			ArchiveBeforeDelete: false,
		},
	}
	m := NewRetentionManager(policies)
	deleted, archived, err := m.ApplyRetention(dir)
	if err != nil {
		t.Fatalf("ApplyRetention failed: %v", err)
	}
	if deleted != 1 {
		t.Errorf("expected 1 deleted file, got %d", deleted)
	}
	if archived != 0 {
		t.Errorf("expected 0 archived, got %d", archived)
	}
}

func TestRetention_ApplyRetention_ArchivesBeforeDelete(t *testing.T) {
	dir := t.TempDir()

	logPath := filepath.Join(dir, "test.log")
	if err := os.WriteFile(logPath, []byte("log content"), 0o600); err != nil {
		t.Fatal(err)
	}

	oldTime := time.Now().Add(-60 * 24 * time.Hour)
	if err := os.Chtimes(logPath, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	policies := []RetentionPolicy{
		{
			Name:             "logs-archive",
			MaxAge:           30 * 24 * time.Hour,
			ResourceType:     "logs",
			AutoCleanup:      true,
			ArchiveBeforeDelete: true,
		},
	}
	m := NewRetentionManager(policies)
	_, archived, err := m.ApplyRetention(dir)
	if err != nil {
		t.Fatalf("ApplyRetention failed: %v", err)
	}
	if archived != 1 {
		t.Errorf("expected 1 archived file, got %d", archived)
	}
	// Verify archive exists
	archiveDir := filepath.Join(dir, "archive")
	entries, err := os.ReadDir(archiveDir)
	if err != nil {
		t.Fatalf("archive dir should exist: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("expected 1 file in archive, got %d", len(entries))
	}
}

func TestRetention_ApplyRetention_NoAutoCleanup(t *testing.T) {
	dir := t.TempDir()

	logPath := filepath.Join(dir, "test.log")
	if err := os.WriteFile(logPath, []byte("log content"), 0o600); err != nil {
		t.Fatal(err)
	}

	oldTime := time.Now().Add(-60 * 24 * time.Hour)
	if err := os.Chtimes(logPath, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	policies := []RetentionPolicy{
		{
			Name:             "logs-no-auto",
			MaxAge:           30 * 24 * time.Hour,
			ResourceType:     "logs",
			AutoCleanup:      false,
			ArchiveBeforeDelete: false,
		},
	}
	m := NewRetentionManager(policies)
	deleted, archived, err := m.ApplyRetention(dir)
	if err != nil {
		t.Fatalf("ApplyRetention failed: %v", err)
	}
	if deleted != 0 {
		t.Errorf("expected 0 deleted (no auto cleanup), got %d", deleted)
	}
	if archived != 0 {
		t.Errorf("expected 0 archived, got %d", archived)
	}
	// File should still exist
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Error("file should still exist when auto cleanup is disabled")
	}
}

func TestRetention_ApplyRetention_RecentFileRetained(t *testing.T) {
	dir := t.TempDir()

	logPath := filepath.Join(dir, "recent.log")
	if err := os.WriteFile(logPath, []byte("recent"), 0o600); err != nil {
		t.Fatal(err)
	}

	policies := []RetentionPolicy{
		{
			Name:             "logs",
			MaxAge:           30 * 24 * time.Hour,
			ResourceType:     "logs",
			AutoCleanup:      true,
			ArchiveBeforeDelete: false,
		},
	}
	m := NewRetentionManager(policies)
	deleted, _, err := m.ApplyRetention(dir)
	if err != nil {
		t.Fatalf("ApplyRetention failed: %v", err)
	}
	if deleted != 0 {
		t.Errorf("expected 0 deleted (recent file), got %d", deleted)
	}
}

func TestRetention_ApplyRetention_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	m := NewRetentionManager(PredefinedRetentionPolicies())
	deleted, archived, err := m.ApplyRetention(dir)
	if err != nil {
		t.Fatalf("ApplyRetention on empty dir should not error: %v", err)
	}
	if deleted != 0 || archived != 0 {
		t.Errorf("expected 0 deleted and 0 archived, got %d/%d", deleted, archived)
	}
}

func TestRetention_ApplyRetention_NonExistentDir(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	_, _, err := m.ApplyRetention("/nonexistent/path/12345")
	if err == nil {
		t.Error("expected error for non-existent directory")
	}
}

// ---- ApplyRetentionByType ----

func TestRetention_ApplyRetentionByType(t *testing.T) {
	dir := t.TempDir()

	// Create log file (old)
	logPath := filepath.Join(dir, "old.log")
	if err := os.WriteFile(logPath, []byte("old log"), 0o600); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-60 * 24 * time.Hour)
	os.Chtimes(logPath, oldTime, oldTime)

	// Create artifact file (old)
	artPath := filepath.Join(dir, "old.jar")
	if err := os.WriteFile(artPath, []byte("old artifact"), 0o600); err != nil {
		t.Fatal(err)
	}
	os.Chtimes(artPath, oldTime, oldTime)

	policies := []RetentionPolicy{
		{
			Name:             "logs",
			MaxAge:           30 * 24 * time.Hour,
			ResourceType:     "logs",
			AutoCleanup:      true,
			ArchiveBeforeDelete: false,
		},
		{
			Name:             "artifacts",
			MaxAge:           30 * 24 * time.Hour,
			ResourceType:     "artifacts",
			AutoCleanup:      true,
			ArchiveBeforeDelete: false,
		},
	}
	m := NewRetentionManager(policies)

	// Apply only to logs
	deleted, _, err := m.ApplyRetentionByType(dir, "logs")
	if err != nil {
		t.Fatalf("ApplyRetentionByType failed: %v", err)
	}
	if deleted != 1 {
		t.Errorf("expected 1 log deleted, got %d", deleted)
	}
	// Artifact should still exist
	if _, err := os.Stat(artPath); os.IsNotExist(err) {
		t.Error("artifact should still exist after log-only cleanup")
	}
}

func TestRetention_ApplyRetentionByType_UnknownType(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	_, _, err := m.ApplyRetentionByType(t.TempDir(), "unknown")
	if err == nil {
		t.Error("expected error for unknown resource type")
	}
}

// ---- classifyResourceType ----

func TestRetention_ClassifyResourceType(t *testing.T) {
	tests := []struct {
		name     string
		dir      string
		expected string
	}{
		{"app.log", "/tmp", "logs"},
		{"error.log", "/var/log", "logs"},
		{"backup.tar.gz", "/tmp", "backups"},
		{"data.zip", "/tmp", "backups"},
		{"db.backup", "/tmp", "backups"},
		{"app.war", "/tmp", "artifacts"},
		{"lib.jar", "/tmp", "artifacts"},
		{"app.ear", "/tmp", "artifacts"},
		{"user.session", "/tmp", "sessions"},
		{"random.txt", "/tmp", ""},
		{"data", "/tmp", ""},
	}
	for _, tt := range tests {
		got := classifyResourceType(tt.name, tt.dir)
		if got != tt.expected {
			t.Errorf("classifyResourceType(%q, %q) = %q, want %q", tt.name, tt.dir, got, tt.expected)
		}
	}
}

// ---- SortPolicies ----

func TestRetention_SortPoliciesByAge(t *testing.T) {
	policies := []RetentionPolicy{
		{Name: "long", MaxAge: 90 * 24 * time.Hour},
		{Name: "short", MaxAge: 7 * 24 * time.Hour},
		{Name: "medium", MaxAge: 30 * 24 * time.Hour},
	}
	SortPoliciesByAge(policies)
	if policies[0].Name != "short" {
		t.Errorf("expected 'short' first, got %s", policies[0].Name)
	}
	if policies[1].Name != "medium" {
		t.Errorf("expected 'medium' second, got %s", policies[1].Name)
	}
	if policies[2].Name != "long" {
		t.Errorf("expected 'long' third, got %s", policies[2].Name)
	}
}

func TestRetention_SortPoliciesBySize(t *testing.T) {
	policies := []RetentionPolicy{
		{Name: "large", MaxSize: 5 * 1024 * 1024 * 1024},
		{Name: "small", MaxSize: 100 * 1024 * 1024},
		{Name: "medium", MaxSize: 500 * 1024 * 1024},
	}
	SortPoliciesBySize(policies)
	if policies[0].Name != "small" {
		t.Errorf("expected 'small' first, got %s", policies[0].Name)
	}
	if policies[1].Name != "medium" {
		t.Errorf("expected 'medium' second, got %s", policies[1].Name)
	}
	if policies[2].Name != "large" {
		t.Errorf("expected 'large' third, got %s", policies[2].Name)
	}
}

// ---- Concurrent access ----

func TestRetention_ConcurrentAccess(t *testing.T) {
	m := NewRetentionManager(PredefinedRetentionPolicies())
	done := make(chan bool, 10)
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 50; j++ {
				m.ShouldRetain("logs", 1*time.Hour, 1024)
				m.GetRetentionPolicy("artifacts")
				m.ListPolicies()
			}
			done <- true
		}()
		go func() {
			for j := 0; j < 50; j++ {
				m.ShouldRetain("sessions", 1*time.Hour, 1024)
				m.GetRetentionPolicy("backups")
				m.ListPolicies()
			}
			done <- true
		}()
	}
	for i := 0; i < 10; i++ {
		<-done
	}
}