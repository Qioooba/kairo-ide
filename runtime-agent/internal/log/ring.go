package log

import (
	"sync"
)

// RingBuffer is a small in-memory ring of recent log lines, used
// by the diagnostic center. The zero value is ready to use.
type RingBuffer struct {
	mu    sync.Mutex
	lines []string
	cap   int
	next  int
	full  bool
}

// NewRingBuffer returns a ring buffer with the given capacity.
func NewRingBuffer(cap int) *RingBuffer {
	if cap <= 0 {
		cap = 1000
	}
	return &RingBuffer{lines: make([]string, cap), cap: cap}
}

// Append adds a line to the ring.
func (b *RingBuffer) Append(line string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cap == 0 {
		// Lazily initialize a zero-value RingBuffer so the
		// "zero value is ready to use" docstring is actually true.
		// Without this, Append would panic on the nil-slice index
		// and divide-by-zero on `(b.next+1) % b.cap`.
		b.cap = 1000
		b.lines = make([]string, b.cap)
	}
	b.lines[b.next] = line
	b.next = (b.next + 1) % b.cap
	if b.next == 0 {
		b.full = true
	}
}

// Snapshot returns a copy of the lines in chronological order.
func (b *RingBuffer) Snapshot() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.full {
		out := make([]string, b.next)
		copy(out, b.lines[:b.next])
		return out
	}
	out := make([]string, b.cap)
	copy(out, b.lines[b.next:])
	copy(out[b.cap-b.next:], b.lines[:b.next])
	return out
}

// Len returns the number of lines currently held.
func (b *RingBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.full {
		return b.cap
	}
	return b.next
}
