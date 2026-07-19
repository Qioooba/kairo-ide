package services

import "testing"

func TestJDTLSMaxHeapMB(t *testing.T) {
	t.Run("default", func(t *testing.T) {
		t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", "")
		if got := jdtlsMaxHeapMB(); got != defaultJDTLSMaxHeapMB {
			t.Fatalf("jdtlsMaxHeapMB() = %d, want %d", got, defaultJDTLSMaxHeapMB)
		}
	})
	t.Run("valid override", func(t *testing.T) {
		t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", "1536")
		if got := jdtlsMaxHeapMB(); got != 1536 {
			t.Fatalf("jdtlsMaxHeapMB() = %d, want 1536", got)
		}
	})
	for _, invalid := range []string{"nope", "128", "8192"} {
		t.Run("invalid_"+invalid, func(t *testing.T) {
			t.Setenv("KAIRO_JDTLS_MAX_HEAP_MB", invalid)
			if got := jdtlsMaxHeapMB(); got != defaultJDTLSMaxHeapMB {
				t.Fatalf("jdtlsMaxHeapMB() = %d, want fallback %d", got, defaultJDTLSMaxHeapMB)
			}
		})
	}
}
