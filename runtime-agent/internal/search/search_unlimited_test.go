// TestSearch_MaxResultsUnlimited verifies MaxResults < 0 means unlimited:
// all matches are returned and Truncated stays false.
package search

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSearch_MaxResultsUnlimited(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	for i := 0; i < 5; i++ {
		content := strings.Repeat("hello\n", 20)
		must(t, os.WriteFile(filepath.Join(dir, fmt.Sprintf("file%d.txt", i)), []byte(content), 0o600))
	}

	r, err := Search(dir, Options{Query: "hello", MaxResults: -1})
	if err != nil {
		t.Fatal(err)
	}
	if r.TotalMatches != 100 {
		t.Errorf("TotalMatches = %d, want 100", r.TotalMatches)
	}
	if r.Truncated {
		t.Errorf("expected Truncated=false for unlimited search")
	}
}
