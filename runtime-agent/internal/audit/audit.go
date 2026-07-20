// Package audit appends structured events to an NDJSON file.
// The file is the system-of-record for "who did what, when".
// The server-mode agent exposes /api/v1/audit to read it.
package audit

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Event is a single audit event.
type Event struct {
	Ts            string         `json:"ts"`
	Level         string         `json:"level"`
	Component     string         `json:"component"`
	WorkspaceID   string         `json:"workspaceId,omitempty"`
	ProjectID     string         `json:"projectId,omitempty"`
	RequestID     string         `json:"requestId,omitempty"`
	CorrelationID string         `json:"correlationId,omitempty"`
	UserID        string         `json:"userId,omitempty"`
	Action        string         `json:"action"`
	Target        string         `json:"target,omitempty"`
	Result        string         `json:"result"` // ok | denied | error
	Fields        map[string]any `json:"fields,omitempty"`
}

// Log is an append-only audit log.
type Log struct {
	mu   sync.Mutex
	path string
	f    *os.File
}

// New opens (or creates) the audit log at path. The parent
// directory must exist.
func New(path string) (*Log, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &Log{path: path, f: f}, nil
}

// Append writes an event.
func (l *Log) Append(e Event) error {
	if l == nil {
		return errors.New("audit log is nil")
	}
	if e.Ts == "" {
		e.Ts = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if e.Level == "" {
		e.Level = "info"
	}
	if e.Result == "" {
		e.Result = "ok"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = l.f.Write(data)
	return err
}

// Close closes the file.
func (l *Log) Close() error {
	if l == nil || l.f == nil {
		return nil
	}
	return l.f.Close()
}

// Reader returns a reader that yields events as JSON objects.
type Reader struct {
	f *os.File
}

// OpenReader opens the log for reading.
func (l *Log) OpenReader() (*Reader, error) {
	f, err := os.Open(l.path)
	if err != nil {
		return nil, err
	}
	return &Reader{f: f}, nil
}

// Read reads up to n events. n <= 0 means "all".
// Always returns a non-nil slice so JSON encoding produces []
// instead of null when the log is empty.
func (r *Reader) Read(n int) ([]Event, error) {
	defer r.f.Close()
	dec := json.NewDecoder(r.f)
	out := []Event{}
	for dec.More() {
		var e Event
		if err := dec.Decode(&e); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return out, fmt.Errorf("decode: %w", err)
		}
		out = append(out, e)
		if n > 0 && len(out) >= n {
			break
		}
	}
	return out, nil
}
