package search

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// T28: Verify consumer abort on large search joins all producer goroutines immediately with no leaks.
func TestStreamingSearch_ConsumerAbortJoinsWorkers_T28(t *testing.T) {
	dir := t.TempDir()

	// Create 200 files, each with 50 lines matching "target_query"
	for i := 0; i < 200; i++ {
		var lines []string
		for j := 0; j < 50; j++ {
			lines = append(lines, fmt.Sprintf("target_query file %d line %d extra padding content", i, j))
		}
		fname := filepath.Join(dir, fmt.Sprintf("file_%03d.txt", i))
		if err := os.WriteFile(fname, []byte(strings.Join(lines, "\n")), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	initialGoroutines := runtime.NumGoroutine()

	consumerAbortErr := errors.New("consumer stopped: user closed search panel")

	var batchReceived atomic.Int32
	ctx := context.Background()

	stats, err := SearchStreamingWithStats(ctx, dir, Options{
		Query:   "target_query",
		Workers: 8,
	}, func(batch []Match, batchIndex int, total int) error {
		batchReceived.Add(1)
		// Consumer aborts on first batch
		return consumerAbortErr
	})

	if !errors.Is(err, consumerAbortErr) {
		t.Fatalf("expected error %v, got %v", consumerAbortErr, err)
	}

	if batchReceived.Load() != 1 {
		t.Fatalf("expected exactly 1 batch processed before abort, got %d", batchReceived.Load())
	}

	// Verify SearchStreamingWithStats returned and producer goroutines joined
	runtime.GC()
	time.Sleep(50 * time.Millisecond)
	finalGoroutines := runtime.NumGoroutine()

	// Goroutine leak check: final should not exceed initial by more than a small margin (e.g., test runner jitter <= 3)
	if diff := finalGoroutines - initialGoroutines; diff > 3 {
		t.Errorf("goroutine leak detected: initial=%d, final=%d (diff=%d)", initialGoroutines, finalGoroutines, diff)
	}

	_ = stats
}

// T29: Verify completion metadata (filesSearched, skippedFiles, truncated, durationMs).
func TestStreamingSearch_CompletionMetadata_T29(t *testing.T) {
	dir := t.TempDir()

	// Normal searchable files (3 files, total 15 matches)
	for i := 0; i < 3; i++ {
		content := strings.Repeat(fmt.Sprintf("match_token line in file %d\n", i), 5)
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("normal_%d.txt", i)), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	// Oversized file exceeding MaxFileBytes (e.g. 500 bytes with limit of 200 bytes)
	oversizedContent := strings.Repeat("match_token oversized data line here\n", 20) // ~740 bytes
	if err := os.WriteFile(filepath.Join(dir, "oversized.txt"), []byte(oversizedContent), 0o600); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	var totalMatchesReceived int

	// Search with MaxFileBytes=200 and MaxResults=10
	stats, err := SearchStreamingWithStats(ctx, dir, Options{
		Query:        "match_token",
		MaxFileBytes: 200,
		MaxResults:   10,
	}, func(batch []Match, batchIndex int, total int) error {
		totalMatchesReceived += len(batch)
		return nil
	})

	if err != nil {
		t.Fatalf("unexpected search error: %v", err)
	}

	// 1. Truncated verification: MaxResults was 10, total matches reached 10
	if !stats.Truncated {
		t.Errorf("expected stats.Truncated to be true")
	}

	// 2. SkippedFiles verification: oversized.txt should be skipped
	if stats.SkippedFiles < 1 {
		t.Errorf("expected stats.SkippedFiles >= 1, got %d", stats.SkippedFiles)
	}

	// 3. FilesSearched verification: at least 3 normal files searched
	if stats.FilesSearched < 3 {
		t.Errorf("expected stats.FilesSearched >= 3, got %d", stats.FilesSearched)
	}

	// 4. DurationMs verification
	if stats.DurationMs < 0 {
		t.Errorf("expected stats.DurationMs >= 0, got %d", stats.DurationMs)
	}

	// 5. Cancelled verification: normal completion must NOT be marked cancelled
	if stats.Cancelled {
		t.Errorf("expected stats.Cancelled to be false on normal completion, got true")
	}

	if totalMatchesReceived == 0 {
		t.Errorf("expected matches to be received, got 0")
	}
}

// T30: Verify rapid cancellation / typing debounce simulation (100 rapid searches cancel cleanly).
func TestStreamingSearch_RapidTypingCancellation_T30(t *testing.T) {
	dir := t.TempDir()

	// Populate test directory with files
	for i := 0; i < 50; i++ {
		content := strings.Repeat(fmt.Sprintf("debounce_query token in file %d\nother random lines\n", i), 20)
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("file_%02d.txt", i)), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	runtime.GC()
	initialGoroutines := runtime.NumGoroutine()

	var wg sync.WaitGroup
	const queriesCount = 100

	cancelledCount := atomic.Int32{}

	for i := 0; i < queriesCount; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			ctx, cancel := context.WithCancel(context.Background())

			// Rapid cancel: either immediate, or after a few milliseconds
			if idx%3 == 0 {
				cancel() // cancelled before or right at start
			} else {
				go func() {
					time.Sleep(time.Duration(idx%5) * time.Millisecond)
					cancel()
				}()
			}

			stats, err := SearchStreamingWithStats(ctx, dir, Options{
				Query:   "debounce_query",
				Workers: 4,
			}, func(batch []Match, batchIndex int, total int) error {
				// simulate minimal processing
				return nil
			})

			if errors.Is(err, context.Canceled) || stats.Cancelled {
				cancelledCount.Add(1)
			}
		}(i)
	}

	wg.Wait()

	if cancelledCount.Load() == 0 {
		t.Errorf("expected cancelled searches, got 0")
	}

	// Verify goroutines recover to baseline after all 100 rapid searches terminate
	runtime.GC()
	time.Sleep(100 * time.Millisecond)
	finalGoroutines := runtime.NumGoroutine()

	if diff := finalGoroutines - initialGoroutines; diff > 5 {
		t.Errorf("lingering goroutines after rapid cancellations: initial=%d, final=%d (diff=%d)", initialGoroutines, finalGoroutines, diff)
	}
}
