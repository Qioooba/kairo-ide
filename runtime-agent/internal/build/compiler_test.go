package build

import (
	"context"
	"os"
	"path/filepath"
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
