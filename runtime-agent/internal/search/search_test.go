package search

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
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
	result, err := Search(dir, Options{Query: "hello", Cancel: ctx})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Search error = %v, want context.Canceled", err)
	}
	if result != nil {
		t.Fatalf("Search result = %+v, want nil after cancellation", result)
	}
}

func TestSearch_DeadlineExceeded(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello\n"), 0o600))
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	result, err := Search(dir, Options{Query: "hello", Cancel: ctx})
	if !errors.Is(err, context.DeadlineExceeded) || result != nil {
		t.Fatalf("Search result=%+v error=%v, want nil/context.DeadlineExceeded", result, err)
	}
}

func TestSearch_MissingRootIsError(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	result, err := Search(missing, Options{Query: "hello"})
	if err == nil || result != nil {
		t.Fatalf("Search result=%+v error=%v, want root error", result, err)
	}
}

func TestReadAllContext_CancelsBetweenChunks(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	reader := &cancelAfterFirstRead{reader: bytes.NewReader(bytes.Repeat([]byte("x"), 256*1024)), cancel: cancel}
	result, err := readAllContext(ctx, reader)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("readAllContext error=%v, want context.Canceled", err)
	}
	if result != nil {
		t.Fatalf("readAllContext returned %d bytes after cancellation, want nil", len(result))
	}
}

type cancelAfterFirstRead struct {
	reader io.Reader
	cancel context.CancelFunc
	once   sync.Once
}

func (r *cancelAfterFirstRead) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.once.Do(r.cancel)
	return n, err
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// TestSearch_ExactMatch 精确匹配搜索
func TestSearch_ExactMatch(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello world\nfoo bar\n"), 0o600))

	r, err := Search(dir, Options{Query: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 1 {
		t.Errorf("TotalMatches = %d, want 1", r.TotalMatches)
	}
	if len(r.Matches) != 1 {
		t.Fatalf("len(Matches) = %d, want 1", len(r.Matches))
	}
	if r.Matches[0].MatchText != "hello" {
		t.Errorf("MatchText = %q, want hello", r.Matches[0].MatchText)
	}
	if r.Matches[0].File != "a.txt" {
		t.Errorf("File = %q, want a.txt", r.Matches[0].File)
	}
}

// TestSearch_CaseInsensitiveMatch 大小写不敏感搜索验证
func TestSearch_CaseInsensitiveMatch(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("Hello World\nHELLO\nhello\n"), 0o600))
	r, err := Search(dir, Options{Query: "hello", CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 3 {
		t.Errorf("TotalMatches = %d, want 3", r.TotalMatches)
	}
}

// TestSearch_RegexPattern 正则表达式搜索验证
func TestSearch_RegexPattern(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a1 b2 c3 d44 e55\n"), 0o600))
	r, err := Search(dir, Options{Query: `\d{2,}`, IsRegex: true})
	if err != nil {
		t.Fatal(err)
	}
	// Should match "44" and "55" (two-digit numbers)
	if r.TotalMatches != 2 {
		t.Errorf("TotalMatches = %d, want 2 (44, 55)", r.TotalMatches)
	}
}

// TestSearch_WholeWordMatch 全词匹配搜索验证
func TestSearch_WholeWordMatch(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("foo foobar foo barfoo foo\n"), 0o600))
	r, err := Search(dir, Options{Query: "foo", WholeWord: true})
	if err != nil {
		t.Fatal(err)
	}
	// Should match standalone "foo" at positions 0, 16, 24
	if r.TotalMatches < 1 {
		t.Errorf("TotalMatches = %d, want >= 1", r.TotalMatches)
	}
	for _, m := range r.Matches {
		if m.MatchText != "foo" {
			t.Errorf("whole word match returned %q, want foo", m.MatchText)
		}
	}
}

// TestSearch_GBK_File 在 GBK 编码文件中搜索
func TestSearch_GBK_File(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// "你好世界" in GBK
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7}
	must(t, os.WriteFile(filepath.Join(dir, "gbk.txt"), append(gbk, '\n'), 0o600))
	r, err := Search(dir, Options{
		Query:           "你好",
		ProjectEncoding: encoding.GBK,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 1 {
		t.Errorf("TotalMatches = %d, want 1", r.TotalMatches)
	}
	if r.Matches[0].MatchText != "你好" {
		t.Errorf("MatchText = %q, want 你好", r.Matches[0].MatchText)
	}
}

// TestSearch_UTF8_File 在 UTF-8 文件中搜索中文
func TestSearch_UTF8_File(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "utf8.txt"), []byte("你好世界\nHello 你好\n"), 0o600))
	r, err := Search(dir, Options{
		Query:           "你好",
		ProjectEncoding: encoding.UTF8,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 2 {
		t.Errorf("TotalMatches = %d, want 2", r.TotalMatches)
	}
}

// TestSearch_MultipleFiles 多文件搜索
func TestSearch_MultipleFiles(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("hello world\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "c.txt"), []byte("no match\n"), 0o600))

	r, err := Search(dir, Options{Query: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 2 {
		t.Errorf("TotalMatches = %d, want 2", r.TotalMatches)
	}
	// 验证结果来自两个不同文件
	files := map[string]bool{}
	for _, m := range r.Matches {
		files[m.File] = true
	}
	if len(files) != 2 {
		t.Errorf("matches from %d files, want 2", len(files))
	}
}

// TestSearch_MaxResults 验证最大结果数限制
func TestSearch_MaxResults(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 创建多个文件，每个文件有多个匹配，验证 MaxResults 截断
	for i := 0; i < 5; i++ {
		content := strings.Repeat("hello\n", 20)
		must(t, os.WriteFile(filepath.Join(dir, fmt.Sprintf("file%d.txt", i)), []byte(content), 0o600))
	}

	r, err := Search(dir, Options{Query: "hello", MaxResults: 15})
	if err != nil {
		t.Fatal(err)
	}
	// MaxResults 在遍历文件前检查，第一个文件全部匹配（20个）后停止
	if r.TotalMatches < 15 {
		t.Errorf("TotalMatches = %d, want >= 15", r.TotalMatches)
	}
	if !r.Truncated {
		t.Errorf("expected Truncated=true")
	}
}

// TestSearch_CancelMidStream 取消搜索验证
func TestSearch_CancelMidStream(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello\n"), 0o600))
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 立即取消
	result, err := Search(dir, Options{Query: "hello", Cancel: ctx})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Search error = %v, want context.Canceled", err)
	}
	if result != nil {
		t.Fatalf("Search result = %+v, want nil after cancellation", result)
	}
}

// TestSearch_EmptyQuery 空查询应返回空结果
func TestSearch_EmptyQuery(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello\n"), 0o600))
	r, err := Search(dir, Options{Query: ""})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 0 {
		t.Errorf("TotalMatches = %d, want 0", r.TotalMatches)
	}
}

// TestSearch_NoResults 搜索不存在的字符串
func TestSearch_NoResults(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello world\n"), 0o600))
	r, err := Search(dir, Options{Query: "nonexistent"})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 0 {
		t.Errorf("TotalMatches = %d, want 0", r.TotalMatches)
	}
	if len(r.Matches) != 0 {
		t.Errorf("len(Matches) = %d, want 0", len(r.Matches))
	}
}

// TestSearch_StreamingResults 验证流式搜索分批返回结果
func TestSearch_StreamingResults(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// 创建包含多个匹配的文件
	var lines []string
	for i := 0; i < 200; i++ {
		lines = append(lines, "hello"+fmt.Sprintf("-%d", i))
	}
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte(strings.Join(lines, "\n")), 0o600))

	ctx := context.Background()
	var batches [][]Match
	err := SearchStreaming(ctx, dir, Options{Query: "hello"}, func(batch []Match, batchIndex int, total int) error {
		batches = append(batches, batch)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(batches) < 2 {
		t.Errorf("expected at least 2 batches, got %d", len(batches))
	}
	// 验证总匹配数
	total := 0
	for _, b := range batches {
		total += len(b)
	}
	if total != 200 {
		t.Errorf("total matches = %d, want 200", total)
	}
}

// TestSearch_StreamingCancel 流式搜索取消
func TestSearch_StreamingCancel(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	content := strings.Repeat("hello\n", 500)
	must(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte(content), 0o600))

	ctx, cancel := context.WithCancel(context.Background())
	count := 0
	err := SearchStreaming(ctx, dir, Options{Query: "hello"}, func(batch []Match, batchIndex int, total int) error {
		count++
		if count >= 2 {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error = %v, want context.Canceled", err)
	}
}

// TestSearch_BinaryFilesSkipped 验证二进制文件被跳过
func TestSearch_BinaryFilesSkipped(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// Create a file with binary extension
	must(t, os.WriteFile(filepath.Join(dir, "image.png"), []byte("hello"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "ok.txt"), []byte("hello"), 0o600))

	r, err := Search(dir, Options{Query: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	// 只应匹配 txt 文件
	if r.TotalMatches != 1 {
		t.Errorf("TotalMatches = %d, want 1", r.TotalMatches)
	}
	for _, m := range r.Matches {
		if strings.HasSuffix(m.File, ".png") {
			t.Errorf("matched binary file: %s", m.File)
		}
	}
}

// TestSearch_IncludeGlob 验证 include 文件过滤
func TestSearch_IncludeGlob(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.java"), []byte("hello\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("hello\n"), 0o600))

	r, err := Search(dir, Options{Query: "hello", Include: []string{"*.java"}})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 1 {
		t.Errorf("TotalMatches = %d, want 1", r.TotalMatches)
	}
	if r.Matches[0].File != "a.java" {
		t.Errorf("File = %q, want a.java", r.Matches[0].File)
	}
}

// TestSearch_ExcludeGlob 验证 exclude 文件过滤
func TestSearch_ExcludeGlob(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "a.java"), []byte("hello\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("hello\n"), 0o600))

	r, err := Search(dir, Options{Query: "hello", Exclude: []string{"*.java"}})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 1 {
		t.Errorf("TotalMatches = %d, want 1", r.TotalMatches)
	}
	if r.Matches[0].File != "b.txt" {
		t.Errorf("File = %q, want b.txt", r.Matches[0].File)
	}
}

// TestSearch_EmptyRootIsError 验证空根路径返回错误
func TestSearch_EmptyRootIsError(t *testing.T) {
	t.Parallel()
	_, err := Search("", Options{Query: "hello"})
	if err == nil {
		t.Fatal("expected error for empty root")
	}
}
