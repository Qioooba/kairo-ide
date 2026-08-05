package jdkmanager

import (
	"os"
	"path/filepath"
	"strconv"
	"runtime"
	"testing"
)

func TestParseJavaVersion(t *testing.T) {
	tests := []struct {
		output  string
		version string
	}{
		{`openjdk version "17.0.9" 2023-10-17`, "17.0.9"},
		{`java version "1.8.0_391"`, "1.8.0_391"},
		{`openjdk version "21.0.1" 2023-10-17 LTS`, "21.0.1"},
		{`java version "11.0.21" 2023-10-17 LTS`, "11.0.21"},
		{`no version here`, ""},
		{``, ""},
	}
	for _, tc := range tests {
		v := parseJavaVersion(tc.output)
		if v != tc.version {
			t.Errorf("parseJavaVersion(%q) = %q, want %q", tc.output, v, tc.version)
		}
	}
}

func TestParseMajorVersion(t *testing.T) {
	tests := []struct {
		version string
		major   int
	}{
		{"17.0.9", 17},
		{"1.8.0_391", 8},
		{"21.0.1", 21},
		{"11.0.21", 11},
		{"1.7.0_80", 7},
		{"1.6.0_45", 6},
		{"", 0},
	}
	for _, tc := range tests {
		m := parseMajorVersion(tc.version)
		if m != tc.major {
			t.Errorf("parseMajorVersion(%q) = %d, want %d", tc.version, m, tc.major)
		}
	}
}

func TestNewManager(t *testing.T) {
	m := NewManager("/tmp/bundled")
	if m.BundledDir != "/tmp/bundled" {
		t.Errorf("BundledDir = %q, want /tmp/bundled", m.BundledDir)
	}
}

func TestGetBridgeJarPath(t *testing.T) {
	m := NewManager("/app/bundled")
	expected := filepath.Join("/", "app", "bundled", "kairo-jdi-bridge.jar")
	if m.GetBridgeJarPath() != expected {
		t.Errorf("GetBridgeJarPath() = %q, want %q", m.GetBridgeJarPath(), expected)
	}
}

func TestIsBridgeJarAvailable_NotExists(t *testing.T) {
	m := NewManager("/nonexistent/path")
	if m.IsBridgeJarAvailable() {
		t.Error("expected bridge jar not to be available")
	}
}

func TestIsBridgeJarAvailable_Exists(t *testing.T) {
	dir := t.TempDir()
	jarPath := filepath.Join(dir, "kairo-jdi-bridge.jar")
	if err := os.WriteFile(jarPath, []byte("dummy"), 0644); err != nil {
		t.Fatal(err)
	}
	m := NewManager(dir)
	if !m.IsBridgeJarAvailable() {
		t.Error("expected bridge jar to be available")
	}
}

func TestGetFullStatus(t *testing.T) {
	m := NewManager("/nonexistent/bundled")
	status := m.GetFullStatus()
	// Bridge jar should not be found at nonexistent path
	if status.BridgeJarFound {
		t.Error("expected bridge jar not to be found")
	}
	if status.BridgeJarPath == "" {
		t.Error("expected bridge jar path to be set")
	}
	if len(status.Limitations) == 0 {
		t.Error("expected limitations to be listed")
	}
	if status.Message == "" {
		t.Error("expected message to be set")
	}
}

func TestResolveJavaHome_BundledJDK(t *testing.T) {
	t.Setenv("JAVA_HOME", "")
	t.Setenv("KAIRO_JDK_HOME", "")
	t.Setenv("KAIRO_JDT_LS_JRE", "")

	bundledDir := t.TempDir()
	javaHome := filepath.Join(bundledDir, "jdk17")
	binDir := filepath.Join(javaHome, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}
	javaPath := filepath.Join(binDir, javaExe)
	if err := os.WriteFile(javaPath, []byte(createFakeJavaContent()), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := ResolveJavaHome(bundledDir)
	if err != nil {
		t.Fatalf("ResolveJavaHome: %v", err)
	}
	if got != javaHome {
		t.Errorf("ResolveJavaHome = %q, want %q", got, javaHome)
	}
}

func TestResolveJavaHome_NotFound(t *testing.T) {
	origPath := os.Getenv("PATH")
	origHome := os.Getenv("JAVA_HOME")
	origJdkHome := os.Getenv("KAIRO_JDK_HOME")
	origJre := os.Getenv("KAIRO_JDT_LS_JRE")
	origCommon := commonJDKPaths
	t.Cleanup(func() {
		os.Setenv("PATH", origPath)
		os.Setenv("JAVA_HOME", origHome)
		os.Setenv("KAIRO_JDK_HOME", origJdkHome)
		os.Setenv("KAIRO_JDT_LS_JRE", origJre)
		commonJDKPaths = origCommon
	})

	emptyDir := t.TempDir()
	t.Setenv("PATH", emptyDir)
	t.Setenv("JAVA_HOME", "")
	t.Setenv("KAIRO_JDK_HOME", "")
	t.Setenv("KAIRO_JDT_LS_JRE", "")
	commonJDKPaths = func() []string { return nil }

	_, err := ResolveJavaHome(t.TempDir())
	if err == nil {
		t.Fatal("expected error when no JDK is available")
	}
}

func TestDetect_NoJava(t *testing.T) {
	// Temporarily clear JAVA_HOME
	origHome := os.Getenv("JAVA_HOME")
	os.Unsetenv("JAVA_HOME")
	defer os.Setenv("JAVA_HOME", origHome)

	m := NewManager("/nonexistent/bundled")
	status := m.Detect()
	if status.Available {
		t.Log("Java found on PATH, this is fine")
	}
	// Just verify no panic
	_ = status.Message
}
func TestLoadPersistedJDKHomes(t *testing.T) {
	dir := t.TempDir()
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "java.exe"
	}
	home := filepath.Join(dir, "jdk21")
	bin := filepath.Join(home, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, javaExe), []byte("dummy"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfgPath := filepath.Join(dir, "host-jdk.json")
	payload := []byte(`{"javaHome":` + strconv.Quote(home) + `}`)
	if err := os.WriteFile(cfgPath, payload, 0o644); err != nil {
		t.Fatal(err)
	}

	t.Setenv("KAIRO_JDK_CONFIG", cfgPath)
	t.Setenv("KAIRO_DATA_DIR", "")
	t.Setenv("KAIRO_JDK_HOME", "")
	t.Setenv("JAVA_HOME", "")

	homes := loadPersistedJDKHomes()
	if len(homes) == 0 {
		t.Fatal("expected persisted JDK home")
	}
	if filepath.Clean(homes[0]) != filepath.Clean(home) {
		t.Fatalf("home = %q, want %q", homes[0], home)
	}

	got := readPersistedJDKHome(cfgPath)
	if filepath.Clean(got) != filepath.Clean(home) {
		t.Fatalf("readPersistedJDKHome = %q, want %q", got, home)
	}
	if readPersistedJDKHome(filepath.Join(dir, "missing.json")) != "" {
		t.Fatal("missing config should return empty")
	}
}
