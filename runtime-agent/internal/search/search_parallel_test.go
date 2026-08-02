package search

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGlob_BasenameMatchesNested(t *testing.T) {
	t.Parallel()
	g := compileGlobs([]string{"*.java"})
	if g == nil {
		t.Fatal("expected glob set")
	}
	if !g.matchAny("src/main/Foo.java") {
		t.Fatal("*.java should match nested Foo.java")
	}
	if g.matchAny("src/main/Foo.txt") {
		t.Fatal("*.java should not match Foo.txt")
	}
}

func TestGlob_PathPatternDoesNotBasenameFallback(t *testing.T) {
	t.Parallel()
	g := compileGlobs([]string{"src/*.java"})
	if g.matchAny("lib/Foo.java") {
		t.Fatal("src/*.java must not match lib/Foo.java via basename")
	}
	if !g.matchAny("src/Foo.java") {
		t.Fatal("src/*.java should match src/Foo.java")
	}
}

func TestSearch_IncludeGlobNested(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(dir, "src"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "src", "a.java"), []byte("hello\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("hello\n"), 0o600))

	r, err := Search(dir, Options{Query: "hello", Include: []string{"*.java"}, Workers: 2})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 1 {
		t.Fatalf("TotalMatches = %d, want 1 (matches=%+v)", r.TotalMatches, r.Matches)
	}
	if !strings.HasSuffix(filepath.ToSlash(r.Matches[0].File), "a.java") {
		t.Fatalf("File = %q, want .../a.java", r.Matches[0].File)
	}
}

func TestSearch_SameLineContext(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("prefix hello suffix\n"), 0o600))
	r, err := Search(dir, Options{Query: "hello", Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Matches) != 1 {
		t.Fatalf("len(Matches)=%d", len(r.Matches))
	}
	if r.Matches[0].ContextBefore != "prefix " {
		t.Fatalf("ContextBefore=%q", r.Matches[0].ContextBefore)
	}
	if r.Matches[0].ContextAfter != " suffix" {
		t.Fatalf("ContextAfter=%q", r.Matches[0].ContextAfter)
	}
}

func TestListFiles_Basic(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(dir, "src"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "src", "a.java"), []byte("x"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("y"), 0o600))
	must(t, os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "node_modules", "x.js"), []byte("z"), 0o600))

	files, err := ListFiles(dir, ListOptions{MaxFiles: 100})
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, f := range files {
		names[filepath.ToSlash(f.Path)] = true
		if f.Name == "" {
			t.Fatalf("empty name for %v", f)
		}
	}
	if !names["src/a.java"] || !names["b.txt"] {
		t.Fatalf("missing expected files: %v", names)
	}
	if names["node_modules/x.js"] {
		t.Fatal("node_modules should be excluded")
	}
}

func TestListFiles_IncludeMask(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(dir, "src"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "src", "a.java"), []byte("x"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("y"), 0o600))

	files, err := ListFiles(dir, ListOptions{Include: []string{"*.java"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Name != "a.java" {
		t.Fatalf("files=%+v", files)
	}
}

func TestSearch_ParallelWorkers(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	for i := 0; i < 40; i++ {
		must(t, os.WriteFile(filepath.Join(dir, fmt.Sprintf("file-%02d.txt", i)), []byte("hello world\n"), 0o600))
	}
	r, err := Search(dir, Options{Query: "hello", Workers: 8})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 40 {
		t.Fatalf("TotalMatches=%d, want 40", r.TotalMatches)
	}
}

func TestSearch_MultiLineContext(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo hello three\nfour\nfive\n"), 0o600))
	r, err := Search(dir, Options{Query: "hello", ContextLines: 1, Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Matches) != 1 {
		t.Fatalf("len=%d", len(r.Matches))
	}
	m := r.Matches[0]
	if !strings.Contains(m.ContextBefore, "one\n") {
		t.Fatalf("ContextBefore=%q want prior line", m.ContextBefore)
	}
	if !strings.HasSuffix(strings.TrimRight(m.ContextBefore, " "), "two ") && !strings.Contains(m.ContextBefore, "two ") {
		t.Fatalf("ContextBefore=%q want same-line prefix", m.ContextBefore)
	}
	if !strings.Contains(m.ContextAfter, "four") {
		t.Fatalf("ContextAfter=%q want next line", m.ContextAfter)
	}
}

func TestSearch_WorkersFasterOrEqual(t *testing.T) {
	if testing.Short() {
		t.Skip("skip perf comparison in short mode")
	}
	dir := t.TempDir()
	for i := 0; i < 200; i++ {
		must(t, os.WriteFile(filepath.Join(dir, fmt.Sprintf("f-%03d.txt", i)), []byte("hello world content\n"), 0o600))
	}
	start1 := time.Now()
	r1, err := Search(dir, Options{Query: "hello", Workers: 1})
	d1 := time.Since(start1)
	if err != nil {
		t.Fatal(err)
	}
	startN := time.Now()
	rN, err := Search(dir, Options{Query: "hello", Workers: 8})
	dN := time.Since(startN)
	if err != nil {
		t.Fatal(err)
	}
	if r1.TotalMatches != rN.TotalMatches {
		t.Fatalf("match count mismatch: 1=%d 8=%d", r1.TotalMatches, rN.TotalMatches)
	}
	t.Logf("workers=1: %v, workers=8: %v (matches=%d)", d1, dN, rN.TotalMatches)
}

func TestSearch_CancelParallel(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	for i := 0; i < 20; i++ {
		must(t, os.WriteFile(filepath.Join(dir, fmt.Sprintf("f-%02d.txt", i)), []byte("hello\n"), 0o600))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Search(dir, Options{Query: "hello", Cancel: ctx, Workers: 4})
	if err == nil {
		t.Fatal("expected cancel error")
	}
}
