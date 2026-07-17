package proc

import (
	"context"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestProcess_RunsAndExits(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/echo")
	}
	p := New(Spec{
		Name: "/bin/echo",
		Args: []string{"hello", "world"},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := p.Start(ctx); err != nil {
		t.Fatal(err)
	}
	p.Wait()
	if p.State() != StateStopped {
		t.Errorf("state = %s, want %s", p.State(), StateStopped)
	}
	out := p.StdoutSnapshot()
	if len(out) == 0 || !strings.Contains(out[0], "hello world") {
		t.Errorf("stdout = %v", out)
	}
}

func TestProcess_StopSendsTerm(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sh")
	}
	// A long-running sleep. We then call Stop and expect it to
	// exit cleanly within the timeout.
	p := New(Spec{
		Name: "/bin/sh",
		Args: []string{"-c", "sleep 30"},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := p.Start(ctx); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond) // let it actually start
	if err := p.Stop(2 * time.Second); err != nil {
		t.Errorf("Stop: %v", err)
	}
	if p.State() != StateStopped {
		t.Errorf("state after stop = %s, want %s", p.State(), StateStopped)
	}
}
