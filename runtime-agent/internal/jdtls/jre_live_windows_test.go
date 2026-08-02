//go:build windows

package jdtls

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveHostJRE_SkipsJDK17EnvAndFinds21(t *testing.T) {
	jdk21 := `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`
	if _, err := os.Stat(filepath.Join(jdk21, "bin", "java.exe")); err != nil {
		t.Skip("Temurin 21 not installed")
	}
	t.Setenv("KAIRO_JDT_LS_JRE", "")
	t.Setenv("KAIRO_JRE17_HOME", `E:\Tools\jdk17`)
	t.Setenv("KAIRO_JDK_HOME", `E:\Tools\jdk17`)
	t.Setenv("JAVA_HOME", `E:\Tools\jdk17`)
	t.Setenv("KAIRO_JDTLS_ASSUME_JRE_MAJOR", "")
	t.Setenv("KAIRO_BUNDLED_DIR", "")
	got, err := resolveHostJRE("", t.TempDir())
	if err != nil {
		t.Fatalf("resolveHostJRE: %v", err)
	}
	if !strings.Contains(strings.ToLower(got), "21") {
		t.Fatalf("expected a JDK 21 home, got %q", got)
	}
	t.Logf("resolved JDT host JRE: %s", got)
}
