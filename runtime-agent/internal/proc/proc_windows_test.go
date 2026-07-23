//go:build windows && (amd64 || arm64)

package proc

import (
	"testing"
	"unsafe"
)

// These paired array lengths are compile-time equality assertions. They make
// GOOS=windows cross-compilation fail even when the resulting test binary
// cannot be executed on the build host.
var (
	_ [uintptr(16) - unsafe.Offsetof(jobObjectBasicLimitInformation{}.LimitFlags)]byte
	_ [unsafe.Offsetof(jobObjectBasicLimitInformation{}.LimitFlags) - uintptr(16)]byte
	_ [uintptr(64) - unsafe.Sizeof(jobObjectBasicLimitInformation{})]byte
	_ [unsafe.Sizeof(jobObjectBasicLimitInformation{}) - uintptr(64)]byte
	_ [uintptr(144) - unsafe.Sizeof(jobObjectExtendedLimitInformationStruct{})]byte
	_ [unsafe.Sizeof(jobObjectExtendedLimitInformationStruct{}) - uintptr(144)]byte
)

func TestJobObjectLimitInformationABI(t *testing.T) {
	var basic jobObjectBasicLimitInformation
	if got, want := unsafe.Offsetof(basic.LimitFlags), uintptr(16); got != want {
		t.Fatalf("LimitFlags offset = %d, want %d", got, want)
	}
	if got, want := unsafe.Sizeof(basic), uintptr(64); got != want {
		t.Fatalf("basic limit information size = %d, want %d", got, want)
	}

	var extended jobObjectExtendedLimitInformationStruct
	if got, want := unsafe.Sizeof(extended), uintptr(144); got != want {
		t.Fatalf("extended limit information size = %d, want %d", got, want)
	}

	basic.LimitFlags = jobObjectLimitKillOnJobClose
	if got := basic.LimitFlags; got != 0x2000 {
		t.Fatalf("LimitFlags = %#x, want %#x", got, uint32(0x2000))
	}
}
