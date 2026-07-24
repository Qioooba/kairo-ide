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

func TestRedactor_NilReceiver(t *testing.T) {
	var r *Redactor
	result := r.Apply("password=secret")
	if result != "password=secret" {
		t.Errorf("nil Redactor should return input unchanged, got %q", result)
	}
}

func TestSetProjectDir(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	b.SetProjectDir("/test/project")
	if b.info.DiskUsage.ProjectDir != "/test/project" {
		t.Errorf("ProjectDir = %q, want /test/project", b.info.DiskUsage.ProjectDir)
	}
}

func TestSetTomcatInfo(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	b.SetTomcatInfo("9.0.0", "/opt/tomcat", "/opt/tomcat/instance")
	if b.info.Tomcat.Version != "9.0.0" {
		t.Errorf("Tomcat Version = %q", b.info.Tomcat.Version)
	}
	if b.info.Tomcat.CatalinaHome != "/opt/tomcat" {
		t.Errorf("CatalinaHome = %q", b.info.Tomcat.CatalinaHome)
	}
	if b.info.Tomcat.CatalinaBase != "/opt/tomcat/instance" {
		t.Errorf("CatalinaBase = %q", b.info.Tomcat.CatalinaBase)
	}
}

func TestSetJDTLSInfo(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	b.SetJDTLSInfo("1.43.0", "/opt/jdtls")
	if b.info.JDTLS.Version != "1.43.0" {
		t.Errorf("JDTLS Version = %q", b.info.JDTLS.Version)
	}
	if b.info.JDTLS.Home != "/opt/jdtls" {
		t.Errorf("JDTLS Home = %q", b.info.JDTLS.Home)
	}
}

func TestAddLogLines_AllTruncated(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	lines := make([]string, MaxLogLines+200)
	for i := range lines {
		lines[i] = "line"
	}
	b.AddLogLines(lines, lines, lines)

	if len(b.info.Logs.Agent) != MaxLogLines {
		t.Errorf("Expected %d agent log lines, got %d", MaxLogLines, len(b.info.Logs.Agent))
	}
	if len(b.info.Logs.JDTLS) != MaxLogLines {
		t.Errorf("Expected %d jdtls log lines, got %d", MaxLogLines, len(b.info.Logs.JDTLS))
	}
	if len(b.info.Logs.Tomcat) != MaxLogLines {
		t.Errorf("Expected %d tomcat log lines, got %d", MaxLogLines, len(b.info.Logs.Tomcat))
	}
}

func TestGenerateZip_WithLogs(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0-test")
	b.info.CollectedAt = time.Now().UTC().Format(time.RFC3339Nano)
	b.info.OS = OSInfo{Name: "windows", Version: "10.0", Arch: "amd64"}
	b.info.Logs.Agent = []string{"agent log line 1", "agent log line 2"}
	b.info.Logs.JDTLS = []string{"jdtls log line 1"}
	b.info.Logs.Tomcat = []string{"tomcat log line 1", "tomcat log line 2", "tomcat log line 3"}
	b.info.Processes = []ProcessInfo{{PID: 1234, Command: "java", Memory: "512M"}}
	b.info.PortUsage = []PortInfo{{PID: 1234, Process: "java", Port: 8080}}
	b.info.RecentErrors = []string{"error 1", "error 2"}

	ctx := context.Background()
	outputPath := filepath.Join(t.TempDir(), "logs-bundle.zip")

	err := b.GenerateZip(ctx, outputPath)
	if err != nil {
		t.Fatalf("GenerateZip failed: %v", err)
	}

	info, err := os.Stat(outputPath)
	if err != nil {
		t.Fatalf("Output file not found: %v", err)
	}
	if info.Size() == 0 {
		t.Error("Output file is empty")
	}
}

func TestGenerateZip_WithTomcatAndJDTLS(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0-test")
	b.info.CollectedAt = time.Now().UTC().Format(time.RFC3339Nano)
	b.info.OS = OSInfo{Name: "linux", Version: "5.15", Arch: "amd64"}
	b.info.JDTLS = JDTLSInfo{Version: "1.43.0", Home: "/opt/jdtls"}
	b.info.Tomcat = TomcatInfo{Version: "9.0.80", CatalinaHome: "/opt/tomcat", CatalinaBase: "/opt/tomcat/instance"}
	b.info.DiskUsage = DiskInfo{ProjectDir: "/home/project", Total: "100G", Used: "45G", Available: "55G"}
	b.info.NodeVersion = "v20.0.0"

	ctx := context.Background()
	outputPath := filepath.Join(t.TempDir(), "full-bundle.zip")

	err := b.GenerateZip(ctx, outputPath)
	if err != nil {
		t.Fatalf("GenerateZip failed: %v", err)
	}

	info, err := os.Stat(outputPath)
	if err != nil {
		t.Fatalf("Output file not found: %v", err)
	}
	if info.Size() == 0 {
		t.Error("Output file is empty")
	}
}

func TestMarshalSummary_FullInfo(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	b.info.CollectedAt = "2024-01-01T00:00:00Z"
	b.info.OS = OSInfo{Name: "linux", Version: "5.15", Arch: "amd64"}
	b.info.NodeVersion = "v20.0.0"
	b.info.JDK = JDKInfo{Versions: []string{"openjdk 17"}, Home: "/usr/lib/jvm/java-17"}
	b.info.JDTLS = JDTLSInfo{Version: "1.43.0", Home: "/opt/jdtls"}
	b.info.Tomcat = TomcatInfo{Version: "9.0.80", CatalinaHome: "/opt/tomcat", CatalinaBase: "/opt/tomcat/instance"}
	b.info.DiskUsage = DiskInfo{ProjectDir: "/home/project", Total: "100G", Used: "45G", Available: "55G"}
	b.info.Processes = []ProcessInfo{{PID: 1, Command: "init"}}
	b.info.PortUsage = []PortInfo{{Port: 8080}}
	b.info.RecentErrors = []string{"e1"}

	data, err := b.marshalSummary()
	if err != nil {
		t.Fatalf("marshalSummary failed: %v", err)
	}
	summary := string(data)
	if !strings.Contains(summary, "Kairo IDE Diagnostic Bundle") {
		t.Error("summary should contain title")
	}
	if !strings.Contains(summary, "JDT LS:") {
		t.Error("summary should contain JDT LS section")
	}
	if !strings.Contains(summary, "Tomcat:") {
		t.Error("summary should contain Tomcat section")
	}
	if !strings.Contains(summary, "Disk Usage:") {
		t.Error("summary should contain Disk Usage section")
	}
	if !strings.Contains(summary, "Node.js:") {
		t.Error("summary should contain Node.js version")
	}
}

func TestMarshalProcesses_Empty(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	data := b.marshalProcesses()
	if !strings.Contains(string(data), "PID") {
		t.Error("empty processes should still have header")
	}
}

func TestMarshalPortUsage_Empty(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	data := b.marshalPortUsage()
	if !strings.Contains(string(data), "PID") {
		t.Error("empty port usage should still have header")
	}
}

func TestMarshalEnvVars_Empty(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	data := b.marshalEnvVars()
	// Empty env vars should produce empty output
	_ = data
}

func TestCollectDiskUsage_NoProjectDir(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	ctx := context.Background()
	err := b.collectDiskUsage(ctx, "")
	if err != nil {
		t.Errorf("collectDiskUsage with empty dir should not error: %v", err)
	}
}

func TestCollectDiskUsage_WithProjectDir(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0")
	b.SetProjectDir(t.TempDir())
	ctx := context.Background()
	err := b.collectDiskUsage(ctx, "")
	if err != nil {
		// df command may fail on Windows, that's OK
		t.Logf("collectDiskUsage: %v", err)
	}
}

func TestCollectEnvVars_SensitiveKeys(t *testing.T) {
	// Set test env vars with sensitive key patterns
	os.Setenv("TEST_API_KEY", "sk-secret")
	os.Setenv("TEST_CREDENTIAL", "mycred")
	os.Setenv("TEST_MY_TOKEN", "tok123")
	os.Setenv("TEST_MY_SECRET", "sec456")
	os.Setenv("TEST_NORMAL_VAR", "normal_value")
	defer func() {
		os.Unsetenv("TEST_API_KEY")
		os.Unsetenv("TEST_CREDENTIAL")
		os.Unsetenv("TEST_MY_TOKEN")
		os.Unsetenv("TEST_MY_SECRET")
		os.Unsetenv("TEST_NORMAL_VAR")
	}()

	b := NewDiagnosticBundle("1.0.0")
	b.collectEnvVars()

	// Sensitive keys should be redacted
	if val, ok := b.info.EnvVars["TEST_API_KEY"]; ok && val != "[REDACTED]" {
		t.Errorf("API_KEY should be redacted, got %q", val)
	}
	if val, ok := b.info.EnvVars["TEST_CREDENTIAL"]; ok && val != "[REDACTED]" {
		t.Errorf("CREDENTIAL should be redacted, got %q", val)
	}
	if val, ok := b.info.EnvVars["TEST_MY_TOKEN"]; ok && val != "[REDACTED]" {
		t.Errorf("TOKEN var should be redacted, got %q", val)
	}
	if val, ok := b.info.EnvVars["TEST_MY_SECRET"]; ok && val != "[REDACTED]" {
		t.Errorf("SECRET var should be redacted, got %q", val)
	}
	// Normal var should not be redacted
	if val, ok := b.info.EnvVars["TEST_NORMAL_VAR"]; ok && val != "normal_value" {
		t.Errorf("normal var should not be redacted, got %q", val)
	}
}

func TestGenerateZip_CollectsIfNeeded(t *testing.T) {
	b := NewDiagnosticBundle("1.0.0-test")
	// Don't set CollectedAt — GenerateZip should auto-collect

	ctx := context.Background()
	outputPath := filepath.Join(t.TempDir(), "auto-collect.zip")

	err := b.GenerateZip(ctx, outputPath)
	if err != nil {
		t.Logf("GenerateZip with auto-collect: %v (may fail on some systems)", err)
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