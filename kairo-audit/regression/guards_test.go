package regression

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"
)

// fragmentedReader simulates TCP chunks (e.g. 1 byte or 3 bytes per read)
type fragmentedReader struct {
	data      []byte
	pos       int
	chunkSize int
}

func (r *fragmentedReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	remaining := len(r.data) - r.pos
	toRead := r.chunkSize
	if toRead > remaining {
		toRead = remaining
	}
	if toRead > len(p) {
		toRead = len(p)
	}
	copy(p, r.data[r.pos:r.pos+toRead])
	r.pos += toRead
	return toRead, nil
}

// 1. Toolchain compatibility: valid
func TestCheckToolchainCompatibility_Valid(t *testing.T) {
	if err := CheckToolchainCompatibility("1.6", 6); err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}
}

// 2. Toolchain compatibility: incompatible
func TestCheckToolchainCompatibility_Incompatible(t *testing.T) {
	err := CheckToolchainCompatibility("1.6", 8)
	if err == nil {
		t.Fatal("expected toolchain_incompatible error when compiler requires >= 8")
	}
}

// 3. Class major version: valid
func TestReadClassMajorVersion_Valid(t *testing.T) {
	// cafe babe 0000 0032 (major 50 = Java 6)
	raw := []byte{0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0x00, 0x00, 0x32}
	major, err := ReadClassMajorVersion(raw)
	if err != nil {
		t.Fatalf("ReadClassMajorVersion failed: %v", err)
	}
	if major != 50 {
		t.Fatalf("expected major 50, got %d", major)
	}
}

// 4. Class major version: truncated
func TestReadClassMajorVersion_Truncated(t *testing.T) {
	raw := []byte{0xCA, 0xFE, 0xBA}
	_, err := ReadClassMajorVersion(raw)
	if err == nil {
		t.Fatal("expected truncated class file error")
	}
}

// 5. Class major version: invalid magic
func TestReadClassMajorVersion_InvalidMagic(t *testing.T) {
	raw := []byte{0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x32}
	_, err := ReadClassMajorVersion(raw)
	if err == nil {
		t.Fatal("expected invalid magic error")
	}
}

// 6. Java 6 major gate: reject major 52
func TestValidateClassMajorForJava6(t *testing.T) {
	if err := ValidateClassMajorForJava6(50); err != nil {
		t.Fatalf("major 50 should be accepted: %v", err)
	}
	if err := ValidateClassMajorForJava6(52); err == nil {
		t.Fatal("major 52 should be rejected for Java 6 deployment")
	}
}

// 7. JDWP handshake: normal success
func TestReadJDWPHandshake_Success(t *testing.T) {
	r := bytes.NewReader([]byte(JDWPHandshake))
	if err := ReadJDWPHandshake(r); err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
}

// 8. JDWP handshake: fragmented stream (1 byte per read)
func TestReadJDWPHandshake_Fragmented(t *testing.T) {
	r := &fragmentedReader{data: []byte(JDWPHandshake), chunkSize: 1}
	if err := ReadJDWPHandshake(r); err != nil {
		t.Fatalf("fragmented handshake must succeed with io.ReadFull: %v", err)
	}
}

// 9. JDWP handshake: invalid string
func TestReadJDWPHandshake_Invalid(t *testing.T) {
	r := bytes.NewReader([]byte("HTTP/1.1 200 OK"))
	if err := ReadJDWPHandshake(r); err == nil {
		t.Fatal("expected handshake error on non-JDWP string")
	}
}

// 10. 2-byte char and short encoding/decoding
func TestEncodeDecodeCharAndShort(t *testing.T) {
	// Char: '中' = 0x4E2D
	cBytes := EncodeChar(0x4E2D)
	if len(cBytes) != 2 {
		t.Fatalf("char encoding must be exactly 2 bytes, got %d", len(cBytes))
	}
	charVal, err := DecodeChar(cBytes)
	if err != nil || charVal != 0x4E2D {
		t.Fatalf("decode char failed: %v, val: %X", err, charVal)
	}

	// Short: -1 = 0xFFFF
	sBytes := EncodeShort(-1)
	if len(sBytes) != 2 {
		t.Fatalf("short encoding must be exactly 2 bytes, got %d", len(sBytes))
	}
	shortVal, err := DecodeShort(sBytes)
	if err != nil || shortVal != -1 {
		t.Fatalf("decode short failed: %v, val: %d", err, shortVal)
	}
}

// 11. Search producer/consumer cancellation and join
func TestRunSearchWithJoin_Cancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	batchCount := 0
	errExpected := errors.New("consumer stopped early")

	err := RunSearchWithJoin(ctx, 1000, 10, func(batch []string) error {
		batchCount++
		if batchCount >= 2 {
			return errExpected // Cancel consumer after 2 batches
		}
		return nil
	})

	if !errors.Is(err, errExpected) {
		t.Fatalf("expected %v, got %v", errExpected, err)
	}
	if batchCount != 2 {
		t.Fatalf("expected exactly 2 batches, got %d", batchCount)
	}
}
