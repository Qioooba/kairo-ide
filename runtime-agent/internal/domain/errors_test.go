package domain

import (
	"errors"
	"fmt"
	"testing"
)

func TestDomainError_Error(t *testing.T) {
	de := NewDomainError("TEST_CODE", "test message", errors.New("inner"))
	got := de.Error()
	if got != "[TEST_CODE] test message: inner" {
		t.Errorf("DomainError.Error() = %q, want %q", got, "[TEST_CODE] test message: inner")
	}
}

func TestDomainError_ErrorNoInner(t *testing.T) {
	de := NewDomainError("TEST_CODE", "test message", nil)
	got := de.Error()
	if got != "[TEST_CODE] test message" {
		t.Errorf("DomainError.Error() = %q, want %q", got, "[TEST_CODE] test message")
	}
}

func TestDomainError_Unwrap(t *testing.T) {
	inner := errors.New("inner")
	de := NewDomainError("TEST_CODE", "test message", inner)
	if !errors.Is(de, inner) {
		t.Error("errors.Is should find the inner error")
	}
}

func TestValidationError_Error(t *testing.T) {
	ve := NewValidationError("validation failed", map[string]string{"name": "required", "age": "invalid"})
	got := ve.Error()
	// Order of map iteration is non-deterministic, so check prefix
	if len(got) == 0 || got[:17] != "validation failed" {
		t.Errorf("ValidationError.Error() = %q", got)
	}
}

func TestValidationError_ErrorNoFields(t *testing.T) {
	ve := NewValidationError("validation failed", nil)
	got := ve.Error()
	if got != "validation failed" {
		t.Errorf("ValidationError.Error() = %q, want %q", got, "validation failed")
	}
}

func TestMapError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		wantCode int
		wantStr  string
	}{
		{"invalid input", ErrInvalidInput, 400, "invalid_input"},
		{"unauthenticated", ErrUnauthenticated, 401, "unauthenticated"},
		{"forbidden", ErrForbidden, 403, "forbidden"},
		{"not found", ErrNotFound, 404, "not_found"},
		{"conflict", ErrConflict, 409, "conflict"},
		{"workspace not found", ErrWorkspaceNotFound, 404, "not_found"},
		{"project not found", ErrProjectNotFound, 404, "not_found"},
		{"toolchain not found", ErrToolchainNotFound, 404, "not_found"},
		{"build not found", ErrBuildNotFound, 404, "not_found"},
		{"server not found", ErrServerNotFound, 404, "not_found"},
		{"runtime not found", ErrRuntimeNotFound, 404, "not_found"},
		{"invalid config", ErrInvalidConfig, 400, "invalid_input"},
		{"invalid state transition", ErrInvalidStateTransition, 409, "conflict"},
		{"server already running", ErrServerAlreadyRunning, 409, "conflict"},
		{"operation in progress", ErrOperationInProgress, 409, "conflict"},
		{"duplicate id", ErrDuplicateID, 409, "conflict"},
		{"duplicate root", ErrDuplicateRoot, 409, "conflict"},
		{"port in use", ErrPortInUse, 409, "conflict"},
		{"path escape", ErrPathEscape, 403, "forbidden"},
		{"unsupported build tool", ErrUnsupportedBuildTool, 400, "invalid_input"},
		{"unsupported runtime", ErrUnsupportedRuntime, 400, "invalid_input"},
		{"unknown error", errors.New("unknown"), 500, "internal_error"},
		{"wrapped not found", fmt.Errorf("wrap: %w", ErrNotFound), 404, "not_found"},
		{"wrapped conflict", fmt.Errorf("wrap: %w", ErrConflict), 409, "conflict"},
		{"wrapped invalid input", fmt.Errorf("wrap: %w", ErrInvalidInput), 400, "invalid_input"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, str := MapError(tt.err)
			if code != tt.wantCode {
				t.Errorf("MapError(%v) code = %d, want %d", tt.err, code, tt.wantCode)
			}
			if str != tt.wantStr {
				t.Errorf("MapError(%v) str = %q, want %q", tt.err, str, tt.wantStr)
			}
		})
	}
}

func TestAggregateError(t *testing.T) {
	t.Run("single error", func(t *testing.T) {
		err := NewAggregateError([]error{errors.New("single")})
		got := err.Error()
		if got != "single" {
			t.Errorf("single error: got %q, want %q", got, "single")
		}
	})

	t.Run("multiple errors", func(t *testing.T) {
		err := NewAggregateError([]error{errors.New("a"), errors.New("b")})
		got := err.Error()
		if got != "multiple errors: a; b" {
			t.Errorf("multiple errors: got %q, want %q", got, "multiple errors: a; b")
		}
	})

	t.Run("empty errors returns nil", func(t *testing.T) {
		err := NewAggregateError([]error{})
		if err != nil {
			t.Errorf("empty errors should return nil, got %v", err)
		}
	})

	t.Run("nil errors returns nil", func(t *testing.T) {
		err := NewAggregateError(nil)
		if err != nil {
			t.Errorf("nil errors should return nil, got %v", err)
		}
	})

	t.Run("unwrap", func(t *testing.T) {
		inner := []error{errors.New("a"), errors.New("b")}
		agg := NewAggregateError(inner)
		ae, ok := agg.(*AggregateError)
		if !ok {
			t.Fatal("expected *AggregateError")
		}
		unwrapped := ae.Unwrap()
		if len(unwrapped) != 2 {
			t.Errorf("Unwrap length = %d, want 2", len(unwrapped))
		}
	})
}