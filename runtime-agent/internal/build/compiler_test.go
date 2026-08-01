package build

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCompilerTimeoutTerminatesManagedProcessTree(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell fixture; Windows tree termination is covered by proc_windows tests")
	}
	javaHome := t.TempDir()
	binDir := filepath.Join(javaHome, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	javac := filepath.Join(binDir, "javac")
	if err := os.WriteFile(javac, []byte("#!/bin/sh\nsleep 30 &\nwait\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	source := filepath.Join(project, "Slow.java")
	if err := os.WriteFile(source, []byte("class Slow {}"), 0o600); err != nil {
		t.Fatal(err)
	}

	started := time.Now()
	_, err := New(javaHome).Compile(context.Background(), Request{
		ProjectRoot: project,
		Sources:     []string{source},
		Timeout:     150 * time.Millisecond,
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Compile error = %v, want deadline exceeded", err)
	}
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Fatalf("timeout took %s; compiler process tree was not stopped promptly", elapsed)
	}
}

func TestJavacArgFileThresholdAndEscaping(t *testing.T) {
	root := t.TempDir()
	sources := make([]string, 60)
	for i := range sources {
		sources[i] = filepath.Join(root, `src folder`, `A"B.java`)
	}
	if runtime.GOOS == "windows" && !shouldUseJavacArgFile(nil, sources) {
		t.Fatal("Windows builds with many sources must use an argfile")
	}
	name, err := writeJavacArgFile(root, sources[:1])
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(name)
	info, err := os.Stat(name)
	if err != nil {
		t.Fatal(err)
	}
	// On Windows, os.FileMode permission bits are not enforced the same way
	// as on Unix. Skip the strict permission check on Windows.
	if runtime.GOOS != "windows" {
		if info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("argfile permissions = %o, want owner-only", info.Mode().Perm())
		}
	}
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(data), `"`) || !strings.Contains(string(data), `\"`) {
		t.Fatalf("argfile path is not safely quoted: %q", data)
	}
}

// TestCompiler_RealJavac uses the system javac to compile a
// trivial Hello.java. Skipped if no javac on PATH.
func TestCompiler_RealJavac(t *testing.T) {
	javac := whichJavac(t)
	if javac == "" {
		t.Skip("no javac on PATH")
	}
	javaHome := filepath.Dir(filepath.Dir(javac))

	dir := t.TempDir()
	src := filepath.Join(dir, "Hello.java")
	if err := os.WriteFile(src, []byte(`
public class Hello {
    public static void main(String[] args) {
        System.out.println("hi");
    }
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "out")
	if err := os.Mkdir(out, 0o755); err != nil {
		t.Fatal(err)
	}

	c := New(javaHome)
	res, err := c.Compile(context.Background(), Request{
		ProjectRoot: dir,
		Toolchain:   javaHome,
		SourceLevel: "8",
		TargetLevel: "8",
		Sources:     []string{src},
		OutputDir:   out,
		Timeout:     60 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Success {
		t.Errorf("compile failed: %s", res.Output)
	}
	if _, err := os.Stat(filepath.Join(out, "Hello.class")); err != nil {
		t.Errorf("class not produced: %v", err)
	}
}

// TestParseDiagnostics_English covers the standard English javac
// output for errors and warnings.
func TestParseDiagnostics_English(t *testing.T) {
	out := `src/main/java/com/example/App.java:10: error: cannot find symbol
  symbol:   variable foo
  location: class com.example.App
src/main/java/com/example/App.java:15: warning: [deprecation] oldMethod() in com.example.App has been deprecated
1 error
1 warning
`
	diags := parseDiagnostics(out, "/proj")
	if len(diags) != 2 {
		t.Fatalf("expected 2 diagnostics, got %d: %#v", len(diags), diags)
	}
	if diags[0].Severity != "error" || diags[0].Line != 10 {
		t.Errorf("unexpected first diagnostic: %#v", diags[0])
	}
	if diags[0].File != filepath.Join("/proj", "src/main/java/com/example/App.java") {
		t.Errorf("unexpected file: %q", diags[0].File)
	}
	if !strings.Contains(diags[0].Message, "cannot find symbol") ||
		!strings.Contains(diags[0].Message, "symbol:") {
		t.Errorf("continuation lines not folded into message: %q", diags[0].Message)
	}
	if diags[1].Severity != "warning" || diags[1].Line != 15 {
		t.Errorf("unexpected second diagnostic: %#v", diags[1])
	}
}

// TestParseDiagnostics_Chinese covers javac output under a
// Chinese-locale JDK (错误/警告 markers, both ASCII and fullwidth
// colons). The <path>.java:<line>: prefix must still be parsed and
// severities normalized to error/warning.
func TestParseDiagnostics_Chinese(t *testing.T) {
	out := `src\main\java\com\example\App.java:10: 错误: 找不到符号
  符号:   变量 foo
  位置: 类 com.example.App
src\main\java\com\example\App.java:15: 警告: [deprecation] 已过时
src\main\java\com\example\App.java:20: 错误：缺少方法主体
1 个错误
1 个警告
`
	diags := parseDiagnostics(out, `C:\proj`)
	if len(diags) != 3 {
		t.Fatalf("expected 3 diagnostics, got %d: %#v", len(diags), diags)
	}
	if diags[0].Severity != "error" || diags[0].Line != 10 {
		t.Errorf("unexpected first diagnostic: %#v", diags[0])
	}
	if !strings.Contains(diags[0].Message, "找不到符号") ||
		!strings.Contains(diags[0].Message, "符号:") {
		t.Errorf("Chinese continuation lines not folded: %q", diags[0].Message)
	}
	if diags[1].Severity != "warning" || diags[1].Line != 15 {
		t.Errorf("unexpected second diagnostic: %#v", diags[1])
	}
	// Fullwidth colon after 错误 must also parse.
	if diags[2].Severity != "error" || diags[2].Line != 20 {
		t.Errorf("unexpected third diagnostic: %#v", diags[2])
	}
	if !strings.Contains(diags[2].Message, "缺少方法主体") {
		t.Errorf("unexpected message: %q", diags[2].Message)
	}
}

func whichJavac(t *testing.T) string {
	t.Helper()
	for _, p := range []string{"javac", "/usr/bin/javac", "/opt/homebrew/opt/openjdk@21/bin/javac"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// Try JAVA_HOME.
	if h := os.Getenv("JAVA_HOME"); h != "" {
		p := filepath.Join(h, "bin", "javac")
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func TestNewCompiler(t *testing.T) {
	c := New("/path/to/jdk")
	if c == nil {
		t.Fatal("New() returned nil")
	}
	if c.javaHome != "/path/to/jdk" {
		t.Errorf("javaHome = %q, want /path/to/jdk", c.javaHome)
	}

	c2 := New("")
	if c2.javaHome != "" {
		t.Errorf("javaHome = %q, want empty", c2.javaHome)
	}
}

func TestNormalizeSeverity(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"error", "error"},
		{"warning", "warning"},
		{"错误", "error"},
		{"警告", "warning"},
		{"info", "info"},
		{"", ""},
		{"custom", "custom"},
	}
	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := normalizeSeverity(tc.input)
			if got != tc.want {
				t.Errorf("normalizeSeverity(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestShouldUseJavacArgFile(t *testing.T) {
	t.Run("windows with many sources", func(t *testing.T) {
		sources := make([]string, 51)
		for i := range sources {
			sources[i] = "src/Foo.java"
		}
		got := shouldUseJavacArgFile(nil, sources)
		if runtime.GOOS == "windows" && !got {
			t.Error("should use argfile on Windows with >50 sources")
		}
	})

	t.Run("few sources below threshold", func(t *testing.T) {
		sources := []string{"src/Foo.java", "src/Bar.java"}
		got := shouldUseJavacArgFile(nil, sources)
		if got {
			t.Error("should not use argfile with few sources")
		}
	})

	t.Run("long command line", func(t *testing.T) {
		sources := make([]string, 100)
		for i := range sources {
			sources[i] = strings.Repeat("x", 250) + ".java"
		}
		got := shouldUseJavacArgFile(nil, sources)
		if !got {
			t.Error("should use argfile when command line exceeds 24KB")
		}
	})

	t.Run("empty sources", func(t *testing.T) {
		got := shouldUseJavacArgFile(nil, nil)
		if got {
			t.Error("should not use argfile with empty sources")
		}
	})

	t.Run("long args", func(t *testing.T) {
		args := []string{strings.Repeat("x", 24*1024)}
		got := shouldUseJavacArgFile(args, []string{"src/Foo.java"})
		if !got {
			t.Error("should use argfile when args exceed 24KB")
		}
	})
}

func TestWriteJavacArgFile_EdgeCases(t *testing.T) {
	t.Run("empty project root", func(t *testing.T) {
		_, err := writeJavacArgFile("", []string{"src/Foo.java"})
		if err == nil {
			t.Fatal("expected error for empty project root")
		}
	})

	t.Run("empty sources", func(t *testing.T) {
		root := t.TempDir()
		name, err := writeJavacArgFile(root, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer os.Remove(name)
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if len(data) != 0 {
			t.Errorf("expected empty argfile, got %q", string(data))
		}
	})

	t.Run("multiple sources with escaping", func(t *testing.T) {
		root := t.TempDir()
		sources := []string{
			filepath.Join(root, "src", "Hello.java"),
			filepath.Join(root, "src", `File"With"Quotes.java`),
		}
		name, err := writeJavacArgFile(root, sources)
		if err != nil {
			t.Fatal(err)
		}
		defer os.Remove(name)
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		content := string(data)
		if !strings.Contains(content, `\"`) {
			t.Error("quotes should be escaped in argfile")
		}
		lines := strings.Split(strings.TrimSpace(content), "\n")
		if len(lines) != 2 {
			t.Errorf("expected 2 lines, got %d: %q", len(lines), content)
		}
	})

	t.Run("backslash escaping", func(t *testing.T) {
		root := t.TempDir()
		sources := []string{filepath.Join(root, `path\to\file.java`)}
		name, err := writeJavacArgFile(root, sources)
		if err != nil {
			t.Fatal(err)
		}
		defer os.Remove(name)
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		content := string(data)
		if !strings.Contains(content, `\\`) {
			t.Error("backslashes should be escaped in argfile")
		}
	})
}

func TestCountCompiled(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   int
	}{
		{"english recompile", "Note: Some files use unchecked operations.\nNote: 3 files to recompile\n", 3},
		{"chinese note", "注意: 10 个文件已编译\n", 0},
		{"empty", "", 0},
		{"no note", "Build successful\n", 0},
		{"zero files", "Note: 0 files compiled\n", 0},
		{"large count", "Note: 12345 files to recompile\n", 12345},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := countCompiled(tc.output)
			if got != tc.want {
				t.Errorf("countCompiled(%q) = %d, want %d", tc.output, got, tc.want)
			}
		})
	}
}

func TestParseDiagnostics_EdgeCases(t *testing.T) {
	t.Run("empty output", func(t *testing.T) {
		diags := parseDiagnostics("", "/proj")
		if len(diags) != 0 {
			t.Errorf("expected 0 diagnostics, got %d", len(diags))
		}
	})

	t.Run("no diagnostics", func(t *testing.T) {
		diags := parseDiagnostics("Build successful\n", "/proj")
		if len(diags) != 0 {
			t.Errorf("expected 0 diagnostics, got %d", len(diags))
		}
	})

	t.Run("single error without continuation", func(t *testing.T) {
		out := "src/Foo.java:5: error: semicolon expected\n"
		diags := parseDiagnostics(out, "/proj")
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		if diags[0].Line != 5 || diags[0].Severity != "error" {
			t.Errorf("unexpected: %#v", diags[0])
		}
	})

	t.Run("with column number", func(t *testing.T) {
		out := "src/Foo.java:10:5: error: cannot find symbol\n"
		diags := parseDiagnostics(out, "/proj")
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		if diags[0].Column != 5 {
			t.Errorf("Column = %d, want 5", diags[0].Column)
		}
	})

	t.Run("column defaults to 1", func(t *testing.T) {
		out := "src/Foo.java:10: error: something\n"
		diags := parseDiagnostics(out, "/proj")
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		if diags[0].Column != 1 {
			t.Errorf("Column = %d, want 1", diags[0].Column)
		}
	})

	t.Run("absolute path preserved", func(t *testing.T) {
		// On Windows, Unix-style absolute paths are not recognized as absolute.
		// Use a platform-appropriate absolute path.
		absPath := filepath.Join("/abs", "path", "Foo.java")
		out := absPath + ":10: error: test\n"
		diags := parseDiagnostics(out, "/proj")
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		// On Unix, the path is absolute and preserved. On Windows, it's joined with projectRoot.
		if runtime.GOOS != "windows" {
			if diags[0].File != absPath {
				t.Errorf("File = %q, want %q", diags[0].File, absPath)
			}
		}
	})

	t.Run("no project root", func(t *testing.T) {
		out := "Foo.java:10: error: test\n"
		diags := parseDiagnostics(out, "")
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		if diags[0].File != "Foo.java" {
			t.Errorf("File = %q, want Foo.java", diags[0].File)
		}
	})

	t.Run("error code extraction", func(t *testing.T) {
		out := "src/Foo.java:10: error: [compiler.err.cant.resolve] cannot find symbol\n"
		diags := parseDiagnostics(out, "/proj")
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		if diags[0].Code != "compiler.err.cant.resolve" {
			t.Errorf("Code = %q, want compiler.err.cant.resolve", diags[0].Code)
		}
	})

	t.Run("warning code extraction", func(t *testing.T) {
		out := "src/Foo.java:15: warning: [compiler.warn.deprecation] oldMethod() has been deprecated\n"
		diags := parseDiagnostics(out, "/proj")
		if len(diags) != 1 {
			t.Fatalf("expected 1 diagnostic, got %d", len(diags))
		}
		if diags[0].Code != "compiler.warn.deprecation" {
			t.Errorf("Code = %q, want compiler.warn.deprecation", diags[0].Code)
		}
	})
}

func TestCompile_NoSources(t *testing.T) {
	c := New("/path/to/jdk")
	res, err := c.Compile(context.Background(), Request{
		Sources: nil,
	})
	if err != nil {
		t.Fatalf("Compile with no sources: %v", err)
	}
	if res == nil || !res.Success {
		t.Fatalf("expected success for empty sources, got res=%v", res)
	}
	if res.FilesCompiled != 0 {
		t.Errorf("FilesCompiled = %d, want 0", res.FilesCompiled)
	}
}

func TestCompile_EmptySourcesSlice(t *testing.T) {
	c := New("/path/to/jdk")
	res, err := c.Compile(context.Background(), Request{
		Sources: []string{},
	})
	if err != nil {
		t.Fatalf("Compile with empty slice: %v", err)
	}
	if !res.Success {
		t.Fatal("expected success for empty sources slice")
	}
}

func TestCompile_DefaultTimeout(t *testing.T) {
	// Empty sources should return immediately without using the timeout
	c := New("/path/to/jdk")
	res, err := c.Compile(context.Background(), Request{
		Sources: []string{},
		Timeout: 0,
	})
	if err != nil {
		t.Fatalf("Compile with zero timeout: %v", err)
	}
	if !res.Success {
		t.Fatal("expected success")
	}
}

func TestCompile_ArgFileWithEmptyProjectRoot(t *testing.T) {
	// Create enough sources to trigger argfile usage on all platforms.
	// Each source path is ~255 chars, so 100 sources × 255 ≈ 25KB,
	// plus args overhead, exceeds the 24KB threshold.
	longPath := strings.Repeat("x", 250) + ".java"
	sources := make([]string, 100)
	for i := range sources {
		sources[i] = longPath
	}

	c := New("/path/to/jdk")
	_, err := c.Compile(context.Background(), Request{
		ProjectRoot: "", // empty project root causes writeJavacArgFile to fail
		Sources:     sources,
		SourceLevel: "8",
		TargetLevel: "8",
	})
	if err == nil {
		t.Fatal("expected error for empty project root with argfile")
	}
	if !strings.Contains(err.Error(), "project root") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestCompile_CustomArgs(t *testing.T) {
	// With custom Args, the default arg building is skipped.
	// javac will likely fail since we use a fake path, but we should
	// at least verify the code path doesn't panic.
	javaHome := t.TempDir()
	c := New(javaHome)
	_, err := c.Compile(context.Background(), Request{
		ProjectRoot: t.TempDir(),
		Sources:     []string{"src/Foo.java"},
		Args:        []string{"-version"},
		Timeout:     5 * time.Second,
	})
	// We expect an error because javac is not found at the fake path
	// and likely not on PATH either. But we just want to exercise the
	// custom Args path — any error is acceptable.
	if err == nil {		// javac happened to be on PATH and -version succeeded
		t.Log("javac was found on PATH; custom Args path exercised")
	}
}

func TestCompile_WorkingDir(t *testing.T) {
	// When WorkingDir is set, it should be used instead of ProjectRoot.
	javaHome := t.TempDir()
	c := New(javaHome)
	_, err := c.Compile(context.Background(), Request{
		ProjectRoot: t.TempDir(),
		WorkingDir:  t.TempDir(),
		Sources:     []string{"src/Foo.java"},
		SourceLevel: "8",
		TargetLevel: "8",
		Timeout:     5 * time.Second,
	})
	// Expect error because javac is not at the fake path, but the
	// WorkingDir path is exercised.
	if err == nil {
		t.Log("javac was found on PATH; WorkingDir path exercised")
	}
}

func TestCompile_WithEncodingAndClasspath(t *testing.T) {
	// Test the default args path with encoding and classpath set.
	javaHome := t.TempDir()
	c := New(javaHome)
	_, err := c.Compile(context.Background(), Request{
		ProjectRoot: t.TempDir(),
		Sources:     []string{"src/Foo.java"},
		SourceLevel: "11",
		TargetLevel: "11",
		Encoding:    "UTF-8",
		Classpath:   []string{"/lib/a.jar", "/lib/b.jar"},
		OutputDir:   t.TempDir(),
		Timeout:     5 * time.Second,
	})
	// Expect error because javac is not at the fake path, but the
	// default args building path is exercised.
	if err == nil {
		t.Log("javac was found on PATH; default args path exercised")
	}
}

func TestCompile_NoEncodingNoClasspath(t *testing.T) {
	// Test the default args path without encoding and classpath.
	javaHome := t.TempDir()
	c := New(javaHome)
	_, err := c.Compile(context.Background(), Request{
		ProjectRoot: t.TempDir(),
		Sources:     []string{"src/Foo.java"},
		SourceLevel: "8",
		TargetLevel: "8",
		Timeout:     5 * time.Second,
	})
	if err == nil {
		t.Log("javac was found on PATH; default args path exercised")
	}
}

func TestCompile_NoToolchain(t *testing.T) {
	c := New("")
	_, err := c.Compile(context.Background(), Request{
		Sources: []string{"src/Foo.java"},
	})
	if err == nil {
		t.Fatal("expected error for empty toolchain")
	}
	if err.Error() != "compiler toolchain not set" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestCompile_CancelledContext(t *testing.T) {
	c := New("/path/to/jdk")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := c.Compile(ctx, Request{
		Sources: []string{"src/Foo.java"},
	})
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestResult_Defaults(t *testing.T) {
	r := Result{}
	if r.Success {
		t.Error("new Result should have Success=false")
	}
	if r.Diagnostics != nil {
		t.Error("new Result should have nil Diagnostics")
	}
}

// =============================================================================
// CollectSources tests
// =============================================================================

func TestCollectSources_SingleDir(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Hello.java", "class Hello {}")
	writeFile(t, dir, "World.java", "class World {}")
	writeFile(t, dir, "readme.txt", "not java")

	sources, err := CollectSources([]string{dir}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sources) != 2 {
		t.Errorf("expected 2 sources, got %d: %v", len(sources), sources)
	}
}

func TestCollectSources_MultiDir(t *testing.T) {
	base := t.TempDir()
	dir1 := filepath.Join(base, "src", "main", "java")
	dir2 := filepath.Join(base, "src", "test", "java")
	os.MkdirAll(dir1, 0755)
	os.MkdirAll(dir2, 0755)
	writeFile(t, dir1, "Main.java", "class Main {}")
	writeFile(t, dir2, "MainTest.java", "class MainTest {}")

	sources, err := CollectSources([]string{dir1, dir2}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sources) != 2 {
		t.Errorf("expected 2 sources, got %d", len(sources))
	}
}

func TestCollectSources_SkipsExcluded(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "App.java", "class App {}")
	os.MkdirAll(filepath.Join(dir, ".git"), 0755)
	writeFile(t, filepath.Join(dir, ".git"), "Hidden.java", "// hidden")

	sources, err := CollectSources([]string{dir}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sources) != 1 {
		t.Errorf("expected 1 source (skipping .git), got %d", len(sources))
	}
}

func TestCollectSources_EmptyRoots(t *testing.T) {
	sources, err := CollectSources(nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sources) != 0 {
		t.Errorf("expected 0 sources, got %d", len(sources))
	}
}

func TestCollectSources_CustomExcludes(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "App.java", "class App {}")
	os.MkdirAll(filepath.Join(dir, "generated"), 0755)
	writeFile(t, filepath.Join(dir, "generated"), "Gen.java", "class Gen {}")

	sources, err := CollectSources([]string{dir}, []string{"generated"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sources) != 1 {
		t.Errorf("expected 1 source (skipping 'generated'), got %d", len(sources))
	}
}

// =============================================================================
// ResolveClasspath tests
// =============================================================================

func TestResolveClasspath_SingleJar(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "lib.jar", "fake jar")
	writeFile(t, dir, "readme.txt", "not a jar")

	cp, err := ResolveClasspath([]string{dir}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cp) != 1 {
		t.Errorf("expected 1 classpath entry, got %d", len(cp))
	}
}

func TestResolveClasspath_MissingDir(t *testing.T) {
	cp, err := ResolveClasspath([]string{"/nonexistent/lib"}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cp) != 0 {
		t.Errorf("expected 0 classpath entries, got %d", len(cp))
	}
}

func TestResolveClasspath_WithExtraJars(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.jar", "fake")
	extraJars := []string{"/opt/lib/special.jar"}

	cp, err := ResolveClasspath([]string{dir}, extraJars)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cp) < 2 {
		t.Errorf("expected at least 2 entries, got %d: %v", len(cp), cp)
	}
}

func TestResolveClasspath_FileNotDir(t *testing.T) {
	dir := t.TempDir()
	jarPath := filepath.Join(dir, "single.jar")
	writeFile(t, dir, "single.jar", "fake jar")

	cp, err := ResolveClasspath([]string{jarPath}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cp) != 1 {
		t.Errorf("expected 1 entry, got %d", len(cp))
	}
}

// =============================================================================
// IncrementalSources tests
// =============================================================================

func TestIncrementalSources_NewerSource(t *testing.T) {
	dir := t.TempDir()
	outDir := filepath.Join(dir, "out")
	os.MkdirAll(outDir, 0755)

	// Write class file first (older)
	writeFile(t, outDir, "Test.class", "fake class")
	time.Sleep(100 * time.Millisecond)
	// Write source file after (newer than class)
	src := filepath.Join(dir, "Test.java")
	writeFile(t, dir, "Test.java", "class Test {}")

	inc := IncrementalSources([]string{src}, outDir)
	if len(inc) != 1 {
		t.Errorf("expected 1 incremental source, got %d", len(inc))
	}
}

func TestIncrementalSources_UpToDate(t *testing.T) {
	dir := t.TempDir()
	outDir := filepath.Join(dir, "out")
	os.MkdirAll(outDir, 0755)

	// Write source file first (older)
	src := filepath.Join(dir, "Test.java")
	writeFile(t, dir, "Test.java", "class Test {}")
	time.Sleep(100 * time.Millisecond)
	// Write class file after (newer than source, so up to date)
	writeFile(t, outDir, "Test.class", "fake class")

	inc := IncrementalSources([]string{src}, outDir)
	if len(inc) != 0 {
		t.Errorf("expected 0 incremental sources (up to date), got %d", len(inc))
	}
}

func TestIncrementalSources_NoClassFile(t *testing.T) {
	dir := t.TempDir()
	outDir := filepath.Join(dir, "out")
	os.MkdirAll(outDir, 0755)

	src := filepath.Join(dir, "Test.java")
	writeFile(t, dir, "Test.java", "class Test {}")

	inc := IncrementalSources([]string{src}, outDir)
	if len(inc) != 1 {
		t.Errorf("expected 1 incremental source (no class file), got %d", len(inc))
	}
}

func TestIncrementalSources_EmptySources(t *testing.T) {
	inc := IncrementalSources(nil, "/tmp/out")
	if len(inc) != 0 {
		t.Errorf("expected 0, got %d", len(inc))
	}
}

// =============================================================================
// readPackageDeclaration tests
// =============================================================================

func TestReadPackageDeclaration(t *testing.T) {
	dir := t.TempDir()
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{"simple", "package com.example;\nclass Test {}", "com.example"},
		{"with spaces", "package  com.example.util ;\nimport java.util.*;", "com.example.util"},
		{"no package", "class Test {}", ""},
		{"comment before", "// comment\npackage foo.bar;\nclass Test {}", "foo.bar"},
		{"block comment", "/* header */\npackage foo;\nclass Test {}", "foo"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(dir, tt.name+".java")
			os.WriteFile(path, []byte(tt.content), 0644)
			got := readPackageDeclaration(path)
			if got != tt.want {
				t.Errorf("readPackageDeclaration = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestReadPackageDeclaration_MissingFile(t *testing.T) {
	got := readPackageDeclaration("/nonexistent/Test.java")
	if got != "" {
		t.Errorf("expected empty for missing file, got %q", got)
	}
}

// =============================================================================
// DetermineEncoding tests
// =============================================================================

func TestDetermineEncoding(t *testing.T) {
	tests := []struct {
		name string
		req  string
		want string
	}{
		{"explicit utf8", "UTF-8", "UTF-8"},
		{"explicit gbk", "GBK", "GBK"},
		{"explicit iso8859", "ISO-8859-1", "ISO-8859-1"},
		{"empty defaults to utf8", "", "UTF-8"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DetermineEncoding(tt.req)
			if got != tt.want {
				t.Errorf("DetermineEncoding(%q) = %q, want %q", tt.req, got, tt.want)
			}
		})
	}
}

// =============================================================================
// BuildClasspathString tests
// =============================================================================

func TestBuildClasspathString(t *testing.T) {
	entries := []string{"/lib/a.jar", "/lib/b.jar"}
	result := BuildClasspathString(entries)
	if result == "" {
		t.Error("expected non-empty classpath string")
	}
}

func TestBuildClasspathString_Empty(t *testing.T) {
	result := BuildClasspathString(nil)
	if result != "" {
		t.Errorf("expected empty string, got %q", result)
	}
}

// =============================================================================
// SourceToClassFile tests
// =============================================================================

func TestSourceToClassFile(t *testing.T) {
	dir := t.TempDir()
	// File with package
	srcPath := filepath.Join(dir, "Test.java")
	os.WriteFile(srcPath, []byte("package com.example;\nclass Test {}"), 0644)

	classFile := sourceToClassFile(srcPath, filepath.Join(dir, "out"))
	if classFile == "" {
		t.Error("expected non-empty class file path")
	}
}

func TestSourceToClassFile_NotJava(t *testing.T) {
	result := sourceToClassFile("readme.txt", "/out")
	if result != "" {
		t.Errorf("expected empty for non-java file, got %q", result)
	}
}

// =============================================================================
// Legacy source-level normalization (KAIRO-S27 / JDK 21)
// =============================================================================

func TestParseLevel(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"1.6", 6},
		{"1.8", 8},
		{"6", 6},
		{"8", 8},
		{"11", 11},
		{"17", 17},
		{"", 0},
		{"abc", 0},
		{"1.", 0},
		{" 1.7 ", 7},
	}
	for _, tc := range cases {
		if got := parseLevel(tc.in); got != tc.want {
			t.Errorf("parseLevel(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestNormalizeLevel(t *testing.T) {
	cases := []struct {
		level string
		min   int
		want  string
	}{
		{"1.6", 7, "7"},   // legacy source raised to JDK 21 minimum
		{"1.6", 8, "8"},   // raised further when JDK min is 8
		{"1.6", 0, "1.6"}, // unknown minimum → pass through
		{"8", 7, "8"},     // already supported → unchanged
		{"7", 7, "7"},     // exactly the minimum → unchanged
		{"11", 7, "11"},   // above minimum → unchanged
		{"", 7, ""},       // empty → unchanged
		{"abc", 7, "abc"}, // unparsable → unchanged
	}
	for _, tc := range cases {
		if got := normalizeLevel(tc.level, tc.min); got != tc.want {
			t.Errorf("normalizeLevel(%q, %d) = %q, want %q", tc.level, tc.min, got, tc.want)
		}
	}
}

func TestProbeMinSourceLevel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell fixture; Windows probing is covered by real JDK E2E")
	}

	t.Run("english-jdk21", func(t *testing.T) {
		javac := writeFakeJavac(t, "Usage: javac <options> <source files>\nSupported releases: 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21\n")
		if got := probeMinSourceLevel(javac); got != 7 {
			t.Fatalf("probeMinSourceLevel = %d, want 7", got)
		}
	})

	t.Run("chinese-jdk21", func(t *testing.T) {
		// javac localizes its -help text; the Chinese build lists the
		// supported releases as "支持的发行版本：8, 9, ...".
		javac := writeFakeJavac(t, "用法: javac <options> <source files>\n--release <release>\n    为指定的 Java SE 版本编译。支持的发行版本：8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21\n")
		if got := probeMinSourceLevel(javac); got != 8 {
			t.Fatalf("probeMinSourceLevel = %d, want 8", got)
		}
	})
}

// TestSupportedReleasesRE validates the javac -help parser against both the
// English and localized (Chinese) help texts. Runs on every platform.
func TestSupportedReleasesRE(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"Supported releases: 7, 8, 11, 17, 21", 7},
		{"Supported source versions: 8, 11, 17", 8},
		{"支持的发行版本：8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21", 8},
		{"为指定的 Java SE 发行版编译。支持的发行版：7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17", 7},
		{"no version list here", 0},
		{"", 0},
	}
	for _, tc := range cases {
		min := 0
		for _, m := range supportedReleasesRE.FindAllStringSubmatch(tc.in, -1) {
			if len(m) < 2 {
				continue
			}
			for _, tok := range strings.Split(m[1], ",") {
				if v, err := strconv.Atoi(strings.TrimSpace(tok)); err == nil && (min == 0 || v < min) {
					min = v
				}
			}
		}
		if min != tc.want {
			t.Errorf("supportedReleasesRE(%q) min = %d, want %d", tc.in, min, tc.want)
		}
	}
}

// writeFakeJavac writes an executable sh script that echoes the given help
// text (probeMinSourceLevel invokes javac with -help).
func writeFakeJavac(t *testing.T, helpText string) string {
	t.Helper()
	javaHome := t.TempDir()
	binDir := filepath.Join(javaHome, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	javac := filepath.Join(binDir, "javac")
	script := "#!/bin/sh\nprintf '%s' " + strconv.Quote(helpText) + "\n"
	if err := os.WriteFile(javac, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return javac
}

// writeFile is a helper for test file creation.
func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}
