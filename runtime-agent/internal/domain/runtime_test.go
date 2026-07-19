package domain

import (
	"testing"
	"time"
)

func TestServerStateTransitions(t *testing.T) {
	tests := []struct {
		name    string
		from    ServerState
		to      ServerState
		allowed bool
	}{
		// stopped
		{"stopped→preparing", ServerStateStopped, ServerStatePreparing, true},
		{"stopped→stopped (idempotent)", ServerStateStopped, ServerStateStopped, true},
		{"stopped→starting (illegal)", ServerStateStopped, ServerStateStarting, false},
		{"stopped→running (illegal)", ServerStateStopped, ServerStateRunning, false},
		{"stopped→failed (illegal)", ServerStateStopped, ServerStateFailed, false},

		// preparing
		{"preparing→starting", ServerStatePreparing, ServerStateStarting, true},
		{"preparing→failed", ServerStatePreparing, ServerStateFailed, true},
		{"preparing→preparing", ServerStatePreparing, ServerStatePreparing, true},
		{"preparing→running (illegal)", ServerStatePreparing, ServerStateRunning, false},
		{"preparing→stopped (illegal)", ServerStatePreparing, ServerStateStopped, false},

		// starting
		{"starting→running", ServerStateStarting, ServerStateRunning, true},
		{"starting→failed", ServerStateStarting, ServerStateFailed, true},
		{"starting→starting", ServerStateStarting, ServerStateStarting, true},
		{"starting→stopped (illegal)", ServerStateStarting, ServerStateStopped, false},
		{"starting→stopping (illegal)", ServerStateStarting, ServerStateStopping, false},

		// running
		{"running→stopping", ServerStateRunning, ServerStateStopping, true},
		{"running→restarting", ServerStateRunning, ServerStateRestarting, true},
		{"running→crashed", ServerStateRunning, ServerStateCrashed, true},
		{"running→failed", ServerStateRunning, ServerStateFailed, true},
		{"running→running", ServerStateRunning, ServerStateRunning, true},
		{"running→stopped (illegal direct)", ServerStateRunning, ServerStateStopped, false},
		{"running→starting (illegal)", ServerStateRunning, ServerStateStarting, false},

		// stopping
		{"stopping→stopped", ServerStateStopping, ServerStateStopped, true},
		{"stopping→failed", ServerStateStopping, ServerStateFailed, true},
		{"stopping→stopping", ServerStateStopping, ServerStateStopping, true},
		{"stopping→running (illegal)", ServerStateStopping, ServerStateRunning, false},

		// restarting
		{"restarting→starting", ServerStateRestarting, ServerStateStarting, true},
		{"restarting→failed", ServerStateRestarting, ServerStateFailed, true},
		{"restarting→restarting", ServerStateRestarting, ServerStateRestarting, true},
		{"restarting→running (illegal)", ServerStateRestarting, ServerStateRunning, false},
		{"restarting→stopped (illegal)", ServerStateRestarting, ServerStateStopped, false},

		// failed
		{"failed→starting", ServerStateFailed, ServerStateStarting, true},
		{"failed→stopped", ServerStateFailed, ServerStateStopped, true},
		{"failed→failed", ServerStateFailed, ServerStateFailed, true},
		{"failed→running (illegal)", ServerStateFailed, ServerStateRunning, false},

		// crashed
		{"crashed→starting", ServerStateCrashed, ServerStateStarting, true},
		{"crashed→stopped", ServerStateCrashed, ServerStateStopped, true},
		{"crashed→crashed", ServerStateCrashed, ServerStateCrashed, true},
		{"crashed→running (illegal)", ServerStateCrashed, ServerStateRunning, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CanTransitionServerState(tt.from, tt.to)
			if got != tt.allowed {
				t.Errorf("CanTransitionServerState(%q, %q) = %v, want %v", tt.from, tt.to, got, tt.allowed)
			}

			err := TransitionServerState(tt.from, tt.to)
			if tt.allowed && err != nil {
				t.Errorf("TransitionServerState(%q, %q) returned unexpected error: %v", tt.from, tt.to, err)
			}
			if !tt.allowed && err != ErrInvalidStateTransition {
				t.Errorf("TransitionServerState(%q, %q) error = %v, want ErrInvalidStateTransition", tt.from, tt.to, err)
			}
		})
	}
}

func TestServerStateIsTerminal(t *testing.T) {
	terminalStates := map[ServerState]bool{
		ServerStateStopped:    true,
		ServerStateFailed:     true,
		ServerStateCrashed:    true,
		ServerStatePreparing:  false,
		ServerStateStarting:   false,
		ServerStateRunning:    false,
		ServerStateStopping:   false,
		ServerStateRestarting: false,
	}

	for state, wantTerminal := range terminalStates {
		got := state.IsTerminal()
		if got != wantTerminal {
			t.Errorf("ServerState(%q).IsTerminal() = %v, want %v", state, got, wantTerminal)
		}
	}
}

func TestServerStateIsTransitioning(t *testing.T) {
	transitioningStates := map[ServerState]bool{
		ServerStatePreparing:  true,
		ServerStateStarting:   true,
		ServerStateStopping:   true,
		ServerStateRestarting: true,
		ServerStateStopped:    false,
		ServerStateRunning:    false,
		ServerStateFailed:     false,
		ServerStateCrashed:    false,
	}

	for state, wantTransitioning := range transitioningStates {
		got := state.IsTransitioning()
		if got != wantTransitioning {
			t.Errorf("ServerState(%q).IsTransitioning() = %v, want %v", state, got, wantTransitioning)
		}
	}
}

func TestRuntimePlanDeepCopy(t *testing.T) {
	now := time.Now()

	original := RuntimePlan{
		WorkspaceID:    "ws_test123",
		ProjectID:      "prj_test456",
		ServerID:       "srv_test789",
		RuntimeID:      "tomcat6",
		JavaHome:       "/usr/lib/jvm/java-6",
		CatalinaHome:   "/opt/tomcat6",
		CatalinaBase:   "/tmp/kairo/srv_test789",
		WebappDir:      "/project/webapp",
		DeploymentRoot: "/tmp/kairo/srv_test789/webapps/ROOT",
		ContextPath:    "/",
		HTTPPort:       8080,
		ShutdownPort:   8005,
		DebugPort:      8000,
		JVMOptions:     []string{"-Xms256m", "-Xmx512m"},
		Env:            []string{"JAVA_OPTS=-Dtest=true"},
		Generation:     1,
	}

	copied := original.DeepCopy()

	// Verify values are equal
	if copied.WorkspaceID != original.WorkspaceID {
		t.Error("WorkspaceID mismatch after copy")
	}
	if copied.ServerID != original.ServerID {
		t.Error("ServerID mismatch after copy")
	}
	if copied.Generation != original.Generation {
		t.Error("Generation mismatch after copy")
	}

	// Mutate the copy's slices and verify original is unchanged
	copied.JVMOptions[0] = "-Xms1g"
	copied.Env[0] = "MUTATED"

	if original.JVMOptions[0] == copied.JVMOptions[0] {
		t.Error("JVMOptions slice was not deep copied - mutation affected original")
	}
	if original.Env[0] == copied.Env[0] {
		t.Error("Env slice was not deep copied - mutation affected original")
	}

	// Test with nil slices
	nilPlan := RuntimePlan{
		ServerID:   "srv_nil",
		JVMOptions: nil,
		Env:        nil,
	}
	nilCopy := nilPlan.DeepCopy()
	if nilCopy.JVMOptions != nil {
		t.Error("nil JVMOptions should remain nil after copy")
	}
	if nilCopy.Env != nil {
		t.Error("nil Env should remain nil after copy")
	}
	_ = now
}

func TestServerRecordDeepCopy(t *testing.T) {
	now := time.Now()
	startTime := now.Add(-1 * time.Hour)
	pi := ProcessIdentity{
		PID:          12345,
		Executable:   "/usr/bin/java",
		StartTime:    startTime,
		CatalinaBase: "/tmp/kairo/srv_test",
		MarkerToken:  "marker-abc",
	}

	original := ServerRecord{
		ID:              "srv_testrecord",
		WorkspaceID:     "ws_test",
		ProjectID:       "prj_test",
		DesiredState:    DesiredServerStateRunning,
		ObservedState:   ServerStateRunning,
		Generation:      3,
		PID:             12345,
		ProcessIdentity: &pi,
		RuntimePlan: RuntimePlan{
			ServerID:   "srv_testrecord",
			JVMOptions: []string{"-Xmx256m"},
			Env:        []string{"TEST=1"},
		},
		LastError: "",
		StartedAt: &startTime,
		StoppedAt: nil,
		UpdatedAt: now,
	}

	copied := original.DeepCopy()

	// Verify basic field equality
	if copied.ID != original.ID {
		t.Error("ID mismatch after copy")
	}
	if copied.Generation != original.Generation {
		t.Error("Generation mismatch after copy")
	}
	if copied.PID != original.PID {
		t.Error("PID mismatch after copy")
	}

	// Verify ProcessIdentity deep copied
	if copied.ProcessIdentity == nil {
		t.Fatal("ProcessIdentity should not be nil after copy")
	}
	if copied.ProcessIdentity == original.ProcessIdentity {
		t.Error("ProcessIdentity pointer was not deep copied")
	}
	copied.ProcessIdentity.PID = 99999
	if original.ProcessIdentity.PID == 99999 {
		t.Error("ProcessIdentity mutation affected original")
	}

	// Verify RuntimePlan deep copied
	copied.RuntimePlan.JVMOptions[0] = "-Xmx1g"
	if original.RuntimePlan.JVMOptions[0] == "-Xmx1g" {
		t.Error("RuntimePlan.JVMOptions mutation affected original")
	}

	// Verify time pointers deep copied
	if copied.StartedAt == original.StartedAt {
		t.Error("StartedAt pointer was not deep copied")
	}
	newStart := now.Add(-2 * time.Hour)
	copied.StartedAt = &newStart
	if original.StartedAt.Equal(newStart) {
		t.Error("StartedAt mutation affected original")
	}

	// Verify nil StartedAt/StoppedAt
	original2 := ServerRecord{
		ID:              "srv_test2",
		ProcessIdentity: nil,
		StartedAt:       nil,
		StoppedAt:       nil,
	}
	copied2 := original2.DeepCopy()
	if copied2.ProcessIdentity != nil {
		t.Error("nil ProcessIdentity should remain nil")
	}
	if copied2.StartedAt != nil {
		t.Error("nil StartedAt should remain nil")
	}
	if copied2.StoppedAt != nil {
		t.Error("nil StoppedAt should remain nil")
	}
}

func TestProcessIdentityEqual(t *testing.T) {
	now := time.Now()
	later := now.Add(1 * time.Second)

	base := ProcessIdentity{
		PID:          1234,
		Executable:   "/usr/bin/java",
		StartTime:    now,
		CatalinaBase: "/tmp/catalina",
		MarkerToken:  "token-abc",
	}

	tests := []struct {
		name  string
		a     ProcessIdentity
		b     ProcessIdentity
		equal bool
	}{
		{"identical", base, base, true},
		{"different PID", base, ProcessIdentity{PID: 5678, Executable: base.Executable, StartTime: base.StartTime, CatalinaBase: base.CatalinaBase, MarkerToken: base.MarkerToken}, false},
		{"different executable", base, ProcessIdentity{PID: base.PID, Executable: "/other/java", StartTime: base.StartTime, CatalinaBase: base.CatalinaBase, MarkerToken: base.MarkerToken}, false},
		{"different start time", base, ProcessIdentity{PID: base.PID, Executable: base.Executable, StartTime: later, CatalinaBase: base.CatalinaBase, MarkerToken: base.MarkerToken}, false},
		{"different catalina base", base, ProcessIdentity{PID: base.PID, Executable: base.Executable, StartTime: base.StartTime, CatalinaBase: "/other/base", MarkerToken: base.MarkerToken}, false},
		{"different marker", base, ProcessIdentity{PID: base.PID, Executable: base.Executable, StartTime: base.StartTime, CatalinaBase: base.CatalinaBase, MarkerToken: "other-token"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.a.Equal(tt.b)
			if got != tt.equal {
				t.Errorf("ProcessIdentity.Equal() = %v, want %v", got, tt.equal)
			}
		})
	}
}

func TestDesiredServerStateConstants(t *testing.T) {
	if DesiredServerStateRunning != "running" {
		t.Errorf("DesiredServerStateRunning = %q, want %q", DesiredServerStateRunning, "running")
	}
	if DesiredServerStateStopped != "stopped" {
		t.Errorf("DesiredServerStateStopped = %q, want %q", DesiredServerStateStopped, "stopped")
	}
}

func TestServerEventTypes(t *testing.T) {
	expectedEvents := map[ServerEventType]string{
		ServerEventStateChanged: "state-changed",
		ServerEventStarted:      "started",
		ServerEventStopped:      "stopped",
		ServerEventFailed:       "failed",
		ServerEventCrashed:      "crashed",
		ServerEventRestarting:   "restarting",
		ServerEventLog:          "log",
		ServerEventReconciled:   "reconciled",
	}

	for eventType, expectedValue := range expectedEvents {
		if string(eventType) != expectedValue {
			t.Errorf("ServerEventType %v = %q, want %q", eventType, string(eventType), expectedValue)
		}
	}
}

func TestLogStreamConstants(t *testing.T) {
	if LogStreamStdout != 0 {
		t.Errorf("LogStreamStdout = %d, want 0", LogStreamStdout)
	}
	if LogStreamStderr != 1 {
		t.Errorf("LogStreamStderr = %d, want 1", LogStreamStderr)
	}
}
