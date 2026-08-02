package search

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestSearchStreaming_FirstBatchLatency builds a tree of many small files
// (4K-random-read heavy) and asserts the first streamed batch arrives
// quickly — the UX metric IDEA users notice first.
func TestSearchStreaming_FirstBatchLatency(t *testing.T) {
	if testing.Short() {
		t.Skip("skip latency gate in short mode")
	}
	dir := t.TempDir()
	const files = 800
	for i := 0; i < files; i++ {
		subdir := filepath.Join(dir, fmt.Sprintf("pkg%02d", i%20))
		_ = os.MkdirAll(subdir, 0o755)
		// Put the needle early so a healthy walk can return quickly,
		// but still create hundreds of siblings to stress metadata+open.
		content := "package sample\n"
		if i < 5 {
			content = "package sample\nfunc Hello() {}\n"
		}
		must(t, os.WriteFile(filepath.Join(subdir, fmt.Sprintf("F%03d.java", i)), []byte(content), 0o600))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	start := time.Now()
	var firstBatchAt time.Duration
	err := SearchStreaming(ctx, dir, Options{Query: "Hello", Workers: 8}, func(batch []Match, batchIndex int, total int) error {
		if batchIndex == 0 && firstBatchAt == 0 {
			firstBatchAt = time.Since(start)
		}
		return nil
	})
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if firstBatchAt == 0 {
		t.Fatal("never received first batch")
	}
	t.Logf("first batch: %v, total: %v, files=%d", firstBatchAt, elapsed, files)

	// Gate: first batch should surface well under 1.5s on a local disk.
	// (CI/HDDs may be slower — keep a generous ceiling.)
	const maxFirst = 1500 * time.Millisecond
	if firstBatchAt > maxFirst {
		t.Fatalf("first batch too slow: %v > %v", firstBatchAt, maxFirst)
	}
}

// TestListFiles_LargeTreeLatency ensures filename listing (no content read)
// stays cheap relative to content search on the same tree.
func TestListFiles_LargeTreeLatency(t *testing.T) {
	if testing.Short() {
		t.Skip("skip latency gate in short mode")
	}
	dir := t.TempDir()
	const files = 2000
	for i := 0; i < files; i++ {
		subdir := filepath.Join(dir, fmt.Sprintf("d%02d", i%40))
		_ = os.MkdirAll(subdir, 0o755)
		must(t, os.WriteFile(filepath.Join(subdir, fmt.Sprintf("f%04d.txt", i)), []byte("x"), 0o600))
	}

	start := time.Now()
	entries, err := ListFiles(dir, ListOptions{MaxFiles: files})
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < files {
		t.Fatalf("listed %d, want %d", len(entries), files)
	}
	t.Logf("ListFiles(%d) = %v", len(entries), elapsed)
	if elapsed > 2*time.Second {
		t.Fatalf("ListFiles too slow: %v", elapsed)
	}
}
