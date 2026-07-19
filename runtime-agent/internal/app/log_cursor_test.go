package app

import (
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

func TestLogCursor_BasicSequence(t *testing.T) {
	buf := newServerLogBuffer(5)
	for i := 0; i < 3; i++ {
		buf.Append(domain.LogLine{Text: "line", Generation: 1})
	}
	lines, next, gap := buf.Read(0, 10)
	if gap {
		t.Error("unexpected gap for cursor=0")
	}
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(lines))
	}
	for i, l := range lines {
		if l.Sequence != uint64(i) {
			t.Errorf("line %d: expected sequence %d, got %d", i, i, l.Sequence)
		}
	}
	if next != 3 {
		t.Errorf("expected next cursor 3, got %d", next)
	}
}

func TestLogCursor_GapDetection(t *testing.T) {
	buf := newServerLogBuffer(3) // small buffer
	for i := 0; i < 5; i++ {
		buf.Append(domain.LogLine{Text: "line", Generation: 1})
	}
	// Buffer has wrapped. Oldest should be seq=2 (seq 0,1 evicted).
	lines, _, gap := buf.Read(0, 10)
	if !gap {
		t.Error("expected gap=true for cursor=0 when buffer has wrapped")
	}
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines (buffer size), got %d", len(lines))
	}
	if lines[0].Sequence != 2 {
		t.Errorf("expected first line sequence=2, got %d", lines[0].Sequence)
	}
}

func TestLogCursor_NoGapWhenUpToDate(t *testing.T) {
	buf := newServerLogBuffer(100)
	for i := 0; i < 5; i++ {
		buf.Append(domain.LogLine{Text: "line", Generation: 1})
	}
	lines, next, gap := buf.Read(5, 10)
	if gap {
		t.Error("unexpected gap when cursor is up to date")
	}
	if len(lines) != 0 {
		t.Errorf("expected 0 lines when cursor is up to date, got %d", len(lines))
	}
	if next != 5 {
		t.Errorf("expected next=5, got %d", next)
	}
}

func TestLogCursor_ContinuousPagination(t *testing.T) {
	buf := newServerLogBuffer(100)
	for i := 0; i < 10; i++ {
		buf.Append(domain.LogLine{Text: "line", Generation: 1})
	}
	// Read first page of 3.
	page1, cursor1, gap1 := buf.Read(0, 3)
	if gap1 {
		t.Fatal("unexpected gap on first page")
	}
	if len(page1) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(page1))
	}
	// Read second page.
	page2, cursor2, gap2 := buf.Read(cursor1, 3)
	if gap2 {
		t.Fatal("unexpected gap on second page")
	}
	if len(page2) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(page2))
	}
	// Read remaining.
	page3, cursor3, gap3 := buf.Read(cursor2, 10)
	if gap3 {
		t.Fatal("unexpected gap on third page")
	}
	if len(page3) != 4 {
		t.Fatalf("expected 4 lines, got %d", len(page3))
	}
	if cursor3 != 10 {
		t.Errorf("expected final cursor 10, got %d", cursor3)
	}
	// Verify sequences are monotonically increasing across pages.
	all := append(append(page1, page2...), page3...)
	for i := 1; i < len(all); i++ {
		if all[i].Sequence <= all[i-1].Sequence {
			t.Errorf("sequences not monotonic: %d <= %d at index %d", all[i].Sequence, all[i-1].Sequence, i)
		}
	}
}
