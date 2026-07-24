package debug

import (
	"testing"
)

func TestExceptionBreakpointManager_Add(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	bp := &ExceptionBreakpoint{
		CatchMode:      ExceptionCatchAll,
		ExceptionClass: "java.lang.RuntimeException",
	}
	id := ebm.AddExceptionBreakpoint(bp)

	if id != 1 {
		t.Errorf("expected ID 1, got %d", id)
	}
	if bp.ID != 1 {
		t.Errorf("expected bp.ID 1, got %d", bp.ID)
	}
	if !bp.Enabled {
		t.Error("exception breakpoint should be enabled by default")
	}
	if bp.SuspendPolicy != suspendAll {
		t.Errorf("expected suspendAll, got %d", bp.SuspendPolicy)
	}
}

func TestExceptionBreakpointManager_AddMultiple(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	id1 := ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll})
	id2 := ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchUncaught})
	id3 := ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchCaughtOnly})

	if id1 != 1 || id2 != 2 || id3 != 3 {
		t.Errorf("expected sequential IDs, got %d,%d,%d", id1, id2, id3)
	}
	if ebm.Count() != 3 {
		t.Errorf("expected 3, got %d", ebm.Count())
	}
}

func TestExceptionBreakpointManager_Get(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll, ExceptionClass: "java.lang.NPE"})

	bp, ok := ebm.GetExceptionBreakpoint(1)
	if !ok {
		t.Fatal("should find exception breakpoint")
	}
	if bp.ExceptionClass != "java.lang.NPE" {
		t.Errorf("expected java.lang.NPE, got %s", bp.ExceptionClass)
	}

	_, ok = ebm.GetExceptionBreakpoint(999)
	if ok {
		t.Error("should not find nonexistent")
	}
}

func TestExceptionBreakpointManager_Remove(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll})
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchUncaught})

	err := ebm.RemoveExceptionBreakpoint(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ebm.Count() != 1 {
		t.Errorf("expected 1, got %d", ebm.Count())
	}

	err = ebm.RemoveExceptionBreakpoint(999)
	if err == nil {
		t.Error("expected error for nonexistent")
	}
}

func TestExceptionBreakpointManager_EnableDisable(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll})

	err := ebm.DisableExceptionBreakpoint(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ := ebm.GetExceptionBreakpoint(1)
	if bp.Enabled {
		t.Error("should be disabled")
	}

	err = ebm.EnableExceptionBreakpoint(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ = ebm.GetExceptionBreakpoint(1)
	if !bp.Enabled {
		t.Error("should be enabled")
	}
}

func TestExceptionBreakpointManager_HitCount(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll})

	ebm.IncrementHitCount(1)
	ebm.IncrementHitCount(1)

	bp, _ := ebm.GetExceptionBreakpoint(1)
	if bp.HitCount != 2 {
		t.Errorf("expected hit count 2, got %d", bp.HitCount)
	}

	// Should not panic for nonexistent
	ebm.IncrementHitCount(999)
}

func TestExceptionBreakpointManager_ClearAll(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll})
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchUncaught})

	ebm.ClearAll()
	if ebm.Count() != 0 {
		t.Errorf("expected 0, got %d", ebm.Count())
	}
}

func TestExceptionBreakpointManager_List(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll})
	ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchUncaught, ExceptionClass: "java.io.IOException"})

	list := ebm.ListExceptionBreakpoints()
	if len(list) != 2 {
		t.Errorf("expected 2, got %d", len(list))
	}
}

// ── Command Builder Tests ─────────────────────────────────────────

func TestBuildExceptionEventRequestCommand(t *testing.T) {
	data := BuildExceptionEventRequestCommand(0x100, true, true, suspendAll)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindException {
		t.Errorf("eventKind = %d, want %d", eventKind, eventKindException)
	}

	suspend, _ := r.ReadByte()
	if suspend != suspendAll {
		t.Errorf("suspend = %d, want %d", suspend, suspendAll)
	}

	modCount, _ := r.ReadInt()
	if modCount != 1 {
		t.Errorf("modCount = %d, want 1", modCount)
	}

	modKind, _ := r.ReadByte()
	if modKind != 8 {
		t.Errorf("modKind = %d, want 8", modKind)
	}

	classID, _ := r.ReadObjectID()
	if classID != 0x100 {
		t.Errorf("classID = %d, want 0x100", classID)
	}

	caught, _ := r.ReadByte()
	if caught != 1 {
		t.Errorf("caught = %d, want 1", caught)
	}

	uncaught, _ := r.ReadByte()
	if uncaught != 1 {
		t.Errorf("uncaught = %d, want 1", uncaught)
	}
}

func TestBuildExceptionEventRequestCommand_UncaughtOnly(t *testing.T) {
	data := BuildExceptionEventRequestCommand(0, false, true, suspendAll)
	r := NewJDWPDataReader(data)

	r.ReadByte()    // eventKind
	r.ReadByte()    // suspend
	r.ReadInt()     // modCount
	r.ReadByte()    // modKind
	r.ReadObjectID() // classID

	caught, _ := r.ReadByte()
	uncaught, _ := r.ReadByte()

	if caught != 0 {
		t.Errorf("caught = %d, want 0", caught)
	}
	if uncaught != 1 {
		t.Errorf("uncaught = %d, want 1", uncaught)
	}
}

func TestBuildExceptionEventWithClassFilterCommand(t *testing.T) {
	data := BuildExceptionEventWithClassFilterCommand("java.lang.*", true, true, suspendAll)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindException {
		t.Errorf("eventKind = %d", eventKind)
	}

	r.ReadByte() // suspend
	modCount, _ := r.ReadInt()
	if modCount != 2 {
		t.Errorf("modCount = %d, want 2", modCount)
	}

	// First modifier: ClassMatch
	modKind, _ := r.ReadByte()
	if modKind != 5 {
		t.Errorf("modKind = %d, want 5", modKind)
	}

	pattern, _ := r.ReadString()
	if pattern != "java.lang.*" {
		t.Errorf("pattern = %s, want java.lang.*", pattern)
	}
}

func TestBuildClearExceptionEventCommand(t *testing.T) {
	data := BuildClearExceptionEventCommand(5)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindException {
		t.Errorf("eventKind = %d", eventKind)
	}

	requestID, _ := r.ReadInt()
	if requestID != 5 {
		t.Errorf("requestID = %d, want 5", requestID)
	}
}

// ── MatchException Tests ──────────────────────────────────────────

func TestMatchException_Uncaught(t *testing.T) {
	bp := &ExceptionBreakpoint{
		Enabled:        true,
		CatchMode:      ExceptionCatchUncaught,
		ExceptionClass: "java.lang.RuntimeException",
	}

	if !MatchException(bp, "java.lang.RuntimeException", false) {
		t.Error("should match uncaught RuntimeException")
	}
	if MatchException(bp, "java.lang.RuntimeException", true) {
		t.Error("should not match caught when mode is uncaught only")
	}
	if MatchException(bp, "java.lang.NPE", false) {
		t.Error("should not match different exception class")
	}
}

func TestMatchException_CaughtOnly(t *testing.T) {
	bp := &ExceptionBreakpoint{
		Enabled:        true,
		CatchMode:      ExceptionCatchCaughtOnly,
		ExceptionClass: "java.io.IOException",
	}

	if !MatchException(bp, "java.io.IOException", true) {
		t.Error("should match caught IOException")
	}
	if MatchException(bp, "java.io.IOException", false) {
		t.Error("should not match uncaught when mode is caught only")
	}
}

func TestMatchException_All(t *testing.T) {
	bp := &ExceptionBreakpoint{
		Enabled:        true,
		CatchMode:      ExceptionCatchAll,
		ExceptionClass: "",
	}

	if !MatchException(bp, "java.lang.RuntimeException", true) {
		t.Error("should match caught exception")
	}
	if !MatchException(bp, "java.lang.NPE", false) {
		t.Error("should match uncaught exception")
	}
	if !MatchException(bp, "java.io.IOException", true) {
		t.Error("should match any exception class")
	}
}

func TestMatchException_Disabled(t *testing.T) {
	bp := &ExceptionBreakpoint{
		Enabled:        false,
		CatchMode:      ExceptionCatchAll,
		ExceptionClass: "",
	}

	if MatchException(bp, "java.lang.RuntimeException", true) {
		t.Error("should not match when disabled")
	}
}

func TestMatchException_ClassFilter(t *testing.T) {
	bp := &ExceptionBreakpoint{
		Enabled:        true,
		CatchMode:      ExceptionCatchAll,
		ExceptionClass: "java.lang.NullPointerException",
	}

	if !MatchException(bp, "java.lang.NullPointerException", true) {
		t.Error("should match NPE")
	}
	if MatchException(bp, "java.lang.IllegalArgumentException", true) {
		t.Error("should not match different class")
	}
}

// ── Concurrency Tests ─────────────────────────────────────────────

func TestExceptionBreakpointManager_Concurrency(t *testing.T) {
	ebm := NewExceptionBreakpointManager()
	done := make(chan bool)

	go func() {
		for i := 0; i < 50; i++ {
			ebm.AddExceptionBreakpoint(&ExceptionBreakpoint{CatchMode: ExceptionCatchAll})
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 50; i++ {
			ebm.ListExceptionBreakpoints()
		}
		done <- true
	}()

	<-done
	<-done
}