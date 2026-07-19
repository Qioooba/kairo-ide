package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectLayoutPrefersLegacyWebRoot(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"WebRoot", filepath.Join("src", "main", "webapp")} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	layout := detectLayout(root)
	if got := layout["webRoot"]; got != "WebRoot" {
		t.Fatalf("webRoot = %v, want WebRoot", got)
	}
}

func TestDetectLayoutUsesModernWebRootWhenLegacyLayoutIsAbsent(t *testing.T) {
	root := t.TempDir()
	modern := filepath.Join("src", "main", "webapp")
	if err := os.MkdirAll(filepath.Join(root, modern), 0o755); err != nil {
		t.Fatal(err)
	}

	layout := detectLayout(root)
	if got := layout["webRoot"]; got != "src/main/webapp" {
		t.Fatalf("webRoot = %v, want src/main/webapp", got)
	}
}
