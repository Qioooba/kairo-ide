package events

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// AuthSecretHeader is the header name for the shared secret in WebSocket upgrade.
	AuthSecretHeader = "X-Kairo-Auth"

	// MaxMessageSizeBytes is the maximum WebSocket message size.
	MaxMessageSizeBytes = maxMessageSize

	// AuthSecretSubprotocol is the subprotocol name for the shared secret.
	AuthSecretSubprotocol = "kairo-auth-v1"

	// PingInterval is the interval between ping messages (30 seconds).
	PingInterval = 30 * time.Second

	// ReadWriteDeadline is the read/write deadline for WebSocket connections (5 minutes).
	ReadWriteDeadline = 300 * time.Second
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // same-origin requests have no Origin header
		}
		if strings.HasPrefix(origin, "http://localhost") ||
			strings.HasPrefix(origin, "http://127.0.0.1") ||
			strings.HasPrefix(origin, "http://[::1]") {
			return true
		}
		if strings.HasPrefix(origin, "file://") {
			return true
		}
		return false
	},
	ReadBufferSize:    1024,
	WriteBufferSize:   1024,
	Subprotocols:      []string{AuthSecretSubprotocol},
	EnableCompression: false,
}

// AuthValidator is a function that validates the auth credential.
type AuthValidator func(credential string) bool

// Serve implements the EventBus interface from the API layer.
// It handles WebSocket upgrade and event streaming for the given
// workspace. Auth is handled by the API layer before calling Serve.
func (h *EventHub) Serve(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	conn.SetReadLimit(MaxMessageSizeBytes)

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		return
	}

	afterSeqStr := r.URL.Query().Get("afterSequence")
	if afterSeqStr == "" {
		afterSeqStr = r.URL.Query().Get("since")
	}
	afterSequence := int64(0)
	if afterSeqStr != "" {
		if parsed, err := strconv.ParseInt(afterSeqStr, 10, 64); err == nil {
			afterSequence = parsed
		}
	}

	conn.SetReadDeadline(time.Now().Add(ReadWriteDeadline))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(ReadWriteDeadline))
		return nil
	})

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go func() {
		ticker := time.NewTicker(PingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	ch, unsubscribe := h.Subscribe(workspaceID, "", afterSequence)
	defer unsubscribe()

	for event := range ch {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := conn.WriteJSON(event); err != nil {
			return
		}
	}
}

// ServeWS handles WebSocket connections for event streaming with auth.
// Auth is done via X-Kairo-Auth header or kairo-auth-v1 subprotocol.
// Connection params: ?workspaceId=xxx&afterSequence=123
func (h *EventHub) ServeWS(w http.ResponseWriter, r *http.Request, secretValidator AuthValidator) {
	if !authenticateRequest(r, secretValidator) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	conn.SetReadLimit(MaxMessageSizeBytes)

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		return
	}

	afterSeqStr := r.URL.Query().Get("afterSequence")
	if afterSeqStr == "" {
		afterSeqStr = r.URL.Query().Get("since")
	}
	afterSequence := int64(0)
	if afterSeqStr != "" {
		if parsed, err := strconv.ParseInt(afterSeqStr, 10, 64); err == nil {
			afterSequence = parsed
		}
	}

	conn.SetReadDeadline(time.Now().Add(ReadWriteDeadline))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(ReadWriteDeadline))
		return nil
	})

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go func() {
		ticker := time.NewTicker(PingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	ch, unsubscribe := h.Subscribe(workspaceID, "", afterSequence)
	defer unsubscribe()

	for event := range ch {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := conn.WriteJSON(event); err != nil {
			return
		}
	}
}

// ServeWSCompat is a backward-compatible WebSocket handler that does not
// require authentication. Only use for localhost development.
func (h *EventHub) ServeWSCompat(w http.ResponseWriter, r *http.Request) {
	h.ServeWS(w, r, func(credential string) bool { return true })
}

// authenticateRequest checks the request for valid auth credentials.
// It checks (in order):
// 1. X-Kairo-Auth header
// 2. kairo-auth-v1 subprotocol
// Never accepts secret from URL query parameters.
func authenticateRequest(r *http.Request, validator AuthValidator) bool {
	if validator == nil {
		return true
	}

	secret := r.Header.Get(AuthSecretHeader)
	if secret != "" {
		return validator(secret)
	}

	for _, proto := range websocket.Subprotocols(r) {
		if proto == AuthSecretSubprotocol {
			protoHeader := r.Header.Get("Sec-WebSocket-Protocol")
			parts := strings.Split(protoHeader, ",")
			for _, part := range parts {
				part = strings.TrimSpace(part)
				if strings.HasPrefix(part, AuthSecretSubprotocol+"-") {
					cred := strings.TrimPrefix(part, AuthSecretSubprotocol+"-")
					if cred != "" && validator(cred) {
						return true
					}
				}
			}
		}
	}

	return false
}