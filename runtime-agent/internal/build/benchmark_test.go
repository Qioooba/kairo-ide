package build

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- Compiler benchmarks ---

func BenchmarkCollectSources(b *testing.B) {
	dir := b.TempDir()
	srcDir := filepath.Join(dir, "src")
	os.MkdirAll(srcDir, 0755)
	for i := 0; i < 100; i++ {
		os.WriteFile(filepath.Join(srcDir, "File"+string(rune('A'+i%26))+".java"), []byte("class Test{}"), 0644)
	}
	// Create subdirectories
	subDir := filepath.Join(srcDir, "sub")
	os.MkdirAll(subDir, 0755)
	for i := 0; i < 50; i++ {
		os.WriteFile(filepath.Join(subDir, "Sub"+string(rune('A'+i%26))+".java"), []byte("class Test{}"), 0644)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CollectSources([]string{srcDir}, nil)
	}
}

func BenchmarkCollectSources_Large(b *testing.B) {
	dir := b.TempDir()
	srcDir := filepath.Join(dir, "src")
	os.MkdirAll(srcDir, 0755)
	for i := 0; i < 500; i++ {
		os.WriteFile(filepath.Join(srcDir, "File"+string(rune('A'+i%26))+".java"), []byte("class Test{}"), 0644)
	}
	for d := 0; d < 5; d++ {
		subDir := filepath.Join(srcDir, "sub"+string(rune('A'+d)))
		os.MkdirAll(subDir, 0755)
		for i := 0; i < 100; i++ {
			os.WriteFile(filepath.Join(subDir, "Sub"+string(rune('A'+i%26))+".java"), []byte("class Test{}"), 0644)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CollectSources([]string{srcDir}, nil)
	}
}

func BenchmarkResolveClasspath(b *testing.B) {
	dir := b.TempDir()
	libDir := filepath.Join(dir, "lib")
	os.MkdirAll(libDir, 0755)
	for i := 0; i < 20; i++ {
		os.WriteFile(filepath.Join(libDir, "lib-"+string(rune('A'+i%26))+".jar"), []byte("dummy"), 0644)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ResolveClasspath([]string{libDir}, nil)
	}
}

func BenchmarkParseDiagnostics(b *testing.B) {
	output := strings.Repeat("src/com/example/Test.java:10: error: cannot find symbol\n  symbol: variable x\n", 100)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		parseDiagnostics(output, "/project")
	}
}

func BenchmarkParseDiagnostics_Large(b *testing.B) {
	output := strings.Repeat("src/com/example/Test.java:10: error: cannot find symbol\n  symbol: variable x\n", 1000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		parseDiagnostics(output, "/project")
	}
}

func BenchmarkCountCompiled(b *testing.B) {
	output := "Note: 42 files compiled\nNote: 42 files compiled\nNote: 42 files compiled\n"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		countCompiled(output)
	}
}

func BenchmarkBuildClasspathString(b *testing.B) {
	entries := []string{
		"/path/to/lib1.jar", "/path/to/lib2.jar", "/path/to/lib3.jar",
		"/path/to/lib4.jar", "/path/to/lib5.jar", "/path/to/lib6.jar",
		"/path/to/lib7.jar", "/path/to/lib8.jar", "/path/to/lib9.jar",
		"/path/to/lib10.jar",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		BuildClasspathString(entries)
	}
}

func BenchmarkShouldUseJavacArgFile(b *testing.B) {
	args := []string{"-source", "1.6", "-target", "1.6", "-encoding", "gbk", "-d", "bin"}
	sources := make([]string, 200)
	for i := range sources {
		sources[i] = "/very/long/path/to/source/file/Example" + string(rune('A'+i%26)) + ".java"
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		shouldUseJavacArgFile(args, sources)
	}
}

func BenchmarkWriteJavacArgFile(b *testing.B) {
	dir := b.TempDir()
	sources := make([]string, 200)
	for i := range sources {
		sources[i] = "/very/long/path/to/source/file/Example" + string(rune('A'+i%26)) + ".java"
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		name, err := writeJavacArgFile(dir, sources)
		if err != nil {
			b.Fatal(err)
		}
		os.Remove(name)
	}
}

func BenchmarkIncrementalSources(b *testing.B) {
	dir := b.TempDir()
	outDir := filepath.Join(dir, "out")
	os.MkdirAll(outDir, 0755)

	sources := make([]string, 100)
	for i := range sources {
		src := filepath.Join(dir, "File"+string(rune('A'+i%26))+".java")
		os.WriteFile(src, []byte("class Test{}"), 0644)
		sources[i] = src
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		IncrementalSources(sources, outDir)
	}
}

func BenchmarkReadPackageDeclaration(b *testing.B) {
	dir := b.TempDir()
	src := filepath.Join(dir, "Test.java")
	os.WriteFile(src, []byte("package com.example.test;\n\nimport java.util.*;\n\npublic class Test {\n}\n"), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		readPackageDeclaration(src)
	}
}

func BenchmarkDetermineEncoding(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		DetermineEncoding("gbk")
	}
}

func BenchmarkDetermineEncoding_Default(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		DetermineEncoding("")
	}
}

func BenchmarkCompiler_New(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		New("/usr/lib/jvm/java-8")
	}
}

func BenchmarkCompiler_Compile_NoSources(b *testing.B) {
	c := New("/usr/lib/jvm/java-8")
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.Compile(ctx, Request{})
	}
}