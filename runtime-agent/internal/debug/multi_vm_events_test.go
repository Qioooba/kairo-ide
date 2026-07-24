package debug

import (
	"testing"
	"time"
)

// ── MultiVMEventAggregator Tests ───────────────────────────────────

func TestNewMultiVMEventAggregator(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	if mea == nil {
		t.Fatal("aggregator should not be nil")
	}
	if mea.EventCount() != 0 {
		t.Errorf("initial event count = %d, want 0", mea.EventCount())
	}
	if mea.ListenerCount() != 0 {
		t.Errorf("initial listener count = %d, want 0", mea.ListenerCount())
	}
}

func TestNewMultiVMEventAggregatorZeroMax(t *testing.T) {
	mea := NewMultiVMEventAggregator(0)
	// Should default to 1000, so we can record events
	for i := 0; i < 100; i++ {
		mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	}
	if mea.EventCount() != 100 {
		t.Errorf("event count = %d, want 100", mea.EventCount())
	}
}

func TestRecordEvent(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	event := DebugEvent{
		Type:       EventBreakpointHit,
		ThreadID:   42,
		ClassName:  "com.example.MyClass",
		LineNumber: 10,
	}

	mea.RecordEvent("session-1", "core", event)

	if mea.EventCount() != 1 {
		t.Fatalf("event count = %d, want 1", mea.EventCount())
	}

	events := mea.GetAllEvents()
	if len(events) != 1 {
		t.Fatalf("events length = %d, want 1", len(events))
	}

	e := events[0]
	if e.SessionID != "session-1" {
		t.Errorf("SessionID = %s, want session-1", e.SessionID)
	}
	if e.ModuleName != "core" {
		t.Errorf("ModuleName = %s, want core", e.ModuleName)
	}
	if e.EventType != EventBreakpointHit {
		t.Errorf("EventType = %s, want %s", e.EventType, EventBreakpointHit)
	}
	if e.ThreadID != 42 {
		t.Errorf("ThreadID = %d, want 42", e.ThreadID)
	}
	if e.ClassName != "com.example.MyClass" {
		t.Errorf("ClassName = %s, want com.example.MyClass", e.ClassName)
	}
	if e.LineNumber != 10 {
		t.Errorf("LineNumber = %d, want 10", e.LineNumber)
	}
	if e.Timestamp.IsZero() {
		t.Error("Timestamp should be set")
	}
}

func TestGetEvents(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	mea.RecordEvent("s2", "web", DebugEvent{Type: EventStepComplete})
	mea.RecordEvent("s1", "core", DebugEvent{Type: EventVMDeath})

	s1Events := mea.GetEvents("s1")
	if len(s1Events) != 2 {
		t.Errorf("s1 events count = %d, want 2", len(s1Events))
	}

	s2Events := mea.GetEvents("s2")
	if len(s2Events) != 1 {
		t.Errorf("s2 events count = %d, want 1", len(s2Events))
	}

	s3Events := mea.GetEvents("s3")
	if len(s3Events) != 0 {
		t.Errorf("s3 events count = %d, want 0", len(s3Events))
	}
}

func TestGetAllEvents(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	for i := 0; i < 5; i++ {
		mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	}

	events := mea.GetAllEvents()
	if len(events) != 5 {
		t.Errorf("events count = %d, want 5", len(events))
	}
}

func TestAddListener(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	received := false

	mea.AddListener(func(event AggregatedDebugEvent) {
		received = true
	})

	mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})

	if !received {
		t.Error("listener should have been called")
	}
}

func TestAddListenerMultipleEvents(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	count := 0

	mea.AddListener(func(event AggregatedDebugEvent) {
		count++
	})

	for i := 0; i < 5; i++ {
		mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	}

	if count != 5 {
		t.Errorf("listener call count = %d, want 5", count)
	}
}

func TestEventAggregatorClear(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	mea.AddListener(func(event AggregatedDebugEvent) {})

	mea.Clear()

	if mea.EventCount() != 0 {
		t.Errorf("event count after clear = %d, want 0", mea.EventCount())
	}
	if mea.ListenerCount() != 0 {
		t.Errorf("listener count after clear = %d, want 0", mea.ListenerCount())
	}
}

func TestMaxEventsLimit(t *testing.T) {
	mea := NewMultiVMEventAggregator(5)
	for i := 0; i < 10; i++ {
		mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	}

	if mea.EventCount() != 5 {
		t.Errorf("event count = %d, want 5 (max limit)", mea.EventCount())
	}
}

func TestGetEventsByModule(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	mea.RecordEvent("s2", "core", DebugEvent{Type: EventStepComplete})
	mea.RecordEvent("s3", "web", DebugEvent{Type: EventVMStart})

	coreEvents := mea.GetEventsByModule("core")
	if len(coreEvents) != 2 {
		t.Errorf("core events count = %d, want 2", len(coreEvents))
	}

	webEvents := mea.GetEventsByModule("web")
	if len(webEvents) != 1 {
		t.Errorf("web events count = %d, want 1", len(webEvents))
	}
}

func TestGetEventsByType(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)
	mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	mea.RecordEvent("s2", "core", DebugEvent{Type: EventBreakpointHit})
	mea.RecordEvent("s3", "web", DebugEvent{Type: EventVMStart})

	bpEvents := mea.GetEventsByType(EventBreakpointHit)
	if len(bpEvents) != 2 {
		t.Errorf("breakpoint events count = %d, want 2", len(bpEvents))
	}

	vmEvents := mea.GetEventsByType(EventVMStart)
	if len(vmEvents) != 1 {
		t.Errorf("VM start events count = %d, want 1", len(vmEvents))
	}
}

func TestGetLatestEvent(t *testing.T) {
	mea := NewMultiVMEventAggregator(100)

	// Empty aggregator
	latest := mea.GetLatestEvent()
	if latest != nil {
		t.Error("latest event should be nil for empty aggregator")
	}

	mea.RecordEvent("s1", "core", DebugEvent{Type: EventBreakpointHit})
	time.Sleep(1 * time.Millisecond)
	mea.RecordEvent("s2", "web", DebugEvent{Type: EventVMDeath})

	latest = mea.GetLatestEvent()
	if latest == nil {
		t.Fatal("latest event should not be nil")
	}
	if latest.SessionID != "s2" {
		t.Errorf("latest SessionID = %s, want s2", latest.SessionID)
	}
	if latest.EventType != EventVMDeath {
		t.Errorf("latest EventType = %s, want %s", latest.EventType, EventVMDeath)
	}
}