package diagnostics

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRedactor_RedactsPasswords(t *testing.T) {
	r := NewRedactor()

	tests := []struct {
		input    string
		contains string
		absent   string
	}{
		{
			input:    "password=secret123",
			contains: "[REDACTED]",
			absent:   "secret123",
		},
		{
			input:    "PASSWORD=myPass",
			contains: "[REDACTED]",
			absent:   "myPass",
		},
		{
			input:    "token=abc123def",
			contains: "[REDACTED]",
			absent:   "abc123def",
		},
		{
			input:    "API_KEY=sk-123456",
			contains: "[REDACTED]",
			absent:   "sk-123456",
		},
		{
			input:    "auth_token=secret-token",
			contains: "[REDACTED]",
			absent:   "secret-token",
		},
		{
			input:    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9",
			contains: "[REDACTED]",
		},
		{
			input:    "normal_field=hello_world",
			absent:   "[REDACTED]",
		},
		{
			input:    "jdbc:mysql://user:pass@localhost:3306/db",
			contains: "[REDACTED]",
		},
	}

	for _, tt := range tests {
		got := r.Apply(tt.input)
		if tt.absent != "" && strings.Contains(got, tt.absent) {
			t.Errorf("Redact(%q) = %q, should not contain %q", tt.input, got, tt.absent)
		}
		if tt.contains != "" && !strings.Contains(got, tt.contains) {
			t.Errorf("Redact(%q) = %q, should contain %q", tt.input, got, tt.contains)
		}
	}
}

func TestRedactor_RedactsPrivateKeys(t *testing.T) {
	r := NewRedactor()
	input := `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
-----END PRIVATE KEY-----`

	got := r.Apply(input)
	if strings.Contains(got, "MIIEvQIBADAN") {
		t.Errorf("Private key should be redacted")
	}
	if !strings.Contains(got, "[REDACTED]") {
		t.Errorf("Redacted private key should contain [REDACTED]")
	}
}

func TestBundleSizeLimit(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0-test")

	// Create a large amount of data
	largeData := strings.Repeat("x", 60*1024*1024) // 60 MB, exceeds 50 MB limit
	b.info.Logs.Agent = []string{largeData}

	ctx := context.Background()
	outputPath := filepath.Join(t.TempDir(), "test-bundle.zip")

	err := b.GenerateZip(ctx, outputPath)
	if err == nil {
		t.Error("Expected error for bundle exceeding size limit, got nil")
	}
	if !strings.Contains(err.Error(), "exceeds maximum") {
		t.Errorf("Expected size limit error, got: %v", err)
	}
}

func TestCollectionTimeout(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0-test")

	// Use a very short timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()

	// Give time for the context to expire
	time.Sleep(10 * time.Millisecond)

	err := b.Collect(ctx)
	if err == nil {
		// Collection may succeed if all commands are fast enough
		// But we just verify it doesn't panic
		t.Log("Collection completed (or timed out)")
	}

	// Verify the bundle is still in a valid state
	if b.info.OS.Arch == "" {
		t.Error("OS arch should be set")
	}
}

func TestGenerateZipPath(t *testing.T) {
	path := GenerateZipPath()
	if !strings.HasPrefix(path, "kairo-diag-") {
		t.Errorf("Path should start with kairo-diag-, got: %s", path)
	}
	if !strings.HasSuffix(path, ".zip") {
		t.Errorf("Path should end with .zip, got: %s", path)
	}
}

func TestNewDiagnosticBundle(t *testing.T) {
	b := NewDiagnosticBundle("2.0.0")
	if b.info.KairoVersion != "2.0.0" {
		t.Errorf("KairoVersion = %q, want 2.0.0", b.info.KairoVersion)
	}
	if b.info.AgentVersion != "2.0.0" {
		t.Errorf("AgentVersion = %q, want 2.0.0", b.info.AgentVersion)
	}
	if b.info.OS.Arch == "" {
		t.Error("OS arch should be set")
	}
}

func TestAddLogLines_Truncation(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	lines := make([]string, MaxLogLines+100)
	for i := range lines {
		lines[i] = "line"
	}
	b.AddLogLines(lines, nil, nil)

	if len(b.info.Logs.Agent) != MaxLogLines {
		t.Errorf("Expected %d log lines, got %d", MaxLogLines, len(b.info.Logs.Agent))
	}
}

func TestAddError_Truncation(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	for i := 0; i < MaxRecentErrors+10; i++ {
		b.AddError("test error")
	}
	if len(b.info.RecentErrors) != MaxRecentErrors {
		t.Errorf("Expected %d recent errors, got %d", MaxRecentErrors, len(b.info.RecentErrors))
	}
}

func TestEnvVarRedaction(t *testing.T) {
	// Set a test env var that looks like a password
	os.Setenv("TEST_DB_PASSWORD", "mysecretpassword")
	defer os.Unsetenv("TEST_DB_PASSWORD")

	b := NewDiagnosticBundle("1.0.0")
	b.collectEnvVars()

	if val, ok := b.info.EnvVars["TEST_DB_PASSWORD"]; ok {
		if val == "mysecretpassword" {
			t.Error("DB_PASSWORD should be redacted in env vars")
		}
		if val != "[REDACTED]" {
			t.Logf("Redacted value: %s", val)
		}
	}
}

func TestGenerateZip_EmptyBundle(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0-test")
	b.info.CollectedAt = time.Now().UTC().Format(time.RFC3339Nano)
	b.info.OS = OSInfo{Name: "test", Version: "1.0", Arch: "amd64"}

	ctx := context.Background()
	outputPath := filepath.Join(t.TempDir(), "empty-bundle.zip")

	err := b.GenerateZip(ctx, outputPath)
	if err != nil {
		t.Fatalf("GenerateZip failed: %v", err)
	}

	// Verify the file exists and has content
	info, err := os.Stat(outputPath)
	if err != nil {
		t.Fatalf("Output file not found: %v", err)
	}
	if info.Size() == 0 {
		t.Error("Output file is empty")
	}
}

func TestBundle_ConcurrentAccess(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0-test")

	done := make(chan bool)

	// Concurrent AddError calls
	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				b.AddError("concurrent error")
			}
			done <- true
		}()
	}

	// Concurrent SetWorkspaceConfig calls
	for i := 0; i < 10; i++ {
		go func() {
			b.SetWorkspaceConfig(map[string]string{"key": "value"})
			done <- true
		}()
	}

	for i := 0; i < 20; i++ {
		<-done
	}

	// No panic means success
	if len(b.info.RecentErrors) > MaxRecentErrors {
		t.Errorf("Errors exceeded max: %d", len(b.info.RecentErrors))
	}
}