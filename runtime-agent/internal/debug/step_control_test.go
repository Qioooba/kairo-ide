package debug

import (
	"testing"
)

func TestStepManager_CreateStepRequest(t *testing.T) {
	sm := NewStepManager()
	req := sm.CreateStepRequest(100, StepOver, StepGranularityLine)

	if req.ID != 1 {
		t.Errorf("expected ID 1, got %d", req.ID)
	}
	if req.ThreadID != 100 {
		t.Errorf("expected threadID 100, got %d", req.ThreadID)
	}
	if req.Kind != StepOver {
		t.Errorf("expected StepOver, got %s", req.Kind)
	}
	if req.Granularity != StepGranularityLine {
		t.Errorf("expected StepGranularityLine, got %s", req.Granularity)
	}
	if !req.Active {
		t.Error("request should be active")
	}
	if req.Depth != 1 {
		t.Errorf("expected depth 1 for step over, got %d", req.Depth)
	}
	if req.Size != 1 {
		t.Errorf("expected size 1 for line, got %d", req.Size)
	}
}

func TestStepManager_StepInto(t *testing.T) {
	sm := NewStepManager()
	req := sm.CreateStepRequest(100, StepInto, StepGranularityLine)

	if req.Depth != 0 {
		t.Errorf("expected depth 0 for step into, got %d", req.Depth)
	}
}

func TestStepManager_StepOut(t *testing.T) {
	sm := NewStepManager()
	req := sm.CreateStepRequest(100, StepOut, StepGranularityLine)

	if req.Depth != 2 {
		t.Errorf("expected depth 2 for step out, got %d", req.Depth)
	}
}

func TestStepManager_InstructionGranularity(t *testing.T) {
	sm := NewStepManager()
	req := sm.CreateStepRequest(100, StepOver, StepGranularityInstruction)

	if req.Size != 0 {
		t.Errorf("expected size 0 for instruction, got %d", req.Size)
	}
}

func TestStepManager_GetStepRequest(t *testing.T) {
	sm := NewStepManager()
	req := sm.CreateStepRequest(100, StepOver, StepGranularityLine)

	retrieved, ok := sm.GetStepRequest(req.ID)
	if !ok {
		t.Fatal("should find step request")
	}
	if retrieved.ID != req.ID {
		t.Errorf("expected ID %d, got %d", req.ID, retrieved.ID)
	}

	_, ok = sm.GetStepRequest(999)
	if ok {
		t.Error("should not find nonexistent step request")
	}
}

func TestStepManager_CompleteStepRequest(t *testing.T) {
	sm := NewStepManager()
	req := sm.CreateStepRequest(100, StepOver, StepGranularityLine)

	err := sm.CompleteStepRequest(req.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	retrieved, _ := sm.GetStepRequest(req.ID)
	if retrieved.Active {
		t.Error("step request should be inactive after completion")
	}

	err = sm.CompleteStepRequest(999)
	if err == nil {
		t.Error("expected error for nonexistent request")
	}
}

func TestStepManager_CancelStepRequest(t *testing.T) {
	sm := NewStepManager()
	req := sm.CreateStepRequest(100, StepOver, StepGranularityLine)

	err := sm.CancelStepRequest(req.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	_, ok := sm.GetStepRequest(req.ID)
	if ok {
		t.Error("step request should be removed after cancellation")
	}
	if sm.Count() != 0 {
		t.Errorf("expected 0, got %d", sm.Count())
	}

	err = sm.CancelStepRequest(999)
	if err == nil {
		t.Error("expected error for nonexistent request")
	}
}

func TestStepManager_CancelAllForThread(t *testing.T) {
	sm := NewStepManager()
	sm.CreateStepRequest(100, StepOver, StepGranularityLine)
	sm.CreateStepRequest(100, StepInto, StepGranularityLine)
	sm.CreateStepRequest(200, StepOver, StepGranularityLine)

	if sm.Count() != 3 {
		t.Errorf("expected 3, got %d", sm.Count())
	}

	sm.CancelAllForThread(100)
	if sm.Count() != 1 {
		t.Errorf("expected 1 after cancel, got %d", sm.Count())
	}

	// Verify remaining request is for thread 200
	remaining := sm.ActiveRequests()
	if len(remaining) != 1 {
		t.Fatal("expected 1 active request")
	}
	if remaining[0].ThreadID != 200 {
		t.Errorf("expected thread 200, got %d", remaining[0].ThreadID)
	}
}

func TestStepManager_CancelAll(t *testing.T) {
	sm := NewStepManager()
	sm.CreateStepRequest(100, StepOver, StepGranularityLine)
	sm.CreateStepRequest(200, StepInto, StepGranularityLine)
	sm.CreateStepRequest(300, StepOut, StepGranularityLine)

	sm.CancelAll()
	if sm.Count() != 0 {
		t.Errorf("expected 0 after cancel all, got %d", sm.Count())
	}
}

func TestStepManager_ActiveRequests(t *testing.T) {
	sm := NewStepManager()
	req1 := sm.CreateStepRequest(100, StepOver, StepGranularityLine)
	req2 := sm.CreateStepRequest(200, StepInto, StepGranularityLine)

	active := sm.ActiveRequests()
	if len(active) != 2 {
		t.Errorf("expected 2 active, got %d", len(active))
	}

	sm.CompleteStepRequest(req1.ID)
	active = sm.ActiveRequests()
	if len(active) != 1 {
		t.Errorf("expected 1 active after complete, got %d", len(active))
	}
	if active[0].ID != req2.ID {
		t.Errorf("expected ID %d, got %d", req2.ID, active[0].ID)
	}
}

// ── Command Builder Tests ─────────────────────────────────────────

func TestBuildStepCommand(t *testing.T) {
	data := BuildStepCommand(100, 1, 0)
	r := NewJDWPDataReader(data)

	threadID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if threadID != 100 {
		t.Errorf("threadID = %d, want 100", threadID)
	}

	size, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if size != 1 {
		t.Errorf("size = %d, want 1", size)
	}

	depth, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if depth != 0 {
		t.Errorf("depth = %d, want 0", depth)
	}
}

func TestBuildStepOverCommand(t *testing.T) {
	data := BuildStepOverCommand(100, StepGranularityLine)
	r := NewJDWPDataReader(data)

	threadID, _ := r.ReadObjectID()
	if threadID != 100 {
		t.Errorf("threadID = %d", threadID)
	}

	size, _ := r.ReadInt()
	if size != 1 {
		t.Errorf("size = %d, want 1", size)
	}

	depth, _ := r.ReadInt()
	if depth != 1 {
		t.Errorf("depth = %d, want 1", depth)
	}
}

func TestBuildStepIntoCommand(t *testing.T) {
	data := BuildStepIntoCommand(200, StepGranularityInstruction)
	r := NewJDWPDataReader(data)

	threadID, _ := r.ReadObjectID()
	if threadID != 200 {
		t.Errorf("threadID = %d", threadID)
	}

	size, _ := r.ReadInt()
	if size != 0 {
		t.Errorf("size = %d, want 0 for instruction", size)
	}

	depth, _ := r.ReadInt()
	if depth != 0 {
		t.Errorf("depth = %d, want 0 for into", depth)
	}
}

func TestBuildStepOutCommand(t *testing.T) {
	data := BuildStepOutCommand(300, StepGranularityLine)
	r := NewJDWPDataReader(data)

	threadID, _ := r.ReadObjectID()
	if threadID != 300 {
		t.Errorf("threadID = %d", threadID)
	}

	depth, _ := r.ReadInt()
	_ = depth // skip size
	depth, _ = r.ReadInt()
	if depth != 2 {
		t.Errorf("depth = %d, want 2 for out", depth)
	}
}

func TestBuildStepEventRequestCommand(t *testing.T) {
	data := BuildStepEventRequestCommand(100, 1, 1, suspendAll)
	r := NewJDWPDataReader(data)

	eventKind, _ := r.ReadByte()
	if eventKind != 1 {
		t.Errorf("eventKind = %d, want 1", eventKind)
	}

	suspend, _ := r.ReadByte()
	if suspend != suspendAll {
		t.Errorf("suspend = %d, want %d", suspend, suspendAll)
	}

	modCount, _ := r.ReadInt()
	if modCount != 2 {
		t.Errorf("modCount = %d, want 2", modCount)
	}
}

// ── StepKind and StepGranularity Tests ────────────────────────────

func TestStepKindToDepth(t *testing.T) {
	tests := []struct {
		kind  StepKind
		depth int32
	}{
		{StepInto, 0},
		{StepOver, 1},
		{StepOut, 2},
		{StepKind("unknown"), 1},
	}

	for _, tt := range tests {
		got := stepKindToDepth(tt.kind)
		if got != tt.depth {
			t.Errorf("stepKindToDepth(%s) = %d, want %d", tt.kind, got, tt.depth)
		}
	}
}

func TestStepGranularityToSize(t *testing.T) {
	tests := []struct {
		gran StepGranularity
		size int32
	}{
		{StepGranularityInstruction, 0},
		{StepGranularityLine, 1},
		{StepGranularity("unknown"), 1},
	}

	for _, tt := range tests {
		got := stepGranularityToSize(tt.gran)
		if got != tt.size {
			t.Errorf("stepGranularityToSize(%s) = %d, want %d", tt.gran, got, tt.size)
		}
	}
}

// ── Concurrency Tests ─────────────────────────────────────────────

func TestStepManager_Concurrency(t *testing.T) {
	sm := NewStepManager()
	done := make(chan bool)

	go func() {
		for i := 0; i < 50; i++ {
			sm.CreateStepRequest(int64(i), StepOver, StepGranularityLine)
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 50; i++ {
			sm.ActiveRequests()
		}
		done <- true
	}()

	<-done
	<-done
}