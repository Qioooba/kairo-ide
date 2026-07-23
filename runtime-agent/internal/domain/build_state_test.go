package domain

import (
	"testing"
	"time"
)

func TestBuildStateCanTransitionTo(t *testing.T) {
	tests := []struct {
		name   string
		from   BuildState
		to     BuildState
		expect bool
	}{
		{"queued→running", BuildStateQueued, BuildStateRunning, true},
		{"queued→cancelled", BuildStateQueued, BuildStateCancelled, true},
		{"queued→succeeded", BuildStateQueued, BuildStateSucceeded, false},
		{"queued→failed", BuildStateQueued, BuildStateFailed, false},
		{"running→succeeded", BuildStateRunning, BuildStateSucceeded, true},
		{"running→failed", BuildStateRunning, BuildStateFailed, true},
		{"running→cancelled", BuildStateRunning, BuildStateCancelled, true},
		{"running→queued", BuildStateRunning, BuildStateQueued, false},
		{"succeeded→anything", BuildStateSucceeded, BuildStateRunning, false},
		{"failed→anything", BuildStateFailed, BuildStateRunning, false},
		{"cancelled→anything", BuildStateCancelled, BuildStateRunning, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.from.CanTransitionTo(tt.to)
			if got != tt.expect {
				t.Errorf("BuildState(%q).CanTransitionTo(%q) = %v, want %v", tt.from, tt.to, got, tt.expect)
			}
		})
	}
}

func TestBuildRunIsTerminal(t *testing.T) {
	terminalStates := map[BuildState]bool{
		BuildStateSucceeded: true,
		BuildStateFailed:    true,
		BuildStateCancelled: true,
		BuildStateQueued:    false,
		BuildStateRunning:   false,
	}

	for state, wantTerminal := range terminalStates {
		run := BuildRun{State: state}
		got := run.IsTerminal()
		if got != wantTerminal {
			t.Errorf("BuildRun{State:%q}.IsTerminal() = %v, want %v", state, got, wantTerminal)
		}
	}
}

func TestBuildRunDeepCopy(t *testing.T) {
	now := time.Now()
	started := now.Add(-30 * time.Minute)
	finished := now.Add(-25 * time.Minute)
	exitCode := 0

	original := BuildRun{
		ID:          "build_001",
		WorkspaceID: "ws_001",
		ProjectID:   "prj_001",
		State:       BuildStateSucceeded,
		QueuedAt:    now.Add(-35 * time.Minute),
		StartedAt:   &started,
		FinishedAt:  &finished,
		ExitCode:    &exitCode,
		LogPath:     "/tmp/build.log",
		Summary:     "Build successful",
		Diagnostics: []BuildDiagnostic{
			{File: "Test.java", Line: 10, Column: 5, Severity: "warning", Message: "unused import"},
		},
	}

	copied := original.DeepCopy()

	// Verify basic fields
	if copied.ID != original.ID {
		t.Error("ID mismatch")
	}
	if copied.State != original.State {
		t.Error("State mismatch")
	}

	// Verify time pointers are deep copied
	if copied.StartedAt == original.StartedAt {
		t.Error("StartedAt pointer was not deep copied")
	}
	newStart := now.Add(-1 * time.Hour)
	copied.StartedAt = &newStart
	if original.StartedAt.Equal(newStart) {
		t.Error("StartedAt mutation affected original")
	}

	// Verify ExitCode pointer deep copied
	if copied.ExitCode == original.ExitCode {
		t.Error("ExitCode pointer was not deep copied")
	}
	newCode := 1
	copied.ExitCode = &newCode
	if *original.ExitCode == 1 {
		t.Error("ExitCode mutation affected original")
	}

	// Verify Diagnostics slice deep copied
	copied.Diagnostics[0].Message = "modified"
	if original.Diagnostics[0].Message == "modified" {
		t.Error("Diagnostics slice was not deep copied")
	}

	// Test nil fields
	nilRun := BuildRun{
		ID:          "build_nil",
		StartedAt:   nil,
		FinishedAt:  nil,
		ExitCode:    nil,
		Diagnostics: nil,
	}
	nilCopy := nilRun.DeepCopy()
	if nilCopy.StartedAt != nil {
		t.Error("nil StartedAt should remain nil")
	}
	if nilCopy.FinishedAt != nil {
		t.Error("nil FinishedAt should remain nil")
	}
	if nilCopy.ExitCode != nil {
		t.Error("nil ExitCode should remain nil")
	}
	if nilCopy.Diagnostics != nil {
		t.Error("nil Diagnostics should remain nil")
	}
}

func TestPortLease(t *testing.T) {
	t.Run("new port lease", func(t *testing.T) {
		var released bool
		lease := NewPortLease(8080, 8005, 8000, func() {
			released = true
		})
		if lease.HTTPPort != 8080 {
			t.Errorf("HTTPPort = %d, want 8080", lease.HTTPPort)
		}
		if lease.ShutdownPort != 8005 {
			t.Errorf("ShutdownPort = %d, want 8005", lease.ShutdownPort)
		}
		if lease.DebugPort != 8000 {
			t.Errorf("DebugPort = %d, want 8000", lease.DebugPort)
		}
		if released {
			t.Error("release should not be called yet")
		}
	})

	t.Run("release", func(t *testing.T) {
		var released bool
		lease := NewPortLease(8080, 8005, 8000, func() {
			released = true
		})
		lease.Release()
		if !released {
			t.Error("release should have been called")
		}
		if lease.HTTPPort != 0 {
			t.Errorf("HTTPPort = %d after release, want 0", lease.HTTPPort)
		}
		if lease.ShutdownPort != 0 {
			t.Errorf("ShutdownPort = %d after release, want 0", lease.ShutdownPort)
		}
		if lease.DebugPort != 0 {
			t.Errorf("DebugPort = %d after release, want 0", lease.DebugPort)
		}
	})

	t.Run("double release is safe", func(t *testing.T) {
		callCount := 0
		lease := NewPortLease(8080, 8005, 8000, func() {
			callCount++
		})
		lease.Release()
		lease.Release() // should not panic
		if callCount != 1 {
			t.Errorf("release called %d times, want 1", callCount)
		}
	})

	t.Run("nil lease release is safe", func(t *testing.T) {
		var lease *PortLease
		lease.Release() // should not panic
	})
}

func TestBuildEventTypeConstants(t *testing.T) {
	expected := map[BuildEventType]string{
		BuildEventQueued:            "queued",
		BuildEventStarted:           "started",
		BuildEventProgress:          "progress",
		BuildEventSucceeded:         "succeeded",
		BuildEventFailed:            "failed",
		BuildEventCancelled:         "cancelled",
		BuildEventPersistenceFailed: "persistence-failed",
	}
	for eventType, expectedValue := range expected {
		if string(eventType) != expectedValue {
			t.Errorf("BuildEventType %v = %q, want %q", eventType, string(eventType), expectedValue)
		}
	}
}

func TestBuildIntentConstants(t *testing.T) {
	if BuildIntentFull != "full" {
		t.Errorf("BuildIntentFull = %q, want %q", BuildIntentFull, "full")
	}
	if BuildIntentSelectedFiles != "selected-files" {
		t.Errorf("BuildIntentSelectedFiles = %q, want %q", BuildIntentSelectedFiles, "selected-files")
	}
}

func TestUTCNow(t *testing.T) {
	utc := UTCNow()
	now := time.Now().UTC()
	diff := now.Sub(utc)
	if diff < 0 {
		diff = -diff
	}
	if diff > time.Second {
		t.Errorf("UTCNow() differs from time.Now().UTC() by %v", diff)
	}
}