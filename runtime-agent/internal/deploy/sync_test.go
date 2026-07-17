package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSync_CopyNew(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("hi"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Sync(src, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hi" {
		t.Errorf("dst content = %q, want hi", got)
	}
}

func TestSync_AtomicUpdate(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("v1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Sync(src, dst); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("v2-longer"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Sync(src, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "v2-longer" {
		t.Errorf("dst content = %q, want v2-longer", got)
	}
}

func TestSync_PruneRemoved(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "b.txt"), []byte("b"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Sync(src, dst); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(src, "b.txt")); err != nil {
		t.Fatal(err)
	}
	if err := Sync(src, dst); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dst, "b.txt")); !os.IsNotExist(err) {
		t.Errorf("expected b.txt to be pruned, got err = %v", err)
	}
}

func TestSync_NestedDirs(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.MkdirAll(filepath.Join(src, "sub", "deep"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "deep", "f.txt"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Sync(src, dst); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dst, "sub", "deep", "f.txt")); err != nil {
		t.Errorf("nested file missing: %v", err)
	}
}

func TestSafeDelete_InsideOnly(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := SafeDelete(root, outside); err == nil {
		t.Errorf("expected refusal to delete outside root")
	}
	if !strings.HasPrefix(outside, os.TempDir()) {
		t.Errorf("test setup error")
	}
}
