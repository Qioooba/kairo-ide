package domain

import (
	"errors"
	"strings"
)

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
