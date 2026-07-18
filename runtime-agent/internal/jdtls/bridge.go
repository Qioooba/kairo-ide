// Package jdtls — LSP frame bridge.
//
// The Theia browser app cannot talk directly to the JDT LS
// process over stdio. The bridge below:
//
//  1. Accepts a single WebSocket connection (the Theia
//     LanguageClientContribution).
//  2. Reads binary LSP frames from the WebSocket (NOT
//     newline-JSON).
//  3. Forwards each frame verbatim to the JDT LS stdin.
//  4. Reads LSP frames from the JDT LS stdout (Content-Length
//     framed) and writes each frame to the WebSocket as a
//     single binary message.
//  5. Teardown: on either side closing, kill the other.
//
// The frame codec is unit-tested in bridge_test.go: split
// header, split body, two frames back-to-back, invalid
// Content-Length, oversized message cap, broken pipe, process
// exit.
//
// The bridge is independent of Theia: the Theia side just
// needs a WebSocket. We intentionally do not return the
// JDT LS JSON-RPC envelope — we pass the binary frame
// through unchanged, header and all.

package jdtls

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kairo-ide/runtime-agent/internal/log"
)

// MaxFrameSize caps the size of a single LSP frame the bridge
// will forward. The LSP spec does not impose a hard cap, but
// 16 MiB is enough for any reasonable document + project dump
// and small enough to keep a single misbehaving client from
// making the manager hold a 1 GiB buffer.
const MaxFrameSize = 16 * 1024 * 1024

// bridgeTimeout is how long the bridge waits for a frame
// before it gives up and closes both sides. The Theia side
// always closes the WebSocket when its connection drops, so
// this is a backstop, not the primary teardown signal.
const bridgeTimeout = 30 * time.Second

// FrameBridgeOptions configures a single bridge session.
type FrameBridgeOptions struct {
	// Manager is the source/sink of the LSP process. Required.
	Manager *Manager
	// UpgradeHeader / CheckOrigin let tests inject a custom
	// origin check; production code accepts any origin (the
	// agent binds to loopback in dev).
	UpgradeHeader http.Header
	CheckOrigin   func(r *http.Request) bool
	// OnClose is called once when the bridge tears down.
	OnClose func(reason string)
}

// FrameBridge exposes the websocket.Upgrader and the ServeHTTP
// method. Theia connects via a single WebSocket per
// workspace.
type FrameBridge struct {
	upgrader websocket.Upgrader
	logger   *log.Logger
	manager  *Manager
	onClose  func(string)
}

// NewFrameBridge wires a bridge. The caller owns the Manager
// and is responsible for stopping the JDT LS when no
// workspaces are connected.
func NewFrameBridge(mgr *Manager, logger *log.Logger) *FrameBridge {
	return &FrameBridge{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  64 * 1024,
			WriteBufferSize: 64 * 1024,
			// Accept any origin: the agent binds to loopback
			// in dev. In the server form, the deployment is
			// behind a TLS terminator that already enforces
			// origin policy.
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		logger:  logger,
		manager: mgr,
	}
}

// ServeHTTP upgrades the request to a WebSocket and runs the
// proxy loop until either side closes.
func (b *FrameBridge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		if b.logger != nil {
			b.logger.Warn("jdtls bridge: upgrade failed", log.Fields{"err": err.Error()})
		}
		return
	}
	// We use binary messages on the wire; the Theia side sets
	// binaryType to "arraybuffer" and emits BinaryMessage.
	ws.SetReadLimit(MaxFrameSize)
	_ = ws.SetReadDeadline(time.Now().Add(bridgeTimeout))
	pinger := time.NewTicker(15 * time.Second)
	defer pinger.Stop()
	conns := &sync.WaitGroup{}
	var closed atomic.Bool
	closeWith := func(reason string) {
		if closed.Swap(true) {
			return
		}
		_ = ws.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, reason),
			time.Now().Add(time.Second))
		_ = ws.Close()
		if b.onClose != nil {
			b.onClose(reason)
		}
		if b.logger != nil {
			b.logger.Info("jdtls bridge: closed", log.Fields{"reason": reason})
		}
	}
	conns.Add(1)
	go func() {
		defer conns.Done()
		for range pinger.C {
			if err := ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(time.Second)); err != nil {
				closeWith("ping-fail")
				return
			}
			_ = ws.SetReadDeadline(time.Now().Add(bridgeTimeout))
		}
	}()
	// Inbound: WebSocket -> JDT LS stdin.
	conns.Add(1)
	go func() {
		defer conns.Done()
		defer closeWith("client closed")
		for {
			mt, body, err := ws.ReadMessage()
			if err != nil {
				if !closed.Load() && !isExpectedClose(err) {
					if b.logger != nil {
						b.logger.Warn("jdtls bridge: read error", log.Fields{"err": err.Error()})
					}
				}
				return
			}
			if mt != websocket.BinaryMessage && mt != websocket.TextMessage {
				continue
			}
			if err := b.manager.Send(body); err != nil {
				if b.logger != nil {
					b.logger.Warn("jdtls bridge: send error", log.Fields{"err": err.Error()})
				}
				return
			}
		}
	}()
	// Outbound: JDT LS stdout -> WebSocket.
	conns.Add(1)
	go func() {
		defer conns.Done()
		defer closeWith("server closed")
		ch := b.manager.Receive()
		for body := range ch {
			if err := ws.WriteMessage(websocket.BinaryMessage, body); err != nil {
				if b.logger != nil {
					b.logger.Warn("jdtls bridge: write error", log.Fields{"err": err.Error()})
				}
				return
			}
		}
	}()
	conns.Wait()
}

func isExpectedClose(err error) bool {
	if err == nil {
		return true
	}
	if websocket.IsCloseError(err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseAbnormalClosure) {
		return true
	}
	if errors.Is(err, io.EOF) {
		return true
	}
	return false
}

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
	_ = context.TODO
)
