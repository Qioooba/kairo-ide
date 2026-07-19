package events

import (
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

// EventBusAdapter implements the api.EventBus contract (a
// single Serve(w, r) method) by wrapping an EventHub. The
// Secret field, when non-empty, is the value the browser
// presented in the Sec-WebSocket-Protocol header; the WS
// subprotocol handler in internal/api runs first and sets it
// on the response writer's header before calling us, so we
// re-use that value as the selected subprotocol passed to
// the upgrader.
//
// This file lives in package events (not internal/api) so
// that we can keep the gorilla/websocket dependency out of
// the HTTP layer's public surface; the api package only
// depends on the EventBus interface.
type EventBusAdapter struct {
	Hub    *EventHub
	Secret string
}

// upgrader is a package-level upgrader with loopback-only
// origin policy. The same CheckOrigin rules as ServeWS
// apply, but the adapter is allowed to publish the secret
// as the selected subprotocol via the responseHeader.
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // Same-origin requests carry no Origin header.
		}
		if strings.HasPrefix(origin, "http://localhost") ||
			strings.HasPrefix(origin, "http://127.0.0.1") ||
			strings.HasPrefix(origin, "http://[::1]") {
			return true
		}
		// file:// is the protocol used by Electron / desktop shells.
		if strings.HasPrefix(origin, "file://") {
			return true
		}
		return false
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// Serve upgrades the HTTP connection to a WebSocket and
// subscribes the client to the EventHub. The
// Sec-WebSocket-Protocol header written by the api layer
// (the shared secret) is forwarded as the selected
// subprotocol so the browser finishes the handshake.
func (a *EventBusAdapter) Serve(w http.ResponseWriter, r *http.Request) {
	// Re-publish the secret the api layer put on the writer
	// as the selected subprotocol. gorilla/websocket will
	// use responseHeader.Get("Sec-Websocket-Protocol") as
	// the value of the response's Sec-WebSocket-Protocol
	// header (because Upgrader.Subprotocols is not set).
	//
	// The api layer's handleEvents has already verified the
	// secret using constant-time compare before we get here;
	// we just echo it back so the browser accepts the
	// upgrade.
	responseHeader := http.Header{}
	if secret := w.Header().Get("Sec-WebSocket-Protocol"); secret != "" {
		responseHeader.Set("Sec-WebSocket-Protocol", secret)
	}
	conn, err := wsUpgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		// Upgrader already wrote an error response.
		return
	}
	defer conn.Close()

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		return
	}

	// Reuse the EventHub subscribe/forward logic from
	// ServeWS so the adapter and the standalone path stay
	// in sync. Subscribe returns the unique subscriber ID,
	// the channel of events, and an unsubscribe func.
	_, ch, unsubscribe := a.Hub.Subscribe(workspaceID)
	defer unsubscribe()

	// Drain the channel into the WebSocket connection.
	// Errors from WriteMessage end the goroutine. The
	// browser will reconnect via the runtime-connection
	// service's exponential backoff.
	for ev := range ch {
		if err := conn.WriteJSON(ev); err != nil {
			return
		}
	}
}
