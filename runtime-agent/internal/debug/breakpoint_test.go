package debug

import (
	"testing"
)

func TestBreakpointManager_AddBreakpoint(t *testing.T) {
	bm := NewBreakpointManager()
	bp := &Breakpoint{
		Kind:      BreakpointLine,
		ClassName: "com.example.Test",
		LineNumber: 42,
	}
	id := bm.AddBreakpoint(bp)
	if id != 1 {
		t.Errorf("expected ID 1, got %d", id)
	}
	if bp.ID != 1 {
		t.Errorf("expected bp.ID 1, got %d", bp.ID)
	}
	if !bp.Enabled {
		t.Error("breakpoint should be enabled by default")
	}
	if bp.SuspendPolicy != suspendAll {
		t.Errorf("expected suspendAll, got %d", bp.SuspendPolicy)
	}
}

func TestBreakpointManager_AddMultiple(t *testing.T) {
	bm := NewBreakpointManager()
	id1 := bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "A", LineNumber: 1})
	id2 := bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "B", LineNumber: 2})
	id3 := bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "C", LineNumber: 3})

	if id1 != 1 || id2 != 2 || id3 != 3 {
		t.Errorf("expected sequential IDs 1,2,3 got %d,%d,%d", id1, id2, id3)
	}
	if bm.Count() != 3 {
		t.Errorf("expected 3 breakpoints, got %d", bm.Count())
	}
}

func TestBreakpointManager_GetBreakpoint(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	bp, ok := bm.GetBreakpoint(1)
	if !ok {
		t.Fatal("expected to find breakpoint 1")
	}
	if bp.ClassName != "Test" {
		t.Errorf("expected Test, got %s", bp.ClassName)
	}

	_, ok = bm.GetBreakpoint(999)
	if ok {
		t.Error("should not find nonexistent breakpoint")
	}
}

func TestBreakpointManager_RemoveBreakpoint(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 20})

	if bm.Count() != 2 {
		t.Errorf("expected 2, got %d", bm.Count())
	}

	err := bm.RemoveBreakpoint(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bm.Count() != 1 {
		t.Errorf("expected 1 after remove, got %d", bm.Count())
	}

	err = bm.RemoveBreakpoint(999)
	if err == nil {
		t.Error("expected error for nonexistent breakpoint")
	}
}

func TestBreakpointManager_EnableDisable(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	err := bm.DisableBreakpoint(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ := bm.GetBreakpoint(1)
	if bp.Enabled {
		t.Error("breakpoint should be disabled")
	}

	err = bm.EnableBreakpoint(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ = bm.GetBreakpoint(1)
	if !bp.Enabled {
		t.Error("breakpoint should be enabled")
	}

	err = bm.DisableBreakpoint(999)
	if err == nil {
		t.Error("expected error for nonexistent breakpoint")
	}
}

func TestBreakpointManager_SetCondition(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	err := bm.SetCondition(1, "x > 5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ := bm.GetBreakpoint(1)
	if bp.Condition != "x > 5" {
		t.Errorf("expected 'x > 5', got %q", bp.Condition)
	}

	err = bm.SetCondition(999, "test")
	if err == nil {
		t.Error("expected error for nonexistent breakpoint")
	}
}

func TestBreakpointManager_HitCount(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	bm.IncrementHitCount(1)
	bm.IncrementHitCount(1)
	bm.IncrementHitCount(1)

	bp, _ := bm.GetBreakpoint(1)
	if bp.HitCount != 3 {
		t.Errorf("expected hit count 3, got %d", bp.HitCount)
	}

	// Incrementing nonexistent should not panic
	bm.IncrementHitCount(999)
}

func TestBreakpointManager_ClearAll(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "A", LineNumber: 1})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "B", LineNumber: 2})

	bm.ClearAll()
	if bm.Count() != 0 {
		t.Errorf("expected 0 after clear, got %d", bm.Count())
	}
}

func TestBreakpointManager_ListBreakpoints(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "A", LineNumber: 1})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointMethodEntry, ClassName: "B", MethodName: "foo", LineNumber: 0})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointFieldAccess, ClassName: "C", FieldName: "bar", LineNumber: 0})

	list := bm.ListBreakpoints()
	if len(list) != 3 {
		t.Errorf("expected 3 breakpoints, got %d", len(list))
	}
}

func TestBreakpointManager_DefaultSuspendPolicy(t *testing.T) {
	bm := NewBreakpointManager()
	bp := &Breakpoint{
		Kind:      BreakpointLine,
		ClassName: "Test",
		LineNumber: 42,
		SuspendPolicy: suspendEventThread,
	}
	bm.AddBreakpoint(bp)
	retrieved, _ := bm.GetBreakpoint(bp.ID)
	if retrieved.SuspendPolicy != suspendEventThread {
		t.Errorf("expected suspendEventThread, got %d", retrieved.SuspendPolicy)
	}
}

// ── New Feature Tests: HitCountMode ────────────────────────────────

func TestBreakpointManager_SetHitCountMode(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	err := bm.SetHitCountMode(1, HitCountEQ, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ := bm.GetBreakpoint(1)
	if bp.HitCountMode != HitCountEQ {
		t.Errorf("expected HitCountEQ, got %s", bp.HitCountMode)
	}
	if bp.HitCountTarget != 5 {
		t.Errorf("expected target 5, got %d", bp.HitCountTarget)
	}

	err = bm.SetHitCountMode(999, HitCountGT, 10)
	if err == nil {
		t.Error("expected error for nonexistent breakpoint")
	}
}

func TestBreakpointManager_SetLogMessage(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	err := bm.SetLogMessage(1, "Hit breakpoint at {line}")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ := bm.GetBreakpoint(1)
	if bp.LogMessage != "Hit breakpoint at {line}" {
		t.Errorf("expected log message, got %q", bp.LogMessage)
	}

	err = bm.SetLogMessage(999, "test")
	if err == nil {
		t.Error("expected error for nonexistent breakpoint")
	}
}

func TestBreakpointManager_ResetHitCount(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	bm.IncrementHitCount(1)
	bm.IncrementHitCount(1)
	bp, _ := bm.GetBreakpoint(1)
	if bp.HitCount != 2 {
		t.Errorf("expected 2, got %d", bp.HitCount)
	}

	err := bm.ResetHitCount(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bp, _ = bm.GetBreakpoint(1)
	if bp.HitCount != 0 {
		t.Errorf("expected 0 after reset, got %d", bp.HitCount)
	}

	err = bm.ResetHitCount(999)
	if err == nil {
		t.Error("expected error for nonexistent breakpoint")
	}
}

func TestBreakpointManager_UpdateBreakpoint(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{
		Kind:      BreakpointLine,
		ClassName: "Test",
		LineNumber: 10,
		Condition: "x > 0",
	})

	updates := &Breakpoint{
		Condition:     "x > 10",
		HitCountMode:  HitCountGT,
		HitCountTarget: 3,
		LogMessage:    "hit",
		SuspendPolicy: suspendEventThread,
	}
	err := bm.UpdateBreakpoint(1, updates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	bp, _ := bm.GetBreakpoint(1)
	if bp.Condition != "x > 10" {
		t.Errorf("expected condition 'x > 10', got %q", bp.Condition)
	}
	if bp.HitCountMode != HitCountGT {
		t.Errorf("expected HitCountGT, got %s", bp.HitCountMode)
	}
	if bp.HitCountTarget != 3 {
		t.Errorf("expected target 3, got %d", bp.HitCountTarget)
	}
	if bp.LogMessage != "hit" {
		t.Errorf("expected log message 'hit', got %q", bp.LogMessage)
	}
	if bp.SuspendPolicy != suspendEventThread {
		t.Errorf("expected suspendEventThread, got %d", bp.SuspendPolicy)
	}

	err = bm.UpdateBreakpoint(999, updates)
	if err == nil {
		t.Error("expected error for nonexistent breakpoint")
	}
}

// ── New Feature Tests: FindBySourceURI / FindByLocation ───────────

func TestBreakpointManager_FindBySourceURI(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "A", LineNumber: 1, SourceURI: "file:///src/Foo.java"})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "B", LineNumber: 2, SourceURI: "file:///src/Foo.java"})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "C", LineNumber: 3, SourceURI: "file:///src/Bar.java"})

	results := bm.FindBySourceURI("file:///src/Foo.java")
	if len(results) != 2 {
		t.Errorf("expected 2, got %d", len(results))
	}

	results = bm.FindBySourceURI("file:///src/Baz.java")
	if len(results) != 0 {
		t.Errorf("expected 0, got %d", len(results))
	}
}

func TestBreakpointManager_FindByLocation(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "com.example.Test", LineNumber: 42})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "com.example.Test", LineNumber: 100})

	bp := bm.FindByLocation("com.example.Test", 42)
	if bp == nil {
		t.Fatal("expected to find breakpoint")
	}
	if bp.LineNumber != 42 {
		t.Errorf("expected line 42, got %d", bp.LineNumber)
	}

	bp = bm.FindByLocation("com.example.Test", 999)
	if bp != nil {
		t.Error("should not find nonexistent location")
	}
}

// ── New Feature Tests: HitCount Evaluation ────────────────────────

func TestEvaluateHitCount_NoMode(t *testing.T) {
	bp := &Breakpoint{
		HitCountMode: HitCountOff,
		HitCount:     0,
	}
	if !EvaluateHitCount(bp) {
		t.Error("no mode should always return true")
	}

	bp.HitCountMode = ""
	if !EvaluateHitCount(bp) {
		t.Error("empty mode should always return true")
	}
}

func TestEvaluateHitCount_EQ(t *testing.T) {
	bp := &Breakpoint{
		HitCountMode:   HitCountEQ,
		HitCountTarget: 5,
	}

	bp.HitCount = 5
	if !EvaluateHitCount(bp) {
		t.Error("hitCount 5 == 5 should return true")
	}
	bp.HitCount = 4
	if EvaluateHitCount(bp) {
		t.Error("hitCount 4 == 5 should return false")
	}
}

func TestEvaluateHitCount_GT(t *testing.T) {
	bp := &Breakpoint{
		HitCountMode:   HitCountGT,
		HitCountTarget: 5,
	}

	bp.HitCount = 6
	if !EvaluateHitCount(bp) {
		t.Error("hitCount 6 > 5 should return true")
	}
	bp.HitCount = 5
	if EvaluateHitCount(bp) {
		t.Error("hitCount 5 > 5 should return false")
	}
}

func TestEvaluateHitCount_GE(t *testing.T) {
	bp := &Breakpoint{
		HitCountMode:   HitCountGE,
		HitCountTarget: 5,
	}

	bp.HitCount = 5
	if !EvaluateHitCount(bp) {
		t.Error("hitCount 5 >= 5 should return true")
	}
	bp.HitCount = 6
	if !EvaluateHitCount(bp) {
		t.Error("hitCount 6 >= 5 should return true")
	}
	bp.HitCount = 4
	if EvaluateHitCount(bp) {
		t.Error("hitCount 4 >= 5 should return false")
	}
}

func TestEvaluateHitCount_LT(t *testing.T) {
	bp := &Breakpoint{
		HitCountMode:   HitCountLT,
		HitCountTarget: 5,
	}

	bp.HitCount = 4
	if !EvaluateHitCount(bp) {
		t.Error("hitCount 4 < 5 should return true")
	}
	bp.HitCount = 5
	if EvaluateHitCount(bp) {
		t.Error("hitCount 5 < 5 should return false")
	}
}

func TestEvaluateHitCount_LE(t *testing.T) {
	bp := &Breakpoint{
		HitCountMode:   HitCountLE,
		HitCountTarget: 5,
	}

	bp.HitCount = 5
	if !EvaluateHitCount(bp) {
		t.Error("hitCount 5 <= 5 should return true")
	}
	bp.HitCount = 4
	if !EvaluateHitCount(bp) {
		t.Error("hitCount 4 <= 5 should return true")
	}
	bp.HitCount = 6
	if EvaluateHitCount(bp) {
		t.Error("hitCount 6 <= 5 should return false")
	}
}

func TestEvaluateHitCount_MOD(t *testing.T) {
	bp := &Breakpoint{
		HitCountMode:   HitCountMOD,
		HitCountTarget: 3,
	}

	bp.HitCount = 3
	if !EvaluateHitCount(bp) {
		t.Error("3 % 3 == 0 should return true")
	}
	bp.HitCount = 6
	if !EvaluateHitCount(bp) {
		t.Error("6 % 3 == 0 should return true")
	}
	bp.HitCount = 4
	if EvaluateHitCount(bp) {
		t.Error("4 % 3 != 0 should return false")
	}

	// Zero target
	bp.HitCountTarget = 0
	if EvaluateHitCount(bp) {
		t.Error("MOD with target 0 should return false")
	}
}

// ── New Feature Tests: Condition Evaluation ───────────────────────

func TestEvaluateBreakpointCondition_Empty(t *testing.T) {
	if !EvaluateBreakpointCondition("", nil) {
		t.Error("empty condition should return true")
	}
}

func TestEvaluateBreakpointCondition_SimpleNumeric(t *testing.T) {
	vars := map[string]interface{}{"x": int32(5), "y": float64(10.0), "z": int32(0)}

	// x == 5
	if !EvaluateBreakpointCondition("x == 5", vars) {
		t.Error("x == 5 should be true")
	}
	// x != 10
	if !EvaluateBreakpointCondition("x != 10", vars) {
		t.Error("x != 10 should be true")
	}
	// x > 0
	if !EvaluateBreakpointCondition("x > 0", vars) {
		t.Error("x > 0 should be true")
	}
	// x < 10
	if !EvaluateBreakpointCondition("x < 10", vars) {
		t.Error("x < 10 should be true")
	}
	// x >= 5
	if !EvaluateBreakpointCondition("x >= 5", vars) {
		t.Error("x >= 5 should be true")
	}
	// x <= 5
	if !EvaluateBreakpointCondition("x <= 5", vars) {
		t.Error("x <= 5 should be true")
	}
	// x == 6 (false)
	if EvaluateBreakpointCondition("x == 6", vars) {
		t.Error("x == 6 should be false")
	}
	// y > 5
	if !EvaluateBreakpointCondition("y > 5", vars) {
		t.Error("y > 5 should be true")
	}
	// z == 0
	if !EvaluateBreakpointCondition("z == 0", vars) {
		t.Error("z == 0 should be true")
	}
}

func TestEvaluateBreakpointCondition_UnknownVar(t *testing.T) {
	vars := map[string]interface{}{"x": int32(5)}

	// unknown variable should return false
	if EvaluateBreakpointCondition("unknown == 5", vars) {
		t.Error("unknown variable should return false")
	}
}

func TestEvaluateBreakpointCondition_BooleanCheck(t *testing.T) {
	vars := map[string]interface{}{"flag": true, "flag2": false, "count": int32(1)}

	if !EvaluateBreakpointCondition("flag", vars) {
		t.Error("flag=true should be truthy")
	}
	if EvaluateBreakpointCondition("flag2", vars) {
		t.Error("flag2=false should be falsy")
	}
	if !EvaluateBreakpointCondition("count", vars) {
		t.Error("count=1 should be truthy")
	}
}

func TestEvaluateBreakpointCondition_Complex(t *testing.T) {
	// Complex conditions that can't be evaluated return true
	vars := map[string]interface{}{"x": int32(5)}
	if !EvaluateBreakpointCondition("x > 0 && y < 10", vars) {
		t.Error("complex conditions should default to true")
	}
}

// ── New Feature Tests: Batch Operations ───────────────────────────

func TestBreakpointManager_ApplyBatch(t *testing.T) {
	bm := NewBreakpointManager()

	batch := &BatchBreakpointUpdate{
		Adds: []*Breakpoint{
			{Kind: BreakpointLine, ClassName: "A", LineNumber: 1},
			{Kind: BreakpointLine, ClassName: "B", LineNumber: 2},
		},
	}

	addedIDs, errors := bm.ApplyBatch(batch)
	if len(addedIDs) != 2 {
		t.Errorf("expected 2 added IDs, got %d", len(addedIDs))
	}
	if len(errors) != 0 {
		t.Errorf("expected no errors, got %v", errors)
	}
	if bm.Count() != 2 {
		t.Errorf("expected 2 breakpoints, got %d", bm.Count())
	}
}

func TestBreakpointManager_ApplyBatchUpdates(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	batch := &BatchBreakpointUpdate{
		Updates: map[int32]*Breakpoint{
			1: {Condition: "x > 0", HitCountMode: HitCountEQ, HitCountTarget: 3},
		},
	}

	_, errors := bm.ApplyBatch(batch)
	if len(errors) != 0 {
		t.Errorf("expected no errors, got %v", errors)
	}

	bp, _ := bm.GetBreakpoint(1)
	if bp.Condition != "x > 0" {
		t.Errorf("expected 'x > 0', got %q", bp.Condition)
	}
}

func TestBreakpointManager_ApplyBatchRemoves(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 20})

	batch := &BatchBreakpointUpdate{
		Removes: []int32{1},
	}

	_, errors := bm.ApplyBatch(batch)
	if len(errors) != 0 {
		t.Errorf("expected no errors, got %v", errors)
	}
	if bm.Count() != 1 {
		t.Errorf("expected 1 after remove, got %d", bm.Count())
	}
}

func TestBreakpointManager_ApplyBatchErrors(t *testing.T) {
	bm := NewBreakpointManager()

	batch := &BatchBreakpointUpdate{
		Removes: []int32{999},
		Updates: map[int32]*Breakpoint{
			999: {Condition: "test"},
		},
	}

	_, errors := bm.ApplyBatch(batch)
	if len(errors) != 2 {
		t.Errorf("expected 2 errors, got %d: %v", len(errors), errors)
	}
}

// ── New Feature Tests: Filtering ──────────────────────────────────

func TestBreakpointManager_FilterBreakpoints(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "com.example.Test", LineNumber: 1})
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointMethodEntry, ClassName: "com.example.Test", MethodName: "foo", LineNumber: 0})
	id3 := bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "com.example.Other", LineNumber: 2})
	// Disable the third breakpoint for filtering tests
	bm.DisableBreakpoint(id3)

	// Filter by kind
	enabled := true
	results := bm.FilterBreakpoints(&BreakpointFilter{Kind: BreakpointLine, Enabled: &enabled})
	if len(results) != 1 {
		t.Errorf("expected 1 enabled line breakpoint, got %d", len(results))
	}

	// Filter by class name
	results = bm.FilterBreakpoints(&BreakpointFilter{ClassName: "com.example.Test"})
	if len(results) != 2 {
		t.Errorf("expected 2 Test breakpoints, got %d", len(results))
	}

	// Filter by enabled
	disabled := false
	results = bm.FilterBreakpoints(&BreakpointFilter{Enabled: &disabled})
	if len(results) != 1 {
		t.Errorf("expected 1 disabled breakpoint, got %d", len(results))
	}

	// Filter by source URI
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "X", LineNumber: 1, SourceURI: "file:///test.java"})
	results = bm.FilterBreakpoints(&BreakpointFilter{SourceURI: "file:///test.java"})
	if len(results) != 1 {
		t.Errorf("expected 1 breakpoint with URI, got %d", len(results))
	}
}

// ── New Feature Tests: BreakpointSyncManager ──────────────────────

func TestBreakpointSyncManager_SyncLifecycle(t *testing.T) {
	bm := NewBreakpointManager()
	bsm := NewBreakpointSyncManager(bm)

	bsm.SyncBreakpoint(1)
	bsm.SyncBreakpoint(2)
	bsm.SyncBreakpoint(3)

	if bsm.PendingCount() != 3 {
		t.Errorf("expected 3 pending, got %d", bsm.PendingCount())
	}

	pending := bsm.GetPendingSyncs()
	if len(pending) != 3 {
		t.Errorf("expected 3 pending IDs, got %d", len(pending))
	}

	bsm.MarkSynced(1, 100)
	if bsm.PendingCount() != 2 {
		t.Errorf("expected 2 pending after sync, got %d", bsm.PendingCount())
	}

	reqID, ok := bsm.GetJDWPRequestID(1)
	if !ok {
		t.Error("should find JDWP request ID for 1")
	}
	if reqID != 100 {
		t.Errorf("expected request ID 100, got %d", reqID)
	}

	_, ok = bsm.GetJDWPRequestID(2)
	if ok {
		t.Error("should not find JDWP request ID for unsynced breakpoint")
	}
}

func TestBreakpointSyncManager_Remove(t *testing.T) {
	bm := NewBreakpointManager()
	bsm := NewBreakpointSyncManager(bm)

	bsm.SyncBreakpoint(1)
	bsm.MarkSynced(1, 100)

	bsm.RemoveJDWPRequestID(1)
	if bsm.PendingCount() != 0 {
		t.Errorf("expected 0 pending, got %d", bsm.PendingCount())
	}
	_, ok := bsm.GetJDWPRequestID(1)
	if ok {
		t.Error("should not find JDWP request ID after removal")
	}
}

func TestBreakpointSyncManager_Clear(t *testing.T) {
	bm := NewBreakpointManager()
	bsm := NewBreakpointSyncManager(bm)

	bsm.SyncBreakpoint(1)
	bsm.SyncBreakpoint(2)
	bsm.MarkSynced(1, 100)

	bsm.Clear()
	if bsm.PendingCount() != 0 {
		t.Errorf("expected 0 pending after clear, got %d", bsm.PendingCount())
	}
	_, ok := bsm.GetJDWPRequestID(1)
	if ok {
		t.Error("should not find JDWP request ID after clear")
	}
}

// ── Command Builder Tests ─────────────────────────────────────────

func TestBuildBreakpointSetCommand(t *testing.T) {
	data := BuildBreakpointSetCommand(0x100, 0x200, 42, suspendAll)
	r := NewJDWPDataReader(data)

	eventKind, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if eventKind != eventKindBreakpoint {
		t.Errorf("eventKind = %d, want %d", eventKind, eventKindBreakpoint)
	}

	suspend, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if suspend != suspendAll {
		t.Errorf("suspendPolicy = %d, want %d", suspend, suspendAll)
	}

	modCount, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if modCount != 1 {
		t.Errorf("modCount = %d, want 1", modCount)
	}

	modKind, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if modKind != 7 {
		t.Errorf("modKind = %d, want 7", modKind)
	}

	typeTag, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if typeTag != 1 {
		t.Errorf("typeTag = %d, want 1", typeTag)
	}

	classID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if classID != 0x100 {
		t.Errorf("classID = %d, want 0x100", classID)
	}

	methodID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if methodID != 0x200 {
		t.Errorf("methodID = %d, want 0x200", methodID)
	}

	lineNum, err := r.ReadLong()
	if err != nil {
		t.Fatal(err)
	}
	if lineNum != 42 {
		t.Errorf("lineNumber = %d, want 42", lineNum)
	}
}

func TestBuildBreakpointSetConditionalCommand(t *testing.T) {
	data := BuildBreakpointSetConditionalCommand(0x100, 0x200, 42, suspendAll, "x > 0")
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindBreakpoint {
		t.Errorf("eventKind = %d", eventKind)
	}
	r.ReadByte() // suspendPolicy
	modCount, _ := r.ReadInt()
	if modCount != 2 {
		t.Errorf("modCount = %d, want 2", modCount)
	}
}

func TestBuildMethodEntryBreakpointCommand(t *testing.T) {
	data := BuildMethodEntryBreakpointCommand(0x100, 0x200, suspendAll)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindBreakpoint {
		t.Errorf("eventKind = %d", eventKind)
	}

	r.ReadByte() // suspendPolicy
	r.ReadInt()  // modCount

	modKind, _ := r.ReadByte()
	if modKind != 7 {
		t.Errorf("modKind = %d, want 7", modKind)
	}

	r.ReadByte()    // typeTag
	r.ReadObjectID() // classID
	r.ReadObjectID() // methodID

	line, _ := r.ReadLong()
	if line != 0 {
		t.Errorf("line = %d, want 0", line)
	}
}

func TestBuildMethodExitBreakpointCommand(t *testing.T) {
	data := BuildMethodExitBreakpointCommand(0x100, 0x200, suspendAll)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindBreakpoint {
		t.Errorf("eventKind = %d", eventKind)
	}

	r.ReadByte() // suspendPolicy
	r.ReadInt()  // modCount

	modKind, _ := r.ReadByte()
	if modKind != 7 {
		t.Errorf("modKind = %d, want 7", modKind)
	}
}

func TestBuildClearBreakpointCommand(t *testing.T) {
	data := BuildClearBreakpointCommand(5)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindBreakpoint {
		t.Errorf("eventKind = %d", eventKind)
	}

	requestID, _ := r.ReadInt()
	if requestID != 5 {
		t.Errorf("requestID = %d, want 5", requestID)
	}
}

// ── Match Tests ───────────────────────────────────────────────────

func TestMatchBreakpointLocation(t *testing.T) {
	bp := &Breakpoint{
		Kind:       BreakpointLine,
		ClassName:  "com.example.Test",
		LineNumber: 42,
	}

	if !MatchBreakpointLocation(bp, "com.example.Test", 42) {
		t.Error("should match same class and line")
	}
	if MatchBreakpointLocation(bp, "com.example.Other", 42) {
		t.Error("should not match different class")
	}
	if MatchBreakpointLocation(bp, "com.example.Test", 99) {
		t.Error("should not match different line")
	}

	// Wrong kind
	bp2 := &Breakpoint{Kind: BreakpointMethodEntry, ClassName: "com.example.Test", LineNumber: 42}
	if MatchBreakpointLocation(bp2, "com.example.Test", 42) {
		t.Error("should not match non-line breakpoint")
	}
}

func TestMatchMethodEntry(t *testing.T) {
	bp := &Breakpoint{
		Kind:       BreakpointMethodEntry,
		ClassName:  "com.example.Test",
		MethodName: "doWork",
	}

	if !MatchMethodEntry(bp, "com.example.Test", "doWork") {
		t.Error("should match same class and method")
	}
	if MatchMethodEntry(bp, "com.example.Test", "otherMethod") {
		t.Error("should not match different method")
	}
	if MatchMethodEntry(bp, "com.example.Other", "doWork") {
		t.Error("should not match different class")
	}

	// Wrong kind
	bp2 := &Breakpoint{Kind: BreakpointLine, ClassName: "com.example.Test", MethodName: "doWork"}
	if MatchMethodEntry(bp2, "com.example.Test", "doWork") {
		t.Error("should not match non-method entry breakpoint")
	}
}

// ── Concurrency Tests ─────────────────────────────────────────────

func TestBreakpointManager_Concurrency(t *testing.T) {
	bm := NewBreakpointManager()
	done := make(chan bool)

	go func() {
		for i := 0; i < 100; i++ {
			bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: int32(i)})
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 100; i++ {
			bm.ListBreakpoints()
		}
		done <- true
	}()

	<-done
	<-done
}

func TestBreakpointManager_ConcurrentHitCount(t *testing.T) {
	bm := NewBreakpointManager()
	bm.AddBreakpoint(&Breakpoint{Kind: BreakpointLine, ClassName: "Test", LineNumber: 10})

	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				bm.IncrementHitCount(1)
			}
			done <- true
		}()
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	bp, _ := bm.GetBreakpoint(1)
	if bp.HitCount != 1000 {
		t.Errorf("expected hit count 1000, got %d", bp.HitCount)
	}
}

func TestBreakpointSyncManager_Concurrency(t *testing.T) {
	bm := NewBreakpointManager()
	bsm := NewBreakpointSyncManager(bm)
	done := make(chan bool)

	go func() {
		for i := int32(1); i <= 50; i++ {
			bsm.SyncBreakpoint(i)
		}
		done <- true
	}()

	go func() {
		for i := int32(1); i <= 50; i++ {
			bsm.GetPendingSyncs()
		}
		done <- true
	}()

	<-done
	<-done
}

// ── Phase 3+: Cross-Module Breakpoint Tests ───────────────────────

func TestCrossModuleBreakpointManager_AddAndGet(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	cbp := &CrossModuleBreakpoint{
		Breakpoint: Breakpoint{
			Kind:       BreakpointLine,
			ClassName:  "com.example.Service",
			LineNumber: 42,
		},
		ModuleName: "core",
	}

	id := cm.AddCrossModuleBreakpoint(cbp)
	if id != 1 {
		t.Errorf("expected ID 1, got %d", id)
	}

	bps := cm.GetModuleBreakpoints("core")
	if len(bps) != 1 {
		t.Errorf("expected 1 breakpoint in core, got %d", len(bps))
	}

	bps = cm.GetModuleBreakpoints("webapp")
	if len(bps) != 0 {
		t.Errorf("expected 0 breakpoints in webapp, got %d", len(bps))
	}
}

func TestCrossModuleBreakpointManager_DeferredBreakpoints(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	// Add a deferred breakpoint with wildcard pattern
	cbp := &CrossModuleBreakpoint{
		Breakpoint: Breakpoint{
			Kind:       BreakpointLine,
			ClassName:  "com.example.*",
			LineNumber: 42,
		},
		DeferredClassPattern: "com.example.*",
	}

	cm.AddCrossModuleBreakpoint(cbp)

	if cm.DeferredCount() != 1 {
		t.Errorf("expected 1 deferred, got %d", cm.DeferredCount())
	}

	// Simulate class load
	resolved := cm.OnClassPrepare("com.example.MyService")
	if len(resolved) != 1 {
		t.Errorf("expected 1 resolved, got %d", len(resolved))
	}
	if cm.DeferredCount() != 0 {
		t.Errorf("expected 0 deferred after resolution, got %d", cm.DeferredCount())
	}
}

func TestCrossModuleBreakpointManager_OnClassPrepare(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	// Add breakpoints with different patterns
	cm.AddCrossModuleBreakpoint(&CrossModuleBreakpoint{
		Breakpoint:           Breakpoint{Kind: BreakpointLine, ClassName: "com.example.**", LineNumber: 10},
		DeferredClassPattern: "com.example.**",
	})
	cm.AddCrossModuleBreakpoint(&CrossModuleBreakpoint{
		Breakpoint:           Breakpoint{Kind: BreakpointLine, ClassName: "org.other.*", LineNumber: 20},
		DeferredClassPattern: "org.other.*",
	})

	if cm.DeferredCount() != 2 {
		t.Errorf("expected 2 deferred, got %d", cm.DeferredCount())
	}

	// Load a class matching the first pattern
	resolved := cm.OnClassPrepare("com.example.foo.bar.Baz")
	if len(resolved) != 1 {
		t.Errorf("expected 1 resolved, got %d", len(resolved))
	}
	if cm.DeferredCount() != 1 {
		t.Errorf("expected 1 deferred remaining, got %d", cm.DeferredCount())
	}
}

func TestCrossModuleBreakpointManager_ListModuleBreakpoints(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	cm.AddCrossModuleBreakpoint(&CrossModuleBreakpoint{
		Breakpoint: Breakpoint{Kind: BreakpointLine, ClassName: "A", LineNumber: 1},
		ModuleName: "core",
	})
	cm.AddCrossModuleBreakpoint(&CrossModuleBreakpoint{
		Breakpoint: Breakpoint{Kind: BreakpointLine, ClassName: "B", LineNumber: 2},
		ModuleName: "core",
	})
	cm.AddCrossModuleBreakpoint(&CrossModuleBreakpoint{
		Breakpoint: Breakpoint{Kind: BreakpointLine, ClassName: "C", LineNumber: 3},
		ModuleName: "webapp",
	})

	modules := cm.ListModuleBreakpoints()
	if len(modules) != 2 {
		t.Errorf("expected 2 modules, got %d", len(modules))
	}
	if len(modules["core"]) != 2 {
		t.Errorf("expected 2 in core, got %d", len(modules["core"]))
	}
	if len(modules["webapp"]) != 1 {
		t.Errorf("expected 1 in webapp, got %d", len(modules["webapp"]))
	}
}

func TestCrossModuleBreakpointManager_SetBreakpointOnAllModules(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	ids := cm.SetBreakpointOnAllModules("com.example.**", 42, "**/*", "*.jar")
	if len(ids) != 1 {
		t.Errorf("expected 1 ID, got %d", len(ids))
	}
	if cm.DeferredCount() != 1 {
		t.Errorf("expected 1 deferred, got %d", cm.DeferredCount())
	}
}

// ── Phase 3+: Classpath Pattern Matching Tests ────────────────────

func TestHasWildcard(t *testing.T) {
	tests := []struct {
		pattern  string
		expected bool
	}{
		{"com.example.MyClass", false},
		{"com.example.*", true},
		{"com.example.**", true},
		{"com/example/**", true},
		{"*Service", true},
		{"com.example.Foo?", true},
		{"", false},
	}

	for _, tc := range tests {
		actual := hasWildcard(tc.pattern)
		if actual != tc.expected {
			t.Errorf("hasWildcard(%q) = %v, want %v", tc.pattern, actual, tc.expected)
		}
	}
}

func TestMatchClassPattern(t *testing.T) {
	tests := []struct {
		pattern   string
		className string
		expected  bool
	}{
		// Exact match
		{"com.example.MyClass", "com.example.MyClass", true},
		{"com.example.MyClass", "com.example.OtherClass", false},

		// Single wildcard
		{"com.example.*", "com.example.MyClass", true},
		{"com.example.*", "com.example.foo.MyClass", false},
		{"com.example.*", "com.example.OtherClass", true},

		// Double wildcard
		{"com.example.**", "com.example.MyClass", true},
		{"com.example.**", "com.example.foo.bar.MyClass", true},
		{"com.example.**", "org.other.MyClass", false},

		// Path-style
		{"com/example/**", "com.example.foo.MyClass", true},
		{"com/example/**", "com.example.MyClass", true},

		// Suffix match
		{"*Service", "com.example.UserService", true},
		{"*Service", "com.example.UserController", false},

		// Empty pattern
		{"", "com.example.Test", false},
	}

	for _, tc := range tests {
		actual := matchClassPattern(tc.pattern, tc.className)
		if actual != tc.expected {
			t.Errorf("matchClassPattern(%q, %q) = %v, want %v", tc.pattern, tc.className, actual, tc.expected)
		}
	}
}

func TestMatchClasspathPattern(t *testing.T) {
	tests := []struct {
		pattern    string
		classpath  string
		shouldPass bool
	}{
		{"WEB-INF/lib/*.jar", "WEB-INF/lib/my-lib.jar", true},
		{"WEB-INF/lib/*.jar", "WEB-INF/lib/other.jar", true},
		{"WEB-INF/lib/*.jar", "WEB-INF/classes", false},
		{"target/*.war", "target/myapp.war", true},
	}

	for _, tc := range tests {
		result := MatchClasspathPattern(tc.pattern, tc.classpath)
		if result != tc.shouldPass {
			t.Errorf("MatchClasspathPattern(%q, %q) = %v, want %v", tc.pattern, tc.classpath, result, tc.shouldPass)
		}
	}
}

// ── Phase 3+: Breakpoint Persistence Tests ────────────────────────

func TestCrossModuleBreakpointManager_PersistAndRestore(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	tmpDir := t.TempDir()
	persistPath := tmpDir + "/breakpoints.json"
	cm.SetPersistencePath(persistPath)

	cm.AddCrossModuleBreakpoint(&CrossModuleBreakpoint{
		Breakpoint: Breakpoint{
			Kind:       BreakpointLine,
			ClassName:  "com.example.Test",
			LineNumber: 42,
			Condition:  "x > 0",
		},
		ModuleName: "core",
	})
	cm.AddCrossModuleBreakpoint(&CrossModuleBreakpoint{
		Breakpoint: Breakpoint{
			Kind:       BreakpointMethodEntry,
			ClassName:  "com.example.Test",
			MethodName: "doWork",
		},
		ModuleName: "webapp",
	})

	// Persist
	count, err := cm.PersistBreakpoints()
	if err != nil {
		t.Fatalf("persist failed: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 persisted, got %d", count)
	}

	// Clear
	bm.ClearAll()
	if bm.Count() != 0 {
		t.Errorf("expected 0 after clear, got %d", bm.Count())
	}

	// Restore
	restoredCount, err := cm.RestoreBreakpoints()
	if err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	if restoredCount != 2 {
		t.Errorf("expected 2 restored, got %d", restoredCount)
	}
	if bm.Count() != 2 {
		t.Errorf("expected 2 after restore, got %d", bm.Count())
	}
}

func TestCrossModuleBreakpointManager_PersistNoPath(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	_, err := cm.PersistBreakpoints()
	if err == nil {
		t.Error("expected error when persistence path is not set")
	}
}

func TestCrossModuleBreakpointManager_RestoreNoFile(t *testing.T) {
	bm := NewBreakpointManager()
	cm := NewCrossModuleBreakpointManager(bm)

	tmpDir := t.TempDir()
	cm.SetPersistencePath(tmpDir + "/nonexistent.json")

	count, err := cm.RestoreBreakpoints()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 restored from nonexistent file, got %d", count)
	}
}

// ── Phase 3+: Complex Condition Tests ─────────────────────────────

func TestParseComplexCondition_Simple(t *testing.T) {
	cc := ParseComplexCondition("x > 5")
	if cc == nil {
		t.Fatal("expected non-nil")
	}
	if cc.Operator != "" {
		t.Errorf("expected empty operator, got %s", cc.Operator)
	}
	if cc.Operand != "x > 5" {
		t.Errorf("expected 'x > 5', got %q", cc.Operand)
	}
}

func TestParseComplexCondition_AND(t *testing.T) {
	cc := ParseComplexCondition("x > 5 && y < 10")
	if cc == nil {
		t.Fatal("expected non-nil")
	}
	if cc.Operator != OpAND {
		t.Errorf("expected AND, got %s", cc.Operator)
	}
	if cc.Left == nil || cc.Right == nil {
		t.Fatal("expected both left and right")
	}
	if cc.Left.Operand != "x > 5" {
		t.Errorf("expected left 'x > 5', got %q", cc.Left.Operand)
	}
	if cc.Right.Operand != "y < 10" {
		t.Errorf("expected right 'y < 10', got %q", cc.Right.Operand)
	}
}

func TestParseComplexCondition_OR(t *testing.T) {
	cc := ParseComplexCondition("x > 5 || y < 10")
	if cc == nil {
		t.Fatal("expected non-nil")
	}
	if cc.Operator != OpOR {
		t.Errorf("expected OR, got %s", cc.Operator)
	}
}

func TestParseComplexCondition_NOT(t *testing.T) {
	cc := ParseComplexCondition("!(x > 5)")
	if cc == nil {
		t.Fatal("expected non-nil")
	}
	if cc.Operator != OpNOT {
		t.Errorf("expected NOT, got %s", cc.Operator)
	}
	if cc.Left == nil {
		t.Fatal("expected left child")
	}
	if cc.Left.Operand != "x > 5" {
		t.Errorf("expected 'x > 5', got %q", cc.Left.Operand)
	}
}

func TestParseComplexCondition_Empty(t *testing.T) {
	cc := ParseComplexCondition("")
	if cc != nil {
		t.Error("expected nil for empty condition")
	}
}

func TestFindOperatorIndex(t *testing.T) {
	// Test AND outside parens
	// "x > 5 && y < 10": idx 0=x,1=space,2=>,3=space,4=5,5=space,6=&,7=&,8=space
	idx := findOperatorIndex("x > 5 && y < 10", "&&")
	if idx != 6 {
		t.Errorf("expected 6, got %d", idx)
	}

	// Test OR outside parens
	idx = findOperatorIndex("x > 5 || y < 10", "||")
	if idx != 6 {
		t.Errorf("expected 6, got %d", idx)
	}

	// Test operator inside parens should be ignored
	idx = findOperatorIndex("(x > 5 && y < 10) || z == 0", "&&")
	if idx != -1 {
		t.Errorf("expected -1 (&& inside parens), got %d", idx)
	}

	// Test not found
	idx = findOperatorIndex("x > 5", "&&")
	if idx != -1 {
		t.Errorf("expected -1, got %d", idx)
	}
}

func TestEvaluateComplexCondition_AND(t *testing.T) {
	vars := map[string]interface{}{"x": int32(10), "y": float64(5.0)}

	cc := ParseComplexCondition("x > 5 && y < 10")
	if !EvaluateComplexCondition(cc, vars) {
		t.Error("x > 5 && y < 10 should be true")
	}

	cc = ParseComplexCondition("x > 5 && y > 10")
	if EvaluateComplexCondition(cc, vars) {
		t.Error("x > 5 && y > 10 should be false")
	}
}

func TestEvaluateComplexCondition_OR(t *testing.T) {
	vars := map[string]interface{}{"x": int32(3), "y": float64(15.0)}

	cc := ParseComplexCondition("x > 5 || y > 10")
	if !EvaluateComplexCondition(cc, vars) {
		t.Error("x > 5 || y > 10 should be true (y > 10)")
	}

	cc = ParseComplexCondition("x > 5 || y < 10")
	if EvaluateComplexCondition(cc, vars) {
		t.Error("x > 5 || y < 10 should be false")
	}
}

func TestEvaluateComplexCondition_NOT(t *testing.T) {
	vars := map[string]interface{}{"x": int32(3)}

	cc := ParseComplexCondition("!(x > 5)")
	if !EvaluateComplexCondition(cc, vars) {
		t.Error("!(x > 5) should be true when x=3")
	}

	cc = ParseComplexCondition("!(x < 5)")
	if EvaluateComplexCondition(cc, vars) {
		t.Error("!(x < 5) should be false when x=3")
	}
}

func TestEvaluateComplexCondition_Nil(t *testing.T) {
	if !EvaluateComplexCondition(nil, nil) {
		t.Error("nil condition should return true")
	}
}

// ── Phase 3+: Instance Filter Tests ───────────────────────────────

func TestInstanceFilter_Match(t *testing.T) {
	f := &InstanceFilter{ObjectID: 100}

	if !f.MatchInstanceFilter(int64(100)) {
		t.Error("should match same object ID")
	}
	if f.MatchInstanceFilter(int64(200)) {
		t.Error("should not match different object ID")
	}
}

func TestInstanceFilter_Nil(t *testing.T) {
	var f *InstanceFilter
	if !f.MatchInstanceFilter(int64(100)) {
		t.Error("nil filter should return true")
	}

	f = &InstanceFilter{}
	if !f.MatchInstanceFilter(int64(100)) {
		t.Error("zero ObjectID filter should return true")
	}
}

// ── Phase 3+: Thread Filter Tests ─────────────────────────────────

func TestThreadFilter_Match(t *testing.T) {
	f := &ThreadFilter{ThreadID: 42}

	if !f.MatchThreadFilter(42, "main") {
		t.Error("should match same thread ID")
	}
	if f.MatchThreadFilter(99, "main") {
		t.Error("should not match different thread ID")
	}
}

func TestThreadFilter_NamePattern(t *testing.T) {
	f := &ThreadFilter{ThreadNamePattern: "http-nio-*"}

	if !f.MatchThreadFilter(0, "http-nio-8080-exec-1") {
		t.Error("should match thread name pattern")
	}
	if f.MatchThreadFilter(0, "main") {
		t.Error("should not match different thread name")
	}
}

func TestThreadFilter_Nil(t *testing.T) {
	var f *ThreadFilter
	if !f.MatchThreadFilter(42, "main") {
		t.Error("nil filter should return true")
	}

	f = &ThreadFilter{}
	if !f.MatchThreadFilter(42, "main") {
		t.Error("zero ThreadID filter should return true")
	}
}

// ── Phase 3+: Stack Depth Filter Tests ────────────────────────────

func TestStackDepthFilter_Match(t *testing.T) {
	f := &StackDepthFilter{MinDepth: 2, MaxDepth: 10}

	if !f.MatchStackDepth(5) {
		t.Error("depth 5 should be in range [2, 10]")
	}
	if f.MatchStackDepth(1) {
		t.Error("depth 1 should be below min")
	}
	if f.MatchStackDepth(11) {
		t.Error("depth 11 should be above max")
	}
}

func TestStackDepthFilter_OnlyMin(t *testing.T) {
	f := &StackDepthFilter{MinDepth: 3, MaxDepth: 0}

	if !f.MatchStackDepth(5) {
		t.Error("depth 5 should be >= 3")
	}
	if f.MatchStackDepth(2) {
		t.Error("depth 2 should be below min")
	}
}

func TestStackDepthFilter_OnlyMax(t *testing.T) {
	f := &StackDepthFilter{MinDepth: 0, MaxDepth: 5}

	if !f.MatchStackDepth(3) {
		t.Error("depth 3 should be <= 5")
	}
	if f.MatchStackDepth(6) {
		t.Error("depth 6 should be above max")
	}
}

func TestStackDepthFilter_Nil(t *testing.T) {
	var f *StackDepthFilter
	if !f.MatchStackDepth(5) {
		t.Error("nil filter should return true")
	}
}

// ── Phase 3+: Enhanced Breakpoint Tests ───────────────────────────

func TestEnhancedBreakpoint_ShouldTrigger_Simple(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			Enabled: true,
		},
	}

	if !eb.ShouldTrigger(nil, nil, 0, "", 0) {
		t.Error("simple enabled breakpoint should trigger")
	}
}

func TestEnhancedBreakpoint_ShouldTrigger_Disabled(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			Enabled: false,
		},
	}

	if eb.ShouldTrigger(nil, nil, 0, "", 0) {
		t.Error("disabled breakpoint should not trigger")
	}
}

func TestEnhancedBreakpoint_ShouldTrigger_WithCondition(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			Enabled:   true,
			Condition: "x > 5",
		},
	}

	vars := map[string]interface{}{"x": int32(10)}
	if !eb.ShouldTrigger(vars, nil, 0, "", 0) {
		t.Error("should trigger when x=10 > 5")
	}

	vars = map[string]interface{}{"x": int32(3)}
	if eb.ShouldTrigger(vars, nil, 0, "", 0) {
		t.Error("should not trigger when x=3")
	}
}

func TestEnhancedBreakpoint_ShouldTrigger_WithInstanceFilter(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			Enabled: true,
		},
		InstanceFilter: &InstanceFilter{ObjectID: 100},
	}

	if !eb.ShouldTrigger(nil, int64(100), 0, "", 0) {
		t.Error("should trigger on matching instance")
	}
	if eb.ShouldTrigger(nil, int64(200), 0, "", 0) {
		t.Error("should not trigger on non-matching instance")
	}
}

func TestEnhancedBreakpoint_ShouldTrigger_WithThreadFilter(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			Enabled: true,
		},
		ThreadFilter: &ThreadFilter{ThreadID: 42},
	}

	if !eb.ShouldTrigger(nil, nil, 42, "main", 0) {
		t.Error("should trigger on matching thread")
	}
	if eb.ShouldTrigger(nil, nil, 99, "main", 0) {
		t.Error("should not trigger on non-matching thread")
	}
}

func TestEnhancedBreakpoint_ShouldTrigger_WithStackDepthFilter(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			Enabled: true,
		},
		StackDepthFilter: &StackDepthFilter{MinDepth: 2, MaxDepth: 10},
	}

	if !eb.ShouldTrigger(nil, nil, 0, "", 5) {
		t.Error("should trigger within depth range")
	}
	if eb.ShouldTrigger(nil, nil, 0, "", 1) {
		t.Error("should not trigger below depth range")
	}
}

func TestBuildEnhancedBreakpointSetCommand(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			SuspendPolicy: suspendAll,
		},
	}

	data := BuildEnhancedBreakpointSetCommand(0x100, 0x200, 42, eb)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != eventKindBreakpoint {
		t.Errorf("eventKind = %d, want %d", eventKind, eventKindBreakpoint)
	}

	suspend, _ := r.ReadByte()
	if suspend != suspendAll {
		t.Errorf("suspendPolicy = %d, want %d", suspend, suspendAll)
	}

	modCount, _ := r.ReadInt()
	if modCount != 1 {
		t.Errorf("expected 1 modifier, got %d", modCount)
	}

	// LocationOnly modifier
	modKind, _ := r.ReadByte()
	if modKind != 7 {
		t.Errorf("modKind = %d, want 7", modKind)
	}
}

func TestBuildEnhancedBreakpointSetCommand_WithThreadFilter(t *testing.T) {
	eb := &EnhancedBreakpoint{
		Breakpoint: Breakpoint{
			SuspendPolicy: suspendAll,
		},
		ThreadFilter: &ThreadFilter{ThreadID: 42},
	}

	data := BuildEnhancedBreakpointSetCommand(0x100, 0x200, 42, eb)
	r := NewJDWPDataReader(data)

	r.ReadByte() // eventKind
	r.ReadByte() // suspendPolicy
	modCount, _ := r.ReadInt()
	if modCount != 2 {
		t.Errorf("expected 2 modifiers with thread filter, got %d", modCount)
	}
}

func TestComplexConditionToString(t *testing.T) {
	cc := ParseComplexCondition("x > 5 && y < 10")
	s := complexConditionToString(cc)
	if s != "(x > 5 && y < 10)" {
		t.Errorf("expected '(x > 5 && y < 10)', got %q", s)
	}

	cc = ParseComplexCondition("!(x > 5)")
	s = complexConditionToString(cc)
	if s != "!(x > 5)" {
		t.Errorf("expected '!(x > 5)', got %q", s)
	}

	s = complexConditionToString(nil)
	if s != "" {
		t.Errorf("expected empty string for nil, got %q", s)
	}
}