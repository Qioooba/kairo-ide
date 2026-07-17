// Package protocol is the hand-written Go mirror of
// packages/protocol/src/index.ts. It MUST stay in lock-step with
// the TypeScript source. CI runs `scripts/check-protocol-sync.sh`
// to detect drift.
package protocol

// PROTOCOL_VERSION is the wire protocol major version. It lives
// in the URL prefix (`/api/v1`).
const PROTOCOL_VERSION = "v1"

// KairoErrorCode is the closed enum of stable, machine-readable
// error codes. Add new codes here AND in the TypeScript mirror.
type KairoErrorCode string

const (
	// 4xx-style
	ErrUnauthenticated     KairoErrorCode = "unauthenticated"
	ErrForbidden           KairoErrorCode = "forbidden"
	ErrNotFound            KairoErrorCode = "not_found"
	ErrConflict            KairoErrorCode = "conflict"
	ErrRateLimited         KairoErrorCode = "rate_limited"
	ErrInvalidRequest      KairoErrorCode = "invalid_request"
	ErrPathForbidden       KairoErrorCode = "path_forbidden"
	ErrToolchainMissing    KairoErrorCode = "toolchain_missing"
	ErrRuntimeMissing      KairoErrorCode = "runtime_missing"
	ErrUnsupportedJDKTarget KairoErrorCode = "unsupported_jdk_target"

	// 5xx-style
	ErrInternal            KairoErrorCode = "internal"
	ErrIOError             KairoErrorCode = "io_error"
	ErrProcessSpawnFailed  KairoErrorCode = "process_spawn_failed"
	ErrCompileFailed       KairoErrorCode = "compile_failed"
	ErrDeployFailed        KairoErrorCode = "deploy_failed"
	ErrDebugAttachFailed   KairoErrorCode = "debug_attach_failed"
	ErrTimeout             KairoErrorCode = "timeout"
	ErrPluginCrashed       KairoErrorCode = "plugin_crashed"
	ErrUnsupported         KairoErrorCode = "unsupported"
)

// KairoError is the wire format for an error response.
type KairoError struct {
	Code      KairoErrorCode `json:"code"`
	Message   string         `json:"message"`
	Details   any            `json:"details,omitempty"`
	Retryable bool           `json:"retryable,omitempty"`
}

// RequestEnvelope is the universal request envelope. The
// workspaceId is assigned by the agent after auth, never trusted
// from the client. The requestId is client-generated.
type RequestEnvelope struct {
	WorkspaceID   string `json:"workspaceId"`
	ProjectID     string `json:"projectId,omitempty"`
	RequestID     string `json:"requestId"`
	CorrelationID string `json:"correlationId,omitempty"`
}

// ResponseEnvelope is a successful response.
type ResponseEnvelope struct {
	RequestID     string `json:"requestId"`
	CorrelationID string `json:"correlationId,omitempty"`
	OK            bool   `json:"ok"`
	Payload       any    `json:"payload,omitempty"`
}

// ErrorResponse is an error response.
type ErrorResponse struct {
	RequestID     string    `json:"requestId"`
	CorrelationID string    `json:"correlationId,omitempty"`
	OK            bool      `json:"ok"`
	Error         KairoError `json:"error"`
}

// EnvelopeResult is a small helper that the HTTP layer uses to
// serialize either a successful payload or an error.
type EnvelopeResult struct {
	RequestID     string
	CorrelationID string
	Payload       any
	Error         *KairoError
}

// IsError returns true if the result carries an error.
func (r EnvelopeResult) IsError() bool { return r.Error != nil }

// HealthResponse is the response of GET /api/v1/health.
type HealthResponse struct {
	OK           bool   `json:"ok"`
	Version      string `json:"version"`
	AgentVersion string `json:"agentVersion"`
	UptimeSec    int64  `json:"uptimeSec"`
	Platform     struct {
		OS   string `json:"os"`
		Arch string `json:"arch"`
	} `json:"platform"`
	BindAddress    string `json:"bindAddress"`
	Port           int    `json:"port"`
	ActiveSessions int    `json:"activeSessions"`
}

// Encoding IDs. We keep this open: aliases registered by the user
// are valid EncodingIDs too. These are the well-known ones.
const (
	EncodingUTF8    = "utf-8"
	EncodingUTF8BOM = "utf-8-bom"
	EncodingUTF16LE = "utf-16le"
	EncodingUTF16BE = "utf-16be"
	EncodingGBK     = "gbk"
	EncodingGB18030 = "gb18030"
	EncodingISO88591 = "iso-8859-1"
	EncodingUSASCII  = "us-ascii"
)
