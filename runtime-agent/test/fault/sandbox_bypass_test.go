//go:build fault
// +build fault

// Package fault contains fault-injection tests that verify the
// Runtime Agent correctly rejects malicious or invalid inputs.
//
// Run with:
//
//	go test -tags=fault -count=1 ./test/fault/...
package fault

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/security"
)

func TestSandboxRejectsOutsidePath(t *testing.T) {
	dir := t.TempDir()
	ws, err := security.NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatalf("NewWorkspaceRoots: %v", err)
	}

	// Test that unauthorized paths are rejected
	if _, err := ws.AuthorizeReadAbs("/etc/passwd"); err == nil {
		t.Fatal("should have rejected /etc/passwd")
	}
	if _, err := ws.AuthorizeWriteAbs("/etc/passwd"); err == nil {
		t.Fatal("should have rejected write to /etc/passwd")
	}

	// Test that authorized paths are allowed
	if _, err := ws.AuthorizeReadAbs(filepath.Join(dir, "file.txt")); err != nil {
		t.Errorf("should have allowed %s/file.txt: %v", dir, err)
	}
}

func TestSandboxRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink behavior differs on Windows in CI")
	}
	dir := t.TempDir()
	other := t.TempDir()

	// Create a secret file outside the sandbox
	if err := os.WriteFile(filepath.Join(other, "secret"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Create a symlink inside the sandbox pointing outside
	link := filepath.Join(dir, "link")
	if err := os.Symlink(filepath.Join(other, "secret"), link); err != nil {
		t.Fatal(err)
	}

	ws, err := security.NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatalf("NewWorkspaceRoots: %v", err)
	}

	// The symlink should be rejected because it resolves outside the root
	if _, err := ws.AuthorizeReadAbs(link); err == nil {
		t.Fatal("should have rejected symlink escape")
	}
}

func TestSandboxRejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	ws, err := security.NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatalf("NewWorkspaceRoots: %v", err)
	}

	// Path traversal attempts at the absolute level should be rejected.
	// The canonical path resolves to /etc/passwd which is not under the workspace root.
	traversal := filepath.Join(dir, "..", "..", "..", "..", "etc", "passwd")
	if _, err := ws.AuthorizeReadAbs(traversal); err == nil {
		t.Fatal("should have rejected path traversal")
	}
}

func TestSandboxReadOnly(t *testing.T) {
	dir := t.TempDir()
	bundled := filepath.Join(dir, "bundled")
	if err := os.Mkdir(bundled, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bundled, "x"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	ws, err := security.NewWorkspaceRoots(dir)
	if err != nil {
		t.Fatalf("NewWorkspaceRoots: %v", err)
	}
	ws.WithReadOnly(bundled)

	// Read should be allowed
	if _, err := ws.AuthorizeReadAbs(filepath.Join(bundled, "x")); err != nil {
		t.Errorf("read of read-only path should be allowed: %v", err)
	}
	// Write should be blocked
	if _, err := ws.AuthorizeWriteAbs(filepath.Join(bundled, "x")); err == nil {
		t.Fatal("write of read-only path should be blocked")
	}
}

func TestSandboxAddRootAtRuntime(t *testing.T) {
	dir1 := t.TempDir()
	dir2 := t.TempDir()

	ws, err := security.NewWorkspaceRoots(dir1)
	if err != nil {
		t.Fatalf("NewWorkspaceRoots: %v", err)
	}

	// dir2 should not be accessible yet
	if _, err := ws.AuthorizeReadAbs(filepath.Join(dir2, "file.txt")); err == nil {
		t.Fatal("should have rejected dir2 before AddRoot")
	}

	// Add dir2 at runtime
	if err := ws.AddRoot(dir2); err != nil {
		t.Fatalf("AddRoot: %v", err)
	}

	// Now dir2 should be accessible
	if _, err := ws.AuthorizeReadAbs(filepath.Join(dir2, "file.txt")); err != nil {
		t.Errorf("should have allowed dir2 after AddRoot: %v", err)
	}
}