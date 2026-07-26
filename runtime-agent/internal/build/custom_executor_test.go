package build

import (
	"context"
	"runtime"
	"testing"
	"time"
)

func TestShellSplit(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"ant war", []string{"ant", "war"}},
		{"mvn clean package -DskipTests", []string{"mvn", "clean", "package", "-DskipTests"}},
		{`echo "hello world"`, []string{"echo", "hello world"}},
		{"ls", []string{"ls"}},
		{"", nil},
		{"  ant   clean  ", []string{"ant", "clean"}},
	}
	for _, tc := range tests {
		result := shellSplit(tc.input)
		if len(result) != len(tc.expected) {
			t.Errorf("shellSplit(%q) = %v (len=%d), want %v (len=%d)", tc.input, result, len(result), len(tc.expected), len(tc.expected))
			continue
		}
		for i := range result {
			if result[i] != tc.expected[i] {
				t.Errorf("shellSplit(%q)[%d] = %q, want %q", tc.input, i, result[i], tc.expected[i])
			}
		}
	}
}

func TestNewCustomBuildExecutor(t *testing.T) {
	events := make([]BuildEvent, 0)
	handler := func(event BuildEvent) {
		events = append(events, event)
	}
	exe := NewCustomBuildExecutor(handler)
	if exe == nil {
		t.Fatal("expected non-nil executor")
	}
	if len(exe.RunningBuilds()) != 0 {
		t.Error("expected no running builds")
	}
}

func TestIsRunning(t *testing.T) {
	exe := NewCustomBuildExecutor(nil)
	if exe.IsRunning("nonexistent") {
		t.Error("expected no build to be running")
	}
}

func TestCancel_NotRunning(t *testing.T) {
	exe := NewCustomBuildExecutor(nil)
	err := exe.Cancel("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent build")
	}
}

func TestStart_EmptyCommand(t *testing.T) {
	exe := NewCustomBuildExecutor(func(event BuildEvent) {})
	err := exe.Start(context.Background(), CustomBuildConfig{
		BuildID:     "test-1",
		ProjectRoot: "/tmp",
		Command:     "",
	})
	if err == nil {
		t.Error("expected error for empty command")
	}
}

func TestStart_EchoCommand(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping on Windows")
	}
	events := make([]BuildEvent, 0)
	exe := NewCustomBuildExecutor(func(event BuildEvent) {
		events = append(events, event)
	})

	dir := t.TempDir()
	err := exe.Start(context.Background(), CustomBuildConfig{
		BuildID:     "echo-test",
		ProjectRoot: dir,
		Command:     "echo hello",
		WorkingDir:  dir,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Wait for completion
	time.Sleep(500 * time.Millisecond)

	if len(events) == 0 {
		t.Error("expected events")
	}
	// Check that we got a start event
	foundStart := false
	foundFinish := false
	for _, ev := range events {
		if ev.Type == "start" {
			foundStart = true
		}
		if ev.Type == "finish" {
			foundFinish = true
		}
	}
	if !foundStart {
		t.Error("expected start event")
	}
	if !foundFinish {
		t.Error("expected finish event")
	}
}