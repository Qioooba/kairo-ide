package debug

import (
	"testing"
	"time"
)

// ── State Transition Tests ────────────────────────────────────────

func TestDebugStateMachine_InitialState(t *testing.T) {
	dsm := NewDebugStateMachine()
	if dsm.State() != StateNotConnected {
		t.Errorf("initial state = %s, want %s", dsm.State(), StateNotConnected)
	}
}

func TestDebugStateMachine_Connect(t *testing.T) {
	dsm := NewDebugStateMachine()
	err := dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	session := dsm.Session()
	if session.ID != "session-1" {
		t.Errorf("session ID = %s, want session-1", session.ID)
	}
	if session.Port != 5005 {
		t.Errorf("port = %d, want 5005", session.Port)
	}
	if session.Hostname != "127.0.0.1" {
		t.Errorf("hostname = %s, want 127.0.0.1", session.Hostname)
	}
	if session.SessionType != "attach" {
		t.Errorf("sessionType = %s, want attach", session.SessionType)
	}
	if dsm.State() != StateConnected {
		t.Errorf("state = %s, want %s", dsm.State(), StateConnected)
	}
	if session.StartedAt.IsZero() {
		t.Error("StartedAt should be set")
	}
}

func TestDebugStateMachine_DoubleConnect(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	err := dsm.Connect("session-2", 5006, "127.0.0.1", "attach")
	if err == nil {
		t.Error("double connect should fail")
	}
}

func TestDebugStateMachine_Resume(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.Suspend()
	dsm.Resume()

	if dsm.State() != StateRunning {
		t.Errorf("state = %s, want %s", dsm.State(), StateRunning)
	}
}

func TestDebugStateMachine_ResumeFromConnected(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")

	err := dsm.Resume()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dsm.State() != StateRunning {
		t.Errorf("state = %s, want %s", dsm.State(), StateRunning)
	}
}

func TestDebugStateMachine_Suspend(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.Resume()

	err := dsm.Suspend()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dsm.State() != StateSuspended {
		t.Errorf("state = %s, want %s", dsm.State(), StateSuspended)
	}
}

func TestDebugStateMachine_SuspendFromConnected(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")

	err := dsm.Suspend()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dsm.State() != StateSuspended {
		t.Errorf("state = %s, want %s", dsm.State(), StateSuspended)
	}
}

func TestDebugStateMachine_Terminate(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")

	err := dsm.Terminate()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dsm.State() != StateTerminated {
		t.Errorf("state = %s, want %s", dsm.State(), StateTerminated)
	}

	session := dsm.Session()
	if session.EndedAt.IsZero() {
		t.Error("EndedAt should be set")
	}
}

func TestDebugStateMachine_TerminateFromNotConnected(t *testing.T) {
	dsm := NewDebugStateMachine()
	err := dsm.Terminate()
	if err == nil {
		t.Error("terminate from not_connected should fail")
	}
}

func TestDebugStateMachine_TerminateFromTerminated(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.Terminate()

	err := dsm.Terminate()
	if err == nil {
		t.Error("double terminate should fail")
	}
}

func TestDebugStateMachine_InvalidTransition(t *testing.T) {
	dsm := NewDebugStateMachine()
	err := dsm.Transition(StateRunning)
	if err == nil {
		t.Error("transition from not_connected to running should fail")
	}
}

// ── isValidTransition Tests ───────────────────────────────────────

func TestIsValidTransition(t *testing.T) {
	tests := []struct {
		from  DebugState
		to    DebugState
		valid bool
	}{
		{StateNotConnected, StateConnected, true},
		{StateNotConnected, StateRunning, false},
		{StateNotConnected, StateSuspended, false},
		{StateNotConnected, StateTerminated, false},

		{StateConnected, StateRunning, true},
		{StateConnected, StateSuspended, true},
		{StateConnected, StateTerminated, true},
		{StateConnected, StateNotConnected, false},

		{StateRunning, StateSuspended, true},
		{StateRunning, StateTerminated, true},
		{StateRunning, StateConnected, false},
		{StateRunning, StateNotConnected, false},

		{StateSuspended, StateRunning, true},
		{StateSuspended, StateTerminated, true},
		{StateSuspended, StateConnected, false},
		{StateSuspended, StateNotConnected, false},

		{StateTerminated, StateRunning, false},
		{StateTerminated, StateSuspended, false},
		{StateTerminated, StateConnected, false},
		{StateTerminated, StateNotConnected, false},
	}

	for _, tt := range tests {
		got := isValidTransition(tt.from, tt.to)
		if got != tt.valid {
			t.Errorf("isValidTransition(%s, %s) = %v, want %v", tt.from, tt.to, got, tt.valid)
		}
	}
}

func TestIsValidTransition_SameState(t *testing.T) {
	states := []DebugState{
		StateNotConnected, StateConnected, StateRunning, StateSuspended, StateTerminated,
	}
	for _, s := range states {
		if !isValidTransition(s, s) {
			t.Errorf("same-state transition %s -> %s should be valid", s, s)
		}
	}
}

// ── Event Handling Tests ──────────────────────────────────────────

func TestDebugStateMachine_HandleEvent_VMStart(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")

	dsm.HandleEvent(DebugEvent{Type: EventVMStart})
	if dsm.State() != StateRunning {
		t.Errorf("state = %s, want %s", dsm.State(), StateRunning)
	}
}

func TestDebugStateMachine_HandleEvent_VMDeath(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})

	dsm.HandleEvent(DebugEvent{Type: EventVMDeath})
	if dsm.State() != StateTerminated {
		t.Errorf("state = %s, want %s", dsm.State(), StateTerminated)
	}
}

func TestDebugStateMachine_HandleEvent_BreakpointHit(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})

	dsm.HandleEvent(DebugEvent{Type: EventBreakpointHit, ThreadID: 100, LineNumber: 42})
	if dsm.State() != StateSuspended {
		t.Errorf("state = %s, want %s", dsm.State(), StateSuspended)
	}
}

func TestDebugStateMachine_HandleEvent_StepComplete(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})

	dsm.HandleEvent(DebugEvent{Type: EventStepComplete})
	if dsm.State() != StateSuspended {
		t.Errorf("state = %s, want %s", dsm.State(), StateSuspended)
	}
}

func TestDebugStateMachine_HandleEvent_ExceptionHit(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})

	dsm.HandleEvent(DebugEvent{Type: EventExceptionHit, ExceptionClass: "java.lang.NPE"})
	if dsm.State() != StateSuspended {
		t.Errorf("state = %s, want %s", dsm.State(), StateSuspended)
	}
}

func TestDebugStateMachine_HandleEvent_ThreadStartDeath(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})

	dsm.HandleEvent(DebugEvent{Type: EventThreadStart, ThreadID: 200})
	if dsm.State() != StateRunning {
		t.Errorf("thread start should not change state, got %s", dsm.State())
	}

	dsm.HandleEvent(DebugEvent{Type: EventThreadDeath, ThreadID: 200})
	if dsm.State() != StateRunning {
		t.Errorf("thread death should not change state, got %s", dsm.State())
	}
}

func TestDebugStateMachine_HandleEvent_ClassPrepare(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})

	dsm.HandleEvent(DebugEvent{Type: EventClassPrepare, ClassName: "com.example.Test"})
	if dsm.State() != StateRunning {
		t.Errorf("class prepare should not change state, got %s", dsm.State())
	}
}

// ── Listener Tests ────────────────────────────────────────────────

func TestDebugStateMachine_Listeners(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")

	received := make(chan DebugEvent, 1)
	dsm.AddListener(func(event DebugEvent) {
		received <- event
	})

	dsm.HandleEvent(DebugEvent{Type: EventBreakpointHit, ThreadID: 100, LineNumber: 42})

	select {
	case event := <-received:
		if event.Type != EventBreakpointHit {
			t.Errorf("event type = %s, want %s", event.Type, EventBreakpointHit)
		}
		if event.ThreadID != 100 {
			t.Errorf("threadID = %d, want 100", event.ThreadID)
		}
	case <-time.After(time.Second):
		t.Fatal("listener was not called")
	}
}

// ── Event/Error Log Tests ─────────────────────────────────────────

func TestDebugStateMachine_EventLog(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")

	dsm.HandleEvent(DebugEvent{Type: EventVMStart})
	dsm.HandleEvent(DebugEvent{Type: EventBreakpointHit, ThreadID: 100, LineNumber: 42})
	dsm.HandleEvent(DebugEvent{Type: EventVMDeath})

	log := dsm.EventLog()
	if len(log) != 3 {
		t.Errorf("expected 3 events, got %d", len(log))
	}
	if log[0].Type != EventVMStart {
		t.Errorf("event[0].Type = %s", log[0].Type)
	}
	if log[1].Type != EventBreakpointHit {
		t.Errorf("event[1].Type = %s", log[1].Type)
	}
	if log[2].Type != EventVMDeath {
		t.Errorf("event[2].Type = %s", log[2].Type)
	}
}

func TestDebugStateMachine_ErrorLog(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.AddError("error 1")
	dsm.AddError("error 2")

	errors := dsm.ErrorLog()
	if len(errors) != 2 {
		t.Errorf("expected 2 errors, got %d", len(errors))
	}
	if errors[0] != "error 1" {
		t.Errorf("errors[0] = %q", errors[0])
	}
}

// ── Reset Tests ───────────────────────────────────────────────────

func TestDebugStateMachine_Reset(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})
	dsm.AddError("some error")

	dsm.Reset()

	if dsm.State() != StateNotConnected {
		t.Errorf("state = %s, want %s", dsm.State(), StateNotConnected)
	}
	if len(dsm.EventLog()) != 0 {
		t.Errorf("event log should be empty, got %d", len(dsm.EventLog()))
	}
	if len(dsm.ErrorLog()) != 0 {
		t.Errorf("error log should be empty, got %d", len(dsm.ErrorLog()))
	}
}

// ── IsActive / IsSuspended Tests ──────────────────────────────────

func TestDebugStateMachine_IsActive(t *testing.T) {
	dsm := NewDebugStateMachine()
	if dsm.IsActive() {
		t.Error("not_connected should not be active")
	}

	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	if !dsm.IsActive() {
		t.Error("connected should be active")
	}

	dsm.HandleEvent(DebugEvent{Type: EventVMStart})
	if !dsm.IsActive() {
		t.Error("running should be active")
	}

	dsm.HandleEvent(DebugEvent{Type: EventBreakpointHit})
	if !dsm.IsActive() {
		t.Error("suspended should be active")
	}

	dsm.HandleEvent(DebugEvent{Type: EventVMDeath})
	if dsm.IsActive() {
		t.Error("terminated should not be active")
	}
}

func TestDebugStateMachine_IsSuspended(t *testing.T) {
	dsm := NewDebugStateMachine()
	if dsm.IsSuspended() {
		t.Error("not_connected should not be suspended")
	}

	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})
	if dsm.IsSuspended() {
		t.Error("running should not be suspended")
	}

	dsm.HandleEvent(DebugEvent{Type: EventBreakpointHit})
	if !dsm.IsSuspended() {
		t.Error("should be suspended after breakpoint")
	}
}

// ── ParseEventKind Tests ──────────────────────────────────────────

func TestParseEventKind(t *testing.T) {
	tests := []struct {
		kind byte
		want DebugEventType
	}{
		{eventKindVMStart, EventVMStart},
		{eventKindVMDeath, EventVMDeath},
		{eventKindClassPrepare, EventClassPrepare},
		{eventKindClassUnload, EventClassUnload},
		{eventKindThreadStart, EventThreadStart},
		{eventKindThreadDeath, EventThreadDeath},
		{eventKindBreakpoint, EventBreakpointHit},
		{eventKindException, EventExceptionHit},
		{eventKindFieldAccess, EventFieldAccess},
		{eventKindFieldModification, EventFieldModify},
		{eventKindStep, EventStepComplete},
		{0xFF, "unknown_255"},
	}

	for _, tt := range tests {
		got := ParseEventKind(tt.kind)
		if got != tt.want {
			t.Errorf("ParseEventKind(%d) = %s, want %s", tt.kind, got, tt.want)
		}
	}
}

// ── ParseCompositeEventReply Tests ────────────────────────────────

func TestParseCompositeEventReply_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(suspendAll)
	w.WriteInt(0) // zero events
	data := w.Bytes()

	events, err := ParseCompositeEventReply(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("expected 0 events, got %d", len(events))
	}
}

func TestParseCompositeEventReply_VMStart(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(suspendNone)
	w.WriteInt(1) // one event

	// VMStart event
	w.WriteByte(eventKindVMStart)
	w.WriteInt(0) // requestID

	data := w.Bytes()
	events, err := ParseCompositeEventReply(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Type != EventVMStart {
		t.Errorf("event type = %s, want %s", events[0].Type, EventVMStart)
	}
	if events[0].SuspendPolicy != suspendNone {
		t.Errorf("suspendPolicy = %d, want %d", events[0].SuspendPolicy, suspendNone)
	}
}

func TestParseCompositeEventReply_Breakpoint(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(suspendAll)
	w.WriteInt(1) // one event

	// Breakpoint event
	w.WriteByte(eventKindBreakpoint)
	w.WriteInt(3)         // requestID
	w.WriteObjectID(100)  // threadID
	w.WriteByte(1)        // location tag
	w.WriteObjectID(200)  // classID
	w.WriteObjectID(300)  // methodID
	w.WriteLong(42)       // line number

	data := w.Bytes()
	events, err := ParseCompositeEventReply(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	event := events[0]
	if event.Type != EventBreakpointHit {
		t.Errorf("event type = %s, want %s", event.Type, EventBreakpointHit)
	}
	if event.ThreadID != 100 {
		t.Errorf("threadID = %d, want 100", event.ThreadID)
	}
	if event.LineNumber != 42 {
		t.Errorf("lineNumber = %d, want 42", event.LineNumber)
	}
	if event.RequestID != 3 {
		t.Errorf("requestID = %d, want 3", event.RequestID)
	}
}

func TestParseCompositeEventReply_ThreadStart(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(suspendNone)
	w.WriteInt(1)

	w.WriteByte(eventKindThreadStart)
	w.WriteInt(0)
	w.WriteObjectID(200) // threadID

	data := w.Bytes()
	events, err := ParseCompositeEventReply(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if events[0].Type != EventThreadStart {
		t.Errorf("event type = %s", events[0].Type)
	}
	if events[0].ThreadID != 200 {
		t.Errorf("threadID = %d", events[0].ThreadID)
	}
}

func TestParseCompositeEventReply_ClassPrepare(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(suspendNone)
	w.WriteInt(1)

	w.WriteByte(eventKindClassPrepare)
	w.WriteInt(0)
	w.WriteObjectID(100)       // threadID
	w.WriteByte(1)             // refTypeTag
	w.WriteObjectID(200)       // typeID
	w.WriteString("Lcom/example/Test;") // signature
	w.WriteInt(1)              // status

	data := w.Bytes()
	events, err := ParseCompositeEventReply(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if events[0].ClassName != "Lcom/example/Test;" {
		t.Errorf("className = %s", events[0].ClassName)
	}
}

func TestParseCompositeEventReply_MultipleEvents(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(suspendAll)
	w.WriteInt(2) // two events

	// VMStart
	w.WriteByte(eventKindVMStart)
	w.WriteInt(0)

	// ThreadStart
	w.WriteByte(eventKindThreadStart)
	w.WriteInt(0)
	w.WriteObjectID(100)

	data := w.Bytes()
	events, err := ParseCompositeEventReply(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].Type != EventVMStart {
		t.Errorf("event[0] = %s", events[0].Type)
	}
	if events[1].Type != EventThreadStart {
		t.Errorf("event[1] = %s", events[1].Type)
	}
}

func TestParseCompositeEventReply_Truncated(t *testing.T) {
	_, err := ParseCompositeEventReply([]byte{0x00})
	if err == nil {
		t.Error("expected error for truncated data")
	}
}

func TestParseCompositeEventReply_TruncatedEvent(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(suspendAll)
	w.WriteInt(1)
	w.WriteByte(eventKindBreakpoint) // incomplete event data
	w.WriteInt(0)

	data := w.Bytes()
	_, err := ParseCompositeEventReply(data)
	if err == nil {
		t.Error("expected error for truncated event data")
	}
}

// ── Concurrency Tests ─────────────────────────────────────────────

func TestDebugStateMachine_Concurrency(t *testing.T) {
	dsm := NewDebugStateMachine()
	dsm.Connect("session-1", 5005, "127.0.0.1", "attach")
	dsm.HandleEvent(DebugEvent{Type: EventVMStart})

	done := make(chan bool)

	go func() {
		for i := 0; i < 50; i++ {
			dsm.HandleEvent(DebugEvent{Type: EventBreakpointHit, ThreadID: 100, LineNumber: int32(i)})
			dsm.Resume()
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 50; i++ {
			dsm.State()
			dsm.IsActive()
			dsm.IsSuspended()
		}
		done <- true
	}()

	go func() {
		for i := 0; i < 50; i++ {
			dsm.AddError("test error")
			dsm.EventLog()
		}
		done <- true
	}()

	<-done
	<-done
	<-done
}

// ── DebugSession Tests ────────────────────────────────────────────

func TestDebugSession_Fields(t *testing.T) {
	session := &DebugSession{
		ID:          "session-1",
		State:       StateConnected,
		VMName:      "HotSpot",
		VMVersion:   "1.6.0_45",
		StartedAt:   time.Now(),
		Port:        5005,
		Hostname:    "127.0.0.1",
		SessionType: "attach",
	}

	if session.ID != "session-1" {
		t.Errorf("ID = %s, want session-1", session.ID)
	}
	if session.State != StateConnected {
		t.Errorf("State = %s, want %s", session.State, StateConnected)
	}
	if session.Port != 5005 {
		t.Errorf("Port = %d, want 5005", session.Port)
	}
	if session.SessionType != "attach" {
		t.Errorf("SessionType = %s, want attach", session.SessionType)
	}
}

// ── DebugEvent Tests ──────────────────────────────────────────────

func TestDebugEvent_Fields(t *testing.T) {
	event := DebugEvent{
		Type:           EventBreakpointHit,
		ThreadID:       100,
		ClassName:      "com.example.Test",
		MethodName:     "doWork",
		LineNumber:     42,
		RequestID:      5,
		ExceptionClass: "",
		Timestamp:      time.Now(),
		SuspendPolicy:  suspendAll,
	}

	if event.Type != EventBreakpointHit {
		t.Errorf("Type = %s", event.Type)
	}
	if event.ThreadID != 100 {
		t.Errorf("ThreadID = %d", event.ThreadID)
	}
	if event.LineNumber != 42 {
		t.Errorf("LineNumber = %d", event.LineNumber)
	}
}