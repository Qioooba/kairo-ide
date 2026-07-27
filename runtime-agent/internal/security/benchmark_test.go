package security

import (
	"os"
	"path/filepath"
	"testing"
)

func BenchmarkAuthorizeRead(b *testing.B) {
	dir := b.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hi"), 0o600)
	w, _ := NewWorkspaceRoots(dir)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.AuthorizeRead(0, "a.txt")
	}
}

func BenchmarkAuthorizeRead_Deep(b *testing.B) {
	dir := b.TempDir()
	deepPath := filepath.Join(dir, "a", "b", "c", "d", "e")
	os.MkdirAll(deepPath, 0o755)
	os.WriteFile(filepath.Join(deepPath, "f.txt"), []byte("hi"), 0o600)
	w, _ := NewWorkspaceRoots(dir)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.AuthorizeRead(0, "a/b/c/d/e/f.txt")
	}
}

func BenchmarkAuthorizeWrite(b *testing.B) {
	dir := b.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hi"), 0o600)
	w, _ := NewWorkspaceRoots(dir)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.AuthorizeWrite(0, "a.txt")
	}
}

func BenchmarkAuthorizeReadAbs(b *testing.B) {
	dir := b.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hi"), 0o600)
	w, _ := NewWorkspaceRoots(dir)
	absPath := filepath.Join(dir, "a.txt")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.AuthorizeReadAbs(absPath)
	}
}

func BenchmarkResolveRoot(b *testing.B) {
	dir := b.TempDir()
	sub := filepath.Join(dir, "a", "b", "c")
	os.MkdirAll(sub, 0o755)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resolveRoot(sub)
	}
}

func BenchmarkIsUnder(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isUnder("/a/b/c", "/a/b")
	}
}

func BenchmarkIsUnder_NotUnder(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isUnder("/etc/passwd", "/a/b")
	}
}

func BenchmarkNewWorkspaceRoots(b *testing.B) {
	dir := b.TempDir()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewWorkspaceRoots(dir)
	}
}

func BenchmarkAddRoot(b *testing.B) {
	dir1 := b.TempDir()
	dir2 := b.TempDir()
	w, _ := NewWorkspaceRoots(dir1)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.AddRoot(dir2)
	}
}

func BenchmarkFindRoot(b *testing.B) {
	dir := b.TempDir()
	sub := filepath.Join(dir, "sub")
	os.MkdirAll(sub, 0o755)
	w, _ := NewWorkspaceRoots(dir)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.FindRoot(sub)
	}
}

func BenchmarkJoinAndCheck(b *testing.B) {
	dir := b.TempDir()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		joinAndCheck(dir, "a/b/c.txt", false)
	}
}