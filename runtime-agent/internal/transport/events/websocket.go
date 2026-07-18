package events

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Only allow localhost in Desktop v1
		return true // For now, let middleware handle auth
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// ServeWS handles WebSocket connections for event streaming.
func (h *EventHub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		return
	}

	// Set read deadline for ping/pong
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		return nil
	})

	// Send ping every 15 seconds
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					close(done)
					return
				}
			case <-done:
				return
			}
		}
	}()

	// Subscribe
	_, ch, unsubscribe := h.Subscribe(workspaceID)
	defer unsubscribe()

	// Send history
	events, hasGap := h.GetHistory(workspaceID, 0)
	if hasGap {
		conn.WriteJSON(Event{
			Type:        EventSnapshotRequired,
			WorkspaceID: workspaceID,
			Message:     "Please re-sync snapshot",
		})
	}
	for _, e := range events {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := conn.WriteJSON(e); err != nil {
			return
		}
	}

	// Forward events
	for event := range ch {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := conn.WriteJSON(event); err != nil {
			return
		}
	}
}