package security

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSandbox_TraversalBlocked(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	w, err := NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatal(err)
	}
	// `sub/../etc/passwd` resolves to `dir/etc/passwd` which is
	// INSIDE the workspace. Lexical traversal that stays inside
	// is allowed.
	if _, err := w.AuthorizeRead(0, "sub/../etc/passwd"); err != nil {
		t.Errorf("in-workspace traversal should be allowed, got %v", err)
	}
	// But `../../../../etc/passwd` escapes.
	if _, err := w.AuthorizeRead(0, "../../../../etc/passwd"); err == nil {
		t.Errorf("expected path_forbidden for escape, got nil")
	}
	if _, err := w.AuthorizeRead(0, "/etc/passwd"); err == nil {
		t.Errorf("expected path_forbidden for absolute, got nil")
	}
}

func TestSandbox_InsideOK(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hi"), 0o600); err != nil {
		t.Fatal(err)
	}
	w, err := NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.AuthorizeRead(0, "a.txt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want, err := filepath.EvalSymlinks(filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestSandbox_ReadOnly(t *testing.T) {
	dir := t.TempDir()
	bundled := filepath.Join(dir, "bundled")
	if err := os.Mkdir(bundled, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bundled, "x"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	w, err := NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatal(err)
	}
	w.WithReadOnly(bundled)

	if _, err := w.AuthorizeRead(0, "bundled/x"); err != nil {
		t.Errorf("read of read-only should be allowed: %v", err)
	}
	if _, err := w.AuthorizeWrite(0, "bundled/x"); err == nil {
		t.Errorf("write of read-only should be blocked")
	}
}

func TestSandbox_SymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink behavior differs on Windows in CI")
	}
	dir := t.TempDir()
	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(other, "secret"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(filepath.Join(other, "secret"), link); err != nil {
		t.Fatal(err)
	}
	w, err := NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.AuthorizeRead(0, "link"); err == nil {
		t.Errorf("expected symlink escape to be blocked")
	}
}

func TestIsUnder(t *testing.T) {
	cases := []struct {
		child, parent string
		want          bool
	}{
		{"/a/b/c", "/a/b", true},
		{"/a/b", "/a/b", true},
		{"/a/bc", "/a/b", false},
		{"/a", "/a/b", false},
		{"/a/b", "/a", true},
	}
	for _, c := range cases {
		if got := isUnder(c.child, c.parent); got != c.want {
			t.Errorf("isUnder(%q,%q) = %v, want %v", c.child, c.parent, got, c.want)
		}
	}
}
