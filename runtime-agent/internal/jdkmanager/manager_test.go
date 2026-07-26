package jdkmanager

import (
	"os"
	"path/filepath"
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