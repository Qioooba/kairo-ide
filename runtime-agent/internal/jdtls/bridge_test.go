package jdtls

import (
	"bufio"
	"bytes"
	"io"
	"strings"
	"testing"
	"time"
)

func TestEncodeFrame(t *testing.T) {
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	frame := EncodeFrame(body)
	want := []byte("Content-Length: " + itoa(len(body)) + "\r\n\r\n")
	if !bytes.HasPrefix(frame, want) {
		t.Fatalf("header wrong: %q", frame[:min(40, len(frame))])
	}
	if !bytes.HasSuffix(frame, body) {
		t.Fatalf("body wrong: %q", frame[len(frame)-len(body):])
	}
}

func TestEncodeFrameWithHeaders(t *testing.T) {
	body := []byte(`{"hello":1}`)
	frame := EncodeFrameWithHeaders([]string{"Content-Type: application/vscode-jsonrpc; charset=utf-8"}, body)
	want := []byte("Content-Length: " + itoa(len(body)) + "\r\n")
	if !bytes.HasPrefix(frame, want) {
		t.Fatalf("Content-Length wrong: %q", frame[:min(40, len(frame))])
	}
	if !bytes.Contains(frame, []byte("Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n")) {
		t.Fatalf("Content-Type missing: %q", frame)
	}
	if !bytes.HasSuffix(frame, body) {
		t.Fatalf("body wrong: %q", frame)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := [20]byte{}
	pos := len(digits)
	for n > 0 {
		pos--
		digits[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(digits[pos:])
}

func TestFrameDecoder_SingleFrame(t *testing.T) {
	dec := NewFrameDecoder()
	body := []byte(`{"jsonrpc":"2.0","id":1,"result":{}}`)
	frame := EncodeFrame(body)
	out, consumed, err := dec.Feed(frame)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, body) {
		t.Fatalf("body mismatch: %q", out)
	}
	if consumed != len(frame) {
		t.Fatalf("consumed=%d want %d", consumed, len(frame))
	}
}

func TestFrameDecoder_SplitHeader(t *testing.T) {
	dec := NewFrameDecoder()
	body := []byte(`{"jsonrpc":"2.0","id":1}`)
	full := EncodeFrame(body)
	var got []byte
	for i := 0; i < len(full); i += 2 {
		end := i + 2
		if end > len(full) {
			end = len(full)
		}
		out, _, err := dec.Feed(full[i:end])
		if err != nil {
			t.Fatalf("chunk %d: %v", i, err)
		}
		if out != nil {
			got = out
		}
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("body mismatch: %q", got)
	}
}

func TestFrameDecoder_SplitBody(t *testing.T) {
	dec := NewFrameDecoder()
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"textDocument/completion","params":{"textDocument":{"uri":"file:///x.java"},"position":{"line":0,"character":1}}}`)
	full := EncodeFrame(body)
	sep := bytes.Index(full, []byte("\r\n\r\n"))
	if sep < 0 {
		t.Fatal("frame should contain CRLFCRLF")
	}
	hdr := full[:sep+4]
	out, _, err := dec.Feed(hdr)
	if err != nil {
		t.Fatal(err)
	}
	if out != nil {
		t.Fatalf("premature frame: %q", out)
	}
	bodyStart := len(hdr)
	half := bodyStart + len(body)/2
	out, _, err = dec.Feed(full[bodyStart:half])
	if err != nil {
		t.Fatal(err)
	}
	if out != nil {
		t.Fatalf("premature frame: %q", out)
	}
	out, _, err = dec.Feed(full[half:])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, body) {
		t.Fatalf("body mismatch: %q", out)
	}
}

func TestFrameDecoder_TwoFramesBackToBack(t *testing.T) {
	dec := NewFrameDecoder()
	body1 := []byte(`{"jsonrpc":"2.0","id":1}`)
	body2 := []byte(`{"jsonrpc":"2.0","method":"initialized","params":{}}`)
	stream := append(EncodeFrame(body1), EncodeFrame(body2)...)
	got1, consumed, err := dec.Feed(stream)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got1, body1) {
		t.Fatalf("first body wrong: %q", got1)
	}
	// Feed the rest; we expect to get body2 back.
	got2, _, err := dec.Feed(stream[consumed:])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got2, body2) {
		t.Fatalf("second body wrong: %q", got2)
	}
}

func TestFrameDecoder_InvalidContentLength(t *testing.T) {
	cases := []struct {
		name string
		hdr  string
	}{
		{"non-numeric", "Content-Length: abc\r\n\r\n"},
		{"negative", "Content-Length: -5\r\n\r\n"},
		{"missing", "\r\n\r\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dec := NewFrameDecoder()
			_, _, err := dec.Feed([]byte(tc.hdr))
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), "Content-Length") {
				t.Fatalf("error %q should mention Content-Length", err.Error())
			}
		})
	}
}

func TestFrameDecoder_OversizedBody(t *testing.T) {
	dec := NewFrameDecoder()
	dec.MaxFrameSize = 64
	hdr := []byte("Content-Length: 1024\r\n\r\n")
	_, _, err := dec.Feed(hdr)
	if err == nil {
		t.Fatal("expected oversized error")
	}
	if !strings.Contains(err.Error(), "frame too large") {
		t.Fatalf("error %q should mention frame too large", err.Error())
	}
}

func TestFrameDecoder_ZeroBody(t *testing.T) {
	dec := NewFrameDecoder()
	frame := EncodeFrame(nil)
	out, _, err := dec.Feed(frame)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 0 {
		t.Fatalf("body should be empty: %q", out)
	}
}

func TestFrameDecoder_PartialHeaderThenRest(t *testing.T) {
	dec := NewFrameDecoder()
	if _, _, err := dec.Feed([]byte("Content-Len")); err != nil {
		t.Fatal(err)
	}
	out, _, err := dec.Feed([]byte("gth: 2\r\n\r\nxx"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, []byte("xx")) {
		t.Fatalf("body wrong: %q", out)
	}
}

// Roundtrip: encode + readHeaders + body read.

func TestReadHeadersAndBody(t *testing.T) {
	body := []byte(`{"jsonrpc":"2.0","id":42,"result":{"capabilities":{}}}`)
	frame := EncodeFrame(body)
	br := bufio.NewReader(bytes.NewReader(frame))
	h, err := readHeaders(br)
	if err != nil {
		t.Fatal(err)
	}
	if h.contentLength != len(body) {
		t.Fatalf("content-length=%d want %d", h.contentLength, len(body))
	}
	got := make([]byte, h.contentLength)
	if _, err := io.ReadFull(br, got); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("body mismatch")
	}
}

func TestSafeJoin_PathTraversal(t *testing.T) {
	// Use an OS-agnostic dest for the algorithm. The real
	// production code uses real paths; this test exercises
	// the algorithm.
	dest := "jdtls-install"
	cases := []struct {
		entry   string
		wantErr bool
	}{
		{"plugins/org.eclipse.equinox.launcher_1.6.500.jar", false},
		{"../escape.txt", true},
		{"subdir/../../escape.txt", true},
		{"/abs/path", true},
		{"", true},
		{"plugins/.", false},
		{"plugins/..", true},
	}
	for _, tc := range cases {
		t.Run(tc.entry, func(t *testing.T) {
			got, err := safeJoin(dest, tc.entry)
			gotErr := err != nil
			if gotErr != tc.wantErr {
				t.Fatalf("entry=%q: gotErr=%v wantErr=%v err=%v got=%q", tc.entry, gotErr, tc.wantErr, err, got)
			}
		})
	}
}

func TestReadHeaders_MissingContentLength(t *testing.T) {
	raw := "Content-Type: text/plain\r\n\r\n"
	br := bufio.NewReader(bytes.NewReader([]byte(raw)))
	_, err := readHeaders(br)
	if err == nil {
		t.Fatal("expected error on missing Content-Length")
	}
}

func TestReadHeaders_InvalidContentLength(t *testing.T) {
	raw := "Content-Length: notanumber\r\n\r\n"
	br := bufio.NewReader(bytes.NewReader([]byte(raw)))
	_, err := readHeaders(br)
	if err == nil {
		t.Fatal("expected error on non-numeric Content-Length")
	}
}

func TestBridgeTimeout_Defaults(t *testing.T) {
	if bridgeTimeout < 5*time.Second {
		t.Fatalf("bridgeTimeout too small: %v", bridgeTimeout)
	}
}

func TestMaxFrameSize_Boundary(t *testing.T) {
	if MaxFrameSize <= 0 {
		t.Fatalf("MaxFrameSize must be positive: %d", MaxFrameSize)
	}
	// We don't build a 16 MiB test frame in unit tests, but
	// we do verify the cap is at least 1 MiB and at most 64
	// MiB so the constant is not accidentally zeroed or
	// 10x-ed.
	if MaxFrameSize < 1<<20 {
		t.Fatalf("MaxFrameSize too small: %d", MaxFrameSize)
	}
	if MaxFrameSize > 64<<20 {
		t.Fatalf("MaxFrameSize too large: %d", MaxFrameSize)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
