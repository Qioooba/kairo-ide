package toolchain

import (
	"path/filepath"
	"strings"
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
		ID:           "test-jdk-1",
		Kind:         "jdk",
		Home:         "/tmp/jdk",
		Vendor:       "openjdk",
		Version:      "17.0.7",
		SourceLevels: []string{"1.8", "9", "11", "17"},
		Fingerprint:  "sha256:abc",
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

func TestRegistry_List(t *testing.T) {
	dir := t.TempDir()
	r, _ := NewRegistry(dir)
	_ = r.Add(Toolchain{ID: "a", Kind: "jdk", Fingerprint: "sha256:abc", Version: "1.0"})
	_ = r.Add(Toolchain{ID: "b", Kind: "jdk", Fingerprint: "sha256:def", Version: "2.0"})

	items := r.List()
	if len(items) != 2 {
		t.Errorf("List should return 2 items, got %d", len(items))
	}
}

func TestRegistry_List_Empty(t *testing.T) {
	dir := t.TempDir()
	r, _ := NewRegistry(dir)
	items := r.List()
	if len(items) != 0 {
		t.Errorf("List should return empty, got %d", len(items))
	}
}

func TestRegistry_Add_InvalidID(t *testing.T) {
	dir := t.TempDir()
	r, _ := NewRegistry(dir)
	err := r.Add(Toolchain{ID: "", Kind: "jdk", Fingerprint: "sha256:abc"})
	if err == nil {
		t.Error("expected error for empty ID")
	}
}

func TestRegistry_Add_InvalidFingerprint(t *testing.T) {
	dir := t.TempDir()
	r, _ := NewRegistry(dir)
	err := r.Add(Toolchain{ID: "x", Kind: "jdk", Fingerprint: "abc"})
	if err == nil {
		t.Error("expected error for invalid fingerprint")
	}
}

func TestRegistry_Remove_NotFound(t *testing.T) {
	dir := t.TempDir()
	r, _ := NewRegistry(dir)
	err := r.Remove("nonexistent")
	if err == nil {
		t.Error("expected error for removing nonexistent toolchain")
	}
}

func TestParseVendor_AllVendors(t *testing.T) {
	tests := []struct {
		line   string
		vendor string
	}{
		{`openjdk version "17.0.7"`, "openjdk"},
		{`java version "1.8.0_202" Java(TM) SE Runtime Environment`, "oracle"},
		{`java version "1.8.0" Java SE Runtime Environment`, "oracle"},
		{`IBM J9 VM (build 2.9)`, "ibm"},
		{`Zulu 11.0.1`, "azul"},
		{`Azul Systems JDK`, "azul"},
		{`Amazon Corretto-11.0.20`, "amazon"},
		{`Corretto JDK`, "amazon"},
		{`Eclipse Temurin JDK`, "adoptium"},
		{`Adoptium JDK`, "adoptium"},
		{`some random jdk`, "unknown"},
	}
	for _, tt := range tests {
		got := parseVendor(tt.line)
		if got != tt.vendor {
			t.Errorf("parseVendor(%q) = %q, want %q", tt.line, got, tt.vendor)
		}
	}
}

func TestParseVersion_NoMatch(t *testing.T) {
	version := parseVersion("no version here")
	if version != "" {
		t.Errorf("expected empty version, got %q", version)
	}
}

func TestFirstNonEmptyLine_Empty(t *testing.T) {
	line := firstNonEmptyLine([]byte("\n\n\n"))
	if line != "" {
		t.Errorf("expected empty line, got %q", line)
	}
}

func TestFirstNonEmptyLine_SpacesOnly(t *testing.T) {
	line := firstNonEmptyLine([]byte("   \n\t\n"))
	if line != "" {
		t.Errorf("expected empty line, got %q", line)
	}
}

func TestLocateBinary_NotFound(t *testing.T) {
	// Use a non-existent directory
	_, err := locateBinary("/nonexistent/jdk/path", "java")
	if err == nil {
		t.Error("expected error for non-existent path")
	}
}

func TestDetect_EmptyHome(t *testing.T) {
	_, err := Detect("")
	if err == nil {
		t.Error("expected error for empty home")
	}
}

func TestRunVersion_NoOutput(t *testing.T) {
	_, _, err := runVersion("nonexistent-java", "-version")
	if err == nil {
		t.Error("expected error for non-existent binary")
	}
}

func TestSanitize(t *testing.T) {
	tests := []struct {
		input, expected string
	}{
		{"Hello World", "hello-world"},
		{"JDK/17", "jdk-17"},
		{"simple", "simple"},
	}
	for _, tt := range tests {
		got := sanitize(tt.input)
		if got != tt.expected {
			t.Errorf("sanitize(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestBuildID(t *testing.T) {
	id := buildID("openjdk", "17.0.7", "abc123")
	if id == "" {
		t.Error("buildID should not be empty")
	}
	if !strings.HasPrefix(id, "openjdk-17.0.7-") {
		t.Errorf("buildID should have prefix, got %q", id)
	}
}

func hasPrefix(s, p string) bool {
	if len(s) < len(p) {
		return false
	}
	return s[:len(p)] == p
}

// javaHome returns JAVA_HOME or a reasonable fallback for tests.
// Priority: JAVA_HOME first (so the test environment can pin
// the JDK), then which java (which on Windows often resolves
// to a JRE stub redirector at Common Files\Oracle\Java\javapath).
func javaHome() string {
	if h := getenv("JAVA_HOME"); h != "" {
		return h
	}
	javaPath := which("java")
	if javaPath != "" {
		// java is at <home>/bin/java
		return filepath.Dir(filepath.Dir(javaPath))
	}
	return ""
}
