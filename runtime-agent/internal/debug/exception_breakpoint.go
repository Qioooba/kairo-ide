// Package debug — exception breakpoint management.
//
// Implements catching uncaught exceptions, caught+uncaught
// exceptions, and exception class filtering via JDWP event
// requests.
package debug

import (
	"fmt"
	"sync"
)

// ExceptionCatchMode defines how exceptions are caught.
type ExceptionCatchMode string

const (
	ExceptionCatchUncaught      ExceptionCatchMode = "uncaught"
	ExceptionCatchAll           ExceptionCatchMode = "all"
	ExceptionCatchCaughtOnly    ExceptionCatchMode = "caught"
)

// ExceptionBreakpoint represents an exception breakpoint.
type ExceptionBreakpoint struct {
	ID             int32             `json:"id"`
	Enabled        bool              `json:"enabled"`
	CatchMode      ExceptionCatchMode `json:"catchMode"`
	ExceptionClass string            `json:"exceptionClass,omitempty"`
	SuspendPolicy  byte              `json:"suspendPolicy"`
	HitCount       int64             `json:"hitCount"`
}

// ExceptionBreakpointManager manages exception breakpoints.
type ExceptionBreakpointManager struct {
	mu          sync.RWMutex
	breakpoints map[int32]*ExceptionBreakpoint
	nextID      int32
}

// NewExceptionBreakpointManager creates a new ExceptionBreakpointManager.
func NewExceptionBreakpointManager() *ExceptionBreakpointManager {
	return &ExceptionBreakpointManager{
		breakpoints: make(map[int32]*ExceptionBreakpoint),
		nextID:      1,
	}
}

// AddExceptionBreakpoint adds an exception breakpoint.
func (ebm *ExceptionBreakpointManager) AddExceptionBreakpoint(bp *ExceptionBreakpoint) int32 {
	ebm.mu.Lock()
	defer ebm.mu.Unlock()

	bp.ID = ebm.nextID
	ebm.nextID++
	if bp.Enabled == false && bp.CatchMode != "" {
		bp.Enabled = true
	}
	if bp.SuspendPolicy == 0 {
		bp.SuspendPolicy = suspendAll
	}
	ebm.breakpoints[bp.ID] = bp
	return bp.ID
}

// RemoveExceptionBreakpoint removes an exception breakpoint by ID.
func (ebm *ExceptionBreakpointManager) RemoveExceptionBreakpoint(id int32) error {
	ebm.mu.Lock()
	defer ebm.mu.Unlock()

	if _, ok := ebm.breakpoints[id]; !ok {
		return fmt.Errorf("exception breakpoint %d not found", id)
	}
	delete(ebm.breakpoints, id)
	return nil
}

// GetExceptionBreakpoint returns an exception breakpoint by ID.
func (ebm *ExceptionBreakpointManager) GetExceptionBreakpoint(id int32) (*ExceptionBreakpoint, bool) {
	ebm.mu.RLock()
	defer ebm.mu.RUnlock()

	bp, ok := ebm.breakpoints[id]
	return bp, ok
}

// ListExceptionBreakpoints returns all exception breakpoints.
func (ebm *ExceptionBreakpointManager) ListExceptionBreakpoints() []*ExceptionBreakpoint {
	ebm.mu.RLock()
	defer ebm.mu.RUnlock()

	result := make([]*ExceptionBreakpoint, 0, len(ebm.breakpoints))
	for _, bp := range ebm.breakpoints {
		result = append(result, bp)
	}
	return result
}

// EnableExceptionBreakpoint enables an exception breakpoint.
func (ebm *ExceptionBreakpointManager) EnableExceptionBreakpoint(id int32) error {
	ebm.mu.Lock()
	defer ebm.mu.Unlock()

	bp, ok := ebm.breakpoints[id]
	if !ok {
		return fmt.Errorf("exception breakpoint %d not found", id)
	}
	bp.Enabled = true
	return nil
}

// DisableExceptionBreakpoint disables an exception breakpoint.
func (ebm *ExceptionBreakpointManager) DisableExceptionBreakpoint(id int32) error {
	ebm.mu.Lock()
	defer ebm.mu.Unlock()

	bp, ok := ebm.breakpoints[id]
	if !ok {
		return fmt.Errorf("exception breakpoint %d not found", id)
	}
	bp.Enabled = false
	return nil
}

// IncrementHitCount increments hit count for an exception breakpoint.
func (ebm *ExceptionBreakpointManager) IncrementHitCount(id int32) {
	ebm.mu.Lock()
	defer ebm.mu.Unlock()

	if bp, ok := ebm.breakpoints[id]; ok {
		bp.HitCount++
	}
}

// ClearAll removes all exception breakpoints.
func (ebm *ExceptionBreakpointManager) ClearAll() {
	ebm.mu.Lock()
	defer ebm.mu.Unlock()

	ebm.breakpoints = make(map[int32]*ExceptionBreakpoint)
}

// Count returns the number of exception breakpoints.
func (ebm *ExceptionBreakpointManager) Count() int {
	ebm.mu.RLock()
	defer ebm.mu.RUnlock()
	return len(ebm.breakpoints)
}

// ── JDWP Command Builders for Exception Breakpoints ───────────────

// BuildExceptionEventRequestCommand builds an EventRequest.Set
// command for exception events.
//
// Command data:
//
//	byte: eventKind (4 = exception)
//	byte: suspendPolicy
//	int:  modifier count
//	[modifiers:
//	  byte: 8 (ClassOnly)
//	  long: exceptionClassID (0 for all exceptions)
//	  byte: caught (1)
//	  byte: uncaught (1)
//	]
func BuildExceptionEventRequestCommand(exceptionClassID int64, caught, uncaught bool, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindException)
	w.WriteByte(suspendPolicy)
	w.WriteInt(1) // one modifier

	// ClassOnly + ExceptionOnly modifier
	w.WriteByte(8) // ModKind.ClassOnly = 8 (for exception filtering)
	if exceptionClassID != 0 {
		w.WriteObjectID(exceptionClassID)
	} else {
		w.WriteObjectID(0)
	}

	// caught/uncaught flags
	if caught {
		w.WriteByte(1)
	} else {
		w.WriteByte(0)
	}
	if uncaught {
		w.WriteByte(1)
	} else {
		w.WriteByte(0)
	}

	return w.Bytes()
}

// BuildExceptionEventWithClassFilterCommand builds an EventRequest.Set
// command for exception events filtered by class name pattern.
//
// Uses a ClassMatch or ClassExclude modifier to filter exceptions.
func BuildExceptionEventWithClassFilterCommand(classNamePattern string, caught, uncaught bool, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindException)
	w.WriteByte(suspendPolicy)
	w.WriteInt(2) // two modifiers

	// ClassMatch modifier
	w.WriteByte(5) // ModKind.ClassMatch = 5
	w.WriteString(classNamePattern)

	// caught/uncaught flags
	w.WriteByte(8) // ModKind.ClassOnly = 8
	w.WriteObjectID(0)
	if caught {
		w.WriteByte(1)
	} else {
		w.WriteByte(0)
	}
	if uncaught {
		w.WriteByte(1)
	} else {
		w.WriteByte(0)
	}

	return w.Bytes()
}

// BuildClearExceptionEventCommand builds an EventRequest.Clear
// command for an exception event.
func BuildClearExceptionEventCommand(requestID int32) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindException)
	w.WriteInt(requestID)
	return w.Bytes()
}

// ── Exception Matching ────────────────────────────────────────────

// MatchException checks if an exception breakpoint should trigger
// for the given exception class name and whether it was caught or
// uncaught.
func MatchException(bp *ExceptionBreakpoint, exceptionClassName string, wasCaught bool) bool {
	if !bp.Enabled {
		return false
	}

	// Check catch mode
	switch bp.CatchMode {
	case ExceptionCatchUncaught:
		if wasCaught {
			return false
		}
	case ExceptionCatchCaughtOnly:
		if !wasCaught {
			return false
		}
	case ExceptionCatchAll:
		// Both caught and uncaught
	}

	// Check class filter
	if bp.ExceptionClass != "" && bp.ExceptionClass != exceptionClassName {
		return false
	}

	return true
}