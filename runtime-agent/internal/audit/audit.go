// Package audit appends structured events to an NDJSON file.
// The file is the system-of-record for "who did what, when".
// The server-mode agent exposes /api/v1/audit to read it.
//
// Enhanced features:
//   - Structured JSON and CEF log formats
//   - Audit event categories (CRUD, authentication, configuration)
//   - HMAC-based log signing for tamper detection
//   - Log rotation and archiving
//   - Compliance report generation
package audit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// EventCategory classifies the type of audit event.
type EventCategory string

const (
	CategoryCreate         EventCategory = "create"
	CategoryRead           EventCategory = "read"
	CategoryUpdate         EventCategory = "update"
	CategoryDelete         EventCategory = "delete"
	CategoryAuthentication EventCategory = "authentication"
	CategoryConfiguration  EventCategory = "configuration"
	CategoryDeployment     EventCategory = "deployment"
	CategoryBuild          EventCategory = "build"
	CategoryDebug          EventCategory = "debug"
	CategorySystem         EventCategory = "system"
	CategorySecurity       EventCategory = "security"
	CategoryNetwork        EventCategory = "network"
)

// Event is a single audit event.
type Event struct {
	Ts            string         `json:"ts"`
	Level         string         `json:"level"`
	Category      EventCategory  `json:"category,omitempty"`
	Component     string         `json:"component"`
	WorkspaceID   string         `json:"workspaceId,omitempty"`
	ProjectID     string         `json:"projectId,omitempty"`
	RequestID     string         `json:"requestId,omitempty"`
	CorrelationID string         `json:"correlationId,omitempty"`
	UserID        string         `json:"userId,omitempty"`
	SourceIP      string         `json:"sourceIp,omitempty"`
	Action        string         `json:"action"`
	Target        string         `json:"target,omitempty"`
	Result        string         `json:"result"` // ok | denied | error
	Signature     string         `json:"signature,omitempty"`
	Fields        map[string]any `json:"fields,omitempty"`
}

// Log is an append-only audit log with signing and rotation support.
type Log struct {
	mu         sync.Mutex
	path       string
	f          *os.File
	signingKey []byte          // HMAC-SHA256 key for log signing
	maxSize    int64           // Max file size in bytes before rotation (0 = no rotation)
	maxBackups int             // Max number of backup files (0 = keep all)
	currentSize int64          // Approximate current file size
}

// LogOption configures the audit log.
type LogOption func(*Log)

// WithSigningKey sets the HMAC key for audit log signing.
func WithSigningKey(key []byte) LogOption {
	return func(l *Log) {
		l.signingKey = make([]byte, len(key))
		copy(l.signingKey, key)
	}
}

// WithRotation configures log rotation.
func WithRotation(maxSize int64, maxBackups int) LogOption {
	return func(l *Log) {
		l.maxSize = maxSize
		l.maxBackups = maxBackups
	}
}

// New opens (or creates) the audit log at path. The parent
// directory must exist.
func New(path string, opts ...LogOption) (*Log, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	l := &Log{path: path}
	for _, opt := range opts {
		opt(l)
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	l.f = f

	// Get current file size for rotation tracking
	if info, err := f.Stat(); err == nil {
		l.currentSize = info.Size()
	}

	return l, nil
}

// Append writes an event. If signing is configured, the event is signed
// before writing. If rotation is configured, log rotation is performed
// when the max size is exceeded.
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

	// Check rotation before writing
	if l.maxSize > 0 && l.currentSize >= l.maxSize {
		if err := l.rotate(); err != nil {
			return fmt.Errorf("rotate: %w", err)
		}
	}

	// Sign the event if a signing key is configured
	if len(l.signingKey) > 0 {
		dataToSign := l.buildSignaturePayload(e)
		e.Signature = l.sign(dataToSign)
	}

	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	n, err := l.f.Write(data)
	if err != nil {
		return err
	}
	l.currentSize += int64(n)
	return nil
}

// buildSignaturePayload creates a deterministic payload for HMAC signing.
func (l *Log) buildSignaturePayload(e Event) string {
	// Build a deterministic string from key fields for signing
	parts := []string{
		e.Ts,
		string(e.Category),
		e.Component,
		e.UserID,
		e.Action,
		e.Target,
		e.Result,
	}
	return strings.Join(parts, "|")
}

// sign generates an HMAC-SHA256 signature for the given payload.
func (l *Log) sign(payload string) string {
	mac := hmac.New(sha256.New, l.signingKey)
	mac.Write([]byte(payload))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// VerifySignature checks if the event's signature matches the recomputed HMAC.
func (l *Log) VerifySignature(e Event) bool {
	if len(l.signingKey) == 0 {
		return true // no signing configured, always pass
	}
	if e.Signature == "" {
		return false
	}
	payload := l.buildSignaturePayload(e)
	expected := l.sign(payload)
	return hmac.Equal([]byte(e.Signature), []byte(expected))
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

// ---- Log Rotation ----

// rotate closes the current log file, renames it with a timestamp,
// and opens a new log file. Must be called with l.mu held.
func (l *Log) rotate() error {
	// Close current file
	if err := l.f.Close(); err != nil {
		return fmt.Errorf("close current log: %w", err)
	}

	// Rename current log with timestamp
	ts := time.Now().UTC().Format("20060102T150405")
	rotatedPath := l.path + "." + ts
	if err := os.Rename(l.path, rotatedPath); err != nil {
		// Try to reopen the original file
		f, reopenErr := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if reopenErr != nil {
			return fmt.Errorf("rename failed and reopen failed: %w / %w", err, reopenErr)
		}
		l.f = f
		l.currentSize = 0
		return fmt.Errorf("rename: %w (log continued without rotation)", err)
	}

	// Open new log file
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open new log: %w", err)
	}
	l.f = f
	l.currentSize = 0

	// Cleanup old backups if maxBackups is set
	if l.maxBackups > 0 {
		l.cleanupBackups()
	}

	return nil
}

// cleanupBackups removes old rotated log files exceeding maxBackups.
func (l *Log) cleanupBackups() {
	dir := filepath.Dir(l.path)
	base := filepath.Base(l.path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	var backups []string
	prefix := base + "."
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), prefix) {
			backups = append(backups, entry.Name())
		}
	}

	// Sort by name (which includes timestamp), oldest first
	sort.Strings(backups)

	// Remove oldest backups exceeding maxBackups
	for len(backups) > l.maxBackups {
		oldest := filepath.Join(dir, backups[0])
		os.Remove(oldest)
		backups = backups[1:]
	}
}

// ArchiveTo moves old rotated log files to an archive directory.
func (l *Log) ArchiveTo(archiveDir string) error {
	if err := os.MkdirAll(archiveDir, 0o755); err != nil {
		return err
	}

	dir := filepath.Dir(l.path)
	base := filepath.Base(l.path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	prefix := base + "."
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), prefix) {
			src := filepath.Join(dir, entry.Name())
			dst := filepath.Join(archiveDir, entry.Name())
			if err := os.Rename(src, dst); err != nil {
				return fmt.Errorf("archive %s: %w", entry.Name(), err)
			}
		}
	}
	return nil
}

// ---- CEF Format (Common Event Format) ----

// ToCEF converts an audit event to CEF (Common Event Format) string.
// CEF is used by SIEM systems (ArcSight, Splunk, etc.).
// Format: CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
func (e Event) ToCEF() string {
	version := "0"
	vendor := "Kairo"
	product := "KairoIDE"
	productVersion := "0.1.0"
	signatureID := e.Action
	name := e.Action
	severity := mapLevelToCEFSeverity(e.Level)

	ext := map[string]string{
		"cat":      string(e.Category),
		"src":      e.SourceIP,
		"suser":    e.UserID,
		"dproc":    e.Component,
		"request":  e.RequestID,
		"outcome":  e.Result,
		"cs1":      e.WorkspaceID,
		"cs1Label": "workspaceId",
		"cs2":      e.ProjectID,
		"cs2Label": "projectId",
		"cs3":      e.Target,
		"cs3Label": "target",
	}

	// Build extension string
	var extParts []string
	for k, v := range ext {
		if v != "" {
			extParts = append(extParts, k+"="+escapeCEFValue(v))
		}
	}
	extStr := strings.Join(extParts, " ")

	return fmt.Sprintf("CEF:%s|%s|%s|%s|%s|%s|%s|%s",
		version, vendor, product, productVersion,
		signatureID, name, severity, extStr)
}

func mapLevelToCEFSeverity(level string) string {
	switch level {
	case "error", "critical":
		return "9"
	case "warn":
		return "5"
	case "info":
		return "1"
	default:
		return "0"
	}
}

func escapeCEFValue(v string) string {
	v = strings.ReplaceAll(v, "\\", "\\\\")
	v = strings.ReplaceAll(v, "=", "\\=")
	return v
}

// WriteCEF writes the event in CEF format to the given writer.
func (e Event) WriteCEF(w io.Writer) error {
	_, err := fmt.Fprintln(w, e.ToCEF())
	return err
}

// ---- Compliance Report ----

// ComplianceReport summarizes audit events for compliance purposes.
type ComplianceReport struct {
	GeneratedAt  string                    `json:"generatedAt"`
	PeriodStart  string                    `json:"periodStart"`
	PeriodEnd    string                    `json:"periodEnd"`
	TotalEvents  int                       `json:"totalEvents"`
	ByCategory   map[EventCategory]int     `json:"byCategory"`
	ByResult     map[string]int            `json:"byResult"`
	ByLevel      map[string]int            `json:"byLevel"`
	ByComponent  map[string]int            `json:"byComponent"`
	DeniedEvents []EventSummary            `json:"deniedEvents"`
	ErrorEvents  []EventSummary            `json:"errorEvents"`
	Integrity    IntegrityCheckResult      `json:"integrity"`
}

// EventSummary is a condensed view of an audit event for reports.
type EventSummary struct {
	Ts        string        `json:"ts"`
	Category  EventCategory `json:"category"`
	Component string        `json:"component"`
	UserID    string        `json:"userId"`
	Action    string        `json:"action"`
	Target    string        `json:"target"`
	Result    string        `json:"result"`
}

// IntegrityCheckResult describes the result of signature verification.
type IntegrityCheckResult struct {
	TotalChecked   int  `json:"totalChecked"`
	Passed         int  `json:"passed"`
	Failed         int  `json:"failed"`
	UnsignedEvents int  `json:"unsignedEvents"`
	Intact         bool `json:"intact"`
}

// GenerateComplianceReport reads all events from the log and generates
// a compliance report. If the log has signing configured, it verifies
// all signatures.
func (l *Log) GenerateComplianceReport() (*ComplianceReport, error) {
	reader, err := l.OpenReader()
	if err != nil {
		return nil, err
	}

	events, err := reader.Read(0)
	if err != nil {
		return nil, err
	}

	report := &ComplianceReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		ByCategory:  make(map[EventCategory]int),
		ByResult:    make(map[string]int),
		ByLevel:     make(map[string]int),
		ByComponent: make(map[string]int),
		Integrity: IntegrityCheckResult{
			Intact: true,
		},
	}

	if len(events) > 0 {
		report.PeriodStart = events[0].Ts
		report.PeriodEnd = events[len(events)-1].Ts
	}

	for _, e := range events {
		report.TotalEvents++
		report.ByCategory[e.Category]++
		report.ByResult[e.Result]++
		report.ByLevel[e.Level]++
		report.ByComponent[e.Component]++

		summary := EventSummary{
			Ts:        e.Ts,
			Category:  e.Category,
			Component: e.Component,
			UserID:    e.UserID,
			Action:    e.Action,
			Target:    e.Target,
			Result:    e.Result,
		}

		if e.Result == "denied" {
			report.DeniedEvents = append(report.DeniedEvents, summary)
		}
		if e.Result == "error" {
			report.ErrorEvents = append(report.ErrorEvents, summary)
		}

		// Verify signature if signing is configured
		if len(l.signingKey) > 0 {
			report.Integrity.TotalChecked++
			if e.Signature == "" {
				report.Integrity.UnsignedEvents++
				report.Integrity.Intact = false
			} else if l.VerifySignature(e) {
				report.Integrity.Passed++
			} else {
				report.Integrity.Failed++
				report.Integrity.Intact = false
			}
		}
	}

	return report, nil
}

// WriteComplianceReportJSON writes the compliance report as JSON to the given writer.
func (l *Log) WriteComplianceReportJSON(w io.Writer) error {
	report, err := l.GenerateComplianceReport()
	if err != nil {
		return err
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(report)
}

// Sync flushes the log buffer to disk.
func (l *Log) Sync() error {
	if l == nil || l.f == nil {
		return nil
	}
	return l.f.Sync()
}

// Path returns the file path of the audit log.
func (l *Log) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}
