package log

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
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
	l.Debug("d")
	l.Info("i")
	l.Warn("w")
	l.Error("e")

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

// =============================================================================
// Level tests
// =============================================================================

func TestLevel_String(t *testing.T) {
	tests := []struct {
		level Level
		want  string
	}{
		{LevelDebug, "debug"},
		{LevelInfo, "info"},
		{LevelWarn, "warn"},
		{LevelError, "error"},
		{Level(999), "info"}, // default case
	}
	for _, tt := range tests {
		if got := tt.level.String(); got != tt.want {
			t.Errorf("Level(%d).String() = %q, want %q", tt.level, got, tt.want)
		}
	}
}

func TestParseLevel(t *testing.T) {
	tests := []struct {
		input string
		want  Level
	}{
		{"debug", LevelDebug},
		{"DEBUG", LevelDebug},
		{"info", LevelInfo},
		{"warn", LevelWarn},
		{"warning", LevelWarn},
		{"WARNING", LevelWarn},
		{"error", LevelError},
		{"unknown", LevelInfo},
		{"", LevelInfo},
	}
	for _, tt := range tests {
		if got := ParseLevel(tt.input); got != tt.want {
			t.Errorf("ParseLevel(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

// =============================================================================
// Logger modifiers
// =============================================================================

func TestLogger_WithComponent(t *testing.T) {
	l := New("test").WithComponent("api")
	if l.component != "api" {
		t.Errorf("component = %q, want api", l.component)
	}
}

func TestLogger_WithLevel(t *testing.T) {
	l := New("test").WithLevel(LevelDebug)
	if l.level != LevelDebug {
		t.Errorf("level = %d, want %d", l.level, LevelDebug)
	}
}

func TestLogger_WithRedactor(t *testing.T) {
	var buf bytes.Buffer
	r := NewRedactor("secret")
	l := New("test").WithRedactor(r)
	l.w = &buf
	l.Info("hello", Fields{"password": "mysecret123"})
	if !strings.Contains(buf.String(), "[REDACTED]") {
		t.Errorf("expected redacted output, got %s", buf.String())
	}
}

func TestLogger_WithCaptured(t *testing.T) {
	ring := NewRingBuffer(10)
	var buf bytes.Buffer
	l := New("test").WithCaptured(ring)
	l.w = &buf
	l.Info("hello")
	if ring.Len() != 1 {
		t.Errorf("ring len = %d, want 1", ring.Len())
	}
}

// =============================================================================
// Debug method
// =============================================================================

func TestLogger_Debug(t *testing.T) {
	var buf bytes.Buffer
	l := New("test").WithLevel(LevelDebug)
	l.w = &buf
	l.Debug("debug msg")
	if !strings.Contains(buf.String(), `"level":"debug"`) {
		t.Errorf("expected debug level, got %s", buf.String())
	}
}

// =============================================================================
// mergeFields
// =============================================================================

func TestMergeFields_Multiple(t *testing.T) {
	got := mergeFields([]Fields{
		{"a": 1, "b": 2},
		{"c": 3},
	})
	if len(got) != 3 {
		t.Errorf("len = %d, want 3", len(got))
	}
	if got["a"] != 1 || got["b"] != 2 || got["c"] != 3 {
		t.Errorf("got %v", got)
	}
}

func TestMergeFields_Empty(t *testing.T) {
	got := mergeFields(nil)
	if got != nil {
		t.Errorf("expected nil, got %v", got)
	}
	got = mergeFields([]Fields{})
	if got != nil {
		t.Errorf("expected nil, got %v", got)
	}
}

func TestMergeFields_Overriding(t *testing.T) {
	got := mergeFields([]Fields{
		{"a": 1},
		{"a": 2},
	})
	if got["a"] != 2 {
		t.Errorf("expected override to 2, got %v", got["a"])
	}
}

// =============================================================================
// Redactor edge cases
// =============================================================================

func TestRedactor_Nil(t *testing.T) {
	var r *Redactor
	got := r.Apply("hello")
	if got != "hello" {
		t.Errorf("expected 'hello' for nil redactor, got %q", got)
	}
}

func TestRedactor_EmptyPattern(t *testing.T) {
	r := NewRedactor("", "abc")
	got := r.Apply("abc")
	if got != "[REDACTED]" {
		t.Errorf("expected '[REDACTED]', got %q", got)
	}
}

func TestNewRedactor_Empty(t *testing.T) {
	r := NewRedactor()
	if r == nil {
		t.Fatal("expected non-nil redactor")
	}
	got := r.Apply("hello")
	if got != "hello" {
		t.Errorf("expected 'hello', got %q", got)
	}
}

// =============================================================================
// JSON value type coverage
// =============================================================================

type testStringer struct{}

func (t testStringer) String() string { return "stringer-val" }

type myStringer struct{}

func (myStringer) String() string { return "secret-value" }

type unknownType struct{ X int }

func TestLogger_JSONValueTypes(t *testing.T) {
	var buf bytes.Buffer
	l := New("test")
	l.w = &buf

	l.Info("types", Fields{
		"boolTrue":  true,
		"boolFalse": false,
		"int64":     int64(42),
		"float64":   float64(3.14),
		"nilVal":    nil,
		"errorVal":  fmt.Errorf("test error"),
		"stringer":  testStringer{},
	})

	var got map[string]any
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("not valid JSON: %v\n%s", err, buf.String())
	}
	if got["boolTrue"] != true {
		t.Errorf("boolTrue = %v", got["boolTrue"])
	}
	if got["boolFalse"] != false {
		t.Errorf("boolFalse = %v", got["boolFalse"])
	}
	if got["int64"] != float64(42) {
		t.Errorf("int64 = %v", got["int64"])
	}
	if got["float64"] != float64(3.14) {
		t.Errorf("float64 = %v", got["float64"])
	}
	if got["nilVal"] != nil {
		t.Errorf("nilVal = %v", got["nilVal"])
	}
	if got["errorVal"] != "test error" {
		t.Errorf("errorVal = %v", got["errorVal"])
	}
	if got["stringer"] != "stringer-val" {
		t.Errorf("stringer = %v", got["stringer"])
	}
}

// =============================================================================
// JSON string escaping
// =============================================================================

func TestLogger_JSONStringEscaping(t *testing.T) {
	var buf bytes.Buffer
	l := New("test")
	l.w = &buf
	l.Info("msg", Fields{
		"special": "tab\there\nnewline\rreturn\"quote\\backslash",
	})
	line := buf.String()
	if !strings.Contains(line, `\t`) {
		t.Errorf("tab not escaped: %s", line)
	}
	if !strings.Contains(line, `\n`) {
		t.Errorf("newline not escaped: %s", line)
	}
	if !strings.Contains(line, `\r`) {
		t.Errorf("return not escaped: %s", line)
	}
	if !strings.Contains(line, `\"`) {
		t.Errorf("quote not escaped: %s", line)
	}
	if !strings.Contains(line, `\\`) {
		t.Errorf("backslash not escaped: %s", line)
	}
}

func TestLogger_ControlCharacters(t *testing.T) {
	var buf bytes.Buffer
	l := New("test")
	l.w = &buf
	// U+0001 is a control character
	l.Info("msg", Fields{"ctrl": "\x01\x02\x1f"})
	line := buf.String()
	if !strings.Contains(line, `\u0001`) {
		t.Errorf("control char not escaped as unicode: %s", line)
	}
}

// =============================================================================
// Default value type (unknown type)
// =============================================================================

func TestLogger_DefaultValueType(t *testing.T) {
	var buf bytes.Buffer
	l := New("test")
	l.w = &buf
	l.Info("msg", Fields{"custom": unknownType{X: 42}})
	line := buf.String()
	if !strings.Contains(line, `"custom":`) {
		t.Errorf("custom type not serialized: %s", line)
	}
}

// =============================================================================
// Redactor in JSON values
// =============================================================================

func TestLogger_RedactorInError(t *testing.T) {
	var buf bytes.Buffer
	r := NewRedactor("secret")
	l := New("test").WithRedactor(r)
	l.w = &buf
	l.Info("msg", Fields{"err": fmt.Errorf("secret leaked")})
	line := buf.String()
	if strings.Contains(line, "secret") {
		t.Errorf("secret not redacted in error value: %s", line)
	}
}

func TestLogger_RedactorInStringer(t *testing.T) {
	var buf bytes.Buffer
	r := NewRedactor("secret")
	l := New("test").WithRedactor(r)
	l.w = &buf
	l.Info("msg", Fields{"s": myStringer{}})
	line := buf.String()
	if strings.Contains(line, "secret") {
		t.Errorf("secret not redacted in stringer: %s", line)
	}
}

// =============================================================================
// FromContext with empty context
// =============================================================================

func TestFromContext_Empty(t *testing.T) {
	rid, cid, wid, pid := FromContext(context.Background())
	if rid != "" || cid != "" || wid != "" || pid != "" {
		t.Errorf("expected all empty, got (%q,%q,%q,%q)", rid, cid, wid, pid)
	}
}

// =============================================================================
// WithRequestContext partial
// =============================================================================

func TestWithRequestContext_Partial(t *testing.T) {
	ctx := WithRequestContext(context.Background(), "", "", "ws1", "")
	rid, _, wid, _ := FromContext(ctx)
	if rid != "" || wid != "ws1" {
		t.Errorf("expected empty requestId and ws1 workspaceId, got (%q,%q)", rid, wid)
	}
}

// =============================================================================
// Log function with redactor
// =============================================================================

func TestLogger_LogWithRedactor(t *testing.T) {
	var buf bytes.Buffer
	r := NewRedactor("password123")
	l := New("test").WithRedactor(r)
	l.w = &buf
	l.Info("login", Fields{"user": "admin", "password": "password123"})
	line := buf.String()
	if strings.Contains(line, "password123") {
		t.Errorf("password not redacted: %s", line)
	}
}

// =============================================================================
// RingBuffer: zero-value and edge cases
// =============================================================================

func TestRingBuffer_ZeroValue(t *testing.T) {
	var r RingBuffer
	r.Append("a")
	r.Append("b")
	if r.Len() != 2 {
		t.Errorf("Len = %d, want 2", r.Len())
	}
	snap := r.Snapshot()
	if len(snap) != 2 || snap[0] != "a" || snap[1] != "b" {
		t.Errorf("Snapshot = %v", snap)
	}
}

func TestRingBuffer_NewWithZeroCap(t *testing.T) {
	r := NewRingBuffer(0)
	if r.cap != 1000 {
		t.Errorf("cap = %d, want 1000", r.cap)
	}
}

func TestRingBuffer_NewWithNegativeCap(t *testing.T) {
	r := NewRingBuffer(-5)
	if r.cap != 1000 {
		t.Errorf("cap = %d, want 1000", r.cap)
	}
}

func TestRingBuffer_FullSnapshot(t *testing.T) {
	r := NewRingBuffer(3)
	r.Append("a")
	r.Append("b")
	r.Append("c")
	r.Append("d") // wraps
	snap := r.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("len = %d, want 3", len(snap))
	}
	if snap[0] != "b" || snap[1] != "c" || snap[2] != "d" {
		t.Errorf("Snapshot = %v, want [b c d]", snap)
	}
}

func TestRingBuffer_LenNotFull(t *testing.T) {
	r := NewRingBuffer(10)
	r.Append("a")
	r.Append("b")
	if r.Len() != 2 {
		t.Errorf("Len = %d, want 2", r.Len())
	}
}

func TestRingBuffer_LenFull(t *testing.T) {
	r := NewRingBuffer(3)
	r.Append("a")
	r.Append("b")
	r.Append("c")
	if r.Len() != 3 {
		t.Errorf("Len = %d, want 3", r.Len())
	}
}

func TestRingBuffer_Concurrent(t *testing.T) {
	r := NewRingBuffer(100)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				r.Append("line")
			}
		}()
	}
	wg.Wait()
	if r.Len() > 100 {
		t.Errorf("Len = %d, want <= 100", r.Len())
	}
}

// =============================================================================
// Logger concurrent writes
// =============================================================================

func TestLogger_ConcurrentWrites(t *testing.T) {
	var buf bytes.Buffer
	l := New("test")
	l.w = &buf
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			l.Info("msg", Fields{"i": i})
		}(i)
	}
	wg.Wait()
	lines := 0
	for _, b := range buf.Bytes() {
		if b == '\n' {
			lines++
		}
	}
	if lines != 50 {
		t.Errorf("expected 50 lines, got %d", lines)
	}
}
