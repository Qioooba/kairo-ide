package pathpolicy

import (
	"os"
	"path/filepath"
	"testing"
)

func BenchmarkValidateRelativeConfigPath_Valid(b *testing.B) {
	p := NewDefaultPathPolicy()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.ValidateRelativeConfigPath("src/main/java", false)
	}
}

func BenchmarkValidateRelativeConfigPath_Invalid(b *testing.B) {
	p := NewDefaultPathPolicy()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.ValidateRelativeConfigPath("/absolute/path", false)
	}
}

func BenchmarkValidateRelativeConfigPath_Traversal(b *testing.B) {
	p := NewDefaultPathPolicy()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.ValidateRelativeConfigPath("foo/../bar", false)
	}
}

func BenchmarkValidateRelativeConfigPath_Volume(b *testing.B) {
	p := NewDefaultPathPolicy()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.ValidateRelativeConfigPath("C:/outside", false)
	}
}

func BenchmarkResolveWithin(b *testing.B) {
	p := NewDefaultPathPolicy()
	tmpDir := b.TempDir()
	tmpDir, _ = filepath.EvalSymlinks(tmpDir)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.ResolveWithin(tmpDir, "src/main/java")
	}
}

func BenchmarkResolveWithin_Dot(b *testing.B) {
	p := NewDefaultPathPolicy()
	tmpDir := b.TempDir()
	tmpDir, _ = filepath.EvalSymlinks(tmpDir)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.ResolveWithin(tmpDir, ".")
	}
}

func BenchmarkResolveWithinNoFollow(b *testing.B) {
	p := NewDefaultPathPolicy()
	tmpDir := b.TempDir()
	tmpDir, _ = filepath.EvalSymlinks(tmpDir)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.ResolveWithinNoFollow(tmpDir, "src/main/java")
	}
}

func BenchmarkValidateDeployTarget_Valid(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ValidateDeployTarget("WEB-INF/classes/Foo.class")
	}
}

func BenchmarkValidateDeployTarget_Invalid(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ValidateDeployTarget("/etc/passwd")
	}
}

func BenchmarkCanonicalizeAbs(b *testing.B) {
	tmpDir := b.TempDir()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		canonicalizeAbs(tmpDir)
	}
}

func BenchmarkIsLexicallyUnder(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isLexicallyUnder("/a/b/c", "/a/b")
	}
}

func BenchmarkEvalSymlinksNearest(b *testing.B) {
	tmpDir := b.TempDir()
	os.MkdirAll(filepath.Join(tmpDir, "src", "main", "java"), 0o755)
	target := filepath.Join(tmpDir, "src", "main", "java", "nonexistent", "file.txt")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		evalSymlinksNearest(target)
	}
}

func BenchmarkHasVolumeNameLexical(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hasVolumeNameLexical("C:/outside")
	}
}