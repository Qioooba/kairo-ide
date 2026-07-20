// Tests for /api/v1/events WebSocket authentication. Per
// docs/hotfix-windows-test-readiness.md 搂1.2, the WS auth
// contract is:
//
//   client: new WebSocket(url, ["kairo-secret-v1", secret])
//   server: Sec-WebSocket-Protocol response header echoes the
//           secret back so the browser finishes the handshake.
//
// These tests cover the full handler -> upgrader roundtrip
// with a real WebSocket client (httptest.Server + gorilla
// websocket dialer). They guard against two regressions:
//   1. handler returning early before the upgrade because
//      EventBus is nil (the original P0-8 bug),
//   2. upgrader overriding Sec-WebSocket-Protocol so the
//      browser never sees the secret echoed back.

package api

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/audit"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// wsAuthTestBus wires the real EventHub + EventBusAdapter
// into the api.Services. This exercises the same code path
// that production main.go uses (container.EventBus ->
// Services.EventBus -> handleEvents).
func wsAuthTestBus(t *testing.T) *events.EventBusAdapter {
	t.Helper()
	hub := events.NewEventHub(8, 8)
	return &events.EventBusAdapter{Hub: hub}
}

// newWSAuthTestServer builds a full Server (with the real
// middleware chain) and returns an httptest.Server listening
// on loopback. The server is cleaned up via t.Cleanup.
func newWSAuthTestServer(t *testing.T, secret string) *httptest.Server {
	t.Helper()
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })

	srv := NewServer(&Services{EventBus: wsAuthTestBus(t)}, logger, auditLog, "test-0.1.0", secret)

	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

// dialWS dials the /api/v1/events endpoint with the given
// subprotocols and returns the resulting connection. A
// short read deadline makes the test fail fast if the
// server hangs.
func dialWS(t *testing.T, ts *httptest.Server, subprotocols []string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	u, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/api/v1/events"

	dialer := *websocket.DefaultDialer
	dialer.Subprotocols = subprotocols
	dialer.HandshakeTimeout = 3 * time.Second

	conn, resp, err := dialer.Dial(u.String(), nil)
	return conn, resp, err
}

// TestWSAuth_Roundtrip_WithSecret is the happy path: client
// offers ["kairo-secret-v1", secret], the server validates
// the token, echoes the secret as Sec-WebSocket-Protocol,
// and the WebSocket connection completes the 101 upgrade.
func TestWSAuth_Roundtrip_WithSecret(t *testing.T) {
	ts := newWSAuthTestServer(t, "topsecret")

	conn, resp, err := dialWS(t, ts, []string{WebSocketSubprotocol, "topsecret"})
	if err != nil {
		t.Fatalf("dial: %v (status=%v)", err, resp)
	}
	defer conn.Close()

	// The response must have selected the secret as the
	// subprotocol so the browser-side WebSocket constructor
	// accepts the handshake. (gorilla/websocket echoes
	// whichever value was on responseHeader["Sec-WebSocket-Protocol"].)
	if got := resp.Header.Get("Sec-WebSocket-Protocol"); got != "topsecret" {
		t.Errorf("Sec-WebSocket-Protocol response = %q, want topsecret", got)
	}
	if got := conn.Subprotocol(); got != "topsecret" {
		t.Errorf("conn.Subprotocol() = %q, want topsecret", got)
	}
}

// TestWSAuth_Roundtrip_NoSecret asserts that when the agent
// is configured WITHOUT a secret (dev mode), the WS
// handshake still succeeds. This matches the dev-mode path
// in handleEvents: auth is skipped, EventBus.Serve is
// called directly.
func TestWSAuth_Roundtrip_NoSecret(t *testing.T) {
	ts := newWSAuthTestServer(t, "") // no secret

	conn, resp, err := dialWS(t, ts, nil)
	if err != nil {
		t.Fatalf("dial: %v (status=%v)", err, resp)
	}
	defer conn.Close()

	// The upgrade must have succeeded; the response carries
	// no Sec-WebSocket-Protocol because the client didn't
	// offer any.
	if got := resp.Header.Get("Sec-WebSocket-Protocol"); got != "" {
		t.Errorf("Sec-WebSocket-Protocol response = %q, want empty", got)
	}
}

// TestWSAuth_Roundtrip_RejectsBadSecret asserts that a
// wrong secret returns 401 and the upgrade is never
// attempted. We drive the handler through the Server's
// middleware directly because the gorilla dialer will not
// return a clean response when the server rejects the
// handshake — the dialer sees the 401 and surfaces a
// transport-level error, hiding the status code we want to
// assert.
func TestWSAuth_Roundtrip_RejectsBadSecret(t *testing.T) {
	ts := newWSAuthTestServer(t, "topsecret")

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/events", nil)
	req.Header.Set("Sec-WebSocket-Protocol", WebSocketSubprotocol+", wrongsecret")
	rr := httptest.NewRecorder()
	ts.Config.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad-secret status = %d, want 401, body=%s", rr.Code, rr.Body.String())
	}
}

// TestWSAuth_RejectsMissingEventBus reproduces the original
// P0-8 root cause: EventBus is nil, the handler returns 500,
// and the browser-side WebSocket times out waiting for the
// 101. We assert the failure mode is explicit (500), not
// silent, so a future regression that wires the wrong type
// is caught.
func TestWSAuth_RejectsMissingEventBus(t *testing.T) {
	logger := log.New("test").WithLevel(log.LevelWarn)
	auditLog, err := audit.New(t.TempDir() + "/audit.log")
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })

	// EventBus intentionally nil.
	srv := NewServer(&Services{}, logger, auditLog, "test-0.1.0", "topsecret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	req.Header.Set("Sec-WebSocket-Protocol", WebSocketSubprotocol+", topsecret")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("nil EventBus status = %d, want 500, body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "EventBus not configured") {
		t.Errorf("body did not mention EventBus: %s", rr.Body.String())
	}
}
