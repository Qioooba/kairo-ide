package domain

import (
	"errors"
	"fmt"
	"strings"
)

// ---- HTTP-mappable error sentinels ----

var (
	ErrInvalidInput    = errors.New("invalid input")
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrForbidden       = errors.New("forbidden")
	ErrNotFound        = errors.New("not found")
	ErrConflict        = errors.New("conflict")
)

// ---- Domain sentinels ----

var (
	ErrWorkspaceNotFound          = errors.New("workspace not found")
	ErrProjectNotFound            = errors.New("project not found")
	ErrToolchainNotFound          = errors.New("toolchain not found")
	ErrBuildNotFound              = errors.New("build not found")
	ErrServerNotFound             = errors.New("server not found")
	ErrRuntimeNotFound            = errors.New("runtime not found")
	ErrBuildNotCancellable        = errors.New("build is not in a cancellable state")
	ErrInvalidStateTransition     = errors.New("invalid state transition")
	ErrServerAlreadyRunning       = errors.New("server already running")
	ErrServerNotRunning           = errors.New("server not running")
	ErrProcessIdentityMismatch    = errors.New("process identity mismatch")
	ErrProcessOrphaned            = errors.New("process orphaned")
	ErrUnsupportedBuildTool       = errors.New("unsupported build tool")
	ErrUnsupportedRuntime         = errors.New("unsupported runtime")
	ErrRuntimeIntegrationRequired = errors.New("runtime integration required from Windows workflow")
	ErrCorruptDocument            = errors.New("corrupt document")
	ErrDuplicateTarget            = errors.New("duplicate deploy target")
	ErrTargetCollision            = errors.New("deploy target collision (file vs directory)")
	ErrSelectedFileEscape         = errors.New("selected file escapes source roots")
	ErrOutputDirEscape            = errors.New("output dir escapes project root")
	ErrProjectRootMoved           = errors.New("project root moved or missing")
	ErrInvalidConfig              = errors.New("invalid project config")
	ErrInvalidOwnerToken          = errors.New("invalid deployment owner token")
	ErrDeploymentTargetMismatch   = errors.New("deployment target identity mismatch")
	ErrRootNotFound               = errors.New("deployment root does not exist")
	ErrDuplicateID                = errors.New("duplicate id")
	ErrDuplicateRoot              = errors.New("duplicate root")
	ErrInvalidServerID            = errors.New("invalid server id")
	ErrInvalidRuntimeID           = errors.New("invalid runtime id")
	ErrOperationInProgress        = errors.New("operation already in progress")
	ErrPortInUse                  = errors.New("port already in use")
	ErrReadinessTimeout           = errors.New("server readiness timeout")
)

// ---- Typed error wrappers ----

// DomainError is a structured error that carries a machine-readable code
// for HTTP status mapping.
type DomainError struct {
	Code    string
	Message string
	Err     error
}

func (e *DomainError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func (e *DomainError) Unwrap() error { return e.Err }

// NewDomainError creates a new DomainError.
func NewDomainError(code, message string, err error) *DomainError {
	return &DomainError{Code: code, Message: message, Err: err}
}

// ValidationError is a structured validation error with field-level details.
type ValidationError struct {
	Message string
	Fields  map[string]string
}

func (e *ValidationError) Error() string {
	if len(e.Fields) == 0 {
		return e.Message
	}
	parts := make([]string, 0, len(e.Fields))
	for k, v := range e.Fields {
		parts = append(parts, fmt.Sprintf("%s: %s", k, v))
	}
	return fmt.Sprintf("%s (%s)", e.Message, strings.Join(parts, "; "))
}

// NewValidationError creates a new ValidationError.
func NewValidationError(message string, fields map[string]string) *ValidationError {
	return &ValidationError{Message: message, Fields: fields}
}

// ---- HTTP error mapping ----

// MapError maps a domain error to an HTTP status code and error code string.
func MapError(err error) (int, string) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		return 400, "invalid_input"
	case errors.Is(err, ErrUnauthenticated):
		return 401, "unauthenticated"
	case errors.Is(err, ErrForbidden):
		return 403, "forbidden"
	case errors.Is(err, ErrNotFound):
		return 404, "not_found"
	case errors.Is(err, ErrConflict):
		return 409, "conflict"
	case errors.Is(err, ErrWorkspaceNotFound):
		return 404, "not_found"
	case errors.Is(err, ErrProjectNotFound):
		return 404, "not_found"
	case errors.Is(err, ErrToolchainNotFound):
		return 404, "not_found"
	case errors.Is(err, ErrBuildNotFound):
		return 404, "not_found"
	case errors.Is(err, ErrServerNotFound):
		return 404, "not_found"
	case errors.Is(err, ErrRuntimeNotFound):
		return 404, "not_found"
	case errors.Is(err, ErrInvalidConfig):
		return 400, "invalid_input"
	case errors.Is(err, ErrInvalidStateTransition):
		return 409, "conflict"
	case errors.Is(err, ErrServerAlreadyRunning):
		return 409, "conflict"
	case errors.Is(err, ErrOperationInProgress):
		return 409, "conflict"
	case errors.Is(err, ErrDuplicateID):
		return 409, "conflict"
	case errors.Is(err, ErrDuplicateRoot):
		return 409, "conflict"
	case errors.Is(err, ErrPortInUse):
		return 409, "conflict"
	case errors.Is(err, ErrPathEscape):
		return 403, "forbidden"
	case errors.Is(err, ErrUnsupportedBuildTool):
		return 400, "invalid_input"
	case errors.Is(err, ErrUnsupportedRuntime):
		return 400, "invalid_input"
	default:
		return 500, "internal_error"
	}
}

// ---- AggregateError ----

type AggregateError struct {
	Errors []error
}

func (e *AggregateError) Error() string {
	if len(e.Errors) == 1 {
		return e.Errors[0].Error()
	}
	msgs := make([]string, len(e.Errors))
	for i, err := range e.Errors {
		msgs[i] = err.Error()
	}
	return "multiple errors: " + strings.Join(msgs, "; ")
}

func (e *AggregateError) Unwrap() []error {
	return e.Errors
}

func NewAggregateError(errs []error) error {
	if len(errs) == 0 {
		return nil
	}
	if len(errs) == 1 {
		return errs[0]
	}
	return &AggregateError{Errors: errs}
}
