package search

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func BenchmarkSearch_PlainText(b *testing.B) {
	dir := b.TempDir()
	for i := 0; i < 100; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", i)), []byte("hello world\nfoo bar\nhello again\n"), 0o600)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Search(dir, Options{Query: "hello"})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearch_CaseInsensitive(b *testing.B) {
	dir := b.TempDir()
	for i := 0; i < 100; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", i)), []byte("Hello\nHELLO\nhello\n"), 0o600)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Search(dir, Options{Query: "hello", CaseSensitive: false})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearch_Regex(b *testing.B) {
	dir := b.TempDir()
	for i := 0; i < 100; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", i)), []byte("a1 b2 c3 d44\n"), 0o600)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Search(dir, Options{Query: `\d+`, IsRegex: true})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearch_WholeWord(b *testing.B) {
	dir := b.TempDir()
	for i := 0; i < 100; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", i)), []byte("foo foobar foo barfoo foo\n"), 0o600)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Search(dir, Options{Query: "foo", WholeWord: true})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearch_GBK(b *testing.B) {
	dir := b.TempDir()
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3}
	for i := 0; i < 100; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", i)), append(gbk, '\n'), 0o600)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Search(dir, Options{Query: "你好", ProjectEncoding: "gbk"})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearch_LargeFile(b *testing.B) {
	dir := b.TempDir()
	content := strings.Repeat("hello world this is a line of text\n", 10000)
	os.WriteFile(filepath.Join(dir, "large.txt"), []byte(content), 0o600)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Search(dir, Options{Query: "hello"})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearch_ManyFiles(b *testing.B) {
	dir := b.TempDir()
	for i := 0; i < 500; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", i)), []byte("some content hello world\n"), 0o600)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Search(dir, Options{Query: "hello"})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearchStreaming(b *testing.B) {
	dir := b.TempDir()
	var lines []string
	for i := 0; i < 200; i++ {
		lines = append(lines, "hello-"+fmt.Sprintf("%d", i))
	}
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte(strings.Join(lines, "\n")), 0o600)

	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		err := SearchStreaming(ctx, dir, Options{Query: "hello"}, func(batch []Match, batchIndex int, total int) error {
			return nil
		})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkBuildMatcher(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := buildMatcher(Options{Query: "hello", CaseSensitive: false})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkBuildMatcher_Regex(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := buildMatcher(Options{Query: `\d{2,}`, IsRegex: true})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkGlobToRegexp(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		globToRegexp("*.java")
	}
}

func BenchmarkGlobToRegexp_Complex(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		globToRegexp("**/test/**/*_test.go")
	}
}

func BenchmarkIsExcludedDir(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isExcludedDir("node_modules")
	}
}

func BenchmarkIsLikelyBinary(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isLikelyBinary("/path/to/file.class")
	}
}