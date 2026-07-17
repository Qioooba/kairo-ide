// Package log provides a structured JSON logger that is
// 12-factor friendly. Every log line carries ts, level, component,
// msg, and an optional workspaceId / projectId / requestId /
// correlationId. Sensitive fields (passwords, tokens, full DB
// connection strings) are stripped by SetRedactor.
package log

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

// Level is a log level.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

// String returns the lower-case name.
func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return "info"
	}
}

// ParseLevel parses a level name (case-insensitive).
func ParseLevel(s string) Level {
	switch strings.ToLower(s) {
	case "debug":
		return LevelDebug
	case "info":
		return LevelInfo
	case "warn", "warning":
		return LevelWarn
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

// Logger is a structured JSON logger.
type Logger struct {
	mu        sync.Mutex
	w         io.Writer
	level     Level
	redactor  *Redactor
	component string
	// capturedSink, if non-nil, also receives a copy of every line
	// in JSON form. Used by the diagnostic center.
	capturedSink *RingBuffer
}

// Redactor replaces known secrets in field values before writing.
type Redactor struct {
	patterns []string
}

// NewRedactor returns a Redactor that strips the given substrings.
func NewRedactor(patterns ...string) *Redactor {
	return &Redactor{patterns: append([]string{}, patterns...)}
}

// Apply returns v with redacted substrings replaced by "[REDACTED]".
func (r *Redactor) Apply(v string) string {
	if r == nil {
		return v
	}
	for _, p := range r.patterns {
		if p == "" {
			continue
		}
		v = strings.ReplaceAll(v, p, "[REDACTED]")
	}
	return v
}

// New creates a logger that writes to stderr. component is the
// short name that appears in every line ("api", "tomcat", ...).
func New(component string) *Logger {
	return &Logger{w: os.Stderr, level: LevelInfo, component: component, redactor: NewRedactor()}
}

// WithComponent returns a logger that tags every line with a
// different component name.
func (l *Logger) WithComponent(component string) *Logger {
	cp := *l
	cp.component = component
	return &cp
}

// WithLevel sets the minimum level.
func (l *Logger) WithLevel(level Level) *Logger {
	cp := *l
	cp.level = level
	return &cp
}

// WithRedactor sets a redactor on the logger.
func (l *Logger) WithRedactor(r *Redactor) *Logger {
	cp := *l
	cp.redactor = r
	return &cp
}

// WithCaptured attaches a ring buffer that will receive a copy
// of every line. The diagnostic center reads from this.
func (l *Logger) WithCaptured(buf *RingBuffer) *Logger {
	cp := *l
	cp.capturedSink = buf
	return &cp
}

// Fields is the structured-fields key/value type.
type Fields map[string]any

// FromContext extracts the request metadata from context.
func FromContext(ctx context.Context) (requestID, correlationID, workspaceID, projectID string) {
	if v, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		requestID = v
	}
	if v, ok := ctx.Value(ctxKeyCorrelationID).(string); ok {
		correlationID = v
	}
	if v, ok := ctx.Value(ctxKeyWorkspaceID).(string); ok {
		workspaceID = v
	}
	if v, ok := ctx.Value(ctxKeyProjectID).(string); ok {
		projectID = v
	}
	return
}

// WithRequestContext attaches request metadata to a context.
func WithRequestContext(ctx context.Context, requestID, correlationID, workspaceID, projectID string) context.Context {
	if requestID != "" {
		ctx = context.WithValue(ctx, ctxKeyRequestID, requestID)
	}
	if correlationID != "" {
		ctx = context.WithValue(ctx, ctxKeyCorrelationID, correlationID)
	}
	if workspaceID != "" {
		ctx = context.WithValue(ctx, ctxKeyWorkspaceID, workspaceID)
	}
	if projectID != "" {
		ctx = context.WithValue(ctx, ctxKeyProjectID, projectID)
	}
	return ctx
}

type ctxKey int

const (
	ctxKeyRequestID ctxKey = iota + 1
	ctxKeyCorrelationID
	ctxKeyWorkspaceID
	ctxKeyProjectID
)

func (l *Logger) log(level Level, msg string, fields Fields) {
	if level < l.level {
		return
	}
	now := time.Now().UTC()
	line := buildLine(now, level, l.component, msg, fields, l.redactor)

	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = io.WriteString(l.w, line)
	_, _ = io.WriteString(l.w, "\n")
	if l.capturedSink != nil {
		l.capturedSink.Append(line)
	}
}

func buildLine(ts time.Time, level Level, component, msg string, fields Fields, r *Redactor) string {
	var b strings.Builder
	b.WriteString(`{"ts":"`)
	b.WriteString(ts.Format(time.RFC3339Nano))
	b.WriteString(`","level":"`)
	b.WriteString(level.String())
	b.WriteString(`","component":"`)
	b.WriteString(component)
	b.WriteString(`","msg":`)
	writeJSONString(&b, msg)
	if len(fields) > 0 {
		for k, v := range fields {
			b.WriteString(`,"`)
			b.WriteString(k)
			b.WriteString(`":`)
			writeJSONValue(&b, v, r)
		}
	}
	b.WriteString(`}`)
	return b.String()
}

func writeJSONValue(b *strings.Builder, v any, r *Redactor) {
	switch x := v.(type) {
	case string:
		writeJSONString(b, r.Apply(x))
	case error:
		writeJSONString(b, r.Apply(x.Error()))
	case fmt.Stringer:
		writeJSONString(b, r.Apply(x.String()))
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case int:
		fmt.Fprintf(b, "%d", x)
	case int64:
		fmt.Fprintf(b, "%d", x)
	case float64:
		fmt.Fprintf(b, "%g", x)
	case nil:
		b.WriteString("null")
	default:
		writeJSONString(b, r.Apply(fmt.Sprintf("%v", v)))
	}
}

func writeJSONString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// Debug logs at debug level.
func (l *Logger) Debug(msg string, fields ...Fields) { l.log(LevelDebug, msg, mergeFields(fields)) }

// Info logs at info level.
func (l *Logger) Info(msg string, fields ...Fields) { l.log(LevelInfo, msg, mergeFields(fields)) }

// Warn logs at warn level.
func (l *Logger) Warn(msg string, fields ...Fields) { l.log(LevelWarn, msg, mergeFields(fields)) }

// Error logs at error level.
func (l *Logger) Error(msg string, fields ...Fields) { l.log(LevelError, msg, mergeFields(fields)) }

func mergeFields(fs []Fields) Fields {
	if len(fs) == 0 {
		return nil
	}
	out := Fields{}
	for _, f := range fs {
		for k, v := range f {
			out[k] = v
		}
	}
	return out
}
