package regression

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strconv"
	"sync"
)

// 1. Toolchain compatibility guard: rejects silent target elevation
func CheckToolchainCompatibility(targetVersion string, compilerMinMajor int) error {
	v := targetVersion
	if v == "1.6" || v == "6" {
		if compilerMinMajor > 6 {
			return fmt.Errorf("toolchain_incompatible: target %s requires javac <= 8 (current compiler minimum supported is %d)", targetVersion, compilerMinMajor)
		}
	}
	return nil
}

// 2. Class major version extractor & gate
func ReadClassMajorVersion(b []byte) (uint16, error) {
	if len(b) < 8 {
		return 0, errors.New("truncated class file header: length < 8")
	}
	magic := binary.BigEndian.Uint32(b[0:4])
	if magic != 0xCAFEBABE {
		return 0, fmt.Errorf("invalid class magic: 0x%X", magic)
	}
	major := binary.BigEndian.Uint16(b[6:8])
	return major, nil
}

func ValidateClassMajorForJava6(major uint16) error {
	if major > 50 {
		return fmt.Errorf("class_major_version_exceeded: class major %d exceeds Java 6 maximum of 50", major)
	}
	return nil
}

// 3. JDWP handshake with full read (io.ReadFull)
const JDWPHandshake = "JDWP-Handshake"

func ReadJDWPHandshake(r io.Reader) error {
	buf := make([]byte, len(JDWPHandshake))
	if _, err := io.ReadFull(r, buf); err != nil {
		return fmt.Errorf("jdwp handshake read failed: %w", err)
	}
	if string(buf) != JDWPHandshake {
		return fmt.Errorf("invalid jdwp handshake string: %q", string(buf))
	}
	return nil
}

// 4. JDWP 2-byte char and short codec
func EncodeChar(val uint16) []byte {
	b := make([]byte, 2)
	binary.BigEndian.PutUint16(b, val)
	return b
}

func DecodeChar(b []byte) (uint16, error) {
	if len(b) < 2 {
		return 0, errors.New("insufficient bytes for 2-byte char")
	}
	return binary.BigEndian.Uint16(b[0:2]), nil
}

func EncodeShort(val int16) []byte {
	b := make([]byte, 2)
	binary.BigEndian.PutUint16(b, uint16(val))
	return b
}

func DecodeShort(b []byte) (int16, error) {
	if len(b) < 2 {
		return 0, errors.New("insufficient bytes for 2-byte short")
	}
	return int16(binary.BigEndian.Uint16(b[0:2])), nil
}

// 5. Pre-allocation packet length check
func ValidatePacketLength(length uint32, maxAllowed uint32) error {
	if length < 11 {
		return fmt.Errorf("invalid packet length: %d < 11 (minimum header size)", length)
	}
	if length > maxAllowed {
		return fmt.Errorf("packet length %d exceeds maximum limit %d", length, maxAllowed)
	}
	return nil
}

// 6. Producer / consumer search lifecycle with owned context and join
func RunSearchWithJoin(ctx context.Context, totalItems int, batchSize int, onBatch func([]string) error) error {
	subCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	ch := make(chan string, 16)
	var wg sync.WaitGroup

	// Producer
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(ch)
		for i := 0; i < totalItems; i++ {
			select {
			case <-subCtx.Done():
				return
			case ch <- "item-" + strconv.Itoa(i):
			}
		}
	}()

	// Consumer
	var consumerErr error
	var batch []string
	for item := range ch {
		batch = append(batch, item)
		if len(batch) >= batchSize {
			if err := onBatch(batch); err != nil {
				consumerErr = err
				cancel() // Cancel producer immediately!
				break
			}
			batch = nil
		}
	}
	if consumerErr == nil && len(batch) > 0 {
		consumerErr = onBatch(batch)
	}

	// Drain remaining items if any so producer worker exits
	go func() {
		for range ch {
		}
	}()

	wg.Wait() // Guaranteed join!
	return consumerErr
}
