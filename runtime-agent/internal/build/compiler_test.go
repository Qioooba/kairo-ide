package build

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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
	if diags[0].File != "/proj/src/main/java/com/example/App.java" {
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
