package build

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

// eventCollector gathers BuildEvents in a thread-safe way.
type eventCollector struct {
	mu     sync.Mutex
	events []BuildEvent
}

func (c *eventCollector) add(event BuildEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, event)
}

func (c *eventCollector) types() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.events))
	for _, e := range c.events {
		out = append(out, e.Type)
	}
	return out
}

func (c *eventCollector) hasType(typ string) bool {
	for _, t := range c.types() {
		if t == typ {
			return true
		}
	}
	return false
}

// waitFor waits until the collector has seen all of the given event types.
func (c *eventCollector) waitFor(types ...string) bool {
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		seen := c.types()
		ok := true
		for _, want := range types {
			found := false
			for _, s := range seen {
				if s == want {
					found = true
					break
				}
			}
			if !found {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func TestStart_EchoCommand_Windows(t *testing.T) {
	collector := &eventCollector{}
	exe := NewCustomBuildExecutor(collector.add)

	dir := t.TempDir()
	err := exe.Start(context.Background(), CustomBuildConfig{
		BuildID:     "echo-windows",
		ProjectRoot: dir,
		Command:     "cmd /c echo hello-from-kairo",
		WorkingDir:  dir,
	})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	if !collector.waitFor("start", "finish") {
		t.Fatalf("expected start and finish events, got %v", collector.types())
	}
	if !exe.IsRunning("echo-windows") {
		// The process may have exited already; that is fine.
		_ = exe.IsRunning("echo-windows")
	}
}

func TestStart_DuplicateBuildID(t *testing.T) {
	collector := &eventCollector{}
	exe := NewCustomBuildExecutor(collector.add)

	dir := t.TempDir()
	// A long-running command so the build stays in the running map.
	err := exe.Start(context.Background(), CustomBuildConfig{
		BuildID:     "dup-1",
		ProjectRoot: dir,
		Command:     "ping -n 30 127.0.0.1",
		WorkingDir:  dir,
	})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = exe.Cancel("dup-1")
	}()

	err = exe.Start(context.Background(), CustomBuildConfig{
		BuildID:     "dup-1",
		ProjectRoot: dir,
		Command:     "cmd /c echo second",
		WorkingDir:  dir,
	})
	if err == nil || !strings.Contains(err.Error(), "already running") {
		t.Errorf("expected already-running error, got: %v", err)
	}
}

func TestCancel_RunningBuild(t *testing.T) {
	collector := &eventCollector{}
	exe := NewCustomBuildExecutor(collector.add)

	dir := t.TempDir()
	err := exe.Start(context.Background(), CustomBuildConfig{
		BuildID:     "cancel-1",
		ProjectRoot: dir,
		Command:     "ping -n 30 127.0.0.1",
		WorkingDir:  dir,
	})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	if err := exe.Cancel("cancel-1"); err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}
	if !collector.hasType("cancel") {
		t.Errorf("expected cancel event, got %v", collector.types())
	}
}

func TestStart_CommandNotFound(t *testing.T) {
	collector := &eventCollector{}
	exe := NewCustomBuildExecutor(collector.add)

	dir := t.TempDir()
	err := exe.Start(context.Background(), CustomBuildConfig{
		BuildID:     "nope-1",
		ProjectRoot: dir,
		Command:     "definitely-not-a-real-command-xyz",
		WorkingDir:  dir,
	})
	if err == nil {
		t.Fatal("expected error for unknown command")
	}
	if !collector.hasType("error") {
		t.Errorf("expected error event, got %v", collector.types())
	}
}

func TestStreamLogs_EmitsLogEvents(t *testing.T) {
	collector := &eventCollector{}
	exe := NewCustomBuildExecutor(collector.add)

	exe.streamLogs("build-x", strings.NewReader("line one\nline two\n"), "stdout")

	types := collector.types()
	if len(types) != 2 {
		t.Fatalf("expected 2 log events, got %v", types)
	}
	for _, typ := range types {
		if typ != "log" {
			t.Errorf("expected log event, got %s", typ)
		}
	}
	collector.mu.Lock()
	lines := []string{collector.events[0].Line, collector.events[1].Line}
	collector.mu.Unlock()
	if lines[0] != "line one" || lines[1] != "line two" {
		t.Errorf("lines = %v", lines)
	}
}
