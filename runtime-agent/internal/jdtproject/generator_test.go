package jdtproject

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGenerator_DefaultProject_FromLegacySample(t *testing.T) {
	// Build a directory tree that looks like legacy-sample.
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	mustMkdir(t, filepath.Join(root, "src", "main", "resources"))
	mustMkdir(t, filepath.Join(root, "WebRoot", "WEB-INF", "lib"))
	mustWrite(t, filepath.Join(root, "lib", "javax.servlet-api-4.0.1.jar"), []byte("x"))
	mustWrite(t, filepath.Join(root, "WebRoot", "WEB-INF", "lib", "jstl-1.2.jar"), []byte("x"))

	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws1", "rootPath": root})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	if res.ProjectID == "" {
		t.Fatal("ProjectID empty")
	}
	if !strings.Contains(strings.Join(res.SourceRoots, ","), filepath.Join(root, "src", "main", "java")) {
		t.Fatalf("SourceRoots missing src/main/java: %v", res.SourceRoots)
	}
	if !strings.Contains(strings.Join(res.ClasspathEntries, ","), "javax.servlet-api-4.0.1.jar") {
		t.Fatalf("ClasspathEntries missing lib jar: %v", res.ClasspathEntries)
	}
	for _, p := range []string{res.ProjectModel, res.Classpath} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("missing file on disk: %s err=%v", p, err)
		}
	}
}

func TestGenerator_YAMLOverride(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	mustMkdir(t, filepath.Join(root, ".legacyflow"))
	mustWrite(t, filepath.Join(root, ".legacyflow", "project.yaml"), []byte(`
projectId: my-legacy-web
name: My Legacy Web
encoding: GBK
sourceLevel: "1.6"
targetLevel: "1.6"
sourceRoots:
  - src/main/java
testSourceRoots: []
outputDir: build/classes
webappDir: WebRoot
libraries:
  - lib/javax.servlet-api-4.0.1.jar
referencedLibraries:
  - WebRoot/WEB-INF/lib/jstl-1.2.jar
jstl: false
`))

	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws2", "rootPath": root})
	res, err := g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	if res.ProjectID != "my-legacy-web" {
		t.Fatalf("ProjectID = %q, want my-legacy-web", res.ProjectID)
	}
	if res.Encoding != "GBK" {
		t.Fatalf("Encoding = %q, want GBK", res.Encoding)
	}
	if res.SourceLevel != "1.6" {
		t.Fatalf("SourceLevel = %q, want 1.6", res.SourceLevel)
	}
	cpBytes, err := os.ReadFile(res.Classpath)
	if err != nil {
		t.Fatal(err)
	}
	var cp Classpath
	if err := xml.Unmarshal(cpBytes, &cp); err != nil {
		t.Fatalf("classpath not valid XML: %v\n%s", err, string(cpBytes))
	}
	if len(cp.ClasspathEntries) == 0 {
		t.Fatal("classpath has no entries")
	}
	hasSrc := false
	hasLib := false
	for _, e := range cp.ClasspathEntries {
		// src entries are relative to the project location
		// (Eclipse convention; absolute src paths are invalid).
		if e.Kind == "src" && filepath.Clean(e.Path) == filepath.Join("src", "main", "java") {
			hasSrc = true
		}
		if e.Kind == "lib" && (filepath.Base(e.Path) == "javax.servlet-api-4.0.1.jar" ||
			filepath.Base(e.SourcePath) == "javax.servlet-api-4.0.1.jar") {
			hasLib = true
		}
	}
	if !hasSrc {
		t.Fatalf("classpath missing src entry: %s", string(cpBytes))
	}
	if !hasLib {
		t.Fatalf("classpath missing lib entry: %s", string(cpBytes))
	}
}

func TestGenerator_CacheHitOnSecondCall(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws3", "rootPath": root})
	r1, err := g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	if r1.FromCache {
		t.Fatal("first call should not be from cache")
	}
	r2, err := g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	if !r2.FromCache {
		t.Fatal("second call should be from cache")
	}
	if r1.ProjectModel != r2.ProjectModel {
		t.Fatalf("project model path changed: %q -> %q", r1.ProjectModel, r2.ProjectModel)
	}
}

func TestGenerator_CacheInvalidatedOnConfigChange(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	mustMkdir(t, filepath.Join(root, ".legacyflow"))
	mustWrite(t, filepath.Join(root, ".legacyflow", "project.yaml"),
		[]byte("projectId: foo\nsourceRoots: [src/main/java]\n"))
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws4", "rootPath": root})
	r1, err := g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	if r1.FromCache {
		t.Fatal("first call should not be from cache")
	}
	mustWrite(t, filepath.Join(root, ".legacyflow", "project.yaml"),
		[]byte("projectId: foo\nsourceRoots: [src/main/java, src/main/resources]\n"))
	mustMkdir(t, filepath.Join(root, "src", "main", "resources"))
	r2, err := g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	if r2.FromCache {
		t.Fatal("second call should NOT be from cache after config change")
	}
}

func TestGenerator_StatusReportsExistence(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	g := NewGenerator(t.TempDir(), t.TempDir())
	st, err := g.Status("nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if st.Exists {
		t.Fatal("Exists should be false for unknown workspace")
	}
	payload := mustJSON(t, map[string]any{"workspaceId": "ws5", "rootPath": root})
	_, err = g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	st, err = g.Status("ws5")
	if err != nil {
		t.Fatal(err)
	}
	if !st.Exists {
		t.Fatal("Exists should be true after generation")
	}
	if st.GeneratedAt == "" {
		t.Fatal("GeneratedAt should be set")
	}
}

func TestGenerator_Invalidate(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "src", "main", "java"))
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{"workspaceId": "ws6", "rootPath": root})
	_, err := g.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.Invalidate("ws6"); err != nil {
		t.Fatal(err)
	}
	st, err := g.Status("ws6")
	if err != nil {
		t.Fatal(err)
	}
	if st.Exists {
		t.Fatal("Exists should be false after Invalidate")
	}
}

func TestGenerator_AllWorkspaces(t *testing.T) {
	g := NewGenerator(t.TempDir(), t.TempDir())
	all, err := g.AllWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Fatalf("expected 0, got %d", len(all))
	}
	for _, ws := range []string{"a", "b"} {
		root := t.TempDir()
		mustMkdir(t, filepath.Join(root, "src", "main", "java"))
		payload := mustJSON(t, map[string]any{"workspaceId": ws, "rootPath": root})
		if _, err := g.Generate(payload); err != nil {
			t.Fatal(err)
		}
	}
	all, _ = g.AllWorkspaces()
	if len(all) != 2 {
		t.Fatalf("expected 2, got %d", len(all))
	}
}

func TestGenerator_RejectsBadRootPath(t *testing.T) {
	g := NewGenerator(t.TempDir(), t.TempDir())
	payload := mustJSON(t, map[string]any{
		"workspaceId": "ws7",
		"rootPath":    "/this/does/not/exist",
	})
	_, err := g.Generate(payload)
	if err == nil {
		t.Fatal("expected error for missing rootPath")
	}
}

func TestEncodingIDForJDT(t *testing.T) {
	cases := map[string]string{
		"UTF-8":      "UTF-8",
		"utf-8":      "UTF-8",
		"utf8":       "UTF-8",
		"GBK":        "GBK",
		"gb18030":    "GBK",
		"GB18030":    "GBK",
		"ISO-8859-1": "ISO-8859-1",
		"":           "UTF-8",
	}
	for in, want := range cases {
		got := encodingIDForJDT(in)
		if got != want {
			t.Errorf("encodingIDForJDT(%q) = %q, want %q", in, got, want)
		}
	}
}

// ---- helpers ----

func mustMkdir(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, p string, body []byte) {
	t.Helper()
	mustMkdir(t, filepath.Dir(p))
	if err := os.WriteFile(p, body, 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := jsonMarshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
