package log

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestLogger_EmitsValidJSON(t *testing.T) {
	var buf bytes.Buffer
	l := New("test")
	l.w = &buf
	l.Info("hello", Fields{"foo": "bar", "n": 42})

	var got map[string]any
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("not valid JSON: %v\n%s", err, buf.String())
	}
	if got["component"] != "test" {
		t.Errorf("component = %v, want test", got["component"])
	}
	if got["level"] != "info" {
		t.Errorf("level = %v, want info", got["level"])
	}
	if got["msg"] != "hello" {
		t.Errorf("msg = %v, want hello", got["msg"])
	}
	if got["foo"] != "bar" {
		t.Errorf("foo = %v, want bar", got["foo"])
	}
	if got["n"] != float64(42) {
		t.Errorf("n = %v, want 42", got["n"])
	}
}

func TestLogger_LevelFilter(t *testing.T) {
	var buf bytes.Buffer
	l := New("test").WithLevel(LevelWarn)
	l.w = &buf
	l.Debug("d"); l.Info("i"); l.Warn("w"); l.Error("e")

	if bytes.Count(buf.Bytes(), []byte{'\n'}) != 2 {
		t.Errorf("expected 2 lines, got %d:\n%s", bytes.Count(buf.Bytes(), []byte{'\n'}), buf.String())
	}
}

func TestRedactor(t *testing.T) {
	r := NewRedactor("hunter2", "tok_abc")
	got := r.Apply("password=hunter2 token=tok_abc end")
	want := "password=[REDACTED] token=[REDACTED] end"
	if got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestRingBuffer(t *testing.T) {
	r := NewRingBuffer(3)
	r.Append("a")
	r.Append("b")
	r.Append("c")
	r.Append("d")
	got := r.Snapshot()
	want := []string{"b", "c", "d"}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestContext_AttachesToLog(t *testing.T) {
	var buf bytes.Buffer
	l := New("test")
	l.w = &buf
	ctx := WithRequestContext(context.Background(), "req_1", "corr_1", "ws_1", "p_1")

	rid, cid, wid, pid := FromContext(ctx)
	if rid != "req_1" || cid != "corr_1" || wid != "ws_1" || pid != "p_1" {
		t.Fatalf("ctx = (%q,%q,%q,%q)", rid, cid, wid, pid)
	}

	l.Info("hello", Fields{
		"requestId":     rid,
		"correlationId": cid,
		"workspaceId":   wid,
		"projectId":     pid,
	})
	if !strings.Contains(buf.String(), `"requestId":"req_1"`) {
		t.Errorf("missing requestId in log line: %s", buf.String())
	}
	if !strings.Contains(buf.String(), `"correlationId":"corr_1"`) {
		t.Errorf("missing correlationId in log line: %s", buf.String())
	}
	if !strings.Contains(buf.String(), `"workspaceId":"ws_1"`) {
		t.Errorf("missing workspaceId in log line: %s", buf.String())
	}
	if !strings.Contains(buf.String(), `"projectId":"p_1"`) {
		t.Errorf("missing projectId in log line: %s", buf.String())
	}
}
