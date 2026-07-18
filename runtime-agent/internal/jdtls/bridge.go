// Package jdtls — LSP frame bridge.
//
// DEPRECATED: The LSP frame bridge has been moved to the Theia
// backend (packages/java-extension/src/node/java-language-server-contribution.ts).
// The Go Agent no longer starts JDT LS or proxies LSP frames.
// The Theia backend now owns the JDT LS process lifecycle and
// communicates with it directly over stdio.
//
// This file is kept for reference and for the frame codec
// utilities (EncodeFrame, FrameDecoder) which are still used
// by tests. The WebSocket bridge (FrameBridge, ServeHTTP) is
// no longer wired into the API routes.

package jdtls

import (
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// MaxFrameSize is the largest LSP frame we accept. The spec
// allows 0 for unlimited, but we cap at 16 MiB because a
// single result list can be large, but never gigabytes.
const MaxFrameSize = 16 * 1024 * 1024

// bridgeTimeout is the maximum time the bridge would wait for
// the JDT LS to shut down before forcing-exit. Kept for
// backward compatibility with tests.
const bridgeTimeout = 30 * time.Second

// EncodeFrame is exported for testing. It produces a valid
// LSP frame from a payload.
func EncodeFrame(body []byte) []byte {
	hdr := make([]byte, 0, 64)
	hdr = append(hdr, []byte("Content-Length: ")...)
	hdr = append(hdr, []byte(fmt.Sprintf("%d", len(body)))...)
	hdr = append(hdr, '\r', '\n')
	hdr = append(hdr, '\r', '\n')
	out := make([]byte, 0, len(hdr)+len(body))
	out = append(out, hdr...)
	out = append(out, body...)
	return out
}

// DecodeFrameStream is the test seam for the frame parser.
// Given a full byte stream (potentially containing multiple
// concatenated frames), it returns the next frame body and
// the number of bytes consumed. The buffer in `state` keeps
// any partial header/body across calls.
type FrameDecoder struct {
	// MaxFrameSize caps the body length we accept; 0 means
	// use MaxFrameSize.
	MaxFrameSize int
	buf          []byte
}

func NewFrameDecoder() *FrameDecoder {
	return &FrameDecoder{MaxFrameSize: MaxFrameSize}
}

// Feed adds more bytes to the internal buffer and returns
// the next complete frame body (if any), the bytes consumed
// from the input slice, and any parse error. Returns
// (nil, 0, nil) when the buffer does not yet contain a
// complete frame. Returns an error on malformed headers,
// invalid Content-Length, or a body larger than
// MaxFrameSize.
//
// Multiple frames may be passed in a single call; callers
// should keep calling Feed until they have consumed the
// whole stream.
func (d *FrameDecoder) Feed(in []byte) (frame []byte, consumed int, err error) {
	d.buf = append(d.buf, in...)
	for {
		hdrEnd := indexHeaderEnd(d.buf)
		if hdrEnd < 0 {
			return nil, 0, nil
		}
		hdr := d.buf[:hdrEnd]
		cl, hasCL := parseContentLength(string(hdr))
		if !hasCL {
			return nil, 0, errors.New("missing Content-Length")
		}
		if cl < 0 {
			return nil, 0, fmt.Errorf("invalid Content-Length: %d", cl)
		}
		max := d.MaxFrameSize
		if max == 0 {
			max = MaxFrameSize
		}
		if cl > max {
			return nil, 0, fmt.Errorf("frame too large: %d > %d", cl, max)
		}
		total := hdrEnd + 4 + cl // \r\n\r\n + body
		if len(d.buf) < total {
			return nil, 0, nil
		}
		body := make([]byte, cl)
		copy(body, d.buf[hdrEnd+4:hdrEnd+4+cl])
		d.buf = d.buf[total:]
		return body, len(in) - len(d.buf), nil
	}
}

// indexHeaderEnd returns the index of the first byte of the
// CRLFCRLF that ends the LSP frame header, or -1 if the
// buffer does not yet contain a complete header.
func indexHeaderEnd(b []byte) int {
	// We scan for "\r\n\r\n". At a minimum, we need 4 bytes.
	for i := 0; i+3 < len(b); i++ {
		if b[i] == '\r' && b[i+1] == '\n' && b[i+2] == '\r' && b[i+3] == '\n' {
			return i
		}
	}
	return -1
}

// parseContentLength scans a header block for "Content-Length"
// (case-insensitive prefix match). Whitespace around the value
// is tolerated.
func parseContentLength(hdr string) (int, bool) {
	const key = "content-length:"
	low := toLower(hdr)
	idx := indexOf(low, key)
	if idx < 0 {
		return 0, false
	}
	rest := hdr[idx+len(key):]
	// rest may be followed by \r\n or other whitespace.
	end := indexByte(rest, '\r')
	if end < 0 {
		end = indexByte(rest, '\n')
	}
	if end >= 0 {
		rest = rest[:end]
	}
	// Trim leading whitespace
	for len(rest) > 0 && (rest[0] == ' ' || rest[0] == '\t') {
		rest = rest[1:]
	}
	n := 0
	for _, c := range rest {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int(c-'0')
	}
	return n, true
}

func toLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func indexOf(s, sub string) int {
	if len(sub) == 0 {
		return 0
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

// EncodeFrameWithHeaders writes a header set (one
// "Key: Value\r\n" pair per element) followed by the body.
// Content-Length is added automatically.
func EncodeFrameWithHeaders(extra []string, body []byte) []byte {
	hdr := make([]byte, 0, 64+len(body))
	hdr = append(hdr, []byte("Content-Length: ")...)
	// The value can be 0 to 9999999999 (10 digits); format it
	// without allocating an intermediate fmt buffer.
	digits := [20]byte{}
	pos := len(digits)
	n := len(body)
	if n == 0 {
		pos--
		digits[pos] = '0'
	} else {
		for n > 0 {
			pos--
			digits[pos] = byte('0' + n%10)
			n /= 10
		}
	}
	hdr = append(hdr, digits[pos:]...)
	hdr = append(hdr, '\r', '\n')
	for _, kv := range extra {
		hdr = append(hdr, []byte(kv)...)
		hdr = append(hdr, '\r', '\n')
	}
	hdr = append(hdr, '\r', '\n')
	out := make([]byte, 0, len(hdr)+len(body))
	out = append(out, hdr...)
	out = append(out, body...)
	return out
}

// BE16 / LE16 are exposed for completeness; the LSP spec uses
// US-ASCII so we never need them, but they are useful for
// tests that want to verify the decoder ignores a hypothetical
// binary-prefixed header.
var (
	_ = binary.BigEndian
)