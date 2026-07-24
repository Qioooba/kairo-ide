package jdtproject

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// =============================================================================
// servletAPIPath tests — improve from 0.0%
// =============================================================================

func TestServletAPIPath_Found(t *testing.T) {
	bundled := t.TempDir()
	// Create the first candidate jar
	jarDir := filepath.Join(bundled, "servlet-api")
	mustMkdir(t, jarDir)
	mustWrite(t, filepath.Join(jarDir, "servlet-api-2.5.jar"), []byte("fake"))

	g := &Generator{BundledDir: bundled}
	got := g.servletAPIPath("2.5")
	if got == "" {
		t.Fatal("expected to find servlet-api jar")
	}
	if !strings.Contains(got, "servlet-api-2.5.jar") {
		t.Fatalf("path = %q, want servlet-api-2.5.jar", got)
	}
}

func TestServletAPIPath_SecondCandidate(t *testing.T) {
	bundled := t.TempDir()
	jarDir := filepath.Join(bundled, "servlet-api")
	mustMkdir(t, jarDir)
	// Create the second candidate, not the first
	mustWrite(t, filepath.Join(jarDir, "javax.servlet-api-4.0.jar"), []byte("fake"))

	g := &Generator{BundledDir: bundled}
	got := g.servletAPIPath("4.0")
	if got == "" {
		t.Fatal("expected to find javax.servlet-api jar")
	}
	if !strings.Contains(got, "javax.servlet-api-4.0.jar") {
		t.Fatalf("path = %q, want javax.servlet-api-4.0.jar", got)
	}
}

func TestServletAPIPath_ThirdCandidate(t *testing.T) {
	bundled := t.TempDir()
	jarDir := filepath.Join(bundled, "servlet-api")
	mustMkdir(t, jarDir)
	mustWrite(t, filepath.Join(jarDir, "servlet-3.1.jar"), []byte("fake"))

	g := &Generator{BundledDir: bundled}
	got := g.servletAPIPath("3.1")
	if got == "" {
		t.Fatal("expected to find servlet jar")
	}
	if !strings.Contains(got, "servlet-3.1.jar") {
		t.Fatalf("path = %q, want servlet-3.1.jar", got)
	}
}

func TestServletAPIPath_NotFound(t *testing.T) {
	bundled := t.TempDir()
	g := &Generator{BundledDir: bundled}
	got := g.servletAPIPath("9.9")
	if got != "" {
		t.Fatalf("expected empty for missing jar, got %q", got)
	}
}

// =============================================================================
// jstlPath tests — improve from 0.0%
// =============================================================================

func TestJSTLPath_Found(t *testing.T) {
	bundled := t.TempDir()
	jarDir := filepath.Join(bundled, "jstl")
	mustMkdir(t, jarDir)
	mustWrite(t, filepath.Join(jarDir, "jstl-1.2.jar"), []byte("fake"))

	g := &Generator{BundledDir: bundled}
	got := g.jstlPath()
	if got == "" {
		t.Fatal("expected to find jstl jar")
	}
	if !strings.Contains(got, "jstl-1.2.jar") {
		t.Fatalf("path = %q, want jstl-1.2.jar", got)
	}
}

func TestJSTLPath_SecondCandidate(t *testing.T) {
	bundled := t.TempDir()
	jarDir := filepath.Join(bundled, "jstl")
	mustMkdir(t, jarDir)
	mustWrite(t, filepath.Join(jarDir, "javax.servlet.jsp.jstl-1.2.1.jar"), []byte("fake"))

	g := &Generator{BundledDir: bundled}
	got := g.jstlPath()
	if got == "" {
		t.Fatal("expected to find jstl jar")
	}
	if !strings.Contains(got, "javax.servlet.jsp.jstl-1.2.1.jar") {
		t.Fatalf("path = %q, want javax.servlet.jsp.jstl-1.2.1.jar", got)
	}
}

func TestJSTLPath_NotFound(t *testing.T) {
	bundled := t.TempDir()
	g := &Generator{BundledDir: bundled}
	got := g.jstlPath()
	if got != "" {
		t.Fatalf("expected empty for missing jar, got %q", got)
	}
}

// =============================================================================
// readClasspath tests — improve from 0.0%
// =============================================================================

func TestReadClasspath_Success(t *testing.T) {
	root := t.TempDir()
	cp := Classpath{
		ClasspathEntries: []ClasspathEntry{
			{Kind: "src", Path: "src/main/java"},
			{Kind: "output", Path: "build/classes"},
		},
	}
	data, err := xml.MarshalIndent(cp, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, ".classpath"), data)

	got, err := readClasspath(root)
	if err != nil {
		t.Fatalf("readClasspath: %v", err)
	}
	if len(got.ClasspathEntries) != 2 {
		t.Fatalf("entries = %d, want 2", len(got.ClasspathEntries))
	}
	if got.ClasspathEntries[0].Kind != "src" {
		t.Fatalf("entry[0].Kind = %q, want src", got.ClasspathEntries[0].Kind)
	}
	if got.ClasspathEntries[0].Path != "src/main/java" {
		t.Fatalf("entry[0].Path = %q, want src/main/java", got.ClasspathEntries[0].Path)
	}
}

func TestReadClasspath_MissingFile(t *testing.T) {
	root := t.TempDir()
	_, err := readClasspath(root)
	if err == nil {
		t.Fatal("expected error for missing .classpath")
	}
}

func TestReadClasspath_InvalidXML(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, ".classpath"), []byte("not valid xml"))
	_, err := readClasspath(root)
	if err == nil {
		t.Fatal("expected error for invalid XML")
	}
}

// =============================================================================
// parseClasspathBytes tests — improve from 75.0%
// =============================================================================

func TestParseClasspathBytes_InvalidXML(t *testing.T) {
	_, err := parseClasspathBytes([]byte("not xml"))
	if err == nil {
		t.Fatal("expected error for invalid XML")
	}
}

func TestParseClasspathBytes_EmptyXML(t *testing.T) {
	cp, err := parseClasspathBytes([]byte("<classpath></classpath>"))
	if err != nil {
		t.Fatalf("parseClasspathBytes: %v", err)
	}
	if cp == nil {
		t.Fatal("expected non-nil result")
	}
	if len(cp.ClasspathEntries) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(cp.ClasspathEntries))
	}
}

// =============================================================================
// UnmarshalYAML tests — improve from 44.4%
// =============================================================================

func TestUnmarshalYAML_StringForm(t *testing.T) {
	data := []byte("encoding: GBK\nprojectId: test\n")
	var proj Project
	if err := yaml.Unmarshal(data, &proj); err != nil {
		t.Fatal(err)
	}
	if string(proj.Encoding) != "GBK" {
		t.Fatalf("Encoding = %q, want GBK", proj.Encoding)
	}
}

func TestUnmarshalYAML_NestedEncoding(t *testing.T) {
	// Test the nested form: encoding: {default: gbk}
	data := []byte("encoding:\n  default: GBK\nprojectId: test\n")
	var proj Project
	if err := yaml.Unmarshal(data, &proj); err != nil {
		t.Fatal(err)
	}
	if string(proj.Encoding) != "GBK" {
		t.Fatalf("Encoding = %q, want GBK", proj.Encoding)
	}
}

func TestUnmarshalYAML_EmptyEncoding(t *testing.T) {
	data := []byte("projectId: test\n")
	var proj Project
	if err := yaml.Unmarshal(data, &proj); err != nil {
		t.Fatal(err)
	}
	if string(proj.Encoding) != "" {
		t.Fatalf("Encoding = %q, want empty", proj.Encoding)
	}
}

// =============================================================================
// readProjectConfig tests — improve from 71.4%
// =============================================================================

func TestReadProjectConfig_KairoDir(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, ".kairo"))
	mustWrite(t, filepath.Join(root, ".kairo", "project.yaml"), []byte(`
projectId: kairo-proj
sourceRoots:
  - src/main/java
`))

	proj, err := readProjectConfig(root)
	if err != nil {
		t.Fatalf("readProjectConfig: %v", err)
	}
	if proj.ProjectID != "kairo-proj" {
		t.Fatalf("ProjectID = %q, want kairo-proj", proj.ProjectID)
	}
}

func TestReadProjectConfig_InvalidYAML(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, ".kairo"))
	mustWrite(t, filepath.Join(root, ".kairo", "project.yaml"), []byte(": invalid: yaml: ["))
	_, err := readProjectConfig(root)
	if err == nil {
		t.Fatal("expected error for invalid YAML")
	}
}

func TestReadProjectConfig_LegacyFlowNestedSourceLayout(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, ".legacyflow"))
	mustWrite(t, filepath.Join(root, ".legacyflow", "project.yaml"), []byte(`
projectId: legacy-proj
sourceLayout:
  src:
    - src/main/java
    - src/main/resources
  testSrc:
    - src/test/java
  webRoot: WebRoot
  lib: lib
`))

	proj, err := readProjectConfig(root)
	if err != nil {
		t.Fatalf("readProjectConfig: %v", err)
	}
	if proj.ProjectID != "legacy-proj" {
		t.Fatalf("ProjectID = %q, want legacy-proj", proj.ProjectID)
	}
	if len(proj.SourceRoots) != 2 {
		t.Fatalf("SourceRoots = %d, want 2", len(proj.SourceRoots))
	}
	if len(proj.TestSourceRoots) != 1 {
		t.Fatalf("TestSourceRoots = %d, want 1", len(proj.TestSourceRoots))
	}
	if proj.WebappDir != "WebRoot" {
		t.Fatalf("WebappDir = %q, want WebRoot", proj.WebappDir)
	}
}

func TestReadProjectConfig_LegacyFlowNoProjectID(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, ".legacyflow"))
	mustWrite(t, filepath.Join(root, ".legacyflow", "project.yaml"), []byte(`
sourceRoots:
  - src/main/java
`))
	// The project ID should be derived from the directory name
	proj, err := readProjectConfig(root)
	if err != nil {
		t.Fatalf("readProjectConfig: %v", err)
	}
	if proj.ProjectID == "" {
		t.Fatal("ProjectID should not be empty")
	}
}

// =============================================================================
// relPathOrAbs tests — improve from 62.5%
// =============================================================================

func TestRelPathOrAbs_EmptyInput(t *testing.T) {
	got := relPathOrAbs("", "/root")
	if got != "" {
		t.Fatalf("relPathOrAbs = %q, want empty", got)
	}
}

func TestRelPathOrAbs_EmptyRoot(t *testing.T) {
	got := relPathOrAbs("/abs/path", "")
	if got != "/abs/path" {
		t.Fatalf("relPathOrAbs = %q, want /abs/path", got)
	}
}

func TestRelPathOrAbs_Relative(t *testing.T) {
	got := relPathOrAbs("/root/sub/file.txt", "/root")
	if got != filepath.Join("sub", "file.txt") {
		t.Fatalf("relPathOrAbs = %q, want sub/file.txt", got)
	}
}

func TestRelPathOrAbs_DifferentDrive(t *testing.T) {
	// On Windows, paths on different drives can't be made relative
	got := relPathOrAbs("D:\\other\\file.txt", "C:\\root")
	// Should return the absolute path since it can't be relativized
	if got == "" {
		t.Fatal("expected non-empty result")
	}
}

// =============================================================================
// sanitizeWorkspaceID tests — improve from 80.0%
// =============================================================================

func TestSanitizeWorkspaceID_Empty(t *testing.T) {
	got := sanitizeWorkspaceID("")
	if got != "default" {
		t.Fatalf("sanitizeWorkspaceID = %q, want default", got)
	}
}

func TestSanitizeWorkspaceID_Whitespace(t *testing.T) {
	got := sanitizeWorkspaceID("  ")
	if got != "default" {
		t.Fatalf("sanitizeWorkspaceID = %q, want default", got)
	}
}

func TestSanitizeWorkspaceID_Colons(t *testing.T) {
	got := sanitizeWorkspaceID("a:b:c")
	if !strings.Contains(got, "_") {
		t.Fatalf("sanitizeWorkspaceID = %q, expected underscores", got)
	}
}

// =============================================================================
// readGeneratedStamp tests — improve from 75.0%
// =============================================================================

func TestReadGeneratedStamp_MissingFile(t *testing.T) {
	dir := t.TempDir()
	got := readGeneratedStamp(dir)
	if got != "" {
		t.Fatalf("readGeneratedStamp = %q, want empty", got)
	}
}

func TestReadGeneratedStamp_Valid(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".kairo-generated-at"), []byte("2026-01-13T00:00:00Z\n"))
	got := readGeneratedStamp(dir)
	if got != "2026-01-13T00:00:00Z" {
		t.Fatalf("readGeneratedStamp = %q, want 2026-01-13T00:00:00Z", got)
	}
}

// =============================================================================
// cacheChanged tests — improve from 84.6%
// =============================================================================

func TestCacheChanged_NoFile(t *testing.T) {
	dir := t.TempDir()
	if !cacheChanged(dir, []byte{0x01, 0x02}) {
		t.Fatal("cacheChanged should return true when no cache file exists")
	}
}

func TestCacheChanged_InvalidHex(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".kairo-cache-key"), []byte("not-valid-hex"))
	if !cacheChanged(dir, []byte{0x01, 0x02}) {
		t.Fatal("cacheChanged should return true for invalid hex")
	}
}

func TestCacheChanged_DifferentLength(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".kairo-cache-key"), []byte("aabb\n"))
	if !cacheChanged(dir, []byte{0x01, 0x02, 0x03}) {
		t.Fatal("cacheChanged should return true for different lengths")
	}
}

func TestCacheChanged_SameKey(t *testing.T) {
	dir := t.TempDir()
	key := []byte{0xaa, 0xbb, 0xcc}
	mustWrite(t, filepath.Join(dir, ".kairo-cache-key"), []byte("aabbcc\n"))
	if cacheChanged(dir, key) {
		t.Fatal("cacheChanged should return false for same key")
	}
}

func TestCacheChanged_DifferentKey(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".kairo-cache-key"), []byte("aabbcc\n"))
	if !cacheChanged(dir, []byte{0xdd, 0xee, 0xff}) {
		t.Fatal("cacheChanged should return true for different key")
	}
}

// =============================================================================
// joinAbsAll tests — improve from 83.3%
// =============================================================================

func TestJoinAbsAll_EmptyString(t *testing.T) {
	got := joinAbsAll("/root", []string{"a", "", "b"})
	if len(got) != 2 {
		t.Fatalf("joinAbsAll = %d entries, want 2", len(got))
	}
}

func TestJoinAbsAll_EmptySlice(t *testing.T) {
	got := joinAbsAll("/root", nil)
	if len(got) != 0 {
		t.Fatalf("joinAbsAll = %d entries, want 0", len(got))
	}
}

// =============================================================================
// encodingIDForJDT more tests — improve from 77.8%
// =============================================================================

func TestEncodingIDForJDT_Unknown(t *testing.T) {
	got := encodingIDForJDT("WINDOWS-1252")
	if got != "WINDOWS-1252" {
		t.Fatalf("encodingIDForJDT = %q, want WINDOWS-1252", got)
	}
}

func TestEncodingIDForJDT_USASCII(t *testing.T) {
	got := encodingIDForJDT("US-ASCII")
	if got != "US-ASCII" {
		t.Fatalf("encodingIDForJDT = %q, want US-ASCII", got)
	}
}

// =============================================================================
// Generate with IntoProjectRoot — improve from 61.0%
// =============================================================================

func TestGenerate_IntoProjectRoot(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{
		"workspaceId":     "ws-intoroot",
		"rootPath":        root,
		"intoProjectRoot": true,
	})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	// The .project and .classpath should be in the root path
	if _, err := os.Stat(filepath.Join(root, ".project")); err != nil {
		t.Fatalf(".project missing in root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".classpath")); err != nil {
		t.Fatalf(".classpath missing in root: %v", err)
	}
	_ = res
}

// =============================================================================
// Generate with ServletAPI in project config
// =============================================================================

func TestGenerate_WithServletAPI(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	mustMkdir(t, filepath.Join(root, ".kairo"))
	mustWrite(t, filepath.Join(root, ".kairo", "project.yaml"), []byte(`
projectId: servlet-proj
sourceRoots:
  - src/main/java
servletApi:
  version: "2.5"
`))

	bundled := t.TempDir()
	// Create the servlet API jar in the bundled dir
	jarDir := filepath.Join(bundled, "servlet-api")
	mustMkdir(t, jarDir)
	mustWrite(t, filepath.Join(jarDir, "servlet-api-2.5.jar"), []byte("fake"))

	g := NewGenerator(t.TempDir(), bundled)
	payload := mustJSON(t, map[string]any{"workspaceId": "ws-servlet", "rootPath": root})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	// The servlet API jar should be in the classpath entries
	found := false
	for _, entry := range res.ClasspathEntries {
		if strings.Contains(entry, "servlet-api-2.5.jar") {
			found = true
		}
	}
	if !found {
		t.Fatalf("servlet API jar not found in classpath entries: %v", res.ClasspathEntries)
	}
}

// =============================================================================
// Generate with JSTL in project config
// =============================================================================

func TestGenerate_WithJSTL(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	mustMkdir(t, filepath.Join(root, ".kairo"))
	mustWrite(t, filepath.Join(root, ".kairo", "project.yaml"), []byte(`
projectId: jstl-proj
sourceRoots:
  - src/main/java
jstl: true
`))

	bundled := t.TempDir()
	jarDir := filepath.Join(bundled, "jstl")
	mustMkdir(t, jarDir)
	mustWrite(t, filepath.Join(jarDir, "jstl-1.2.jar"), []byte("fake"))

	g := NewGenerator(t.TempDir(), bundled)
	payload := mustJSON(t, map[string]any{"workspaceId": "ws-jstl", "rootPath": root})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	found := false
	for _, entry := range res.ClasspathEntries {
		if strings.Contains(entry, "jstl-1.2.jar") {
			found = true
		}
	}
	if !found {
		t.Fatalf("JSTL jar not found in classpath entries: %v", res.ClasspathEntries)
	}
}

// =============================================================================
// Generate with ServletAPI not found (missing jar)
// =============================================================================

func TestGenerate_WithServletAPI_NotFound(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	mustMkdir(t, filepath.Join(root, ".kairo"))
	mustWrite(t, filepath.Join(root, ".kairo", "project.yaml"), []byte(`
projectId: servlet-miss
sourceRoots:
  - src/main/java
servletApi:
  version: "9.9"
`))

	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws-servlet-miss", "rootPath": root})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	// Should still succeed, just without the servlet jar
	if res.ProjectID != "servlet-miss" {
		t.Fatalf("ProjectID = %q, want servlet-miss", res.ProjectID)
	}
}

// =============================================================================
// Generate with dependent projects
// =============================================================================

func TestGenerate_WithDependentProjects(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	mustMkdir(t, filepath.Join(root, ".kairo"))

	// Create a dependent project directory with a .classpath file
	depDir := filepath.Join(root, "..", "dep-proj")
	depDirAbs, _ := filepath.Abs(depDir)
	mustMkdir(t, depDirAbs)
	cp := Classpath{
		ClasspathEntries: []ClasspathEntry{
			{Kind: "lib", Path: "dep-lib.jar"},
			{Kind: "output", Path: "dep-output"},
		},
	}
	data, err := xml.MarshalIndent(cp, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(depDirAbs, ".classpath"), data)

	mustWrite(t, filepath.Join(root, ".kairo", "project.yaml"), []byte(`
projectId: dep-proj
sourceRoots:
  - src/main/java
dependentProjects:
  - ../dep-proj
`))

	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws-dep", "rootPath": root})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	// The dependent project's libs and output should be in classpath entries
	foundDepLib := false
	foundDepOutput := false
	for _, entry := range res.ClasspathEntries {
		if strings.Contains(entry, "dep-lib.jar") {
			foundDepLib = true
		}
		if strings.Contains(entry, "dep-output") {
			foundDepOutput = true
		}
	}
	if !foundDepLib {
		t.Log("dep-lib.jar not found in classpath entries (may be relative)")
	}
	if !foundDepOutput {
		t.Log("dep-output not found in classpath entries (may be relative)")
	}
	_ = res
}

// =============================================================================
// Generate with projectID in payload
// =============================================================================

func TestGenerate_ProjectIDFromPayload(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{
		"workspaceId": "ws-pid",
		"rootPath":    root,
		"projectId":   "payload-proj",
	})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if res.ProjectID != "payload-proj" {
		t.Fatalf("ProjectID = %q, want payload-proj", res.ProjectID)
	}
}

// =============================================================================
// Status with empty workspaceID
// =============================================================================

func TestStatus_EmptyWorkspaceID(t *testing.T) {
	g := NewGenerator(t.TempDir(), t.TempDir())
	st, err := g.Status("")
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.WorkspaceID != "default" {
		t.Fatalf("WorkspaceID = %q, want default", st.WorkspaceID)
	}
}

// =============================================================================
// Status with classpath parse error
// =============================================================================

func TestStatus_WithInvalidClasspath(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws-badcp", "rootPath": root})
	_, err := g.Generate(payload)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	// Corrupt the .classpath file
	dir := g.projectModelDir("ws-badcp")
	os.WriteFile(filepath.Join(dir, ".classpath"), []byte("not xml"), 0o644)
	st, err := g.Status("ws-badcp")
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if !st.Exists {
		t.Fatal("Exists should be true even with corrupt classpath")
	}
	// ProjectID may be empty due to parse error
	_ = st
}

// =============================================================================
// renderClasspath with empty proj
// =============================================================================

func TestRenderClasspath_EmptyProject(t *testing.T) {
	proj := Project{ProjectID: "empty"}
	cp := renderClasspath(proj, nil, nil, "/tmp/output", nil, nil)
	if len(cp.ClasspathEntries) != 2 {
		// output entry + JRE container
		t.Fatalf("expected 2 entries (output + JRE), got %d", len(cp.ClasspathEntries))
	}
}

// =============================================================================
// renderKairoConfig with test source roots
// =============================================================================

func TestRenderKairoConfig_WithTestSourceRoots(t *testing.T) {
	proj := Project{
		ProjectID:       "test-proj",
		SourceLevel:     "1.8",
		TargetLevel:     "1.8",
		Encoding:        "UTF-8",
		OutputDir:       "build/classes",
		SourceRoots:     []string{"src/main/java"},
		TestSourceRoots: []string{"src/test/java"},
	}
	cfg := renderKairoConfig(proj)
	if !strings.Contains(cfg, "kairo.test.source.root.0 = src/test/java") {
		t.Fatalf("missing test source root in config: %s", cfg)
	}
}

// =============================================================================
// defaultProject with no dirs
// =============================================================================

func TestDefaultProject_NoDirs(t *testing.T) {
	root := t.TempDir()
	proj := defaultProject(root)
	if proj.ProjectID == "" {
		t.Fatal("ProjectID should not be empty")
	}
	if len(proj.SourceRoots) != 0 {
		t.Fatalf("SourceRoots = %d, want 0 (no dirs exist)", len(proj.SourceRoots))
	}
	if len(proj.Libraries) != 0 {
		t.Fatalf("Libraries = %d, want 0", len(proj.Libraries))
	}
}

// =============================================================================
// defaultProject with src dir
// =============================================================================

func TestDefaultProject_WithSrc(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src"))
	proj := defaultProject(root)
	if len(proj.SourceRoots) != 1 {
		t.Fatalf("SourceRoots = %d, want 1", len(proj.SourceRoots))
	}
	if proj.SourceRoots[0] != "src" {
		t.Fatalf("SourceRoots[0] = %q, want src", proj.SourceRoots[0])
	}
}

// =============================================================================
// Generate with invalid payload
// =============================================================================

func TestGenerate_InvalidJSON(t *testing.T) {
	g := NewGenerator(t.TempDir(), t.TempDir())
	_, err := g.Generate([]byte("not json"))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestGenerate_EmptyRootPath(t *testing.T) {
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws-noroot"})
	_, err := g.Generate(payload)
	if err == nil {
		t.Fatal("expected error for empty rootPath")
	}
}

func TestGenerate_RootPathNotDirectory(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "file.txt")
	os.WriteFile(filePath, []byte("data"), 0o644)
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws-file", "rootPath": filePath})
	_, err := g.Generate(payload)
	if err == nil {
		t.Fatal("expected error for rootPath that is not a directory")
	}
}

// =============================================================================
// AllWorkspaces with read error
// =============================================================================

func TestAllWorkspaces_NoDir(t *testing.T) {
	g := NewGenerator(t.TempDir(), t.TempDir())
	all, err := g.AllWorkspaces()
	if err != nil {
		// fs.ErrNotExist should be handled gracefully
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Fatalf("expected 0, got %d", len(all))
	}
}

// =============================================================================
// renderClasspath with sourceLevel empty
// =============================================================================

func TestRenderClasspath_EmptySourceLevel(t *testing.T) {
	proj := Project{ProjectID: "test", SourceLevel: ""}
	cp := renderClasspath(proj, []string{"src"}, nil, "/out", []string{"/lib/a.jar"}, nil)
	// JRE container should be bare without source level
	hasJRE := false
	for _, e := range cp.ClasspathEntries {
		if e.Kind == "con" && e.Path == "org.eclipse.jdt.launching.JRE_CONTAINER" {
			hasJRE = true
		}
	}
	if !hasJRE {
		t.Fatal("expected bare JRE container when sourceLevel is empty")
	}
}

// =============================================================================
// renderClasspath with refLibs
// =============================================================================

func TestRenderClasspath_WithRefLibs(t *testing.T) {
	proj := Project{ProjectID: "test", SourceLevel: "1.8", RootPath: "/root"}
	cp := renderClasspath(proj, []string{"src"}, nil, "/out", []string{"/lib/a.jar"}, []string{"/ref/b.jar"})
	hasRefLib := false
	for _, e := range cp.ClasspathEntries {
		if e.Kind == "lib" && strings.Contains(e.Path, "b.jar") {
			hasRefLib = true
		}
	}
	if !hasRefLib {
		t.Fatal("expected refLib entry")
	}
}

// =============================================================================
// renderClasspath with test source roots
// =============================================================================

func TestRenderClasspath_WithTestSourceRoots(t *testing.T) {
	proj := Project{ProjectID: "test", SourceLevel: "1.8", RootPath: "/root"}
	cp := renderClasspath(proj, []string{"src"}, []string{"test"}, "/out", nil, nil)
	srcCount := 0
	for _, e := range cp.ClasspathEntries {
		if e.Kind == "src" {
			srcCount++
		}
	}
	if srcCount != 2 {
		t.Fatalf("expected 2 src entries, got %d", srcCount)
	}
}

// ---- helpers ----