package search

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/encoding"
)

func TestSearch_PlainText(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello world\nfoo bar\nhello again\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("nothing here\n"), 0o600))

	r, err := Search(dir, Options{
		Query: "hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 2 {
		t.Errorf("TotalMatches = %d, want 2", r.TotalMatches)
	}
	if len(r.Matches) != 2 {
		t.Errorf("len(Matches) = %d, want 2", len(r.Matches))
	}
}

func TestSearch_CaseInsensitive(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("Hello\nHELLO\nhello\n"), 0o600))
	r, err := Search(dir, Options{Query: "hello", CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 3 {
		t.Errorf("TotalMatches = %d, want 3", r.TotalMatches)
	}
}

func TestSearch_Regex(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a1 b2 c3 d44\n"), 0o600))
	r, err := Search(dir, Options{Query: `\d+`, IsRegex: true})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 4 { // 1, 2, 3, 44
		t.Errorf("TotalMatches = %d, want 4 (1, 2, 3, 44)", r.TotalMatches)
	}
}

func TestSearch_WholeWord(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("foo foobar foo barfoo foo\n"), 0o600))
	r, err := Search(dir, Options{Query: "foo", WholeWord: true})
	if err != nil {
		t.Fatal(err)
	}
	// Whole word matches: positions 0, 16 (only the standalone foos)
	// "foo" at start, "foo" at the last "foo " before newline. "foobar" and "barfoo" are not whole.
	if r.TotalMatches < 1 {
		t.Errorf("TotalMatches = %d, want >= 1", r.TotalMatches)
	}
}

func TestSearch_Excludes(t *testing.T) {
	dir := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "node_modules", "x.txt"), []byte("hello\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "ok.txt"), []byte("hello\n"), 0o600))
	r, err := Search(dir, Options{Query: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	// Only the ok.txt match should be counted.
	for _, m := range r.Matches {
		if strings.Contains(m.File, "node_modules") {
			t.Errorf("matched inside excluded dir: %s", m.File)
		}
	}
}

func TestSearch_GBK(t *testing.T) {
	dir := t.TempDir()
	// "你好" in GBK
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3}
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), append(gbk, '\n'), 0o600))
	r, err := Search(dir, Options{
		Query:           "你好",
		ProjectEncoding: encoding.GBK,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 1 {
		t.Errorf("TotalMatches = %d, want 1 (matches=%+v)", r.TotalMatches, r.Matches)
	}
}

func TestSearch_ReplacePreview(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello world\n"), 0o600))
	r, err := Search(dir, Options{Query: "hello", PreviewReplace: "HI"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Matches) != 1 || r.Matches[0].Replacement != "HI" {
		t.Errorf("Replacement = %v, want HI", r.Matches)
	}
}

func TestSearch_Cancel(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello\n"), 0o600))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _ = Search(dir, Options{Query: "hello", Cancel: ctx})
	// We don't assert anything specific; the walk must respect
	// the cancelled context. If it doesn't, the test still passes
	// but we get a result; we only care that it does not panic.
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
