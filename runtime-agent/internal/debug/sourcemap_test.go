package debug

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSourceMap_New(t *testing.T) {
	sm := NewSourceMap()
	if sm == nil {
		t.Fatal("expected non-nil SourceMap")
	}
	if sm.Count() != 0 {
		t.Errorf("expected 0 entries, got %d", sm.Count())
	}
}

func TestSourceMap_AddSourceRoot(t *testing.T) {
	sm := NewSourceMap()
	sm.AddSourceRoot("/tmp/src")
	sm.AddSourceRoot("/tmp/src2")

	sm.mu.RLock()
	if len(sm.sourceRoots) != 2 {
		t.Errorf("expected 2 source roots, got %d", len(sm.sourceRoots))
	}
	sm.mu.RUnlock()
}

func TestSourceMap_AddModule(t *testing.T) {
	sm := NewSourceMap()
	sm.AddModule("core", "/tmp/core/src/main/java")

	sm.mu.RLock()
	root, ok := sm.moduleRoots["core"]
	if !ok {
		t.Fatal("expected core module to be registered")
	}
	if root != "/tmp/core/src/main/java" {
		t.Errorf("expected /tmp/core/src/main/java, got %s", root)
	}
	if len(sm.sourceRoots) != 1 {
		t.Errorf("expected 1 source root, got %d", len(sm.sourceRoots))
	}
	sm.mu.RUnlock()
}

func TestSourceMap_AddClasspathRoot(t *testing.T) {
	sm := NewSourceMap()
	sm.AddClasspathRoot("/tmp/target/classes")

	sm.mu.RLock()
	if len(sm.classpathRoots) != 1 {
		t.Errorf("expected 1 classpath root, got %d", len(sm.classpathRoots))
	}
	sm.mu.RUnlock()
}

func TestSourceMap_AddJarSource(t *testing.T) {
	sm := NewSourceMap()
	sm.AddJarSource("my-lib.jar", "my-lib-sources.jar")

	sm.mu.RLock()
	src, ok := sm.jarSources["my-lib.jar"]
	if !ok {
		t.Fatal("expected jar source mapping")
	}
	if src != "my-lib-sources.jar" {
		t.Errorf("expected my-lib-sources.jar, got %s", src)
	}
	sm.mu.RUnlock()
}

func TestSourceMap_EnableDecompiler(t *testing.T) {
	sm := NewSourceMap()

	sm.EnableDecompiler(true)
	sm.mu.RLock()
	if !sm.decompilerEnabled {
		t.Error("expected decompiler to be enabled")
	}
	sm.mu.RUnlock()

	sm.EnableDecompiler(false)
	sm.mu.RLock()
	if sm.decompilerEnabled {
		t.Error("expected decompiler to be disabled")
	}
	sm.mu.RUnlock()
}

func TestSourceMap_ResolveSource_FromSourceRoots(t *testing.T) {
	tmpDir := t.TempDir()
	srcDir := filepath.Join(tmpDir, "src", "main", "java")
	os.MkdirAll(filepath.Join(srcDir, "com", "example"), 0755)

	// Create a source file
	srcFile := filepath.Join(srcDir, "com", "example", "Test.java")
	os.WriteFile(srcFile, []byte("package com.example;"), 0644)

	sm := NewSourceMap()
	sm.AddSourceRoot(srcDir)

	entry, err := sm.ResolveSource("com.example.Test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.SourcePath != srcFile {
		t.Errorf("expected %s, got %s", srcFile, entry.SourcePath)
	}
	if entry.IsDecompiled {
		t.Error("should not be decompiled")
	}
}

func TestSourceMap_ResolveSource_NotFound(t *testing.T) {
	sm := NewSourceMap()
	sm.EnableDecompiler(false)

	_, err := sm.ResolveSource("com.example.NonExistent")
	if err == nil {
		t.Error("expected error for nonexistent class")
	}
}

func TestSourceMap_ResolveSource_Cache(t *testing.T) {
	tmpDir := t.TempDir()
	srcDir := filepath.Join(tmpDir, "src")
	os.MkdirAll(filepath.Join(srcDir, "com", "example"), 0755)
	srcFile := filepath.Join(srcDir, "com", "example", "Test.java")
	os.WriteFile(srcFile, []byte(""), 0644)

	sm := NewSourceMap()
	sm.AddSourceRoot(srcDir)

	// First resolution
	entry, err := sm.ResolveSource("com.example.Test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Second resolution should come from cache
	entry2, err := sm.ResolveSource("com.example.Test")
	if err != nil {
		t.Fatalf("unexpected error on second call: %v", err)
	}
	if entry2.SourcePath != entry.SourcePath {
		t.Error("cache should return same entry")
	}
}

func TestSourceMap_GetSourcePath(t *testing.T) {
	tmpDir := t.TempDir()
	srcDir := filepath.Join(tmpDir, "src")
	os.MkdirAll(filepath.Join(srcDir, "com", "example"), 0755)
	srcFile := filepath.Join(srcDir, "com", "example", "Test.java")
	os.WriteFile(srcFile, []byte(""), 0644)

	sm := NewSourceMap()
	sm.AddSourceRoot(srcDir)

	path := sm.GetSourcePath("com.example.Test")
	if path != srcFile {
		t.Errorf("expected %s, got %s", srcFile, path)
	}

	path = sm.GetSourcePath("com.example.NonExistent")
	if path != "" {
		t.Errorf("expected empty string, got %s", path)
	}
}

func TestSourceMap_ListEntries(t *testing.T) {
	tmpDir := t.TempDir()
	srcDir := filepath.Join(tmpDir, "src")
	os.MkdirAll(filepath.Join(srcDir, "com", "example"), 0755)
	os.WriteFile(filepath.Join(srcDir, "com", "example", "A.java"), []byte(""), 0644)
	os.WriteFile(filepath.Join(srcDir, "com", "example", "B.java"), []byte(""), 0644)

	sm := NewSourceMap()
	sm.AddSourceRoot(srcDir)

	sm.ResolveSource("com.example.A")
	sm.ResolveSource("com.example.B")

	entries := sm.ListEntries()
	if len(entries) != 2 {
		t.Errorf("expected 2 entries, got %d", len(entries))
	}
}

func TestSourceMap_Clear(t *testing.T) {
	tmpDir := t.TempDir()
	srcDir := filepath.Join(tmpDir, "src")
	os.MkdirAll(filepath.Join(srcDir, "com", "example"), 0755)
	os.WriteFile(filepath.Join(srcDir, "com", "example", "Test.java"), []byte(""), 0644)

	sm := NewSourceMap()
	sm.AddSourceRoot(srcDir)
	sm.ResolveSource("com.example.Test")

	if sm.Count() != 1 {
		t.Errorf("expected 1 entry, got %d", sm.Count())
	}

	sm.Clear()
	if sm.Count() != 0 {
		t.Errorf("expected 0 entries after clear, got %d", sm.Count())
	}
}

// ── Path Conversion Tests ─────────────────────────────────────────

func TestClassToSourcePath(t *testing.T) {
	tests := []struct {
		className string
		expected  string
	}{
		{"com.example.MyClass", "com" + string(filepath.Separator) + "example" + string(filepath.Separator) + "MyClass.java"},
		{"com.example.Outer$Inner", "com" + string(filepath.Separator) + "example" + string(filepath.Separator) + "Outer.java"},
		{"Test", "Test.java"},
	}

	for _, tc := range tests {
		actual := classToSourcePath(tc.className)
		if actual != tc.expected {
			t.Errorf("classToSourcePath(%q) = %q, want %q", tc.className, actual, tc.expected)
		}
	}
}

func TestClassToClassPath(t *testing.T) {
	actual := classToClassPath("com.example.MyClass")
	expected := "com" + string(filepath.Separator) + "example" + string(filepath.Separator) + "MyClass.class"
	if actual != expected {
		t.Errorf("classToClassPath = %q, want %q", actual, expected)
	}
}

// ── Maven Module Detection Tests ──────────────────────────────────

func TestDetectMavenModules_NoPom(t *testing.T) {
	tmpDir := t.TempDir()
	layout, err := DetectMavenModules(tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(layout.Modules) != 0 {
		t.Errorf("expected 0 modules, got %d", len(layout.Modules))
	}
}

func TestDetectMavenModules_WithPom(t *testing.T) {
	tmpDir := t.TempDir()

	// Create root pom.xml
	os.WriteFile(filepath.Join(tmpDir, "pom.xml"), []byte("<project></project>"), 0644)

	// Create sub-modules
	coreDir := filepath.Join(tmpDir, "core")
	os.MkdirAll(filepath.Join(coreDir, "src", "main", "java"), 0755)
	os.WriteFile(filepath.Join(coreDir, "pom.xml"), []byte("<project></project>"), 0644)

	webappDir := filepath.Join(tmpDir, "webapp")
	os.MkdirAll(filepath.Join(webappDir, "src", "main", "java"), 0755)
	os.WriteFile(filepath.Join(webappDir, "pom.xml"), []byte("<project></project>"), 0644)

	layout, err := DetectMavenModules(tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(layout.Modules) != 2 {
		t.Errorf("expected 2 modules, got %d", len(layout.Modules))
	}

	// Check module names
	names := make(map[string]bool)
	for _, m := range layout.Modules {
		names[m.Name] = true
	}
	if !names["core"] || !names["webapp"] {
		t.Errorf("expected core and webapp modules, got %v", names)
	}
}

func TestDetectMavenModules_RootModule(t *testing.T) {
	tmpDir := t.TempDir()

	os.WriteFile(filepath.Join(tmpDir, "pom.xml"), []byte("<project></project>"), 0644)
	os.MkdirAll(filepath.Join(tmpDir, "src", "main", "java"), 0755)

	layout, err := DetectMavenModules(tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(layout.Modules) != 1 {
		t.Errorf("expected 1 module (root), got %d", len(layout.Modules))
	}
}

func TestPopulateSourceMap(t *testing.T) {
	sm := NewSourceMap()
	layout := &MavenModuleLayout{
		ProjectRoot: "/tmp/project",
		Modules: []MavenModule{
			{Name: "core", SourceRoot: "/tmp/project/core/src/main/java"},
			{Name: "webapp", SourceRoot: "/tmp/project/webapp/src/main/java"},
		},
	}

	PopulateSourceMap(sm, layout)

	sm.mu.RLock()
	if len(sm.moduleRoots) != 2 {
		t.Errorf("expected 2 modules, got %d", len(sm.moduleRoots))
	}
	if len(sm.sourceRoots) != 2 {
		t.Errorf("expected 2 source roots, got %d", len(sm.sourceRoots))
	}
	sm.mu.RUnlock()
}

// ── Decompiler Config Tests ───────────────────────────────────────

func TestDefaultDecompilerConfig(t *testing.T) {
	cfg := DefaultDecompilerConfig()
	if !cfg.Enabled {
		t.Error("default decompiler should be enabled")
	}
	if cfg.DecompilerName != "CFR" {
		t.Errorf("expected CFR, got %s", cfg.DecompilerName)
	}
}

func TestSourceMap_ApplyDecompilerConfig(t *testing.T) {
	sm := NewSourceMap()
	cfg := DecompilerConfig{Enabled: false, DecompilerName: "Procyon"}
	sm.ApplyDecompilerConfig(cfg)

	sm.mu.RLock()
	if sm.decompilerEnabled {
		t.Error("decompiler should be disabled")
	}
	sm.mu.RUnlock()
}