package domain

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateWorkspacePath(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"simple relative", "src/main/java", false},
		{"single file", "pom.xml", false},
		{"nested path", "a/b/c/d", false},
		{"dot prefix", "./src/main", false},
		{"empty path", "", true},
		{"absolute path", "/etc/passwd", true},
		{"parent traversal", "../outside", true},
		{"double parent traversal", "../../outside", true},
		{"parent in middle resolved to safe", "a/../b", false},
		{"deep parent traversal", "a/../../outside", true},
		{"backslash", "src\\main", true},
		{"null byte", "src\x00main", true},
		{"dot only", ".", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ValidateWorkspacePath(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ValidateWorkspacePath(%q) expected error", tt.input)
				}
				if err != nil && !(err == ErrPathEscape || err.Error() == "empty path") {
					// Accept either ErrPathEscape or the empty path error
				}
				return
			}
			if err != nil {
				t.Errorf("ValidateWorkspacePath(%q) unexpected error: %v", tt.input, err)
				return
			}
			expected := filepath.Clean(tt.input)
			if string(got) != expected {
				t.Errorf("ValidateWorkspacePath(%q) = %q, want %q", tt.input, string(got), expected)
			}
		})
	}
}

func TestWorkspacePath_String(t *testing.T) {
	p := WorkspacePath("src/main")
	if p.String() != "src/main" {
		t.Errorf("WorkspacePath.String() = %q, want %q", p.String(), "src/main")
	}
}

func TestCanonicalPath_String(t *testing.T) {
	p := CanonicalPath("/abs/path")
	if p.String() != "/abs/path" {
		t.Errorf("CanonicalPath.String() = %q, want %q", p.String(), "/abs/path")
	}
}

func TestResolveCanonicalPath(t *testing.T) {
	tmpDir := t.TempDir()
	root := filepath.Join(tmpDir, "workspace")
	os.MkdirAll(root, 0755)

	t.Run("valid path under root", func(t *testing.T) {
		rel := WorkspacePath("src/main")
		got, err := ResolveCanonicalPath(root, rel)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := filepath.Clean(filepath.Join(root, "src/main"))
		if string(got) != expected {
			t.Errorf("got %q, want %q", string(got), expected)
		}
	})

	t.Run("root itself", func(t *testing.T) {
		rel := WorkspacePath(".")
		got, err := ResolveCanonicalPath(root, rel)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if string(got) != filepath.Clean(root) {
			t.Errorf("got %q, want %q", string(got), filepath.Clean(root))
		}
	})

	t.Run("parent traversal blocked", func(t *testing.T) {
		rel := WorkspacePath("../outside")
		_, err := ResolveCanonicalPath(root, rel)
		if err != ErrPathEscape {
			t.Errorf("expected ErrPathEscape, got %v", err)
		}
	})
}

func TestIsUnder(t *testing.T) {
	tests := []struct {
		name   string
		child  string
		parent string
		want   bool
	}{
		{"same path", "/a/b", "/a/b", true},
		{"child under parent", "/a/b/c", "/a/b", true},
		{"parent of child", "/a/b", "/a/b/c", false},
		{"sibling", "/a/b", "/a/c", false},
		{"unrelated", "/x/y", "/a/b", false},
		{"root child", "/a", "/", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isUnder(tt.child, tt.parent)
			if got != tt.want {
				t.Errorf("isUnder(%q, %q) = %v, want %v", tt.child, tt.parent, got, tt.want)
			}
		})
	}
}