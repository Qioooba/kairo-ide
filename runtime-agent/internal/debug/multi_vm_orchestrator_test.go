package debug

import (
	"testing"
	"time"
)

// ── MultiVMDebugOrchestrator Tests ─────────────────────────────────

func TestNewMultiVMDebugOrchestrator(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	if mo == nil {
		t.Fatal("orchestrator should not be nil")
	}
	if mo.SessionCount() != 0 {
		t.Errorf("initial session count = %d, want 0", mo.SessionCount())
	}
	if mo.ActiveSessionCount() != 0 {
		t.Errorf("initial active session count = %d, want 0", mo.ActiveSessionCount())
	}
	if mo.SuspendedSessionCount() != 0 {
		t.Errorf("initial suspended session count = %d, want 0", mo.SuspendedSessionCount())
	}
}

func TestRegisterSession(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	session := &DebugSession{
		ID:          "session-1",
		State:       StateConnected,
		Port:        5005,
		Hostname:    "127.0.0.1",
		SessionType: "attach",
		StartedAt:   time.Now(),
	}

	err := mo.RegisterSession(session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mo.SessionCount() != 1 {
		t.Errorf("session count = %d, want 1", mo.SessionCount())
	}
}

func TestRegisterSessionNil(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	err := mo.RegisterSession(nil)
	if err == nil {
		t.Error("registering nil session should fail")
	}
}

func TestRegisterSessionEmptyID(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	session := &DebugSession{ID: ""}
	err := mo.RegisterSession(session)
	if err == nil {
		t.Error("registering session with empty ID should fail")
	}
}

func TestRegisterSessionDuplicate(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	session := &DebugSession{ID: "dup-session"}
	mo.RegisterSession(session)
	err := mo.RegisterSession(session)
	if err == nil {
		t.Error("duplicate registration should fail")
	}
}

func TestUnregisterSession(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	session := &DebugSession{ID: "session-1"}
	mo.RegisterSession(session)

	err := mo.UnregisterSession("session-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mo.SessionCount() != 0 {
		t.Errorf("session count = %d, want 0", mo.SessionCount())
	}
}

func TestUnregisterSessionNotFound(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	err := mo.UnregisterSession("nonexistent")
	if err == nil {
		t.Error("unregistering nonexistent session should fail")
	}
}

func TestGetSession(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	session := &DebugSession{ID: "session-1", Port: 5005}
	mo.RegisterSession(session)

	got, ok := mo.GetSession("session-1")
	if !ok {
		t.Fatal("session not found")
	}
	if got.Port != 5005 {
		t.Errorf("port = %d, want 5005", got.Port)
	}
}

func TestGetSessionNotFound(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	_, ok := mo.GetSession("nonexistent")
	if ok {
		t.Error("should not find nonexistent session")
	}
}

func TestListSessions(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1"})
	mo.RegisterSession(&DebugSession{ID: "s2"})
	mo.RegisterSession(&DebugSession{ID: "s3"})

	sessions := mo.ListSessions()
	if len(sessions) != 3 {
		t.Errorf("list sessions count = %d, want 3", len(sessions))
	}
}

func TestAssociateModule(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1"})
	mo.RegisterSession(&DebugSession{ID: "s2"})

	err := mo.AssociateModule("s1", "core")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	err = mo.AssociateModule("s2", "core")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	coreSessions := mo.GetModuleSessions("core")
	if len(coreSessions) != 2 {
		t.Errorf("module sessions count = %d, want 2", len(coreSessions))
	}
}

func TestAssociateModuleSessionNotFound(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	err := mo.AssociateModule("nonexistent", "core")
	if err == nil {
		t.Error("associating nonexistent session should fail")
	}
}

func TestGetModuleSessionsNotFound(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	sessions := mo.GetModuleSessions("nonexistent")
	if sessions != nil {
		t.Errorf("expected nil, got %v", sessions)
	}
}

func TestSetGlobalBreakpoint(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	cbp := &CrossModuleBreakpoint{
		Breakpoint: Breakpoint{
			ClassName:  "com.example.MyClass",
			LineNumber: 42,
		},
		ModuleName: "core",
	}

	ids := mo.SetGlobalBreakpoint(cbp)
	if len(ids) != 1 {
		t.Fatalf("breakpoint IDs count = %d, want 1", len(ids))
	}
	if ids[0] == 0 {
		t.Error("breakpoint ID should not be 0")
	}

	bps := mo.GetGlobalBreakpoints()
	if len(bps) != 1 {
		t.Errorf("global breakpoints count = %d, want 1", len(bps))
	}
}

func TestSetGlobalBreakpointNil(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	ids := mo.SetGlobalBreakpoint(nil)
	if ids != nil {
		t.Errorf("expected nil, got %v", ids)
	}
}

func TestRemoveGlobalBreakpoint(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	cbp := &CrossModuleBreakpoint{
		Breakpoint: Breakpoint{ClassName: "com.example.MyClass"},
	}
	ids := mo.SetGlobalBreakpoint(cbp)

	err := mo.RemoveGlobalBreakpoint(ids[0])
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mo.GetGlobalBreakpoints()) != 0 {
		t.Error("global breakpoints should be empty after removal")
	}
}

func TestRemoveGlobalBreakpointNotFound(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	err := mo.RemoveGlobalBreakpoint(999)
	if err == nil {
		t.Error("removing nonexistent breakpoint should fail")
	}
}

func TestSuspendAll(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1", State: StateRunning})
	mo.RegisterSession(&DebugSession{ID: "s2", State: StateRunning})
	mo.RegisterSession(&DebugSession{ID: "s3", State: StateTerminated})

	err := mo.SuspendAll()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	s1, _ := mo.GetSession("s1")
	s2, _ := mo.GetSession("s2")
	s3, _ := mo.GetSession("s3")

	if s1.State != StateSuspended {
		t.Errorf("s1 state = %s, want %s", s1.State, StateSuspended)
	}
	if s2.State != StateSuspended {
		t.Errorf("s2 state = %s, want %s", s2.State, StateSuspended)
	}
	if s3.State != StateTerminated {
		t.Errorf("s3 state = %s, want %s", s3.State, StateTerminated)
	}
}

func TestResumeAll(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s2", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s3", State: StateConnected})

	err := mo.ResumeAll()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	s1, _ := mo.GetSession("s1")
	s2, _ := mo.GetSession("s2")
	s3, _ := mo.GetSession("s3")

	if s1.State != StateRunning {
		t.Errorf("s1 state = %s, want %s", s1.State, StateRunning)
	}
	if s2.State != StateRunning {
		t.Errorf("s2 state = %s, want %s", s2.State, StateRunning)
	}
	if s3.State != StateConnected {
		t.Errorf("s3 state = %s, want %s", s3.State, StateConnected)
	}
}

func TestTerminateAll(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1", State: StateRunning})
	mo.RegisterSession(&DebugSession{ID: "s2", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s3", State: StateConnected})

	err := mo.TerminateAll()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mo.SessionCount() != 0 {
		t.Errorf("session count after terminate = %d, want 0", mo.SessionCount())
	}
}

func TestActiveSessionCount(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1", State: StateRunning})
	mo.RegisterSession(&DebugSession{ID: "s2", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s3", State: StateConnected})
	mo.RegisterSession(&DebugSession{ID: "s4", State: StateTerminated})
	mo.RegisterSession(&DebugSession{ID: "s5", State: StateNotConnected})

	count := mo.ActiveSessionCount()
	if count != 3 {
		t.Errorf("active session count = %d, want 3", count)
	}
}

func TestSuspendedSessionCount(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s2", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s3", State: StateRunning})

	count := mo.SuspendedSessionCount()
	if count != 2 {
		t.Errorf("suspended session count = %d, want 2", count)
	}
}

func TestGetAllVariables(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s2", State: StateRunning})
	mo.RegisterSession(&DebugSession{ID: "s3", State: StateSuspended})

	vars := mo.GetAllVariables()
	if len(vars) != 2 {
		t.Errorf("variables map size = %d, want 2 (only suspended)", len(vars))
	}
	if _, ok := vars["s1"]; !ok {
		t.Error("s1 should be in variables map")
	}
	if _, ok := vars["s2"]; ok {
		t.Error("s2 should not be in variables map (running)")
	}
	if _, ok := vars["s3"]; !ok {
		t.Error("s3 should be in variables map")
	}
}

func TestGetAllCallStacks(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1", State: StateSuspended})
	mo.RegisterSession(&DebugSession{ID: "s2", State: StateRunning})

	stacks := mo.GetAllCallStacks()
	if len(stacks) != 1 {
		t.Errorf("call stacks map size = %d, want 1", len(stacks))
	}
	if _, ok := stacks["s1"]; !ok {
		t.Error("s1 should be in call stacks map")
	}
}

func TestGetEventAggregator(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	ea := mo.GetEventAggregator()
	if ea == nil {
		t.Fatal("event aggregator should not be nil")
	}
}

func TestUnregisterSessionCleansModuleMapping(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	mo.RegisterSession(&DebugSession{ID: "s1"})
	mo.AssociateModule("s1", "core")

	// Unregister should clean up the module mapping
	mo.UnregisterSession("s1")
	sessions := mo.GetModuleSessions("core")
	if len(sessions) != 0 {
		t.Errorf("module sessions after unregister = %d, want 0", len(sessions))
	}
}

func TestSetGlobalBreakpointWithExistingID(t *testing.T) {
	mo := NewMultiVMDebugOrchestrator()
	cbp := &CrossModuleBreakpoint{
		Breakpoint: Breakpoint{
			ID:         42,
			ClassName:  "com.example.MyClass",
			LineNumber: 10,
		},
	}

	ids := mo.SetGlobalBreakpoint(cbp)
	if len(ids) != 1 {
		t.Fatalf("ids count = %d, want 1", len(ids))
	}
	if ids[0] != 42 {
		t.Errorf("breakpoint ID = %d, want 42", ids[0])
	}
}