package audit

import (
	"path/filepath"
	"testing"
)

func TestAudit_AppendAndRead(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "audit.log")
	l, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	evs := []Event{
		{Action: "file.write", Target: "a.txt", Result: "ok"},
		{Action: "file.read", Target: "a.txt", Result: "ok"},
		{Action: "login.failed", Result: "denied", Fields: map[string]any{"ip": "127.0.0.1"}},
	}
	for _, e := range evs {
		if err := l.Append(e); err != nil {
			t.Fatal(err)
		}
	}
	r, err := l.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Errorf("got %d events, want 3", len(got))
	}
	if got[0].Action != "file.write" || got[0].Result != "ok" {
		t.Errorf("event 0 = %+v", got[0])
	}
	if got[2].Result != "denied" {
		t.Errorf("event 2 = %+v", got[2])
	}
	if got[2].Fields["ip"] != "127.0.0.1" {
		t.Errorf("event 2 fields = %+v", got[2].Fields)
	}
}
