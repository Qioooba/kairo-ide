package jdtls

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestParseJavaMajor(t *testing.T) {
	cases := map[string]int{
		"21.0.12":   21,
		"17.0.19":   17,
		"1.8.0_391": 8,
		"":          0,
	}
	for in, want := range cases {
		if got := parseJavaMajor(in); got != want {
			t.Fatalf("parseJavaMajor(%q)=%d want %d", in, got, want)
		}
	}
}

func TestResolveHostJRE_RejectsJDK17(t *testing.T) {
	t.Setenv("KAIRO_JDT_LS_JRE", "")
	t.Setenv("KAIRO_JRE17_HOME", "")
	t.Setenv("KAIRO_JDK_HOME", "")
	t.Setenv("JAVA_HOME", "")
	t.Setenv("KAIRO_JDTLS_ASSUME_JRE_MAJOR", "")
	t.Setenv("KAIRO_BUNDLED_DIR", "")
	orig := commonJDTLSJREPathsFn
	commonJDTLSJREPathsFn = func(string) []string { return nil }
	t.Cleanup(func() { commonJDTLSJREPathsFn = orig })

	home := t.TempDir()
	binDir := filepath.Join(home, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	javaName := "java"
	if runtime.GOOS == "windows" {
		javaName = "java.exe"
	}
	if err := os.WriteFile(filepath.Join(binDir, javaName), []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KAIRO_JDTLS_ASSUME_JRE_MAJOR", "17")
	_, err := resolveHostJRE(home, t.TempDir())
	if err == nil {
		t.Fatal("expected error when only JDK 17 is available")
	}
	if !strings.Contains(err.Error(), "requires a JDK/JRE 21") {
		t.Fatalf("error %q should mention JDK/JRE 21 requirement", err.Error())
	}
}

func TestResolveHostJRE_AcceptsAssumed21(t *testing.T) {
	t.Setenv("KAIRO_JDT_LS_JRE", "")
	t.Setenv("KAIRO_JRE17_HOME", "")
	t.Setenv("KAIRO_JDK_HOME", "")
	t.Setenv("JAVA_HOME", "")
	t.Setenv("KAIRO_BUNDLED_DIR", "")
	t.Setenv("KAIRO_JDTLS_ASSUME_JRE_MAJOR", "21")

	home := t.TempDir()
	binDir := filepath.Join(home, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	javaName := "java"
	if runtime.GOOS == "windows" {
		javaName = "java.exe"
	}
	if err := os.WriteFile(filepath.Join(binDir, javaName), []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := resolveHostJRE(home, t.TempDir())
	if err != nil {
		t.Fatalf("resolveHostJRE: %v", err)
	}
	if got != home {
		t.Fatalf("got %q want %q", got, home)
	}
}
