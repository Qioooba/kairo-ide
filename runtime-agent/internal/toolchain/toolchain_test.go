package toolchain

import (
	"path/filepath"
	"testing"
)

func TestDetect_CurrentJDK(t *testing.T) {
	// Use the JDK that the test runner was built with.
	home := javaHome()
	if home == "" {
		t.Skip("no JAVA_HOME")
	}
	tc, err := Detect(home)
	if err != nil {
		t.Fatal(err)
	}
	if tc.Home == "" || tc.Vendor == "" || tc.Version == "" {
		t.Errorf("missing fields: %+v", tc)
	}
	if !hasPrefix(tc.Fingerprint, "sha256:") {
		t.Errorf("fingerprint = %q, want sha256: prefix", tc.Fingerprint)
	}
	if tc.ID == "" {
		t.Error("id is empty")
	}
}

func TestRegistry_AddListRemove(t *testing.T) {
	dir := t.TempDir()
	r, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	tc := Toolchain{
		ID:          "test-jdk-1",
		Kind:        "jdk",
		Home:        "/tmp/jdk",
		Vendor:      "openjdk",
		Version:     "17.0.7",
		SourceLevels: []string{"1.8", "9", "11", "17"},
		Fingerprint: "sha256:abc",
	}
	if err := r.Add(tc); err != nil {
		t.Fatal(err)
	}
	got, ok := r.Get(tc.ID)
	if !ok || got.Version != "17.0.7" {
		t.Errorf("Get = %+v, ok = %v", got, ok)
	}
	if err := r.Remove(tc.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := r.Get(tc.ID); ok {
		t.Errorf("expected removed")
	}
}

func TestRegistry_Persists(t *testing.T) {
	dir := t.TempDir()
	r1, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := r1.Add(Toolchain{ID: "x", Kind: "jdk", Fingerprint: "sha256:abc", Version: "1.6.0"}); err != nil {
		t.Fatal(err)
	}
	r2, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := r2.Get("x"); !ok {
		t.Errorf("expected persisted entry")
	}
	_ = filepath.Join
}

func hasPrefix(s, p string) bool {
	if len(s) < len(p) {
		return false
	}
	return s[:len(p)] == p
}

// javaHome returns JAVA_HOME or a reasonable fallback for tests.
func javaHome() string {
	h := getenv("JAVA_HOME")
	if h != "" {
		return h
	}
	// Fall back to "java" on PATH and derive its home.
	javaPath := which("java")
	if javaPath == "" {
		return ""
	}
	// java is at <home>/bin/java
	return filepath.Dir(filepath.Dir(javaPath))
}
